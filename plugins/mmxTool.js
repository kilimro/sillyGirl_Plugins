// [title: MiniMax 工具箱]
// [name: mmxTool]
// [desc: 调用本机 MiniMax CLI（mmx）的多模态能力：画图、生成视频、语音合成、网络搜索、看图识别、配额查询、文本对话。使用前需在本机执行 npm install -g mmx-cli 并 mmx auth login 登录（订阅 Key 保存在本地 ~/.mmx/config.json，不会出现在本插件或代码中）。命令统一以 mmx 开头，不与现有插件冲突。]
// [author: Mianpro官方]
// [version: v1.0.2]
// [rule: ^(mmx|MMX|Mmx)[\s，,、:：]*(.*)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 1]
// [class: 大模型]
// [icon: https://www.minimax.cn/favicon.ico]
// [origin: 自定义]
// [depe: ["./geweCore.js"]]

"use strict";
const { sender: s, plugin } = require("sillygirl");
const { spawn } = require("child_process");
const geweCore = require("./geweCore.js");

const IMAGE_TIMEOUT = 180000; // 图片生成一般 10-30 秒
const VIDEO_TIMEOUT = 360000; // 视频生成 1-3 分钟，CLI 内部等待完成
const LISTEN_TIMEOUT = 60000;

const form = new plugin.Form({
  mmx_path: plugin.Form.string()
    .title("mmx 命令路径")
    .description("留空自动使用 PATH 里的 mmx（Windows 自动找 mmx.cmd）；找不到时可填完整路径，如 C:\\Users\\你\\AppData\\Roaming\\npm\\mmx.cmd")
    .default(""),
  region: plugin.Form.string()
    .title("服务区域")
    .description("cn=国内（默认）；global=海外")
    .default("cn"),
  base_url: plugin.Form.string()
    .title("API BaseURL（可选）")
    .description("留空用 CLI 自动识别；一般不用填")
    .default(""),
  mmx_config_dir: plugin.Form.string()
    .title("mmx 配置目录（可选）")
    .description("CLI 登录信息默认在 ~/.mmx/config.json；若 sillyGirl 运行账号读不到，可填实际目录，如 C:\\Users\\你\\.mmx")
    .default(""),
  text_model: plugin.Form.string()
    .title("文本对话模型（可选）")
    .description("留空用 CLI 默认模型（订阅 Key 默认 MiniMax-M3.1-Flash-Preview）")
    .default(""),
  image_ratio: plugin.Form.string()
    .title("图片比例")
    .description("如 16:9 / 1:1 / 9:16 / 3:4；留空用 CLI 默认")
    .default(""),
  voice: plugin.Form.string()
    .title("语音音色（可选）")
    .description("留空用 CLI 默认音色；可先跑 mmx speech voices 查看列表")
    .default(""),
  speech_speed: plugin.Form.number()
    .title("语音语速")
    .description("1.0 正常；0.8 慢；1.2 快")
    .default(1.0),
  convert_api: plugin.Form.string()
    .title("mp3 转 silk API（Gewe 发语音条用）")
    .description("Gewe 平台发语音条需要 mp3→silk 转换接口；留空则 Gewe 语音回退为发送音频链接")
    .default(""),
  convert_url_param: plugin.Form.string().title("mp3转silk URL 参数名").default("url"),
  convert_field: plugin.Form.string().title("mp3转silk 返回字段路径").default("url"),
  enable_private: plugin.Form.boolean().title("私聊启用").default(true),
  enable_group: plugin.Form.boolean().title("群聊启用").default(true),
});

const HELP = [
  "===== MiniMax 工具箱 =====",
  "命令无需空格，如：mmx画 赛博朋克",
  "mmx画 <描述> 生成图片",
  "mmx视频 <描述> 生成视频（约 1-3 分钟）",
  "mmx说 <文字> 语音合成",
  "mmx搜 <关键词> 网络搜索",
  "mmx看看 识别你随后发的图片",
  "mmx配额 查看 M Plan 剩余额度",
  "mmx对话 <问题> 文本对话",
  "mmx菜单 接入与使用示例手册",
].join("\n");

const MENU = [
  "===== MiniMax 工具箱 · 接入手册 =====",
  "【接入步骤（每台机器只需一次）】",
  "1. 在电脑 cmd / PowerShell 执行：npm install -g mmx-cli",
  "2. 执行：mmx auth login（粘贴订阅 Key 或扫码，Key 保存在本地 ~/.mmx，不经过插件）",
  "3. 执行：mmx quota 确认能看到 M Plan 用量即登录成功",
  "4. 重启 sillyGirl 使新命令生效",
  "",
  "【使用示例】",
  "mmx画 赛博朋克城市 —— 生成图片",
  "mmx视频 夕阳下的猫 —— 生成视频（约 1-3 分钟）",
  "mmx说 欢迎使用MiniMax —— 语音合成",
  "mmx搜 MiniMax最新新闻 —— 网络搜索",
  "mmx看看 —— 识别你随后发的图片",
  "mmx配额 —— 查看 M Plan 剩余额度",
  "mmx对话 什么是多模态模型 —— 文本对话",
  "mmx帮助 —— 快速命令列表",
  "",
  "提示：命令与内容之间无需空格，如 mmx画猫 即可",
].join("\n");

let cfg = {};

// 执行 mmx 命令（spawn 不经 shell，参数安全无注入；Windows 用 mmx.cmd）
function runMmx(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const bin = cfg.mmx_path
      ? String(cfg.mmx_path).trim()
      : process.platform === "win32"
        ? "mmx.cmd"
        : "mmx";
    const env = { ...process.env };
    if (String(cfg.mmx_config_dir || "").trim()) env.MMX_CONFIG_DIR = String(cfg.mmx_config_dir).trim();
    if (String(cfg.base_url || "").trim()) env.MINIMAX_BASE_URL = String(cfg.base_url).trim();
    if (String(cfg.region || "cn").trim()) env.MINIMAX_REGION = String(cfg.region).trim();
    const child = spawn(bin, args, { env, windowsHide: true, encoding: "utf8" });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs || IMAGE_TIMEOUT);
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
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

// 深度遍历 JSON，收集 http(s) URL，按关键词优先级排序
function extractUrls(data, kinds = []) {
  const urls = [];
  const seen = new Set();
  const walk = (obj, key) => {
    if (obj == null) return;
    if (typeof obj === "string") {
      const v = obj.trim();
      if (/^https?:\/\//i.test(v) && !seen.has(v)) {
        seen.add(v);
        urls.push({ key: String(key || "").toLowerCase(), url: v });
      }
      return;
    }
    if (Array.isArray(obj)) {
      for (const item of obj) walk(item, key);
      return;
    }
    if (typeof obj === "object") {
      for (const [k, v] of Object.entries(obj)) walk(v, k);
    }
  };
  walk(data, "");
  const want = kinds.map((k) => k.toLowerCase());
  urls.sort((a, b) => {
    const score = (u) => (want.some((w) => u.key.includes(w)) ? 1 : 0);
    return score(b) - score(a);
  });
  return urls.map((u) => u.url);
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
      // 兜底遍历跳过 status/ok/done 等短状态词
      if (typeof v === "string" && v.trim().length < 4) continue;
      const t = firstText(v, keys);
      if (t) return t;
    }
  }
  return "";
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

async function getRecipient() {
  return String((await s.getChatId()) || (await s.getUserId()) || "").trim();
}

async function sendImage(url) {
  const platform = String((await s.getPlatform()) || "").toLowerCase();
  if (platform === "gewe") {
    const toWxid = await getRecipient();
    await geweCore.sendImage({ toWxid, imgUrl: url });
    return;
  }
  await s.reply(`[CQ:image,file=${url}]`);
}

async function sendVoice(url) {
  const platform = String((await s.getPlatform()) || "").toLowerCase();
  if (platform === "gewe") {
    const toWxid = await getRecipient();
    if (!String(cfg.convert_api || "").trim()) {
      await s.reply(`语音已生成：${url}（Gewe 发语音条需配置 convert_api）`);
      return;
    }
    await geweCore.sendVoiceFromMp3(toWxid, url, {
      api: cfg.convert_api,
      urlParam: cfg.convert_url_param,
      field: cfg.convert_field,
    });
    return;
  }
  await s.reply(`[CQ:record,url=${url}]`);
}

async function handleImage(prompt) {
  const args = ["image", "generate", "--prompt", prompt, "--output", "json", "--non-interactive", "--quiet"];
  if (String(cfg.image_ratio || "").trim()) args.push("--aspect-ratio", String(cfg.image_ratio).trim());
  const out = await runMmx(args, IMAGE_TIMEOUT);
  const data = parseJson(out);
  const url = extractUrls(data, ["image", "url"])[0];
  if (!url) throw new Error("未从返回中解析到图片地址");
  await sendImage(url);
}

async function handleVideo(prompt) {
  await s.reply("⏳ 正在生成视频，大约需要 1-3 分钟，好了发你");
  const args = ["video", "generate", "--prompt", prompt, "--output", "json", "--non-interactive", "--quiet"];
  const out = await runMmx(args, VIDEO_TIMEOUT);
  const data = parseJson(out);
  const url = extractUrls(data, ["video", "url"])[0];
  if (!url) throw new Error("未从返回中解析到视频地址");
  await s.reply(`🎬 视频已生成：${url}`);
}

async function handleSpeech(text) {
  const args = ["speech", "synthesize", "--text", text, "--output", "json", "--non-interactive", "--quiet"];
  if (String(cfg.voice || "").trim()) args.push("--voice", String(cfg.voice).trim());
  if (Number(cfg.speech_speed) && Number(cfg.speech_speed) !== 1) {
    args.push("--speed", String(Number(cfg.speech_speed)));
  }
  const out = await runMmx(args, IMAGE_TIMEOUT);
  const data = parseJson(out);
  const url = extractUrls(data, ["audio", "url"])[0];
  if (!url) throw new Error("未从返回中解析到语音地址");
  await sendVoice(url);
}

async function handleSearch(query) {
  const args = ["search", "query", "--q", query, "--output", "json", "--non-interactive", "--quiet"];
  const out = await runMmx(args, IMAGE_TIMEOUT);
  const data = parseJson(out);
  const list = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
  const lines = list.slice(0, 5).map((r, i) => {
    const title = firstText(r, ["title", "name", "query"]);
    const link = extractUrls(r, ["url"])[0] || "";
    return `${i + 1}. ${title || "无标题"}${link ? `\n   ${link}` : ""}`;
  });
  const summary = firstText(data, ["summary", "answer", "content", "text"]);
  await s.reply(
    ["===== 搜索结果 =====", summary ? `💡 ${summary}` : "", ...lines].filter(Boolean).join("\n") ||
      "没有搜到结果",
  );
}

async function handleQuota() {
  const out = await runMmx(["quota"], 60000);
  const text = String(out || "").trim();
  await s.reply(text.slice(0, 1500) || "配额查询无返回，请确认已 mmx auth login");
}

async function handleVision() {
  await s.reply("请发送要识别的图片（一分钟内）");
  const platform = String((await s.getPlatform()) || "").toLowerCase();
  const result = await s.listen({
    rules: ["raw ^\\[CQ:image[^\\]]*\\]$"],
    timeout: LISTEN_TIMEOUT,
    user_id: await s.getUserId(),
    chat_id: await s.getChatId(),
    handle: async (s2) => {
      const cq = String((await s2.getMsg()) || "").trim();
      let imgUrl = "";
      if (platform === "gewe") {
        imgUrl = await geweCore.downloadImageFromCq(cq);
      } else {
        const m = cq.match(/file=([^,\]]+)/);
        if (m && /^https?:\/\//i.test(m[1])) imgUrl = m[1];
      }
      if (!imgUrl) {
        await s2.reply("没识别到图片，请重新发 mmx 看看");
        return;
      }
      try {
        const args = ["vision", "describe", "--image", imgUrl, "--output", "json", "--non-interactive", "--quiet"];
        const out = await runMmx(args, IMAGE_TIMEOUT);
        const data = parseJson(out);
        const desc = firstText(data, ["description", "content", "text", "result", "answer"]);
        await s2.reply(desc ? `🔍 ${desc.slice(0, 1500)}` : "识别完成，但没有返回描述内容");
      } catch (err) {
        await s2.reply(`识别失败：${String(err?.message || err).slice(0, 150)}`);
      }
    },
  });
  if (result === "timeout") {
    await s.reply("等待图片超时，已取消");
  }
}

async function handleText(prompt) {
  const args = ["text", "chat", "--message", prompt, "--output", "json", "--non-interactive", "--quiet"];
  if (String(cfg.text_model || "").trim()) args.push("--model", String(cfg.text_model).trim());
  const out = await runMmx(args, IMAGE_TIMEOUT);
  const data = parseJson(out);
  const content = firstText(data, ["content", "text", "message", "answer", "result"]);
  await s.reply(content ? content.slice(0, 1500) : "没有返回内容");
}

async function main() {
  cfg = (await form.get()) || {};
  const raw = String((await s.getMsg()) || "").trim();
  if (!raw) return;
  const m = raw.match(/^(?:mmx|MMX|Mmx)[\s，,、:：]*(.*)$/s);
  if (!m) return;
  const input = String(m[1] || "").trim();
  const chatId = String((await s.getChatId()) || "");
  const userId = String((await s.getUserId()) || "");
  const isPrivate = chatId === userId;
  if (isPrivate && !cfg.enable_private) return;
  if (!isPrivate && !cfg.enable_group) return;

  // 子命令解析：支持 "mmx 画 xxx" / "mmx画 xxx" / "mmx画xxx" 等任意写法（命令与描述之间无需空格）
  const cmdMatch = input.match(
    /^(画画|生成图片|搜索|视频|语音|朗读|看看|看图|识别|配额|额度|用量|对话|帮助|菜单|画|搜|说|image|video|speech|search|vision|quota|chat|text|help|menu)[\s，,、:：]*(.*)$/is,
  );
  const cmdKey = cmdMatch ? String(cmdMatch[1]).toLowerCase() : "";
  const rest = cmdMatch ? String(cmdMatch[2] || "").trim() : "";

  try {
    switch (cmdKey) {
      case "画":
      case "画画":
      case "生成图片":
      case "image":
        if (!rest) return s.reply("用法：mmx 画 <描述>");
        return handleImage(rest);
      case "视频":
      case "video":
        if (!rest) return s.reply("用法：mmx 视频 <描述>");
        return handleVideo(rest);
      case "说":
      case "语音":
      case "朗读":
      case "speech":
        if (!rest) return s.reply("用法：mmx 说 <文字>");
        return handleSpeech(rest);
      case "搜":
      case "搜索":
      case "search":
        if (!rest) return s.reply("用法：mmx 搜 <关键词>");
        return handleSearch(rest);
      case "看看":
      case "看图":
      case "识别":
      case "vision":
        return handleVision();
      case "配额":
      case "额度":
      case "用量":
      case "quota":
        return handleQuota();
      case "对话":
      case "chat":
      case "text":
        if (!rest) return s.reply("用法：mmx 对话 <问题>");
        return handleText(rest);
      case "帮助":
      case "help":
      case "menu":
      case "":
        return s.reply(HELP);
      case "菜单":
        return s.reply(MENU);
      default:
        return s.reply(`未识别的命令：${cmd}（发送 mmx 帮助 查看用法）`);
    }
  } catch (error) {
    await s.reply(`mmx 执行失败：${String(error?.message || error).slice(0, 150)}`);
  }
}

main().catch(async (error) => {
  await s.reply(`MiniMax 工具箱异常：${String(error?.message || error).slice(0, 150)}`);
});
