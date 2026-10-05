// [title: AI 画画]
// [name: aiDraw]
// [desc: 发"画一只猫"AI 生成图片。支持 MiniMax 和 OpenAI 兼容接口，每人每天限次。]
// [author: Mianpro官方]
// [version: v1.0.0]
// [rule: ^画(.+)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 工具]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: 自定义]
// [depe: ["./aiDrawCore.js"]]

const { sender: s, Bucket, plugin } = require("sillygirl");
const draw = require("./aiDrawCore.js");

const QUOTA_BUCKET = "ai_draw_quota";

const form = new plugin.Form({
  provider: plugin.Form.string()
    .title("画图提供商")
    .description("minimax=MiniMax image-01；openai=OpenAI 兼容 /v1/images/generations")
    .default("minimax"),
  api_key: plugin.Form.string().title("API Key").default("").required(),
  minimax_model: plugin.Form.string()
    .title("MiniMax 模型")
    .description("image-01 或 image-01-live")
    .default("image-01"),
  minimax_aspect: plugin.Form.string()
    .title("MiniMax 画幅比例")
    .description("1:1 / 16:9 / 9:16 / 4:3 / 3:4 等")
    .default("1:1"),
  openai_base_url: plugin.Form.string()
    .title("OpenAI 兼容 BaseURL")
    .description("openai 模式填你的中转站地址，如 https://api.openai.com/v1")
    .default("https://api.openai.com/v1"),
  openai_model: plugin.Form.string()
    .title("OpenAI 画图模型")
    .description("如 dall-e-3、stable-diffusion-xl 等")
    .default("dall-e-3"),
  openai_size: plugin.Form.string().title("图片尺寸").description("如 1024x1024、1792x1024").default("1024x1024"),
  daily_limit: plugin.Form.integer().title("每人每天次数").default(3).min(1).max(100),
});

const quotaStore = new Bucket(QUOTA_BUCKET);

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function getAndIncrQuota(userId) {
  const key = `quota:${userId}`;
  const raw = String(await quotaStore.get(key, "{}"));
  let record;
  try {
    record = JSON.parse(raw);
  } catch (_) {
    record = {};
  }
  if (record.date !== today()) {
    record = { date: today(), count: 0 };
  }
  record.count = Number(record.count || 0) + 1;
  await quotaStore.set(key, JSON.stringify(record));
  return record.count;
}

async function main() {
  const cfg = (await form.get()) || {};
  if (!String(cfg.api_key || "").trim()) return;

  const raw = String((await s.getMsg()) || "").trim();
  const m = raw.match(/^画(.+)$/);
  if (!m) return;
  const prompt = m[1].trim();
  if (!prompt) return;

  const userId = String((await s.getUserId()) || "");
  const used = await getAndIncrQuota(userId);
  if (used > Number(cfg.daily_limit)) {
    return s.reply(`今天已经画了 ${cfg.daily_limit} 张啦，明天再来～`);
  }

  await s.reply(`正在画「${prompt.slice(0, 50)}」，请稍等...`);

  try {
    const urls = await draw.draw({
      provider: cfg.provider,
      apiKey: cfg.api_key,
      model: cfg.provider === "openai" ? cfg.openai_model : cfg.minimax_model,
      prompt,
      aspectRatio: cfg.minimax_aspect,
      size: cfg.openai_size,
      baseUrl: cfg.openai_base_url,
      n: 1,
    });
    for (const url of urls) {
      await s.reply(`[CQ:image,file=${url}]`);
    }
  } catch (error) {
    await s.reply(`画画失败：${String(error?.message || error).slice(0, 200)}`);
  }
}

main().catch(async (error) => {
  try {
    await s.reply(`AI 画画插件异常：${String(error?.message || error).slice(0, 200)}`);
  } catch (_) {}
});
