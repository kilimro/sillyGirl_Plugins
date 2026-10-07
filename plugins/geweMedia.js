// [title: Gewe语音发送依赖模块]
// [name: geweMedia]
// [desc: 把文本/音频转成 Gewe 微信语音条所需的 silk 公网 URL：mp3/wav/amr→silk(纯本地 silk-wasm+可选ffmpeg)→上传Cloudflare R2→返回公网URL。配置由调用插件通过 configure() 传入，供插件在 Gewe 平台发送语音条时使用。]
// [author: Mianpro官方]
// [version: v2.0.0]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 模块]
// [icon: https://api.920pdd.com/favicon.ico]
// [module: true]
// [origin: 自定义]
// [depe: ["@aws-sdk/client-s3","silk-wasm"]]

"use strict";
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

// ===== 可选依赖（加载失败不阻塞其余能力）=====
let silk = null;
try {
  silk = require("silk-wasm");
} catch (_) {}
let S3Client = null;
let PutObjectCommand = null;
try {
  const s3 = require("@aws-sdk/client-s3");
  S3Client = s3.S3Client;
  PutObjectCommand = s3.PutObjectCommand;
} catch (_) {}
let ffmpegStatic = null;
// 动态 require：ffmpeg-static 体积大，做成可选增强，不让依赖扫描器写进 [depe]
try {
  const FFMPEG_STATIC = "ffmpeg-static";
  ffmpegStatic = require(FFMPEG_STATIC);
} catch (_) {}

// ===== 配置 =====
const DEFAULT_CFG = {
  downloadDir: "", // 临时目录（放中间 silk/pcm 文件）；默认 <cwd>/data/gewe-media
  upload: null, // 上传后端配置，见 configure
  ffmpegPath: "", // ffmpeg 二进制路径；空则自动探测(系统ffmpeg→ffmpeg-static)
  timeout: 30000, // 拉取远程音频超时毫秒
  maxRetries: 2, // 拉取远程音频重试次数
  silkSampleRate: 24000, // 微信 silk 常用采样率
};
let cfg = { ...DEFAULT_CFG };

function defaultDownloadDir() {
  return path.join(process.cwd(), "data", "gewe-media");
}

/**
 * 配置模块（调用插件启动时调用一次，全局生效）。
 * upload 支持两种后端：
 *   1) R2：{ provider:"r2", accountId, accessKeyId, secretAccessKey, bucketName, publicBaseUrl,
 *           endpoint?, region? }
 *   2) 自定义：{ provider:"custom", uploader: async(localPath, opts)=>{ return url } }
 */
function configure(input) {
  if (!input || typeof input !== "object") return cfg;
  cfg = {
    ...cfg,
    ...input,
    upload: input.upload && typeof input.upload === "object" ? { ...input.upload } : cfg.upload,
  };
  return cfg;
}

function getConfig() {
  return cfg;
}

// ===== 内部工具 =====
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(cfg.timeout) || 30000);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function sanitizeName(name) {
  return String(name || "media")
    .replace(/[\\/:*?"<>|\s]+/g, "_")
    .slice(0, 180);
}

function guessMime(localPath) {
  const ext = path.extname(String(localPath || "").split("?")[0]).toLowerCase();
  const map = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".amr": "audio/amr",
    ".pcm": "audio/pcm",
    ".silk": "audio/silk",
  };
  return (ext && map[ext]) || "audio/silk";
}

function resolveExt(url, mime) {
  const ext = path
    .extname(String(url || "").split("?")[0])
    .toLowerCase()
    .replace(".", "");
  if (ext && ext.length >= 2 && ext.length <= 5) return ext;
  const fromMime = {
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/amr": "amr",
    "audio/pcm": "pcm",
    "audio/silk": "silk",
  };
  return fromMime[mime] || "silk";
}

async function readInputBuffer(input) {
  if (/^https?:\/\//i.test(String(input))) {
    const retries = Math.max(0, Number(cfg.maxRetries) || 0);
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const res = await fetchWithTimeout(input);
        if (!res.ok) throw new Error(`读取远程资源失败 HTTP ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
      } catch (error) {
        lastError = error;
        if (attempt < retries) await sleep(300 * (attempt + 1));
      }
    }
    throw new Error(`读取远程资源失败(${input}): ${(lastError && lastError.message) || "未知错误"}`);
  }
  return await fsp.readFile(input);
}

function requireSilk() {
  if (!silk) throw new Error("缺少依赖 silk-wasm：请安装 npm i silk-wasm");
  return silk;
}

function writeOut(data, dir, filename, ext, mime) {
  const outDir = dir || cfg.downloadDir || defaultDownloadDir();
  const base = filename || `voice_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.${ext}`;
  const target = path.join(outDir, sanitizeName(base));
  return fsp
    .mkdir(outDir, { recursive: true })
    .then(() => fsp.writeFile(target, data))
    .then(() => ({
      path: target,
      size: data.length,
      mime,
    }));
}

// ===== ffmpeg（可选增强，mp3/wav/amr→pcm 需要）=====
function resolveFfmpeg() {
  if (cfg.ffmpegPath) return cfg.ffmpegPath;
  if (ffmpegStatic) return ffmpegStatic;
  return "ffmpeg";
}

function ffmpegAvailable() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    try {
      const proc = spawn(resolveFfmpeg(), ["-version"], { stdio: "ignore" });
      proc.on("error", () => finish(false));
      proc.on("close", (code) => finish(code === 0));
      setTimeout(() => finish(false), 5000).unref();
    } catch (_) {
      finish(false);
    }
  });
}

async function requireFfmpeg() {
  if (!(await ffmpegAvailable())) {
    throw new Error(
      "mp3/wav/amr 转 silk 需要 ffmpeg：未检测到系统 ffmpeg，也未安装 ffmpeg-static。可安装系统 ffmpeg，或 npm i ffmpeg-static，或在 configure 里指定 ffmpegPath",
    );
  }
  return resolveFfmpeg();
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const proc = spawn(resolveFfmpeg(), args);
    proc.stderr.on("data", (d) => {
      stderr += String(d);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg 退出码 ${code}: ${String(stderr).slice(-500)}`));
    });
  });
}

// ===== 语音转码（发送侧核心）=====
/**
 * pcm → silk（返回 Buffer，可直接落盘 .silk 供 Gewe 发送）
 * @param {string|Buffer} input pcm 路径或 Buffer
 * @param {{sampleRate?:number}} [opts]
 */
async function pcmToSilk(input, opts = {}) {
  const sw = requireSilk();
  const buf = Buffer.isBuffer(input)
    ? input
    : input instanceof Uint8Array
      ? Buffer.from(input)
      : await readInputBuffer(input);
  const sampleRate = Number(opts.sampleRate) || Number(cfg.silkSampleRate) || 24000;
  const result = await sw.encode(buf, sampleRate);
  return { data: Buffer.from(result.data) };
}

/**
 * mp3/wav/amr → silk（用于 Gewe 发送语音）。需要 ffmpeg 先把音频转成 pcm_s16le。
 * @param {string|Buffer} input 本地路径 / http(s) URL / Buffer
 * @returns {Promise<{path:string,size:number,mime:string}>}
 */
async function mp3ToSilk(input, opts = {}) {
  await requireFfmpeg();
  const sampleRate = Number(opts.sampleRate) || Number(cfg.silkSampleRate) || 24000;
  const outDir = opts.dir || cfg.downloadDir || defaultDownloadDir();
  await fsp.mkdir(outDir, { recursive: true });
  const pcmPath = path.join(outDir, `_tmp_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.pcm`);
  const inputPath = Buffer.isBuffer(input) ? null : String(input);
  const inputBuf = Buffer.isBuffer(input) ? input : await readInputBuffer(input);
  try {
    if (inputPath) {
      await runFfmpeg(["-y", "-i", inputPath, "-ar", String(sampleRate), "-ac", "1", "-f", "s16le", pcmPath]);
    } else {
      const tmpSrc = path.join(outDir, `_tmp_src_${Date.now()}.tmp`);
      await fsp.writeFile(tmpSrc, inputBuf);
      try {
        await runFfmpeg(["-y", "-i", tmpSrc, "-ar", String(sampleRate), "-ac", "1", "-f", "s16le", pcmPath]);
      } finally {
        fsp.unlink(tmpSrc).catch(() => undefined);
      }
    }
    const pcm = await fsp.readFile(pcmPath);
    const { data } = await pcmToSilk(pcm, { sampleRate });
    return writeOut(data, outDir, opts.filename, "silk", "audio/silk");
  } finally {
    fsp.unlink(pcmPath).catch(() => undefined);
  }
}

// ===== 上传（本地 → R2 → 公网 URL）=====
/**
 * 把本地文件变成公网 URL。默认走 Cloudflare R2，也可注入自定义 uploader。
 * @param {string} localPath
 * @param {{contentType?:string, key?:string}} [opts]
 * @returns {Promise<string>}
 */
async function toSendableUrl(localPath, opts = {}) {
  if (!cfg.upload) {
    throw new Error(
      "toSendableUrl: 未配置上传后端(cfg.upload)。请配置 R2({provider:'r2',accountId,accessKeyId,secretAccessKey,bucketName,publicBaseUrl}) 或自定义 uploader；否则请插件自行把本地文件转成公网 URL",
    );
  }
  if (cfg.upload.provider === "r2") return uploadToR2(localPath, opts);
  if (typeof cfg.upload.uploader === "function") {
    const url = await cfg.upload.uploader(localPath, opts);
    if (!url) throw new Error("toSendableUrl: 自定义 uploader 未返回 URL");
    return url;
  }
  throw new Error(`toSendableUrl: 未知上传后端 ${cfg.upload.provider}`);
}

async function uploadToR2(localPath, opts = {}) {
  if (!S3Client || !PutObjectCommand) throw new Error("toSendableUrl: 缺少 @aws-sdk/client-s3 依赖");
  const up = cfg.upload;
  if (!up.accountId || !up.accessKeyId || !up.secretAccessKey || !up.bucketName) {
    throw new Error("toSendableUrl: R2 配置不完整，需 accountId/accessKeyId/secretAccessKey/bucketName");
  }
  const stat = await fsp.stat(localPath);
  if (!stat.isFile()) throw new Error(`toSendableUrl: 不是文件 ${localPath}`);
  const ext = path.extname(localPath).toLowerCase();
  const finalKey = opts.key || `gewe/${Date.now()}_${crypto.randomBytes(4).toString("hex")}${ext}`;
  const client = new S3Client({
    region: up.region || "auto",
    endpoint: up.endpoint || `https://${up.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: up.accessKeyId, secretAccessKey: up.secretAccessKey },
  });
  const body = await fsp.readFile(localPath);
  await client.send(
    new PutObjectCommand({
      Bucket: up.bucketName,
      Key: finalKey,
      Body: body,
      ContentType: opts.contentType || guessMime(localPath),
    }),
  );
  if (!up.publicBaseUrl) throw new Error("R2 上传成功但未配置 publicBaseUrl，无法返回公网 URL");
  return `${String(up.publicBaseUrl).replace(/\/+$/, "")}/${finalKey}`;
}

// ===== 工具：CQ 码构造（仅语音）=====
/**
 * 生成 Gewe 语音条 CQ 码。Gewe 需要公网 silk URL。
 * @param {string} url silk 公网 URL
 */
function cqRecord(url) {
  return `[CQ:record,url=${url}]`;
}

// ===== 高层封装：音频 → silk 公网 URL =====
/**
 * 把任意音频(mp3/wav/amr 的本地路径/URL/Buffer) 转成 silk 并上传，返回公网 URL。
 * 供插件在 Gewe 平台发送语音条使用（配合 cqRecord）。
 * @param {string|Buffer} audioInput 本地路径 / http(s) URL / Buffer
 * @param {{filename?:string, key?:string, sampleRate?:number, dir?:string}} [opts]
 * @returns {Promise<string>}
 */
async function toSilkPublicUrl(audioInput, opts = {}) {
  const silkFile = await mp3ToSilk(audioInput, opts);
  return toSendableUrl(silkFile.path, { contentType: "audio/silk", key: opts.key });
}

module.exports = {
  configure,
  getConfig,
  // 发送侧
  toSilkPublicUrl,
  mp3ToSilk,
  pcmToSilk,
  toSendableUrl,
  // 工具
  cqRecord,
  // 内部暴露（供自测/复用）
  _internal: { resolveExt, guessMime, requireFfmpeg, ffmpegAvailable },
};
