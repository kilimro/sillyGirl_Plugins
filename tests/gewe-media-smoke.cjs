#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");

// ===== mock sillygirl =====
const fake = {
  utils: { image: (url) => `[CQ:image,file=${url}]` },
  Bucket: class Bucket {},
  plugin: { Form: class Form {} },
  sender: {},
  console,
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "sillygirl") return fake;
  return originalLoad.call(this, request, parent, isMain);
};

// 生成 0.2 秒 24kHz mono s16le 静音 wav（纯 Buffer，不依赖外部文件）
function makeWav(sampleRate = 24000, seconds = 0.2) {
  const pcmLen = Math.floor(sampleRate * 2 * seconds);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmLen, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmLen, 40);
  return Buffer.concat([header, Buffer.alloc(pcmLen)]);
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gewe-media-smoke-"));
  const gewe = require(path.join(root, "plugins", "geweMedia.js"));
  gewe.configure({ downloadDir: tmp });

  // ===== 前置：toSendableUrl 未配置应抛明确错误 =====
  const probe = path.join(tmp, "a.txt");
  fs.writeFileSync(probe, "x");
  await assert.rejects(() => gewe.toSendableUrl(probe), /未配置上传后端/);

  // ===== silk-wasm 依赖 =====
  let silk;
  try {
    ({ encode: silk } = require("silk-wasm"));
  } catch (_) {}
  if (!silk) throw new Error("缺少 silk-wasm，请先 npm i silk-wasm 再运行测试");

  // ===== pcm → silk =====
  const pcmData = new Uint8Array(24000 * 2 * 1);
  const { data: silkRound } = await gewe.pcmToSilk(pcmData, { sampleRate: 24000 });
  assert.ok(silkRound.length > 0);

  // ===== 自定义 uploader + toSilkPublicUrl（wav→silk→上传）=====
  const wavBuf = makeWav();
  const wavPath = path.join(tmp, "in.wav");
  fs.writeFileSync(wavPath, wavBuf);
  gewe.configure({
    upload: { provider: "custom", uploader: async (p) => `https://pub.gewe.test/${path.basename(p)}` },
  });
  const uploadedUrl = await gewe.toSilkPublicUrl(wavPath, { dir: tmp });
  assert.match(uploadedUrl, /^https:\/\/pub\.gewe\.test\//);
  assert.match(uploadedUrl, /\.silk$/);

  // ===== cqRecord =====
  assert.equal(gewe.cqRecord(uploadedUrl), `[CQ:record,url=${uploadedUrl}]`);

  // ===== R2 缺配置应报清晰错误 =====
  gewe.configure({ upload: { provider: "r2", accountId: "a", accessKeyId: "k", secretAccessKey: "s" } });
  await assert.rejects(() => gewe.toSendableUrl(probe), /@aws-sdk|配置不完整|bucketName/);

  // ===== ffmpeg 可用性信息 =====
  const hasFfmpeg = await gewe._internal.ffmpegAvailable();

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`gewe_media_smoke=PASS ffmpeg=${hasFfmpeg ? "yes" : "no"} silk_url=${uploadedUrl}`);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
