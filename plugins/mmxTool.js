// [title: MiniMax 工具箱]
// [name: mmxTool]
// [desc: 调用本机 MiniMax CLI（mmx）的多模态能力：画图、生成视频、语音合成、网络搜索、看图识别、配额查询、文本对话。使用前需在本机执行 npm install -g mmx-cli 并 mmx auth login 登录（订阅 Key 保存在本地 ~/.mmx/config.json，不会出现在本插件或代码中）。命令统一以 mmx 开头，不与现有插件冲突。]
// [author: Mianpro官方]
// [version: v1.0.10]
// [rule: ^(mmx|MMX|Mmx)[\s，,、:：]*(.*)$]
// [status: true]
// [admin: true]
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

// 配置值容错：用户可能误填成 "mmx_path: xxx" / "mmx_config_dir: xxx" 带键名前缀，自动清洗
function cleanCfgValue(value, key) {
  return String(value || "")
    .replace(new RegExp(`^${key}\\s*[:：]\\s*`, "i"), "")
    .trim();
}

// Windows 下 .cmd 参数：剔除 cmd 元字符（防注入/防解析错乱），再双引号包裹
function winCmdArg(value) {
  const cleaned = String(value)
    .replace(/["%^!&|<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `"${cleaned}"`;
}

// 执行 mmx 命令（macOS/Linux 直接 spawn；Windows 必须经 cmd.exe /c 拉起 .cmd，参数已清洗+引号包裹）
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
    const timer = setTimeout(() => child.kill(), timeoutMs || IMAGE_TIMEOUT);
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

// 按指定字段路径精确取值（不兜底全树遍历，避免误抓 title/来源 等字段）
function pickTop(data, keys) {
  if (data == null || typeof data !== "object" || Array.isArray(data)) return "";
  for (const k of keys) {
    const v = data[k];
    if (v == null) continue;
    if (typeof v === "string" && v.trim().length >= 4) return v.trim();
    if (typeof v === "object") {
      const t = pickTop(v, keys);
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
  // 真实返回结构：{ organic: [{ title, link, snippet, date }] }
  const list = Array.isArray(data?.organic)
    ? data.organic
    : Array.isArray(data?.results)
      ? data.results
      : Array.isArray(data)
        ? data
        : [];
  const lines = [];
  for (const r of list.slice(0, 3)) {
    const title = String(firstText(r, ["title", "name"]) || "无标题").trim().slice(0, 30);
    const link = String(r?.link || extractUrls(r, ["url", "link"])[0] || "").trim();
    const snippet = pickTop(r, ["snippet", "content", "description"]).slice(0, 120);
    lines.push(`${title}${link ? `\n${link}` : ""}${snippet ? `\n${snippet}` : ""}`);
  }
  const reply = lines.join("\n\n");
  await s.reply(reply ? reply.slice(0, 1500) : "没有搜到结果");
}

async function handleQuota() {
  const out = await runMmx(["quota"], 60000);
  const data = parseJson(out);
  if (!data || !Array.isArray(data.model_remains)) {
    await s.reply(String(out || "配额查询无返回，请确认已 mmx auth login").trim().slice(0, 500));
    return;
  }
  const nameMap = { general: "通用（文本/图像）", video: "视频", speech: "语音", music: "音乐" };
  const lines = ["===== MiniMax 配额 ====="];
  for (const item of data.model_remains) {
    const name = nameMap[item.model_name] || item.model_name || "未知模型";
    const curTotal = item.current_interval_total_count ?? 0;
    const curUsed = item.current_interval_usage_count ?? 0;
    const curPct = item.current_interval_remaining_percent ?? "-";
    const weekTotal = item.current_weekly_total_count ?? 0;
    const weekUsed = item.current_weekly_usage_count ?? 0;
    const weekPct = item.current_weekly_remaining_percent ?? "-";
    lines.push(
      `${name}`,
      `  本周期：已用 ${curUsed}/${curTotal} 次，剩余 ${curPct}%`,
      `  本周：已用 ${weekUsed}/${weekTotal} 次，剩余 ${weekPct}%`,
    );
  }
  await s.reply(lines.join("\n"));
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
  // 解析：单个 JSON 正常取；多段（流式 delta 兜底）按出现顺序拼接 content 类字段；失败回退原文
  let content = "";
  try {
    const parts = [];
    const re = /\{[\s\S]*?\}/g;
    let m;
    while ((m = re.exec(String(out)))) {
      try {
        parts.push(JSON.parse(m[0]));
      } catch (_) {}
    }
    if (parts.length === 1) {
      content = firstText(parts[0], ["content", "text", "message", "answer", "result"]);
    } else if (parts.length > 1) {
      content = parts
        .map((p) => firstText(p, ["content", "text", "message", "answer", "result"]))
        .filter(Boolean)
        .join("");
    }
  } catch (_) {}
  content = String(content || "").trim();
  if (!content) {
    const rawText = String(out || "").trim();
    await s.reply(rawText ? rawText.slice(0, 1500) : "没有返回内容");
    return;
  }
  await s.reply(content.slice(0, 1500));
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
