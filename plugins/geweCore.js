// [title: Gewe机器人公共模块]
// [name: geweCore]
// [desc: 仅供 Gewe 平台机器人使用的公共依赖模块。从 gewe 桶读取 api_base/app_id/token（后台已接入，无需用户重复填写），封装 Gewe 消息与联系人 API：发语音、发小程序、发名片、发链接、发文件、发 appmsg、获取简要信息。后续可扩展其它 Gewe 独有接口。非 Gewe 平台插件请勿引用。]
// [author: Mianpro官方]
// [version: v1.2.0]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 模块]
// [icon: https://api.920pdd.com/favicon.ico]
// [module: true]
// [origin: 自定义]
// [depe: []]

"use strict";
const { Bucket } = require("sillygirl");

const BUCKET = "gewe";
const TIMEOUT = 15000;

// 默认浏览器 UA：convert API 不带 UA 会返回 403
const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/**
 * 从 gewe 桶读取 Gewe 接入配置（后台已填写，无需用户重复输入）。
 * @returns {Promise<{apiBase:string, appId:string, token:string}>}
 */
async function getGeweConfig() {
  const bucket = new Bucket(BUCKET);
  const [apiBase, appId, token] = await Promise.all([
    bucket.get("api_base"),
    bucket.get("app_id"),
    bucket.get("token"),
  ]);
  return {
    apiBase: String(apiBase || "").replace(/\/+$/, ""),
    appId: String(appId || ""),
    token: String(token || ""),
  };
}

function assertReady(cfg) {
  if (!cfg.apiBase || !cfg.appId || !cfg.token) {
    throw new Error("gewe 桶配置不完整：需 api_base / app_id / token（请在 SillyGirl 后台 gewe 桶填写接入参数）");
  }
}

/**
 * 公共请求：自动带 appId 与 token，统一解析 JSON 并校验 ret。
 * @param {string} path 接口路径，如 /gewe/v2/api/message/postVoice
 * @param {object} body 请求体（不含 appId，自动补）
 * @param {string} [errPrefix] 失败提示前缀，如 "Gewe 发语音失败"
 * @returns {Promise<object>} Gewe 原始响应
 */
async function request(path, body, errPrefix = "Gewe 操作失败") {
  const cfg = await getGeweConfig();
  assertReady(cfg);
  const res = await fetch(`${cfg.apiBase}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-gewe-token": cfg.token,
    },
    body: JSON.stringify({ appId: cfg.appId, ...body }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const text = await res.text().catch(() => "");
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (_) {
    throw new Error(`${errPrefix}：返回不是 JSON（HTTP ${res.status}）`);
  }
  if (!res.ok || (data && data.ret && data.ret !== 200)) {
    throw new Error(`${errPrefix}：${data?.msg || `HTTP ${res.status}`}`);
  }
  return data;
}

/**
 * 发送语音条。
 * @param {{toWxid:string, voiceUrl:string, voiceDuration:number}} args
 * @returns {Promise<object>} Gewe 原始响应
 */
async function sendVoice({ toWxid, voiceUrl, voiceDuration }) {
  if (!toWxid) throw new Error("sendVoice: 缺少 toWxid");
  if (!voiceUrl) throw new Error("sendVoice: 缺少 voiceUrl（需 silk 公网 URL）");
  const duration = Number(voiceDuration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`sendVoice: 无效 voiceDuration(${voiceDuration})，需毫秒正整数`);
  }
  return request("/gewe/v2/api/message/postVoice", { toWxid, voiceUrl, voiceDuration: duration }, "Gewe 发语音失败");
}

/**
 * 发送小程序消息。
 * @param {{toWxid:string, miniAppId:string, userName:string, title:string, coverImgUrl:string, pagePath:string, displayName:string}} args
 * @returns {Promise<object>} Gewe 原始响应
 */
async function sendMiniApp({ toWxid, miniAppId, userName, title, coverImgUrl, pagePath, displayName }) {
  if (!toWxid) throw new Error("sendMiniApp: 缺少 toWxid");
  if (!miniAppId || !userName || !title || !coverImgUrl || !pagePath || !displayName) {
    throw new Error("sendMiniApp: 缺少必填参数（miniAppId/userName/title/coverImgUrl/pagePath/displayName）");
  }
  return request(
    "/gewe/v2/api/message/postMiniApp",
    { toWxid, miniAppId, userName, title, coverImgUrl, pagePath, displayName },
    "Gewe 发小程序失败",
  );
}

/**
 * 发送名片消息。
 * @param {{toWxid:string, nickName:string, nameCardWxid:string}} args
 * @returns {Promise<object>} Gewe 原始响应
 */
async function sendNameCard({ toWxid, nickName, nameCardWxid }) {
  if (!toWxid || !nickName || !nameCardWxid) {
    throw new Error("sendNameCard: 缺少必填参数（toWxid/nickName/nameCardWxid）");
  }
  return request("/gewe/v2/api/message/postNameCard", { toWxid, nickName, nameCardWxid }, "Gewe 发名片失败");
}

/**
 * 发送链接消息。
 * @param {{toWxid:string, title:string, desc:string, linkUrl:string, thumbUrl:string}} args
 * @returns {Promise<object>} Gewe 原始响应
 */
async function sendLink({ toWxid, title, desc, linkUrl, thumbUrl }) {
  if (!toWxid || !title || !desc || !linkUrl || !thumbUrl) {
    throw new Error("sendLink: 缺少必填参数（toWxid/title/desc/linkUrl/thumbUrl）");
  }
  return request("/gewe/v2/api/message/postLink", { toWxid, title, desc, linkUrl, thumbUrl }, "Gewe 发链接失败");
}

/**
 * 发送文件消息。
 * @param {{toWxid:string, fileName:string, fileUrl:string}} args
 * @returns {Promise<object>} Gewe 原始响应
 */
async function sendFile({ toWxid, fileName, fileUrl }) {
  if (!toWxid || !fileName || !fileUrl) {
    throw new Error("sendFile: 缺少必填参数（toWxid/fileName/fileUrl）");
  }
  return request("/gewe/v2/api/message/postFile", { toWxid, fileName, fileUrl }, "Gewe 发文件失败");
}

/**
 * 发送 appmsg 消息（音乐分享、视频号内容、引用消息等）。
 * @param {{toWxid:string, appmsg:string}} args appmsg 为回调消息中的 appmsg 节点内容
 * @returns {Promise<object>} Gewe 原始响应
 */
async function sendAppMsg({ toWxid, appmsg }) {
  if (!toWxid || !appmsg) throw new Error("sendAppMsg: 缺少必填参数（toWxid/appmsg）");
  return request("/gewe/v2/api/message/postAppMsg", { toWxid, appmsg }, "Gewe 发appmsg失败");
}

/**
 * 获取群/好友简要信息。
 * @param {string[]} wxids 目标 ID 数组（最多 20 个）
 * @returns {Promise<object[]>} 简要信息数组
 */
async function getBriefInfo(wxids) {
  const list = Array.isArray(wxids) ? wxids : [];
  if (list.length === 0) throw new Error("getBriefInfo: 缺少 wxids");
  if (list.length > 20) throw new Error("getBriefInfo: wxids 最多 20 个");
  const data = await request("/gewe/v2/api/contacts/getBriefInfo", { wxids: list }, "Gewe 获取简要信息失败");
  return data?.data || [];
}

/**
 * 探测 mp3 URL 是否可访问（带浏览器 UA）。
 * @param {string} mp3Url
 * @returns {Promise<{ok:boolean, status?:number}>}
 */
async function probeMp3Url(mp3Url) {
  try {
    const res = await fetch(mp3Url, {
      method: "GET",
      headers: { "user-agent": DEFAULT_UA, range: "bytes=0-1023" },
      signal: AbortSignal.timeout(8000),
    });
    return { ok: res.ok, status: res.status };
  } catch (_) {
    return { ok: false };
  }
}

/**
 * 调用第三方 API 把 mp3 公网 URL 转成 silk 公网 URL。
 * @param {string} mp3Url
 * @param {{api:string, urlParam?:string, field?:string, timeout?:number}} [opts]
 * @returns {Promise<{url:string, duration:number}>} silk 公网 URL 与时长（毫秒）
 */
async function mp3ToSilkUrl(mp3Url, opts = {}) {
  const api = String(opts.api || "").trim();
  if (!api) throw new Error("mp3转silk 失败：未配置转换 API 地址");
  const probe = await probeMp3Url(mp3Url);
  if (!probe.ok) {
    throw new Error(`mp3转silk 失败：mp3 无法访问${probe.status ? `（HTTP ${probe.status}）` : ""}`);
  }
  const urlParam = String(opts.urlParam || "").trim() || "url";
  const field = String(opts.field || "").trim() || "silk_url";
  const sep = api.includes("?") ? "&" : "?";
  const target = `${api}${sep}${encodeURIComponent(urlParam)}=${encodeURIComponent(mp3Url)}`;
  const res = await fetch(target, {
    method: "GET",
    headers: { "user-agent": DEFAULT_UA },
    signal: AbortSignal.timeout(Number(opts.timeout) || 30000),
  });
  const text = await res.text().catch(() => "");
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_) {
      throw new Error(`mp3转silk 失败：API 返回不是 JSON（HTTP ${res.status}）`);
    }
  }
  if (!res.ok) throw new Error(`mp3转silk 失败：HTTP ${res.status}`);
  if (data && data.ok === false) {
    throw new Error(`mp3转silk 失败：${String(data.error || data.msg || "转换失败")}`);
  }
  const url = data && data[field];
  if (!url || typeof url !== "string") {
    throw new Error(`mp3转silk 失败：返回缺少字段 ${field}`);
  }
  const duration = Number(data.duration) || 0;
  return { url, duration };
}

/**
 * 一条龙：mp3 公网 URL → silk → 发语音条。
 * @param {string} toWxid
 * @param {string} mp3Url
 * @param {{api:string, urlParam?:string, field?:string, timeout?:number}} [opts]
 * @returns {Promise<object>} Gewe 原始响应
 */
async function sendVoiceFromMp3(toWxid, mp3Url, opts = {}) {
  const { url: silkUrl, duration } = await mp3ToSilkUrl(mp3Url, opts);
  return sendVoice({ toWxid, voiceUrl: silkUrl, voiceDuration: duration });
}

module.exports = {
  getGeweConfig,
  request,
  sendVoice,
  sendMiniApp,
  sendNameCard,
  sendLink,
  sendFile,
  sendAppMsg,
  getBriefInfo,
  mp3ToSilkUrl,
  probeMp3Url,
  sendVoiceFromMp3,
};
