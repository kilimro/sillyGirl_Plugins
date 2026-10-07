// [title: Gewe多媒体依赖模块]
// [name: geweMedia]
// [desc: 收敛 Gewe 微信多媒体收发链路：下载(CDN URL→本地落盘)、语音转码(silk↔mp3/wav/pcm，纯本地silk-wasm+可选ffmpeg)、上传(本地→Cloudflare R2→公网URL)、CQ码构造。供其它插件 require 使用，不改适配器。]
// [author: Mianpro官方]
// [version: v1.0.0]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 模块]
// [module: true]
// [icon: https://api.920pdd.com/favicon.ico]
// [origin: 自定义]
// [depe: ["@aws-sdk/client-s3","silk-wasm"]]

"use strict";
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { Readable } = require("node:stream");
const { utils } = require("sillygirl");

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
  baseUrl: "", // Gewe 接口地址（如需模块直接调 Gewe API）
  token: "", // Gewe X-GEWE-TOKEN
  appId: "", // Gewe 设备 ID
  downloadDir: "", // 下载目录；默认 <cwd>/data/gewe-media
  upload: null, // 上传后端配置，见 configure
  ffmpegPath: "", // ffmpeg 二进制路径；空则自动探测(系统ffmpeg→ffmpeg-static)
  timeout: 15000, // 网络超时毫秒
  maxRetries: 2, // 下载/网络重试次数
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
  const timer = setTimeout(() => controller.abort(), Number(cfg.timeout) || 15000);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function streamToFile(stream, target) {
  return new Promise((resolve, reject) => {
    const write = fs.createWriteStream(target);
    // fetch 返回的 body 是 web ReadableStream，需转成 Node stream 才能 .pipe()
    const nodeStream = stream && typeof stream.pipe === "function" ? stream : Readable.fromWeb(stream);
    nodeStream.on("error", (error) => {
      write.destroy();
      reject(error);
    });
    write.on("error", reject);
    write.on("finish", resolve);
    nodeStream.pipe(write);
  });
}

function sanitizeName(name) {
  return String(name || "media")
    .replace(/[\\/:*?"<>|\s]+/g, "_")
    .slice(0, 180);
}

function guessMime(type, url) {
  const ext = path.extname(String(url || "").split("?")[0]).toLowerCase();
  const map = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".pcm": "audio/pcm",
    ".amr": "audio/amr",
    ".silk": "audio/silk",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".zip": "application/zip",
  };
  if (ext && map[ext]) return map[ext];
  const typeMap = { image: "image/jpeg", voice: "audio/silk", video: "video/mp4", file: "application/octet-stream" };
  return typeMap[type] || "application/octet-stream";
}

function resolveExt(type, url, mime) {
  const ext = path
    .extname(String(url || "").split("?")[0])
    .toLowerCase()
    .replace(".", "");
  if (ext && ext.length >= 2 && ext.length <= 5) return ext;
  const fromMime = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/pcm": "pcm",
    "audio/amr": "amr",
    "audio/silk": "silk",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
  };
  if (fromMime[mime]) return fromMime[mime];
  const typeMap = { image: "jpg", voice: "silk", video: "mp4", file: "bin" };
  return typeMap[type] || "bin";
}

async function readInputBuffer(input) {
  if (/^https?:\/\//i.test(String(input))) {
    const res = await fetchWithTimeout(input);
    if (!res.ok) throw new Error(`读取远程资源失败 HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return await fsp.readFile(input);
}

// WAV 头（pcm_s16le + 头）
function buildWavHeader(pcmLength, sampleRate, channels = 1, bits = 16) {
  const buf = Buffer.alloc(44);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + pcmLength, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * (bits / 8), 28);
  buf.writeUInt16LE(channels * (bits / 8), 32);
  buf.writeUInt16LE(bits, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(pcmLength, 40);
  return buf;
}

function requireSilk() {
  if (!silk) throw new Error("缺少依赖 silk-wasm：请安装 npm i silk-wasm");
  return silk;
}

// ===== ffmpeg（可选增强，仅 mp3 相关需要）=====
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
      "mp3 转码需要 ffmpeg：未检测到系统 ffmpeg，也未安装 ffmpeg-static。可安装系统 ffmpeg，或 npm i ffmpeg-static，或在 configure 里指定 ffmpegPath",
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

// ===== 能力一：多媒体下载（接收侧）=====
/**
 * 把 Gewe 的 CDN URL 下载为本地文件。
 * @param {string} url CQ 码 file= 里的值
 * @param {{type?:string, filename?:string}} [opts] type: image|voice|video|file
 * @returns {Promise<{path:string,size:number,mime:string}>}
 */
async function download(url, opts = {}) {
  if (!url || typeof url !== "string") throw new Error("download: 缺少媒体 URL");
  const { type = "", filename = "" } = opts || {};
  const dir = cfg.downloadDir || defaultDownloadDir();
  await fsp.mkdir(dir, { recursive: true });
  const retries = Math.max(0, Number(cfg.maxRetries) || 0);
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const mime =
        String(response.headers.get("content-type") || "")
          .split(";")[0]
          .trim() || guessMime(type, url);
      const ext = resolveExt(type, url, mime);
      const name = filename || `${type || "media"}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.${ext}`;
      const target = path.join(dir, sanitizeName(name));
      await streamToFile(response.body, target);
      const size = (await fsp.stat(target)).size;
      if (!size) throw new Error("下载内容为空");
      return { path: target, size, mime };
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(300 * (attempt + 1));
    }
  }
  throw new Error(`download 失败(${url}): ${(lastError && lastError.message) || "未知错误"}`);
}

// ===== 能力二：语音转码（核心）=====
/**
 * silk → pcm（返回 Buffer）
 * @param {string|Buffer} input silk 路径或 URL，或 Buffer
 * @param {{sampleRate?:number}} [opts]
 */
async function silkToPcm(input, opts = {}) {
  const sw = requireSilk();
  const buf = Buffer.isBuffer(input) ? input : await readInputBuffer(input);
  const sampleRate = Number(opts.sampleRate) || Number(cfg.silkSampleRate) || 24000;
  const result = await sw.decode(buf, sampleRate);
  return { data: Buffer.from(result.data), sampleRate: result.sampleRate || sampleRate };
}

/**
 * pcm → silk（返回 Buffer，可直接落盘 .silk 供 Gewe 发送）
 * @param {string|Buffer} input pcm 路径或 Buffer
 * @param {{sampleRate?:number}} [opts]
 */
async function pcmToSilk(input, opts = {}) {
  const sw = requireSilk();
  const buf = Buffer.isBuffer(input) ? input : await readInputBuffer(input);
  const sampleRate = Number(opts.sampleRate) || Number(cfg.silkSampleRate) || 24000;
  const result = await sw.encode(buf, sampleRate);
  return { data: Buffer.from(result.data) };
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

/**
 * silk → 可播放格式。format: pcm|wav|mp3（mp3 需要 ffmpeg）。
 * @returns {Promise<{path:string,size:number,mime:string}>}
 */
async function voiceToMp3(input, opts = {}) {
  const format = String(opts.format || "mp3").toLowerCase();
  const { data, sampleRate } = await silkToPcm(input, opts);
  if (format === "pcm") return writeOut(data, opts.dir, opts.filename, "pcm", "audio/pcm");
  if (format === "wav") {
    const wav = Buffer.concat([buildWavHeader(data.length, sampleRate), data]);
    return writeOut(wav, opts.dir, opts.filename, "wav", "audio/wav");
  }
  if (format !== "mp3") throw new Error(`voiceToMp3: 不支持的输出格式 ${format}（可选 pcm/wav/mp3）`);
  await requireFfmpeg();
  const pcmPath = path.join(
    opts.dir || cfg.downloadDir || defaultDownloadDir(),
    `_tmp_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.pcm`,
  );
  await fsp.mkdir(path.dirname(pcmPath), { recursive: true });
  await fsp.writeFile(pcmPath, data);
  try {
    const outPath = path.join(
      opts.dir || cfg.downloadDir || defaultDownloadDir(),
      sanitizeName(opts.filename || `voice_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.mp3`),
    );
    await runFfmpeg([
      "-y",
      "-f",
      "s16le",
      "-ar",
      String(sampleRate),
      "-ac",
      "1",
      "-i",
      pcmPath,
      "-b:a",
      "64k",
      outPath,
    ]);
    const size = (await fsp.stat(outPath)).size;
    return { path: outPath, size, mime: "audio/mpeg" };
  } finally {
    fsp.unlink(pcmPath).catch(() => undefined);
  }
}

/**
 * mp3/wav/amr → silk（用于 Gewe 发送语音）。需要 ffmpeg 先把音频转成 pcm_s16le。
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

// ===== 能力三：上传（本地 → R2 → 公网 URL）=====
/**
 * 把本地文件变成 Gewe 可发送的公网 URL。默认走 Cloudflare R2，也可注入自定义 uploader。
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
      ContentType: opts.contentType || guessMime("", localPath),
    }),
  );
  if (!up.publicBaseUrl) throw new Error("R2 上传成功但未配置 publicBaseUrl，无法返回公网 URL");
  return `${String(up.publicBaseUrl).replace(/\/+$/, "")}/${finalKey}`;
}

// ===== 工具：CQ 码构造 =====
function buildCq(type, params) {
  if (utils && typeof utils.buildCQTag === "function") {
    try {
      return utils.buildCQTag(type, params);
    } catch (_) {}
  }
  const file = params && params.file;
  return `[CQ:${type},file=${file}]`;
}

function cqImage(url) {
  return buildCq("image", { file: url });
}
function cqRecord(url) {
  return buildCq("record", { file: url });
}
function cqFile(url) {
  return buildCq("file", { file: url });
}
function cqVideo(url) {
  return buildCq("video", { file: url });
}

module.exports = {
  configure,
  getConfig,
  // 能力一
  download,
  // 能力二
  voiceToMp3,
  mp3ToSilk,
  silkToPcm,
  pcmToSilk,
  // 能力三
  toSendableUrl,
  // 工具
  cqImage,
  cqRecord,
  cqFile,
  cqVideo,
  // 内部暴露（供自测/复用）
  _internal: { buildWavHeader, resolveExt, guessMime, requireFfmpeg, ffmpegAvailable, buildCq },
};
