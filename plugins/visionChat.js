// [title: 图片识图助手]
// [name: visionChat]
// [desc: 仅 Gewe 平台、仅管理员可用。收到图片消息后自动识别图片内容并转成中文文字回复（类似语音转文字）。识别支持两种模式：cli=走本机 mmx 命令（需装 mmx-cli）；api=直连 MiniMax VLM API（无需 mmx，Key 自动读 ~/.mmx/config.json）。]
// [author: Mianpro官方]
// [version: v2.0.0]
// [rule: raw ^\[CQ:image[^\]]*\]$]
// [status: true]
// [admin: true]
// [public: true]
// [priority: 900]
// [class: 大模型]
// [icon: https://www.minimax.cn/favicon.ico]
// [origin: 自定义]
// [depe: ["./geweCore.js"]]

"use strict";
const { sender: s, plugin } = require("sillygirl");
const { spawn } = require("child_process");
const os = require("os");
const path = require("path");
const fs = require("fs");
const geweCore = require("./geweCore.js");

const TIMEOUT = 120000;
const VLM_TIMEOUT = 90000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 图片 base64 上限 8MB
const COOLDOWN_MS = 10000; // 10 秒内连续图片只识别一次，防刷屏

const form = new plugin.Form({
  mode: plugin.Form.string()
    .title("识别模式")
    .description("cli=走本机 mmx 命令（需装 mmx-cli 并登录）；api=直连 MiniMax VLM API（无需装 mmx，Key 可自动读 ~/.mmx/config.json）")
    .default("cli"),
  mmx_path: plugin.Form.string()
    .title("mmx 命令路径（cli 模式）")
    .description("留空自动使用 PATH 里的 mmx（Windows 自动找 mmx.cmd）；找不到时可填完整路径，如 C:\\Users\\你\\AppData\\Roaming\\npm\\mmx.cmd")
    .default(""),
  region: plugin.Form.string()
    .title("服务区域")
    .description("cn=国内（默认）；global=海外。api 模式未填 BaseURL 时按此推断")
    .default("cn"),
  base_url: plugin.Form.string()
    .title("API BaseURL（cli 模式可选）")
    .description("留空用 CLI 自动识别；一般不用填")
    .default(""),
  mmx_config_dir: plugin.Form.string()
    .title("mmx 配置目录（可选）")
    .description("CLI 登录信息默认在 ~/.mmx/config.json；若 sillyGirl 运行账号读不到，可填实际目录，如 C:\\Users\\你\\.mmx")
    .default(""),
  api_key: plugin.Form.string()
    .title("API Key（api 模式）")
    .description("留空自动读取本机 ~/.mmx/config.json 里的订阅 Key；也可直接填 API Key")
    .default(""),
  api_base: plugin.Form.string()
    .title("API BaseURL（api 模式）")
    .description("留空按区域自动：cn=https://api.minimax.cn，global=https://api.minimax.io")
    .default(""),
  vision_prompt: plugin.Form.string()
    .title("识图提示词")
    .description("发送给视觉模型的指令，控制识别输出的详细程度和语言；默认中文详细描述")
    .default("请用中文详细描述这张图片的内容，包括主体、场景、人物或物体、画面中的文字等，越详细越好。"),
  enable_private: plugin.Form.boolean().title("私聊启用").default(true),
  enable_group: plugin.Form.boolean().title("群聊启用").default(true),
});

let cfg = {};

// 配置值容错：用户可能误填成 "mmx_path: xxx" 带键名前缀，自动清洗
function cleanCfgValue(value, key) {
  return String(value || "")
    .replace(new RegExp(`^${key}\\s*[:：]\\s*`, "i"), "")
    .trim();
}

// Windows 下 .cmd 参数：剔除 cmd 元字符，再双引号包裹
function winCmdArg(value) {
  const cleaned = String(value)
    .replace(/["%^!&|<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `"${cleaned}"`;
}

// 执行 mmx 命令（macOS/Linux 直接 spawn；Windows 必须经 cmd.exe /c 拉起 .cmd）
function runMmx(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const bin =
      cleanCfgValue(cfg.mmx_path, "mmx_path") ||
      (process.platform === "win32" ? "mmx.cmd" : "mmx");
    const env = { ...process.env };
    const configDir = cleanCfgValue(cfg.mmx_config_dir, "mmx_config_dir");
    if (configDir) env.MMX_CONFIG_DIR = configDir;
    const baseUrl = cleanCfgValue(cfg.base_url, "base_url");
    if (baseUrl) env.MINIMAX_BASE_URL = baseUrl;
    const region = cleanCfgValue(cfg.region, "region");
    if (region) env.MINIMAX_REGION = region;
    let child;
    if (process.platform === "win32") {
      const cmdLine = `""${bin}" ${args.map(winCmdArg).join(" ")}"`;
      child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", cmdLine], {
        env,
        windowsHide: true,
        windowsVerbatimArguments: true,
      });
    } else {
      child = spawn(bin, args, { env, windowsHide: true });
    }
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs || TIMEOUT);
    child.stdout?.on("data", (d) => { stdout += d; });
    child.stderr?.on("data", (d) => { stderr += d; });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`mmx 启动失败：${err?.message || err}（未安装请先 npm install -g mmx-cli，或配置 mmx_path）`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else {
        const msg = String(stderr || stdout || "").trim().slice(0, 200);
        reject(new Error(msg || `mmx 退出码 ${code}`));
      }
    });
  });
}

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

function firstText(data, keys = []) {
  if (data == null) return "";
  if (typeof data === "string") return data.trim();
  if (Array.isArray(data)) {
    for (const item of data) {
      const t = firstText(item, keys);
      if (t) return t;
    }
    return "";
  }
  if (typeof data === "object") {
    for (const k of keys) {
      if (data[k] != null) {
        const t = firstText(data[k], keys);
        if (t) return t;
      }
    }
    for (const v of Object.values(data)) {
      if (typeof v === "string" && v.trim().length < 4) continue;
      const t = firstText(v, keys);
      if (t) return t;
    }
  }
  return "";
}

// 读取本机 ~/.mmx/config.json 里的订阅 Key（CLI 登录凭证）
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

// api 模式：按配置或区域推断 MiniMax API BaseURL
function resolveApiBase() {
  const b = String(cfg.api_base || "").trim();
  if (b) return b.replace(/\/+$/, "");
  const region = String(cfg.region || "cn").trim().toLowerCase();
  return region === "global" ? "https://api.minimax.io" : "https://api.minimax.cn";
}

// 下载图片并转成 base64 data URI（喂给 VLM API）
async function urlToDataUri(imgUrl) {
  const res = await fetch(imgUrl, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`下载图片失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("下载图片为空");
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new Error(`图片过大（${(buf.length / 1024 / 1024).toFixed(1)}MB，上限 8MB）`);
  }
  const mime = String(res.headers.get("content-type") || "").split(";")[0] || "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

// api 模式：直连 MiniMax VLM API（POST /v1/coding_plan/vlm）
async function visionApi(imgUrl) {
  const key = String(cfg.api_key || "").trim() || readMmxApiKey();
  if (!key) throw new Error("未找到 MiniMax Key：请填 api_key，或先在本机执行 mmx auth login");
  const prompt =
    String(cfg.vision_prompt || "").trim() ||
    "请用中文详细描述这张图片的内容，包括主体、场景、人物或物体、画面中的文字等，越详细越好。";
  const dataUri = await urlToDataUri(imgUrl);
  const endpoint = `${resolveApiBase()}/v1/coding_plan/vlm`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VLM_TIMEOUT);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ prompt, image_url: dataUri }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`VLM HTTP ${res.status}：${text.slice(0, 150)}`);
    const data = parseJson(text);
    return String(firstText(data, ["content", "description", "text", "result", "answer"]) || "").trim();
  } catch (err) {
    if (err?.name === "AbortError") throw new Error("VLM 请求超时");
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

  // 仅 Gewe 平台可用（只有 gewe 能取到图片公网地址）
  const platform = String((await s.getPlatform()) || "").toLowerCase();
  if (platform !== "gewe") return;

  const chatId = String((await s.getChatId()) || "");
  const userId = String((await s.getUserId()) || "");
  const isPrivate = chatId === userId;
  if (isPrivate && !cfg.enable_private) return;
  if (!isPrivate && !cfg.enable_group) return;

  // 冷却防抖：10 秒内只识别一次
  const now = Date.now();
  if (now - lastVisionAt < COOLDOWN_MS) return;
  lastVisionAt = now;

  // 提取图片公网地址
  let imgUrl = "";
  try {
    imgUrl = await geweCore.downloadImageFromCq(raw);
  } catch (e) {
    await s.reply(`取图失败：${String(e?.message || e).slice(0, 100)}`);
    return;
  }
  if (!imgUrl) {
    await s.reply("未获取到图片地址");
    return;
  }

  try {
    const mode = String(cfg.mode || "cli").trim().toLowerCase();
    let desc = "";
    if (mode === "api") {
      desc = await visionApi(imgUrl);
    } else {
      const prompt =
        String(cfg.vision_prompt || "").trim() ||
        "请用中文详细描述这张图片的内容，包括主体、场景、人物或物体、画面中的文字等，越详细越好。";
      const args = ["vision", "describe", "--image", imgUrl, "--prompt", prompt, "--output", "json", "--non-interactive"];
      const out = await runMmx(args, TIMEOUT);
      const data = parseJson(out);
      desc = firstText(data, ["content", "description", "text", "result", "answer"]);
    }
    if (!desc) {
      await s.reply("识别完成，但没有返回描述内容");
      return;
    }
    await s.reply(desc.slice(0, 1500));
  } catch (err) {
    await s.reply(`识图失败：${String(err?.message || err).slice(0, 150)}`);
  }
}

main().catch(async (error) => {
  await s.reply(`识图异常：${String(error?.message || error).slice(0, 150)}`);
});
