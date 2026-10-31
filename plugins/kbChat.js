// [title: 企业知识库对话]
// [name: kbChat]
// [desc: 接入微信对话开放平台（智能客服）企业知识库，在配置的白名单群内自动按知识库内容回复，与提示词驱动的 aiChat 独立并行。白名单外插件完全无感（直接放行）。支持 FAQ / 意图 / 深度思考（生成式回答带引用） / 富文本（图片、语音转 CQ 码）。NOMATCH（知识库未命中）默认放行给 aiChat 等后续插件接话，也可回固定兜底话术。凭证 appid/token/aes_key 均本地表单配置，不写入代码。]
// [author: Mianpro官方]
// [version: v1.1.0]
// [rule: raw [\s\S]+]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 999]
// [class: 大模型]
// [icon: https://res.wx.qq.com/mmspraiweb_node/dist/static/logo/logo180.png]
// [origin: 自定义]
// [depe: []]

"use strict";
const { sender: s, plugin } = require("sillygirl");
const crypto = require("crypto");

const API_BASE = "https://openaiapi.weixin.qq.com";
const TOKEN_TTL = 2 * 60 * 60 * 1000 - 60 * 1000; // access_token 2h 有效，提前 1 分钟过期

const form = new plugin.Form({
  // ---- 微信对话开放平台凭证（仅本地配置，不写入代码）----
  appid: plugin.Form.string()
    .title("APPID")
    .description("微信对话开放平台开放接口 APPID（与机器人一一对应）")
    .default("")
    .required(),
  token: plugin.Form.string()
    .title("Token")
    .description("用于签名校验的 Token")
    .default("")
    .required(),
  aes_key: plugin.Form.string()
    .title("AESKey")
    .description("用于对话请求/响应加解密，AES-256-CBC")
    .default("")
    .required(),
  // ---- 生效范围（白名单群全自动）----
  kb_groups: plugin.Form.string()
    .title("白名单群（这些群自动查知识库）")
    .description("逗号分隔的群 ID，如 gewe:25897824478@chatroom 或直接群ID。只有这些群内的消息会查知识库；其他群/私聊插件直接放行不接管。留空=插件不生效")
    .default(""),
  // ---- 未命中处理 ----
  nomatch_mode: plugin.Form.string()
    .title("未命中处理")
    .description("resume=放行给 aiChat 等后续插件接话（默认）；message=回复固定兜底话术")
    .default("resume"),
  nomatch_message: plugin.Form.string()
    .title("兜底话术")
    .description("nomatch_mode=message 时，知识库未命中回复的文案")
    .default("抱歉，我暂时没有在知识库中找到答案，换个问法试试，或联系管理员~"),
  // ---- 对话与输出 ----
  env: plugin.Form.string()
    .title("环境")
    .description("online=线上（默认）；debug=测试环境")
    .default("online"),
  show_ref: plugin.Form.boolean()
    .title("显示引用来源")
    .description("深度思考回答后附上引用文档（ref_docs），便于溯源。默认开启")
    .default(true),
  timeout: plugin.Form.number()
    .title("请求超时（秒）")
    .description("单次对话接口超时时间")
    .min(10)
    .max(120)
    .default(60),
});

let cfg = {};

// ================= AES-256-CBC 加解密 =================
// AESKey = base64(AESKey+"=") 解码为 32 字节，IV = 前 16 字节，PKCS7 padding
function aesEncrypt(plain, encKey) {
  const key = Buffer.from(String(encKey).trim() + "=", "base64");
  if (key.length !== 32) throw new Error("AESKey 长度非法（应为 32 位字符）");
  const iv = key.slice(0, 16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([cipher.update(Buffer.from(plain, "utf8")), cipher.final()]).toString("base64");
}
function aesDecrypt(b64, encKey) {
  const key = Buffer.from(String(encKey).trim() + "=", "base64");
  if (key.length !== 32) throw new Error("AESKey 长度非法（应为 32 位字符）");
  const iv = key.slice(0, 16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(Buffer.from(b64, "base64")), decipher.final()]).toString("utf8");
}

// ================= 开放接口调用 =================
// sign = md5(Token + unix_timestamp + nonce + md5(body))，body 为实际发送的 body 字符串
async function apiCall(cfg, path, bodyPlain, useAppId) {
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(12).toString("hex"); // 24 位随机串
  const bodyMd5 = crypto.createHash("md5").update(bodyPlain, "utf8").digest("hex");
  const sign = crypto.createHash("md5").update(String(cfg.token).trim() + ts + nonce + bodyMd5, "utf8").digest("hex");
  const headers = {
    "request_id": crypto.randomUUID(),
    "timestamp": ts,
    "nonce": nonce,
    "sign": sign,
    "X-APPID": String(cfg.appid).trim(),
  };
  if (useAppId) {
    headers["Content-Type"] = "application/json";
  } else {
    headers["X-OPENAI-TOKEN"] = await getAccessToken(cfg);
    headers["Content-Type"] = "text/plain"; // 加密 body
  }
  const res = await fetch(API_BASE + path, {
    method: "POST",
    headers,
    body: bodyPlain,
    signal: AbortSignal.timeout((Number(cfg.timeout) || 60) * 1000),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error("HTTP " + res.status + ": " + raw.slice(0, 200));
  return raw;
}

// access_token 缓存（内存，2h）
let tokenCache = { value: "", expireAt: 0 };
async function getAccessToken(cfg) {
  if (tokenCache.value && Date.now() < tokenCache.expireAt) return tokenCache.value;
  const raw = await apiCall(cfg, "/v2/token", "{}", true);
  const data = JSON.parse(raw);
  if (data.code !== 0) throw new Error("换取 access_token 失败 " + data.code + ": " + data.msg);
  tokenCache.value = data.data.access_token;
  tokenCache.expireAt = Date.now() + TOKEN_TTL;
  return tokenCache.value;
}

// ================= 知识库对话 =================
async function queryKb(cfg, query, nickname, userid) {
  const payload = {
    query,
    env: String(cfg.env || "online").trim(),
    first_priority_skills: [],
    second_priority_skills: [],
    user_name: nickname || "",
    avatar: "",
    userid,
  };
  const encrypted = aesEncrypt(JSON.stringify(payload), cfg.aes_key);
  const raw = await apiCall(cfg, "/v2/bot/query", encrypted, false);
  const decrypted = aesDecrypt(raw, cfg.aes_key);
  const data = JSON.parse(decrypted);
  if (data.code !== 0) throw new Error("对话失败 " + data.code + ": " + data.msg);
  return data.data;
}

// 拉取深度思考的生成式回答（generate_url 返回最终文本，剥掉 <think> 思考块）
async function fetchGenerate(url, timeoutMs) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs || 60000) });
  let text = await res.text();
  let out = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const ctype = String(res.headers.get("content-type") || "");
  if (ctype.includes("text/event-stream")) {
    // SSE：拼接 data: 行
    const lines = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).filter(Boolean);
    if (lines.length) out = lines.join("").trim();
  }
  return out || text.trim();
}

// ================= 富文本 answer 解析 =================
// answer 为 string：纯文本，或 JSON.parse 后是 image/voice/video/news/miniprogrampage/流式/multimsg
function parseAnswer(answer) {
  const text = String(answer || "").trim();
  if (!text) return [];
  let obj = null;
  try {
    obj = JSON.parse(text);
  } catch (_) {
    obj = null;
  }
  if (!obj) return [{ type: "text", content: text }];
  if (obj.multimsg && Array.isArray(obj.multimsg)) {
    const msgs = [];
    for (const m of obj.multimsg) {
      const item = String(m);
      let o = null;
      try {
        o = JSON.parse(item);
      } catch (_) {
        o = null;
      }
      if (o && o.image && o.image.url) msgs.push({ type: "image", url: o.image.url, name: o.image.name || "" });
      else if (o && o.voice && o.voice.url) msgs.push({ type: "voice", url: o.voice.url, name: o.voice.name || "" });
      else msgs.push({ type: "text", content: item });
    }
    return msgs;
  }
  if (obj.image && obj.image.url) return [{ type: "image", url: obj.image.url, name: obj.image.name || "" }];
  if (obj.voice && obj.voice.url) return [{ type: "voice", url: obj.voice.url, name: obj.voice.name || "" }];
  if (obj.video && obj.video.url) {
    return [{ type: "text", content: [obj.video.title, obj.video.desc, obj.video.url].filter(Boolean).join("\n") }];
  }
  if (obj.news && Array.isArray(obj.news.articles)) {
    const arts = obj.news.articles.map((a) => [a.title, a.description, a.url].filter(Boolean).join("\n")).join("\n\n");
    if (arts) return [{ type: "text", content: arts }];
  }
  if (obj.miniprogrampage) {
    return [{ type: "text", content: obj.miniprogrampage.title + "\n小程序 appid=" + obj.miniprogrampage.appid + " path=" + obj.miniprogrampage.pagepath }];
  }
  if (obj.generate_url) {
    return [{ type: "stream", url: obj.generate_url, ref_docs: Array.isArray(obj.ref_docs) ? obj.ref_docs : [] }];
  }
  return [{ type: "text", content: text }];
}

// 解析专属群白名单：支持 "gewe:群ID" 或裸群ID（任意平台）
function parseKbGroups(str) {
  const set = new Set();
  for (const item of String(str || "").split(/[,，]/)) {
    const t = item.trim();
    if (!t) continue;
    set.add(t);
  }
  return set;
}

// ================= 主流程 =================
async function main() {
  cfg = (await form.get()) || {};
  const platform = String((await s.getPlatform()) || "").toLowerCase();
  const chatId = String((await s.getChatId()) || "").trim();
  const userId = String((await s.getUserId()) || "").trim();
  const botId = String((await s.getBotId()) || "").trim();
  const raw = String((await s.getMsg()) || "").trim();
  // 跳过机器人自己发的消息
  if (botId && userId === botId) return s.resume();
  const isGroup = !!(chatId && chatId !== userId);

  // 只处理白名单群；其他群/私聊直接放行给后续插件（aiChat / groupSummary 等）
  const groups = parseKbGroups(cfg.kb_groups);
  if (!groups.size) return s.resume();
  const inKbGroup = isGroup && (groups.has(chatId) || groups.has(platform + ":" + chatId));
  if (!inKbGroup) return s.resume();

  // 凭证校验（缺配置时提示一次并放行，避免白名单群瘫痪）
  if (!String(cfg.appid || "").trim() || !String(cfg.token || "").trim() || !String(cfg.aes_key || "").trim()) {
    await s.reply("企业知识库未配置：请在插件配置里填写 appid / token / aes_key");
    return s.resume();
  }

  const queryText = raw;
  const nickname = String((await s.getUserName()) || userId);
  const userid = [platform, chatId || "dm", userId].join(":"); // 稳定用户ID，维持会话上下文

  try {
    const kbData = await queryKb(cfg, queryText, nickname, userid);
    const status = String(kbData.status || "");
    const answer = String(kbData.answer || "").trim();

    // 未命中：按配置 resume（放行给 aiChat）或回兜底话术
    if (status === "NOMATCH" || !answer) {
      if (String(cfg.nomatch_mode || "resume") !== "message") {
        return s.resume();
      }
      await s.reply(String(cfg.nomatch_message || "抱歉，我暂时没有在知识库中找到答案，换个问法试试，或联系管理员~"));
      return s.resume();
    }

    // 命中：解析并回复
    const msgs = parseAnswer(answer);
    for (const m of msgs) {
      if (m.type === "image") {
        await s.reply("[CQ:image,url=" + m.url + "]");
      } else if (m.type === "voice") {
        await s.reply("[CQ:record,url=" + m.url + "]");
      } else if (m.type === "stream") {
        let content = await fetchGenerate(m.url, (Number(cfg.timeout) || 60) * 1000);
        if (cfg.show_ref !== false && m.ref_docs.length) {
          const refs = m.ref_docs.slice(0, 3).map((d) => {
            const body = (d.ref_contents || []).map((c) => c.content).filter(Boolean).join(" ");
            return "· " + (d.doc_name || "") + (body ? "\n  " + body : "");
          }).join("\n");
          if (refs) content = content + "\n\n—— 参考来源：\n" + refs;
        }
        if (content) await s.reply(content);
      } else if (m.content) {
        await s.reply(m.content);
      }
    }
    // 回复后放行：让 groupSummary 等中间件继续积累，也不阻塞 aiChat 链路
    return s.resume();
  } catch (error) {
    await s.reply("知识库查询失败：" + String(error?.message || error).slice(0, 120));
    return s.resume();
  }
}

main().catch(async (error) => {
  try {
    await s.reply("企业知识库插件异常：" + String(error?.message || error).slice(0, 120));
  } catch (_) {}
});
