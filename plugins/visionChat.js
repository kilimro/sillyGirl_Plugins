// [title: 图片识图助手]
// [name: visionChat]
// [desc: 仅 Gewe / yyw 平台、仅管理员可用。收到图片消息后调用多模态大模型识图并转成中文文字回复。基于 OpenAI 兼容 Chat Completions + image_url 多模态输入，默认 MiniMax-M3.1-Flash-Preview（M Plan 原生多模态，Key 自动读 ~/.mmx/config.json），也可配置其他支持 image_url 的厂商（GLM-4V / Qwen-VL / Kimi 等）。Gewe 走 CDN 下载；yyw 解析 [YW.img] 并拼接「yyw 媒体公网地址」公网图片 URL（脚本转换有约 2 秒延迟，已自动等待；该地址只在本地配置，不写入代码）。v1.1 起识图结果写入统一会话记忆 mm_chat_history，后续可直接用 aiChat / voiceChat 追问图片内容（只带识图文字描述，不带原图）。]
// [author: Mianpro官方]
// [version: v1.2.0]
// [rule: raw ^\[(CQ:image|YW\.img)[^\]]*\]$]
// [status: true]
// [admin: true]
// [public: true]
// [priority: 900]
// [class: 大模型]
// [icon: https://www.minimax.cn/favicon.ico]
// [origin: 自定义]
// [depe: ["./geweCore.js","./openaiChatCore.js"]]

"use strict";
const { sender: s, plugin } = require("sillygirl");
const os = require("os");
const path = require("path");
const fs = require("fs");
const geweCore = require("./geweCore.js");
const mm = require("./openaiChatCore.js");

const API_TIMEOUT = 90000; // 多模态识别 90 秒超时
const DEFAULT_BASE = "https://api.minimax.cn/v1";
const DEFAULT_MODEL = "MiniMax-M3.1-Flash-Preview";

const form = new plugin.Form({
  base_url: plugin.Form.string()
    .title("API 地址（OpenAI 兼容）")
    .description("留空默认 MiniMax：https://api.minimax.cn/v1（海外 https://api.minimax.io/v1）；换其他厂商填对应地址，如智谱 https://open.bigmodel.cn/api/paas/v4")
    .default(""),
  api_key: plugin.Form.string()
    .title("API Key")
    .description("留空自动读取本机 ~/.mmx/config.json 的 MiniMax 订阅 Key；换其他厂商需填对应 Key")
    .default(""),
  model: plugin.Form.string()
    .title("多模态模型")
    .description("默认 MiniMax-M3.1-Flash-Preview（M Plan 原生多模态）；其他支持 image_url 的模型如 GLM-4V / qwen-vl-plus / moonshot-v1-vision 均可")
    .default("MiniMax-M3.1-Flash-Preview"),
  vision_prompt: plugin.Form.string()
    .title("识图提示词")
    .description("发送给模型的指令，控制识别输出的详细程度和语言")
    .default("请用中文详细描述这张图片的内容，包括主体、场景、人物或物体、画面中的文字等，越详细越好。"),
  cooldown_seconds: plugin.Form.number()
    .title("防抖秒数")
    .description("同一时间窗口内连续收到的图片只识别一次，防止刷屏")
    .default(10),
  yyw_media_base: plugin.Form.string()
    .title("yyw 媒体公网地址")
    .description("yyw 平台图片/语音转公网的地址（如 http://你的服务器:端口，不含末尾斜杠）。填了 yyw 平台才能识图；留空=yyw 平台自动不可用。Gewe 平台无需填写")
    .default(""),
});

let cfg = {};

function parseJson(stdout) {
  const text = String(stdout || "").trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (_) {
    return null;
  }
}

// 读取本机 ~/.mmx/config.json 里的订阅 Key（mmx auth login 的登录凭证）
function readMmxApiKey() {
  try {
    const p = path.join(os.homedir(), ".mmx", "config.json");
    if (!fs.existsSync(p)) return "";
    const data = JSON.parse(fs.readFileSync(p, "utf-8"));
    return String(data?.apiKey || data?.api_key || data?.token || "").trim();
  } catch (_) {
    return "";
  }
}

// OpenAI 兼容 Chat Completions + image_url 多模态识图
async function visionChat(imgUrl) {
  const key = String(cfg.api_key || "").trim() || readMmxApiKey();
  if (!key) throw new Error("未找到 API Key：请填 api_key，或先在本机执行 mmx auth login");
  const base = String(cfg.base_url || "").trim().replace(/\/+$/, "") || DEFAULT_BASE;
  const model = String(cfg.model || "").trim() || DEFAULT_MODEL;
  const prompt =
    String(cfg.vision_prompt || "").trim() ||
    "请用中文详细描述这张图片的内容，包括主体、场景、人物或物体、画面中的文字等，越详细越好。";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imgUrl, detail: "default" } },
            ],
          },
        ],
        max_completion_tokens: 2000,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`API HTTP ${res.status}：${text.slice(0, 150)}`);
    const data = parseJson(text);
    if (!data) throw new Error("API 返回无法解析");

    // OpenAI 标准响应：choices[0].message.content（字符串或内容块数组）
    const raw = data?.choices?.[0]?.message?.content;
    let content = "";
    if (typeof raw === "string") {
      content = raw.trim();
    } else if (Array.isArray(raw)) {
      content = raw.map((c) => String(c?.text || c?.content || "")).filter(Boolean).join("").trim();
    }
    return content;
  } catch (err) {
    if (err?.name === "AbortError") throw new Error("识别超时（90 秒）");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

let lastVisionAt = 0;

async function main() {
  cfg = (await form.get()) || {};
  const raw = String((await s.getMsg()) || "").trim();
  if (!raw) return;

  // 仅 Gewe / yyw 平台可用（Gewe 走 CDN 下载；yyw 走「yyw 媒体公网地址」拼接公网图片 URL）
  const platform = String((await s.getPlatform()) || "").toLowerCase();
  if (platform !== "gewe" && platform !== "yyw") return;

  // 防抖：配置秒数内连续图片只识别一次
  const now = Date.now();
  const cooldownMs = Math.max(1, Number(cfg.cooldown_seconds) || 10) * 1000;
  if (now - lastVisionAt < cooldownMs) return;
  lastVisionAt = now;

  // 提取图片公网地址：gewe=CDN 下载；yyw=解析 [YW.img,file=xxx.img] 拼公网地址（转换脚本约 2 秒延迟，自动等待）
  let imgUrl = "";
  if (platform === "yyw") {
    const base = String(cfg.yyw_media_base || "").trim().replace(/\/+$/, "");
    if (!base) {
      await s.reply("yyw 平台识图需先在插件配置里填写「yyw 媒体公网地址」");
      return;
    }
    const fileMatch = raw.match(/\[YW\.img,file=([^,\]]+)/);
    const file = fileMatch ? fileMatch[1].trim() : "";
    if (!file) {
      await s.reply("未获取到图片地址");
      return;
    }
    // 去掉 .img 扩展名，按 .jpg 拼接（转换服务一般输出 jpg；个别 png 若识别失败可调整）
    const id = file.replace(/\.img$/i, "");
    imgUrl = `${base}/image/${id}.jpg`;
    await new Promise((r) => setTimeout(r, 2000)); // 等转换脚本完成（约 2 秒）
  } else {
    try {
      imgUrl = await geweCore.downloadImageFromCq(raw);
    } catch (e) {
      await s.reply(`取图失败：${String(e?.message || e).slice(0, 100)}`);
      return;
    }
  }
  if (!imgUrl) {
    await s.reply("未获取到图片地址");
    return;
  }

  try {
    const desc = await visionChat(imgUrl);
    if (!desc) {
      await s.reply("识别完成，但没有返回描述内容");
      return;
    }
    await s.reply(desc.slice(0, 1500));

    // 写入统一会话记忆（mm_chat_history）：只带识图文字描述、不带原图，后续可用 aiChat / voiceChat 追问图片内容
    try {
      const chatId = String((await s.getChatId()) || "");
      const userId = String((await s.getUserId()) || "");
      const key = mm.chatKey(platform, chatId, userId);
      const history = await mm.loadHistory(key);
      history.push({ role: "user", content: `用户发来一张图片，图片内容为：${desc}` });
      await mm.saveHistory(key, history, 10);
    } catch (e) {
      console.log(`[visionChat] 写入会话记忆失败: ${e?.message || e}`);
    }
  } catch (err) {
    await s.reply(`识图失败：${String(err?.message || err).slice(0, 150)}`);
  }
}

main().catch(async (error) => {
  await s.reply(`识图异常：${String(error?.message || error).slice(0, 150)}`);
});
