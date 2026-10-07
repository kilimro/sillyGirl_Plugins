// [title: Gewe多媒体示例]
// [name: geweMediaDemo]
// [desc: 演示 geweMedia 依赖模块用法：收到图片/语音/文件/视频时自动下载→(语音转mp3)→上传Cloudflare R2→回复公网URL。配置好R2后即可用于把用户发来的多媒体转成公网URL供其它插件使用。]
// [author: Mianpro官方]
// [version: v1.0.0]
// [rule: raw (\[CQ:(image|record|file|video),file=[^\]]+\])]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 999]
// [class: 示例]
// [icon: https://api.920pdd.com/favicon.ico]
// [origin: 自定义]
// [depe: ["./geweMedia.js"]]

"use strict";
const { sender: s, plugin } = require("sillygirl");
const gewe = require("./geweMedia.js");

const form = new plugin.Form({
  auto_upload: plugin.Form.boolean().title("自动处理开关").description("关闭后不响应多媒体").default(true),
  voice_to_mp3: plugin.Form.boolean().title("语音转mp3").description("收到语音先转成mp3再上传").default(true),
  download_dir: plugin.Form.string().title("下载目录").description("留空用 geweMedia 默认目录").default(""),
  r2_account_id: plugin.Form.string().title("R2 账户ID").default(""),
  r2_access_key: plugin.Form.string().title("R2 Access Key ID").default(""),
  r2_secret_key: plugin.Form.string().title("R2 Secret Access Key").default(""),
  r2_bucket: plugin.Form.string().title("R2 Bucket 名").default(""),
  r2_public_url: plugin.Form.string()
    .title("R2 公网访问域名")
    .description("如 https://pub.example.com，上传后拼在 key 前")
    .default(""),
});

const CQ_RE = /\[CQ:(image|record|file|video),file=([^\]]+)\]/g;

async function main() {
  const cfg = (await form.get()) || {};
  if (!cfg.auto_upload) return;
  const content = String((await s.getMsg()) || "").trim();
  if (!content) return;

  // 1. 配置 geweMedia（R2 上传后端 + 下载目录）
  gewe.configure({
    downloadDir: String(cfg.download_dir || "").trim(),
    upload: {
      provider: "r2",
      accountId: String(cfg.r2_account_id || "").trim(),
      accessKeyId: String(cfg.r2_access_key || "").trim(),
      secretAccessKey: String(cfg.r2_secret_key || "").trim(),
      bucketName: String(cfg.r2_bucket || "").trim(),
      publicBaseUrl: String(cfg.r2_public_url || "").trim(),
    },
  });

  // 2. 解析消息里的 CQ 多媒体码
  const tags = [];
  let match;
  CQ_RE.lastIndex = 0;
  while ((match = CQ_RE.exec(content))) tags.push({ type: match[1], url: match[2] });
  if (!tags.length) return;

  await s.reply(`检测到 ${tags.length} 个多媒体，开始处理...`);
  for (const tag of tags) {
    try {
      // 3. 下载到本地
      const dl = await gewe.download(tag.url, { type: tag.type });
      let filePath = dl.path;

      // 4. 语音可选转 mp3
      if (tag.type === "record" && cfg.voice_to_mp3) {
        const mp3 = await gewe.voiceToMp3(dl.path, { format: "mp3" });
        filePath = mp3.path;
      }

      // 5. 上传 R2，得到公网 URL
      const publicUrl = await gewe.toSendableUrl(filePath);
      await s.reply(`【${tag.type}】下载 ${dl.size} 字节 → ${publicUrl}`);
    } catch (error) {
      await s.reply(`处理 ${tag.type} 失败：${String(error?.message || error).slice(0, 200)}`);
    }
  }
}

main().catch((error) => s.reply(`Gewe多媒体示例异常：${String(error?.message || error).slice(0, 200)}`));
