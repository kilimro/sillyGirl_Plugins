<?php
/**
 * 摸鱼日报 - 绘图接口（改造版 v1.2）
 *
 * 调用：GET /API/moyu/a/moyu.php?nickname=<昵称>&days=<天数>&avatar=<头像URL>
 * 返回：{"code":200,"msg":"success","url":"https://<host>/API/moyu/a/data/moyu/<hash>.png","size":12345,"tips":"图片仅保存24小时，请及时保存"}
 *
 * 说明：
 *   - 本接口只负责绘图返图，昵称/天数/头像由调用方（JS 插件）传入
 *   - 昵称自动清理：[YW.emoji,id=xxx] 脏数据、emoji 表情（GD 字体渲染不了）、超 6 个字符截断加 ...
 *   - 日历（日期/星期）在服务端本地计算
 *   - 文案从原接口 $tipsApi 获取（键 1~7），失败则跳过文案绘制
 *   - 资源：bg1.png（背景图）、zt.ttf（字体），与本文件同目录
 *   - 删除机制：每次生成前自动清理 data/moyu 下超过 24 小时的旧图，防止堆积
 */

// ===================== 可配置项 =====================
// 生成图片的公网访问前缀（按实际部署路径修改）
$publicPrefix = '/API/moyu/a/data/moyu/';
// 摸鱼文案接口（原接口，返回键 1~7）
$tipsApi = 'https://api.920pdd.com/API/my/moyu.php';

header('Content-Type: application/json; charset=utf-8');

// ===================== 1. 基础参数 =====================
$nickname = isset($_GET['nickname']) ? urldecode(trim($_GET['nickname'])) : '';
$days     = isset($_GET['days']) ? trim($_GET['days']) : '0';
$avatar   = isset($_GET['avatar']) ? trim($_GET['avatar']) : '';

$nickname = cleanNickname($nickname);
if ($nickname === '') $nickname = '神秘摸鱼人';
if (!preg_match('/^\d+$/', $days)) $days = '0';

// ===================== 2. 目录与删除机制 =====================
$baseDir = __DIR__ . '/data';
$moyuDir = $baseDir . '/moyu';
if (!is_dir($moyuDir)) {
    mkdir($moyuDir, 0755, true);
    chmod($moyuDir, 0755);
}
// 清理 24 小时前的旧图，防止每天打卡无限堆积
$oldTime = time() - 86400;
foreach (glob($moyuDir . '/*.png') as $f) {
    if (@filemtime($f) < $oldTime) @unlink($f);
}

$hash    = substr(sha1($nickname . $days . time() . mt_rand(1000, 9999)), 0, 16);
$outFile = $moyuDir . '/' . $hash . '.png';

// ===================== 3. 资源检查 =====================
$bgFile   = __DIR__ . '/bg1.png';
$fontFile = __DIR__ . '/zt.ttf';
if (!file_exists($bgFile)) {
    echo json_encode(['code' => -3, 'msg' => '背景图 bg1.png 不存在'], JSON_UNESCAPED_UNICODE);
    exit;
}
if (!file_exists($fontFile)) {
    echo json_encode(['code' => -6, 'msg' => '字体 zt.ttf 不存在'], JSON_UNESCAPED_UNICODE);
    exit;
}

// ===================== 4. 加载背景 =====================
$detail = getimagesize($bgFile);
if ($detail === false) {
    echo json_encode(['code' => -4, 'msg' => '背景图无法解析'], JSON_UNESCAPED_UNICODE);
    exit;
}
$imageType = image_type_to_extension($detail[2], false); // png / jpeg / gif ...
$createFn  = "imagecreatefrom{$imageType}";
if (!function_exists($createFn)) {
    echo json_encode(['code' => -5, 'msg' => "不支持背景图类型：{$imageType}"], JSON_UNESCAPED_UNICODE);
    exit;
}
$image = $createFn($bgFile);

// ===================== 5. 头像（下载失败则跳过绘制） =====================
if ($avatar !== '') {
    $ctx = stream_context_create([
        'http'  => ['timeout' => 10, 'user_agent' => 'Mozilla/5.0'],
        'https' => ['timeout' => 10, 'user_agent' => 'Mozilla/5.0'],
    ]);
    $imgBin = @file_get_contents($avatar, false, $ctx);
    if ($imgBin !== false && strlen($imgBin) > 0) {
        $avatarRes = @imagecreatefromstring($imgBin);
        if ($avatarRes !== false) {
            $imgH = intval($detail[1] / 11) - 28; // 头像大小（与原始代码一致）
            $circle = getCircleAvatar($avatarRes, $imgH);
            if ($circle !== false) {
                imagecopy($image, $circle, 498, intval($detail[1] / 3) + 624, 0, 0, $imgH, $imgH);
                imagedestroy($circle);
            }
            imagedestroy($avatarRes);
        }
    }
}

// ===================== 6. 文字绘制 =====================
$mColor = imagecolorallocate($image, 93, 147, 98);

$text   = date('Y年m月d日');
$weekMap = [
    'Mon' => '星期一', 'Tue' => '星期二', 'Wed' => '星期三', 'Thu' => '星期四',
    'Fri' => '星期五', 'Sat' => '星期六', 'Sun' => '星期日',
];
$xqtext = isset($weekMap[date('D')]) ? $weekMap[date('D')] : '';

// 摸鱼天数 / 昵称
imagettftext($image, 25, 13, 110, 800, $mColor, $fontFile, '摸鱼天数：' . $days);
imagettftext($image, 25, 13, 110, 750, $mColor, $fontFile, $nickname);
// 星期 / 日期
imagettftext($image, 25, 0, 530, 407, $mColor, $fontFile, $xqtext);
imagettftext($image, 22, 0, 479, 368, $mColor, $fontFile, $text);

// 7 条摸鱼文案（从原接口获取，键 1~7；失败则跳过文案绘制）
$tips = [];
$tipsCtx = stream_context_create([
    'http'  => ['timeout' => 8, 'user_agent' => 'Mozilla/5.0'],
    'https' => ['timeout' => 8, 'user_agent' => 'Mozilla/5.0'],
]);
$tipsBin = @file_get_contents($tipsApi, false, $tipsCtx);
if ($tipsBin !== false) {
    $tipsJson = @json_decode($tipsBin, true);
    if (is_array($tipsJson)) {
        for ($i = 1; $i <= 7; $i++) {
            if (isset($tipsJson[$i])) $tips[] = $tipsJson[$i];
        }
    }
}
$baseX = 80;
$baseY = 1015;
foreach ($tips as $i => $tip) {
    imagettftext($image, 22, 10, $baseX + $i * 6, $baseY + $i * 33, $mColor, $fontFile, $tip);
}

// ===================== 7. 保存并返回 URL =====================
imagepng($image, $outFile);
$size = filesize($outFile);
imagedestroy($image);

$host = isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : '';
$publicUrl = 'https://' . $host . $publicPrefix . basename($outFile);

echo json_encode([
    'code' => 200,
    'msg'  => 'success',
    'url'  => $publicUrl,
    'size' => $size,
    'tips' => '图片仅保存24小时，请及时保存',
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

// ===================== 昵称清洗 =====================
/**
 * 昵称清洗：
 *   1. 去掉 [YW.emoji,id=xxx] 这类脏数据
 *   2. 过滤 emoji 表情（GD 的 imagettftext 用 zt.ttf 渲染不了 emoji，会显示成方块）
 *   3. 最多 6 个字符，超过截断为前 6 个 + "..."
 * 不依赖 mbstring 扩展（纯 UTF-8 正则按字符拆分）。
 * @param string $nickname 原始昵称（UTF-8）
 * @return string 清洗后的昵称
 */
function cleanNickname($nickname)
{
    // 1. 去 yyw emoji 标记脏数据
    $nickname = preg_replace('/\[YW\.emoji,id=\d+\]/', '', $nickname);
    // 2. 过滤 emoji 字符（主要 emoji 区 + 杂项符号 + 变体选择符 + 零宽连接符 + 键帽）
    $nickname = preg_replace(
        '/[\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B00}-\x{2BFF}\x{FE0F}\x{200D}\x{20E3}]/u',
        '',
        $nickname
    );
    // 3. 清理多余空白
    $nickname = preg_replace('/\s+/u', ' ', trim($nickname));
    if ($nickname === '') return '';
    // 4. 按 UTF-8 字符拆分，最多 6 个，超过加 "..."
    preg_match_all('/./us', $nickname, $chars);
    $chars = $chars[0];
    if (count($chars) > 6) {
        $nickname = implode('', array_slice($chars, 0, 6)) . '...';
    }
    return $nickname;
}

// ===================== 圆形头像裁剪 =====================
/**
 * 将任意尺寸头像裁剪为圆形并缩放到指定大小。
 * 实现与原始 imageAvatar 一致：居中裁正方形 → 等比缩放 → 圆外像素设为透明。
 * @param resource $src 源图像资源（GD）
 * @param int $size 目标边长（像素）
 * @return resource|false 圆形头像资源
 */
function getCircleAvatar($src, $size)
{
    $w = imagesx($src);
    $h = imagesy($src);
    $side = min($w, $h);

    // 1. 居中裁正方形
    $square = imagecreatetruecolor($side, $side);
    imagecopy($square, $src, 0, 0, intval(($w - $side) / 2), intval(($h - $side) / 2), $side, $side);

    // 2. 等比缩放到目标大小
    $dst = imagecreatetruecolor($size, $size);
    imagealphablending($dst, false);
    imagesavealpha($dst, true);
    imagecopyresampled($dst, $square, 0, 0, 0, 0, $size, $size, $side, $side);
    imagedestroy($square);

    // 3. 圆外像素设为透明（与原始 imageAvatar 逐像素逻辑一致）
    $r = $size / 2;
    $transparent = imagecolorallocatealpha($dst, 0, 0, 0, 127);
    for ($x = 0; $x < $size; $x++) {
        for ($y = 0; $y < $size; $y++) {
            $dx = $x - $size / 2;
            $dy = $y - $size / 2;
            if (($dx * $dx + $dy * $dy) > ($r * $r)) {
                imagesetpixel($dst, $x, $y, $transparent);
            }
        }
    }

    return $dst;
}
