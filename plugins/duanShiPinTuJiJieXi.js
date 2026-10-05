// [title: 短视频图集解析]
// [name: duanShiPinTuJiJieXi]
// [desc: 解析抖音、快手、微博、皮皮虾、西瓜、小红书、哔哩哔哩等平台视频和图集]
// [author: 297129582]
// [version: v2.0.0]
// [rule: raw (https?://\S+(?:douyin\.com|kuaishou\.com|chenzhongtech\.com|kuai-fei\.com|weibo\.com|t\.cn|pipix\.com|pipigx\.com|ixigua\.com|xhslink\.com|xiaohongshu\.com|bilibili\.com|b23\.tv|bili2233\.cn)\S*)]
// [rule: ^短视频图集解析$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 999999999]
// [class: 影音类]
// [icon: https://fe-video-qc.xhscdn.com/fe-platform/ed8fe781ce9e16c1bfac2cd962f0721edabe2e49.ico]
// [carry: true]
// [origin: backup/短视频图集解析_v1.1.2_By.297129582.txt;backup/短视频图集解析_v1.2.0_By.297129582.js]
// [depe: []]

const { Bucket, sender: s, plugin, utils } = require("sillygirl");

const settings = new Bucket("duanShiPinTuJiJieXi.groups");
const form = new plugin.Form({
  api_endpoints: plugin.Form.string()
    .title("解析接口")
    .description("每行一个，末尾直接拼接原链接")
    .default("https://api.qingxiongvideo.cn/api/parse?url="),
  short_url_api: plugin.Form.string().title("短链接口").description("末尾直接拼接目标链接，可留空").default(""),
  timeout_ms: plugin.Form.integer().title("请求超时毫秒").min(3000).max(30000).default(8000),
  image_total: plugin.Form.integer().title("图集最多图片").min(1).max(100).default(66),
  image_batch: plugin.Form.integer().title("每批图片数").min(1).max(18).default(9),
  batch_sleep_ms: plugin.Form.integer().title("批次间隔毫秒").min(0).max(10000).default(1000),
});

async function main() {
  const cfg = (await form.get()) || {};
  const content = String((await s.getMsg()) || "").trim();
  const chatId = String((await s.getChatId()) || "private");
  if (content === "短视频图集解析") return configure(chatId);
  const match = content.match(/https?:\/\/[^\s"'<>]+/i);
  if (!match) return;
  const enabled = await settings.get(`enabled:${chatId}`, chatId === "private" ? "true" : "false");
  if (enabled !== "true") return;
  const data = await parseMedia(match[0].replace(/\\/g, ""), cfg);
  if (Number(data?.code) !== 200) throw new Error(data?.msg || "解析失败，视频不存在或接口失效");
  // 新 API 适配：图集用 images 数组，视频用 video/videoUrl
  const images =
    Array.isArray(data.images) && data.images.length
      ? data.images
      : Array.isArray(data.rawImages) && data.rawImages.length
        ? data.rawImages
        : [];
  if (images.length) return sendImages(images, cfg);
  const video = data.video || data.videoUrl || data.downloadUrl || data.url;
  if (!video) throw new Error("接口没有返回视频地址");
  return s.reply(utils.video(await maybeShort(String(video), cfg)));
}

async function configure(chatId) {
  if (!(await s.isAdmin())) return s.reply("仅管理员可设置");
  const enabled = await settings.get(`enabled:${chatId}`, chatId === "private" ? "true" : "false");
  const caption = await settings.get(`caption:${chatId}`, "false");
  await s.reply(
    ["◇—短视频图集解析设置—◇", `1. 开/关本会话解析 [${enabled}]`, `2. 开/关文案 [${caption}]`, "q. 退出"].join("\n"),
  );
  const child = await s.listen({ timeout: 30000 });
  if (!child) return;
  const choice = String((await child.getMsg()) || "").trim();
  if (choice === "1") {
    const next = enabled === "true" ? "false" : "true";
    await settings.set(`enabled:${chatId}`, next);
    return s.reply(next === "true" ? "本会话已开启" : "本会话已关闭");
  }
  if (choice === "2") {
    const next = caption === "true" ? "false" : "true";
    await settings.set(`caption:${chatId}`, next);
    return s.reply(next === "true" ? "文案已开启" : "文案已关闭");
  }
  return s.reply("已退出");
}

async function parseMedia(url, cfg) {
  const endpoints = String(cfg.api_endpoints || "")
    .split(/\r?\n|,/)
    .map((row) => row.trim())
    .filter(Boolean);
  let last = "";
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${endpoint}${url}`, {
        signal: AbortSignal.timeout(Number(cfg.timeout_ms) || 8000),
        headers: { "user-agent": "Mozilla/5.0" },
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = JSON.parse(text);
      if (data && data.code !== undefined) return data;
      last = text.slice(0, 160);
    } catch (error) {
      last = String(error?.message || error);
    }
  }
  throw new Error(`全部解析接口失败：${last}`);
}

async function information(data, cfg) {
  const out = [`▁▂【${data.name || "短视频"}${data.type || ""}】▂▁`];
  if (data.cover) out.push(utils.image(data.cover));
  if (data.author) out.push(`🗣️作者：${data.author}`);
  if (data.uid) out.push(`🆔UID：${data.uid}`);
  if (data.title) out.push(`📝标题：${data.title}`);
  const stats = [
    ["👍点赞", data.like],
    ["💬评论", data.comment],
    ["⭐收藏", data.collect],
    ["🔄分享", data.share],
  ]
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([name, value]) => `${name}:${value}`);
  if (stats.length) out.push(stats.join("  "));
  if (data.time) out.push(`🕐发布：${formatTime(data.time)}`);
  for (const [name, value] of [
    ["封面", data.cover],
    ["头像", data.avatar],
    ["音频", data.music],
    ["视频", Array.isArray(data.url) ? "" : data.url],
  ])
    if (value) out.push(`${name}：${await maybeShort(String(value), cfg)}`);
  return out.join("\n");
}

async function sendImages(images, cfg) {
  const rows = images.filter(Boolean).slice(0, Number(cfg.image_total) || 66),
    size = Number(cfg.image_batch) || 9;
  if (!rows.length) throw new Error("接口没有返回图集地址");
  for (let index = 0; index < rows.length; index += size) {
    await s.reply(
      rows
        .slice(index, index + size)
        .map((url) => utils.image(String(url)))
        .join("\n"),
    );
    if (index + size < rows.length && cfg.batch_sleep_ms)
      await new Promise((resolve) => setTimeout(resolve, Number(cfg.batch_sleep_ms)));
  }
}

async function maybeShort(url, cfg) {
  const api = String(cfg.short_url_api || "").trim();
  if (!api) return url;
  try {
    const response = await fetch(`${api}${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(Number(cfg.timeout_ms) || 8000),
    });
    const text = (await response.text()).trim();
    return response.ok && text ? text : url;
  } catch {
    return url;
  }
}
function formatTime(value) {
  const raw = Number(value),
    date = new Date(String(Math.trunc(raw)).length === 10 ? raw * 1000 : raw);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { hour12: false });
}

main().catch((error) => s.reply(`短视频图集解析失败：${String(error?.message || error).slice(0, 300)}`));
