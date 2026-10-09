// [title: Gewe机器人公共模块]
// [name: geweCore]
// [desc: 仅供 Gewe 平台机器人使用的公共依赖模块。从 gewe 桶读取 api_base/app_id/token（后台已接入，无需用户重复填写），封装 Gewe 消息 API。当前提供 sendVoice（postVoice 发语音条），后续可扩展其它 Gewe 独有接口。非 Gewe 平台插件请勿引用。]
// [author: Mianpro官方]
// [version: v1.0.1]
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

/**
 * 从 gewe 桶读取 Gewe 接入配置（后台已填写，无需用户重复输入）。
 * @returns {{apiBase:string, appId:string, token:string}}
 */
function getGeweConfig() {
  const bucket = new Bucket(BUCKET);
  return {
    apiBase: String(bucket.get("api_base") || "").replace(/\/+$/, ""),
    appId: String(bucket.get("app_id") || ""),
    token: String(bucket.get("token") || ""),
  };
}

function assertReady(cfg) {
  if (!cfg.apiBase || !cfg.appId || !cfg.token) {
    throw new Error("gewe 桶配置不完整：需 api_base / app_id / token（请在 SillyGirl 后台 gewe 桶填写接入参数）");
  }
}

/**
 * 发送语音条（Gewe postVoice）。
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
  const cfg = getGeweConfig();
  assertReady(cfg);
  const res = await fetch(`${cfg.apiBase}/gewe/v2/api/message/postVoice`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-gewe-token": cfg.token,
    },
    body: JSON.stringify({
      appId: cfg.appId,
      toWxid,
      voiceUrl,
      voiceDuration: duration,
    }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const text = await res.text().catch(() => "");
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (_) {
    throw new Error(`Gewe postVoice 返回不是 JSON（HTTP ${res.status}）：${String(text).slice(0, 160)}`);
  }
  if (!res.ok || (data && data.ret && data.ret !== 200)) {
    throw new Error(`Gewe 发语音失败：${data?.msg || `HTTP ${res.status}`}`);
  }
  return data;
}

module.exports = {
  getGeweConfig,
  sendVoice,
};
