#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");

// ===== mock sillygirl =====
const fake = {
  utils: {
    buildCQTag: (type, params) => `[CQ:${type},file=${params.file}]`,
    image: (url) => `[CQ:image,file=${url}]`,
  },
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

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gewe-media-smoke-"));
  const gewe = require(path.join(root, "plugins", "geweMedia.js"));

  // ===== 能力三前置：toSendableUrl 未配置应抛明确错误 =====
  gewe.configure({ downloadDir: tmp });
  const probe = path.join(tmp, "a.txt");
  fs.writeFileSync(probe, "x");
  await assert.rejects(() => gewe.toSendableUrl(probe), /未配置上传后端/);

  // ===== 能力一：下载 =====
  const imgData = crypto.randomBytes(2048);
  const oldFetch = global.fetch;
  global.fetch = async () =>
    new Response(new Uint8Array(imgData), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  const dl = await gewe.download("https://cdn.gewe.test/pic/abc", { type: "image", dir: tmp });
  assert.equal(dl.size, imgData.length);
  assert.match(dl.mime, /image\/png/);
  assert.ok(fs.existsSync(dl.path));
  assert.deepEqual(fs.readFileSync(dl.path), imgData);

  // ===== 能力二：语音转码（silk-wasm 纯本地）=====
  let silk;
  try {
    ({ encode: silk } = require("silk-wasm"));
  } catch (_) {}
  if (!silk) throw new Error("缺少 silk-wasm，请先 npm i silk-wasm 再运行测试");

  // 1 秒静音 pcm（24000Hz mono s16le）
  const pcmData = new Uint8Array(24000 * 2 * 1);
  const silkBuf = Buffer.from((await silk(pcmData, 24000)).data);

  // silk → pcm
  const { data: pcm, sampleRate } = await gewe.silkToPcm(silkBuf, { sampleRate: 24000 });
  assert.equal(sampleRate, 24000);
  assert.equal(pcm.length, pcmData.length);

  // pcm → silk
  const { data: silkRound } = await gewe.pcmToSilk(pcm, { sampleRate: 24000 });
  assert.ok(silkRound.length > 0);

  // silk → wav
  const wav = await gewe.voiceToMp3(silkBuf, { format: "wav", sampleRate: 24000, dir: tmp });
  assert.match(wav.mime, /audio\/wav/);
  assert.ok(fs.readFileSync(wav.path).subarray(0, 4).equals(Buffer.from("RIFF")));

  // silk → pcm 落盘
  const pcmOut = await gewe.voiceToMp3(silkBuf, { format: "pcm", sampleRate: 24000, dir: tmp });
  assert.match(pcmOut.mime, /audio\/pcm/);

  // mp3 链路：仅当检测到 ffmpeg 时验证（否则跳过并提示）
  const hasFfmpeg = await gewe._internal.ffmpegAvailable();
  if (hasFfmpeg) {
    const mp3 = await gewe.voiceToMp3(silkBuf, { format: "mp3", sampleRate: 24000, dir: tmp });
    assert.match(mp3.mime, /audio\/mpeg/);
    const backSilk = await gewe.mp3ToSilk(mp3.path, { sampleRate: 24000, dir: tmp });
    assert.match(backSilk.mime, /audio\/silk/);
    assert.ok(fs.statSync(backSilk.path).size > 0);
  } else {
    await assert.rejects(() => gewe.voiceToMp3(silkBuf, { format: "mp3", sampleRate: 24000, dir: tmp }), /ffmpeg/);
  }

  // ===== 能力三：自定义 uploader 返回 URL =====
  gewe.configure({
    upload: { provider: "custom", uploader: async (p) => `https://pub.gewe.test/${path.basename(p)}` },
  });
  assert.equal(await gewe.toSendableUrl(probe), `https://pub.gewe.test/${path.basename(probe)}`);
  // R2 缺配置应报清晰错误
  gewe.configure({ upload: { provider: "r2", accountId: "a", accessKeyId: "k", secretAccessKey: "s" } });
  await assert.rejects(() => gewe.toSendableUrl(probe), /@aws-sdk|配置不完整|bucketName/);

  // ===== 工具：CQ 码 =====
  assert.equal(gewe.cqImage("https://x/img.png"), "[CQ:image,file=https://x/img.png]");
  assert.equal(gewe.cqRecord("https://x/v.silk"), "[CQ:record,file=https://x/v.silk]");
  assert.equal(gewe.cqFile("https://x/f.pdf"), "[CQ:file,file=https://x/f.pdf]");
  assert.equal(gewe.cqVideo("https://x/v.mp4"), "[CQ:video,file=https://x/v.mp4]");
  // 不依赖 utils.buildCQTag 的 fallback
  fake.utils.buildCQTag = undefined;
  assert.equal(gewe.cqImage("u"), "[CQ:image,file=u]");

  global.fetch = oldFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`gewe_media_smoke=PASS ffmpeg=${hasFfmpeg ? "yes" : "no"} download_bytes=${dl.size}`);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
