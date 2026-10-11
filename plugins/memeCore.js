// [title: 表情包生成公共模块]
// [name: memeCore]
// [desc: 仅供表情包类插件使用的公共依赖模块。封装 meme-generator HTTP API：上传图片（base64）、生成表情、搜索表情、获取表情信息。API 地址由调用方传入，本模块不存储任何地址。]
// [author: Mianpro官方]
// [version: v1.0.0]
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

const TIMEOUT = 30000;

function normalizeBase(api) {
  return String(api || "").trim().replace(/\/+$/, "");
}

async function requestJson(base, path, { method = "GET", body } = {}) {
  const url = `${normalizeBase(base)}${path}`;
  const init = { method, signal: AbortSignal.timeout(TIMEOUT) };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text().catch(() => "");
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (_) {
    throw new Error(`meme 接口返回异常（HTTP ${res.status}）`);
  }
  if (!res.ok) {
    throw new Error(`meme 接口失败（HTTP ${res.status}）：${data?.message || ""}`);
  }
  return data;
}

/**
 * 上传图片（base64 数据）。
 * @param {string} api 表情服务 API 地址
 * @param {string} base64 图片 base64 数据（不含 data: 前缀）
 * @returns {Promise<string>} image_id
 */
async function uploadByData(api, base64) {
  const data = await requestJson(api, "/image/upload", {
    method: "POST",
    body: { type: "data", data: String(base64 || "") },
  });
  const id = data?.image_id;
  if (!id) throw new Error("meme 上传图片失败：返回缺少 image_id");
  return id;
}

/**
 * 生成表情。
 * @param {string} api 表情服务 API 地址
 * @param {string} key 表情名
 * @param {Array<{name:string,id:string}>} images 图片列表
 * @param {string[]} texts 文本列表
 * @param {object} [options] 表情选项
 * @returns {Promise<string>} 生成图片的 image_id
 */
async function generate(api, key, images, texts, options = {}) {
  const data = await requestJson(api, `/memes/${encodeURIComponent(key)}`, {
    method: "POST",
    body: {
      images: Array.isArray(images) ? images : [],
      texts: Array.isArray(texts) ? texts : [],
      options: options || {},
    },
  });
  const id = data?.image_id;
  if (!id) throw new Error(`meme 生成失败（${key}）：返回缺少 image_id`);
  return id;
}

/**
 * 搜索表情。
 * @param {string} api 表情服务 API 地址
 * @param {string} query 关键词（支持中文，如"摸"）
 * @param {boolean} [includeTags] 是否搜索标签
 * @returns {Promise<string[]>} 表情 key 列表
 */
async function search(api, query, includeTags = false) {
  const q = encodeURIComponent(String(query || "").trim());
  if (!q) return [];
  const data = await requestJson(api, `/meme/search?query=${q}&include_tags=${includeTags ? "true" : "false"}`);
  return Array.isArray(data) ? data : [];
}

/**
 * 获取单个表情信息。
 * @param {string} api 表情服务 API 地址
 * @param {string} key 表情名
 * @returns {Promise<object|null>} 表情信息（含 params/keywords），不存在返回 null
 */
async function getInfo(api, key) {
  try {
    return await requestJson(api, `/memes/${encodeURIComponent(key)}/info`);
  } catch (_) {
    return null;
  }
}

/**
 * 获取全部表情信息列表。
 * @param {string} api 表情服务 API 地址
 * @returns {Promise<object[]>} 表情信息数组
 */
async function getInfos(api) {
  const data = await requestJson(api, "/meme/infos?sort_by=keywords_pinyin");
  return Array.isArray(data) ? data : [];
}

async function requestText(base, path) {
  const url = `${normalizeBase(base)}${path}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  return res.text().catch(() => "");
}

/**
 * 获取表情服务版本（健康检查）。
 * @param {string} api 表情服务 API 地址
 * @returns {Promise<string>} 版本号
 */
async function version(api) {
  const text = await requestText(api, "/meme/version");
  return text.trim();
}

/**
 * 生成图片的公网 URL。
 * @param {string} imageUrlBase 图片 URL 前缀（如 https://emoji.iotty.cn）
 * @param {string} imageId 图片 id
 * @returns {string} 完整图片 URL
 */
function imageUrl(imageUrlBase, imageId) {
  return `${normalizeBase(imageUrlBase)}/image/${imageId}`;
}

module.exports = {
  uploadByData,
  generate,
  search,
  getInfo,
  getInfos,
  version,
  imageUrl,
};
