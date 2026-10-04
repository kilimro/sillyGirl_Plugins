// [title: 京东通用 Sign]
// [name: jdSignLegacy]
// [desc: 京东 12.1.4 Android 请求签名模块，迁移 JD 通用 sign 与 ES5 版本核心算法]
// [author: chuan,hunyan]
// [version: v1.6.4]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 10]
// [class: 工具类]
// [icon: https://www.jd.com/favicon.ico]
// [module: true]
// [carry: true]
// [origin: backup/JD通用sign_v1.6.3_By.chuan.py;backup/JD通用sign_v1.6.3_By.chuan.txt;backup/JDsignES5版_v1.0.0_By.hunyan.txt]
// [depe: []]

"use strict";

const crypto = require("node:crypto");

const KEY = Buffer.from("80306f4370b39fd5630ad0529f77adb6", "utf8");
const MASK = Buffer.from([
  0x37, 0x92, 0x44, 0x68, 0xa5, 0x3d, 0xcc, 0x7f, 0xbb, 0x0f, 0xd9, 0x88, 0xee, 0x9a, 0xe9, 0x5a,
]);
const SOURCE_ALPHABET = "KLMNOPQRSTABCDEFGHIJUVWXYZabcdopqrstuvwxefghijklmnyz0123456789+/";
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DEVICE_MODELS = {
  OPPO: ["PAFM00", "PDEM10", "PDRM00", "PENM00", "PGW110"],
  Xiaomi: ["23078PND5G", "2211133C", "M1902F1A"],
  HUAWEI: ["LIO-AL00", "OCE-AN10", "JER-AN20", "RTE-AL00"],
};

/** Exact byte transform used by the legacy ES5 implementation. */
function signCore(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const output = Buffer.alloc(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) {
    let r0 = MASK[index & 0x0f] ^ bytes[index];
    r0 ^= KEY[index & 0x07];
    r0 += MASK[index & 0x0f];
    let r2 = MASK[index & 0x0f] ^ r0;
    r2 ^= KEY[index & 0x07];
    output[index] = r2 & 0xff;
  }
  return output.toString("base64");
}

function translate(value, fromAlphabet, toAlphabet) {
  let output = "";
  for (const character of String(value)) {
    const index = fromAlphabet.indexOf(character);
    if (index >= 0) output += toAlphabet[index];
  }
  return output;
}

function cipherBase64(value) {
  return translate(Buffer.from(String(value), "utf8").toString("base64"), SOURCE_ALPHABET, BASE64_ALPHABET);
}

function randomString(length, alphabet = "abcdefghijklmnopqrstuvwxyz0123456789", random = Math.random) {
  let output = "";
  for (let index = 0; index < length; index += 1) output += alphabet[Math.floor(random() * alphabet.length)];
  return output;
}

function randomHex(length, random = Math.random) {
  return randomString(length, "abcdef0123456789", random);
}

function randomDigits(length, random = Math.random) {
  return randomString(length, "0123456789", random);
}

function uuidV1(random = Math.random) {
  return [8, 4, 4, 4, 12].map((length) => randomHex(length, random)).join("-");
}

function randomEid(random = Math.random) {
  return `eidAaf8081218as20a2GM${randomString(20, undefined, random)}7FnfQYOecyDYLcd0rfzm3Fy2ePY4UJJOeV0Ub840kG8C7lmIqt3DTlc11fB/s4qsAP8gtPTSoxu`;
}

function choose(values, random) {
  return values[Math.floor(random() * values.length)];
}

function getEp(options = {}) {
  const random = options.random || Math.random;
  const jduuid = options.jduuid || uuidV1(random).replace(/-/g, "").slice(0, 16);
  const ts = Number(options.ts ?? Date.now());
  const area =
    options.area ||
    `${randomDigits(2, random)}_${randomDigits(4, random)}_${randomDigits(5, random)}_${randomDigits(4, random)}`;
  const brand = options.brand || choose(Object.keys(DEVICE_MODELS), random);
  const model = options.model || choose(DEVICE_MODELS[brand] || DEVICE_MODELS.OPPO, random);
  const wifiBssid = options.wifiBssid || `TP_LINK_${randomString(6, undefined, random)}`;
  const osVersion = options.osVersion || choose(["10", "11", "12"], random);
  const screen = options.screen || choose(["640x1136", "750x1334", "1080x1920"], random);
  const ep = JSON.stringify({
    hdid: "JM9F1ywUPwflvMIpYPok0tt5k9kW4ArJEU3lfLhxBqw=",
    ts,
    ridx: -1,
    cipher: {
      area: cipherBase64(area),
      d_model: cipherBase64(model),
      wifiBssid: cipherBase64(wifiBssid),
      osVersion: cipherBase64(osVersion),
      d_brand: cipherBase64(brand),
      screen: cipherBase64(screen),
      uuid: cipherBase64(jduuid),
      aid: cipherBase64(jduuid),
      openudid: cipherBase64(jduuid),
    },
    ciphertype: 5,
    version: "1.2.0",
    appname: "com.jingdong.app.mall",
  });
  return { ep, ts, jduuid, d_brand: brand };
}

function normalizeBody(body) {
  if (typeof body === "string") {
    JSON.parse(body);
    return body;
  }
  return JSON.stringify(body || {});
}

/**
 * Build the legacy /jd/sign response without starting another HTTP server.
 * New web plugins can call this module and expose the result through their router.
 */
function getSignEs5(functionId, body, client = "android", clientVersion = "12.1.4", options = {}) {
  if (!String(functionId || "").trim()) throw new TypeError("functionId 不能为空");
  const normalizedBody = normalizeBody(body);
  const bodyObject = JSON.parse(normalizedBody);
  const { ep, ts, jduuid, d_brand: brand } = getEp(options);
  const versions = [
    [0, 2],
    [1, 1],
    [2, 0],
  ];
  const random = options.random || Math.random;
  const [r1, r2] = options.versionPair || choose(versions, random);
  const sv = `1${r1}${r2}`;
  const allArgs = `functionId=${functionId}&body=${normalizedBody}&uuid=${jduuid}&client=${client}&clientVersion=${clientVersion}&st=${ts}&sv=${sv}`;
  const sign = crypto
    .createHash("md5")
    .update(signCore(Buffer.from(allArgs, "utf8")))
    .digest("hex");
  const ext = encodeURIComponent('{"prstate":"0","pvcStu":"1"}');
  const partner = brand.toLowerCase();
  const eid = Object.prototype.hasOwnProperty.call(bodyObject, "eid") ? bodyObject.eid : randomEid(random);
  const encodedEp = encodeURIComponent(ep);
  const convertUrl = `body=${encodeURIComponent(normalizedBody)}&clientVersion=${clientVersion}&build=98935&client=${client}&partner=${partner}&sdkVersion=31&lang=zh_CN&harmonyOs=0&networkType=wifi&ext=${ext}&oaid=${jduuid}&eid=${eid}&ef=1&ep=${encodedEp}&st=${ts}&sign=${sign}&sv=${sv}`;
  return {
    code: 200,
    fn: functionId,
    body: convertUrl,
    data: {
      functionId,
      body: normalizedBody,
      clientVersion,
      client,
      partner,
      sdkVersion: "31",
      lang: "zh_CN",
      harmonyOs: "0",
      networkType: "wifi",
      ext,
      oaid: jduuid,
      eid,
      ef: "1",
      ep: encodedEp,
      st: ts,
      sign,
      sv,
      convertUrl,
    },
  };
}

function quotePlus(value) {
  return encodeURIComponent(String(value))
    .replace(/%20/g, "+")
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function pythonJsonDumps(value) {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : value > 0 ? "Infinity" : value < 0 ? "-Infinity" : "NaN";
  if (typeof value === "string")
    return JSON.stringify(value).replace(
      /[\u007f-\uffff]/g,
      (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
  if (Array.isArray(value)) return `[${value.map(pythonJsonDumps).join(", ")}]`;
  if (typeof value === "object")
    return `{${Object.entries(value)
      .map(([key, item]) => `${pythonJsonDumps(key)}: ${pythonJsonDumps(item)}`)
      .join(", ")}}`;
  throw new TypeError(`不支持的 JSON 类型：${typeof value}`);
}

/** Exact response layout of JD通用sign v1.6.3 (Python edition). */
function getSignPython(functionId, body, client = "android", clientVersion = "12.1.4", options = {}) {
  if (!String(functionId || "").trim()) throw new TypeError("functionId 不能为空");
  const normalizedBody = typeof body === "string" ? body : pythonJsonDumps(body || {});
  const bodyObject = JSON.parse(normalizedBody);
  const random = options.random || Math.random;
  const ts = String(options.ts ?? Date.now());
  const jduuid = options.jduuid || randomString(16, "abcdef0123456789", random);
  const area =
    options.area ||
    [randomDigits(2, random), randomDigits(4, random), randomDigits(5, random), randomDigits(4, random)].join("_");
  const brand = options.brand || choose(Object.keys(DEVICE_MODELS), random);
  const model = options.model || choose(DEVICE_MODELS[brand] || DEVICE_MODELS.OPPO, random);
  const wifiBssid =
    options.wifiBssid ||
    Array.from({ length: 6 }, () => choose("0123456789ABCDEFG".split(""), random)).join("TP_LINK_");
  const osVersion = options.osVersion || choose(["10", "11", "12"], random);
  const screen = options.screen || choose(["640x1136", "750x1334", "1080x1920"], random);
  const ep = JSON.stringify({
    hdid: "JM9F1ywUPwflvMIpYPok0tt5k9kW4ArJEU3lfLhxBqw=",
    ts,
    ridx: -1,
    cipher: {
      area: cipherBase64(area),
      d_model: cipherBase64(model),
      wifiBssid: cipherBase64(wifiBssid),
      osVersion: cipherBase64(osVersion),
      d_brand: cipherBase64(brand),
      screen: cipherBase64(screen),
      uuid: cipherBase64(jduuid),
      aid: cipherBase64(jduuid),
      openudid: cipherBase64(jduuid),
    },
    ciphertype: 5,
    version: "1.2.0",
    appname: "com.jingdong.app.mall",
  });
  const [r1, r2] =
      options.versionPair ||
      choose(
        [
          [0, 2],
          [1, 1],
          [2, 0],
        ],
        random,
      ),
    sv = `1${r1}${r2}`;
  const allArgs = `functionId=${functionId}&body=${normalizedBody}&uuid=${jduuid}&client=${client}&clientVersion=${clientVersion}&st=${ts}&sv=${sv}`;
  const sign = crypto
    .createHash("md5")
    .update(signCore(Buffer.from(allArgs, "utf8")))
    .digest("hex");
  const partner = brand.toLowerCase(),
    eid = Object.prototype.hasOwnProperty.call(bodyObject, "eid") ? bodyObject.eid : randomEid(random),
    encodedEp = quotePlus(ep);
  const convertUrl = `body=${normalizedBody}&clientVersion=${clientVersion}&client=${client}&partner=${partner}&sdkVersion=31&lang=zh_CN&harmonyOs=0&networkType=wifi&oaid=${jduuid}&eid=${eid}&ef=1&ep=${encodedEp}&st=${ts}&sign=${sign}&sv=${sv}`;
  return {
    code: 200,
    fn: functionId,
    body: convertUrl,
    data: {
      functionId,
      body: normalizedBody,
      clientVersion,
      client,
      partner,
      sdkVersion: 31,
      lang: "zh_CN",
      harmonyOs: 0,
      networkType: "wifi",
      oaid: jduuid,
      ef: 1,
      ep: encodedEp,
      st: ts,
      sign,
      sv,
      convertUrl,
    },
    msg: "success",
  };
}

function getSign(functionId, body, client = "android", clientVersion = "12.1.4", options = {}) {
  return options.edition === "es5"
    ? getSignEs5(functionId, body, client, clientVersion, options)
    : getSignPython(functionId, body, client, clientVersion, options);
}

module.exports = {
  getSign,
  get_sign: getSign,
  getSignPython,
  getSignEs5,
  getEp,
  getep: getEp,
  signCore,
  sign_core: signCore,
  cipherBase64,
  base64Encode: cipherBase64,
  randomEid,
};
