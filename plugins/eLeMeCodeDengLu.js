// [title: 饿了么Code登录]
// [name: eLeMeCodeDengLu]
// [desc: 输入饿了么 wx.login CODE 换完整 Cookie；不带 CODE 时自动读取 SmallCat 首个可用账号，可选同步青龙/呆呆 elmck]
// [author: sillyGirl]
// [version: v1.1.4]
// [rule: ^\s*(饿了么Code|饿了么|[Ee][Ll][Mm])\s*(登录|换[Cc]ookie|取[Cc][Kk])?\s*([^\s]+)?\s*$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 10]
// [class: 工具]
// [icon: https://api.iconify.design/lucide:bot.svg]
// [origin: backup/我不饿_v3.5.0_By.chuan.py]
// [depe: []]

"use strict";

const crypto = require("node:crypto");
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const zlib = require("node:zlib");
const { sender: s, console, plugin, container, user } = require("sillygirl");

const APP_ID = process.env.ELEME_APPID || "wxece3a9a4c82f58c9";
const APP_VERSION = process.env.ELEME_APP_VERSION || "12.6.3";
const LOGIN_ENDPOINT = process.env.ELEME_LOGIN_ENDPOINT || "https://ipassport.ele.me/mini_program/login.do";
const DEFAULT_URL = LOGIN_ENDPOINT;
const UMID_URL = process.env.ELEME_UMID_URL || "https://ynuf.aliapp.org/w/mu.json";

const BX_STD64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
const BX_SUB64 = "v03TgH2iMLjV7QxCDcrAhuY46nGXFP9B+opwkybRKas58JIEfZS/zdO1tWlmeNUq=";
const BX_FINGERPRINT = zlib
  .brotliDecompressSync(
    Buffer.from(
      "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",
      "base64",
    ),
  )
  .toString();
const BX_RAW_1 = [
  133, 121, 59, 17, 6, 132, 125, 193, 29, 48, 150, 148, 148, 148, 148, 148, 148, 148, 148, 148, 149, 27, 158, 81, 155,
  27, 158, 81, 155, 137, 156, 157, 81, 155, 37, 155, 157, 27, 158, 137, 27, 158, 26, 115, 46, 19, 9, 22, 9, 22, 22, 9,
  21, 19, 33, 20, 9, 31, 9, 22, 21, 39, 39, 34, 93, 79, 120, 100, 105, 39, 39, 39, 39, 39, 39, 25, 133, 191, 183, 188,
  160, 191, 184, 182, 160, 191, 160, 188, 64, 244, 74, 173, 63, 149, 43, 124, 129,
];
const BX_RAW_3 = [
  60, 170, 42, 69, 226, 29, 19, 18, 18, 131, 113, 206, 206, 206, 206, 143, 154, 206, 175, 156, 156, 143, 151, 192, 210,
  143, 128, 129, 128, 151, 131, 129, 155, 157, 208, 206, 198, 173, 212, 178, 187, 157, 139, 156, 157, 178, 214, 216,
  222, 219, 216, 178, 170, 129, 141, 155, 131, 139, 128, 154, 157, 178, 169, 135, 154, 166, 155, 140, 178, 157, 135,
  130, 130, 151, 169, 135, 156, 130, 178, 192, 141, 129, 138, 139, 150, 195, 143, 156, 154, 135, 136, 143, 141, 154,
  157, 178, 151, 151, 140, 195, 157, 129, 155, 156, 141, 139, 178, 139, 130, 139, 131, 139, 177, 143, 157, 157, 139,
  154, 157, 178, 158, 130, 155, 137, 135, 128, 177, 178, 153, 150, 138, 218, 216, 140, 216, 139, 215, 141, 215, 140,
  217, 217, 219, 143, 219, 216, 178, 136, 135, 156, 139, 151, 139, 132, 157, 192, 131, 135, 128, 192, 132, 157, 212,
  221, 218, 222, 212, 218, 219, 199, 211, 206, 206, 206, 206, 143, 154, 206, 163, 129, 138, 155, 130, 139, 192, 130,
  129, 143, 138, 206, 198, 128, 129, 138, 139, 212, 135, 128, 154, 139, 156, 128, 143, 130, 193, 131, 129, 138, 155,
  130, 139, 157, 193, 141, 132, 157, 193, 130, 129, 143, 138, 139, 156, 212, 223, 219, 217, 217, 212, 221, 220, 199,
  229, 238, 238, 238, 238, 112, 60, 200, 174,
];
const BX_RAW_4_HEAD = [85, 15, 84, 168, 232, 56, 214, 214, 212, 108, 151];
const BX_RAW_4_CORE = [
  127, 17, 17, 25, 121, 112, 121, 113, 121, 185, 220, 211, 206, 200, 206, 152, 202, 146, 202, 159, 200, 147, 153, 205,
  158, 147, 200, 146, 173, 154, 153, 133, 157, 133, 152, 172, 217, 206, 199, 206, 202, 216, 206, 171, 171, 28, 120, 124,
  118, 103, 122, 102, 122, 115, 97, 28, 120, 124, 118, 103, 122, 102, 122, 115, 97, 115, 26, 98, 124, 123, 113, 122, 98,
  102, 58, 64, 123, 126, 123, 122, 98, 123, 18, 98, 124, 123, 113, 122, 98, 102, 21, 246, 247,
];

function bxUleb(value) {
  const out = [];
  do {
    const byte = value % 128;
    value = (value - byte) / 128;
    out.push(byte + (value ? 128 : 0));
  } while (value);
  return out;
}

function bxCompress(input) {
  const out = bxUleb(input.length);
  let bits = "";
  let model = ` ${Array.from({ length: 256 }, (_, index) => String.fromCharCode(index)).join("")} `;
  let low = 0;
  let high = 1;
  for (const byte of input) {
    const lower = model.indexOf(String.fromCharCode(byte), 1);
    const upper = byte === 255 ? model.length - 1 : model.indexOf(String.fromCharCode(byte + 1), 1);
    const unit = (high - low) / model.length;
    high = low + unit * upper;
    low += unit * lower;
    model = `${model.slice(0, upper)}${"\0".repeat(27)}${model.slice(upper)}`;
    const highBits = high.toString(2).slice(2);
    const lowBits = low.toString(2).slice(2);
    let shared = 0;
    while (shared < highBits.length && shared < lowBits.length && highBits[shared] === lowBits[shared]) shared += 1;
    bits += highBits.slice(0, shared);
    const scale = 2 ** shared;
    high = (high * scale) % 1;
    low = (low * scale) % 1;
  }
  bits += low.toString(2).slice(2).replace(/0+$/, "");
  while (bits.length > 7) {
    out.push(parseInt(bits.slice(0, 8), 2));
    bits = bits.slice(8);
  }
  out.push(parseInt((bits + "00000000").slice(0, 8), 2));
  return out;
}

function bxTransform(mode, input) {
  const rotate = (value, bits) => ((value << bits) | (value >>> (8 - bits))) & 255;
  const out = [];
  for (let index = 0; index < input.length; index += 2) {
    const first = input[index];
    const second = input[index + 1] ?? 0;
    const pair = (index / 2) & 3;
    let a;
    let b;
    if (mode === 1) {
      if (pair === 0) {
        a = first ^ 235;
        b = second ^ a;
      } else if (pair === 1) {
        a = first ^ 89;
        b = second ^ 52;
      } else if (pair === 2) {
        a = rotate((first - 8) & 255, 4);
        b = rotate((second - 8) & 255, 4);
      } else {
        a = first ^ 2;
        b = second ^ a;
      }
    } else if (mode === 3) {
      if (pair === 0) {
        a = first ^ 111;
        b = second ^ a;
      } else if (pair === 1) {
        a = rotate((first - 2) & 255, 4);
        b = rotate((second - 2) & 255, 4);
      } else if (pair === 2) {
        a = (first + 11) & 255;
        b = (second + 11) & 255;
      } else {
        a = first ^ 78;
        b = second ^ 122;
      }
    } else {
      if (pair === 0) {
        a = first ^ 71;
        b = second ^ 103;
      } else if (pair === 1) {
        a = first ^ 189;
        b = second ^ a;
      } else if (pair === 2) {
        a = rotate((first - 7) & 255, 5);
        b = rotate((second - 7) & 255, 5);
      } else {
        a = (first + 11) & 255;
        b = (second + 11) & 255;
      }
    }
    out.push(a, b);
  }
  return out.slice(0, input.length);
}

function bxSection(payload, mask) {
  const checksum = payload.reduce((sum, byte) => sum + (byte & mask), 0);
  return [...bxUleb(payload.length + 2), (checksum >>> 8) & 255, checksum & 255, ...payload];
}

function bxDynamicInput(timestamp, rng) {
  const random = Array.from({ length: 3 }, () => {
    const value = Number(rng());
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      const error = new RangeError("BX_UA_RANDOM_INVALID");
      error.code = "BX_UA_RANDOM_INVALID";
      throw error;
    }
    return value;
  });
  const randomId = random[0].toString(36).slice(2) + random[1].toString(36).slice(2);
  const blocks = Math.ceil(BX_FINGERPRINT.length / 80);
  const start = Math.floor(random[2] * blocks) * 80;
  const chunk = BX_FINGERPRINT.slice(start, start + 80);
  const snippet = encodeURI(chunk);
  const time = Buffer.alloc(8);
  time.writeBigUInt64BE(BigInt(timestamp));
  return [
    ...BX_RAW_4_HEAD,
    ...bxUleb(start).map((byte) => byte ^ 249),
    chunk.length ^ 249,
    3 ^ 249,
    ...BX_RAW_4_CORE,
    ...time.map((byte) => byte ^ 147),
    ...bxUleb(randomId.length + snippet.length + 4).map((byte) => byte ^ 81),
    81,
    ...Buffer.from(randomId).map((byte) => byte ^ 81),
    81,
    81,
    ...Buffer.from(snippet).map((byte) => byte ^ 81),
    81,
  ];
}

function encodeBxBase64(bytes) {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/./g, (character) => BX_SUB64[BX_STD64.indexOf(character)]);
}

const BX_SECTION_1 = bxSection(bxTransform(1, bxCompress(BX_RAW_1)), 248);
const BX_SECTION_3 = bxSection(bxTransform(3, BX_RAW_3), 99);

function buildBxUa({ now = Date.now(), rng = Math.random } = {}) {
  const timestamp = Number(now);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    const error = new TypeError("BX_UA_NOW_INVALID");
    error.code = "BX_UA_NOW_INVALID";
    throw error;
  }
  if (typeof rng !== "function") {
    const error = new TypeError("BX_UA_RNG_INVALID");
    error.code = "BX_UA_RNG_INVALID";
    throw error;
  }
  const section4 = bxSection(bxTransform(4, bxCompress(bxDynamicInput(timestamp, rng))), 157);
  const body = [...BX_SECTION_1, 4, 0, 9, 5, 4, ...BX_SECTION_3, ...section4];
  const checksum = body.reduce((sum, byte) => sum + (byte & 41), 0);
  const low = timestamp % 0x10000;
  const frame = [
    (low >>> 8) & 255,
    low & 255,
    (body.length >>> 8) & 255,
    body.length & 255,
    (checksum >>> 8) & 255,
    checksum & 255,
    ((low >>> 8) + 41) & 255,
    (low + 41) & 255,
    0,
    4,
    1,
    61,
    ...body,
  ];
  return `317$${encodeBxBase64(frame)}`;
}

const JANUS_SBOX_27 = Buffer.from(
  "7/f/AAgQGCAoMDhASFBYYGhweICIkJigqLC4wMjQ2ODo8PgBCREZISkxOUFJUVlhaXF5gYmRmaGpsbnBydHZ4enx+QIKEhoiKjI6QkpSWmJqcnqCipKaoqqyusLK0tri6vL6AwsTGyMrMztDS1NbY2tze4OLk5ujq7O7w8vT2+Pr8/sEDBQcJCw0PERMVFxkbHR8hIyUnKSstLzEzNTc5Oz0/AUNFR0lLTU9RU1VXWVtdX2FjZWdpa21vcXN1d3l7fX9Bg4WHiYuNj5GTlZeZm52foaOlp6mrra+xs7W3ubu9v4HDxcfJy83P0dPV19nb3d/h4+Xn6evt7/Hz9ff5w==",
  "base64",
);
const JANUS_SBOX_28 = Buffer.from(
  "z9ff5+/3/wAIEBggKDA4QEhQWGBocHiAiJCYoKiwuMDI0Njg6PD4AQkRGSEpMTlBSVFZYWlxeYGJkZmhqbG5wcnR2eHp8fkCChIaIioyOkJKUlpianJ6goqSmqKqsrrCytLa4ury+gMLExsjKzM7Q0tTW2Nrc3uDi5Obo6uzu8PL09vj6/P7BAwUHCQsNDxETFRcZGx0fISMlJykrLS8xMzU3OTs9PwFDRUdJS01PUVNVV1lbXV9hY2VnaWttb3FzdXd5e31/QYOFh4mLjY+Rk5WXmZudn6Gjpaepq62vsbO1t7m7vb+Bw8XHycvNz9HT1dfZ293f4ePl5+nr7e/xw==",
  "base64",
);
const JANUS_SUB64 = "16s/O9tTGMigNwZaCBIQdpKLhHn3FeEUfXjbAvxYcDm0V2q45WS7RJ+8lkouPyrz=";
const JANUS_PLAIN = [
  61,
  224,
  100,
  8,
  229,
  0,
  0,
  0,
  0,
  32,
  1,
  75,
  92,
  149,
  43,
  101,
  83,
  241,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  0,
  4,
  37,
  219,
  250,
  192,
  234,
  15,
  129,
  132,
  0,
  0,
  0,
  1,
  101,
  83,
  241,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  90,
  3,
  null,
  0,
  0,
  0,
  0,
  0,
  1,
  134,
  0,
  0,
  3,
  76,
  0,
  1,
  167,
  16,
  102,
  225,
  118,
  90,
  57,
  182,
  89,
  25,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  null,
  72,
  53,
  58,
  205,
  0,
  0,
  0,
  0,
  -2,
  -2,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  null,
];

function janusU32(value) {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function janusUrlHash(url) {
  let hash = 0;
  const step = Math.max(1, Math.floor(url.length / 20));
  for (let index = 0; index < url.length; index += step) {
    hash = (Math.imul(31, hash) + url.charCodeAt(index)) | 0;
  }
  return hash >>> 0;
}

function janusChecksum(bytes, mask) {
  let sum = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    sum += (bytes[index] + index) & 0xff & mask;
  }
  return sum;
}

function janusPairs(bytes, key, first, second) {
  const operations = (key & 1) === 0 ? [first, second] : [second, first];
  const output = [];
  for (let index = 0; index < bytes.length; index += 2) {
    output.push(...operations[(index / 2) & 1](bytes[index], bytes[index + 1], key));
  }
  return output.slice(0, bytes.length);
}

function janusUnary(table) {
  return (first, second, key) => [table[(first ?? 0) & 0xff] ^ key, table[(second ?? 0) & 0xff] ^ key];
}

const JANUS_OP_19 = (first, second, key) => [(first ^ 4 ^ key) & 0xff, ((second ?? 0) ^ 112 ^ key) & 0xff];
const JANUS_OP_30 = (first, second, key) => [(first ^ 80 ^ key) & 0xff, ((second ?? 0) ^ 109 ^ key) & 0xff];
const JANUS_OP_24 = (first, second, key) => [(first ^ 116 ^ key) & 0xff, ((second ?? 0) ^ 111 ^ key) & 0xff];
const JANUS_OP_1 = (first, second, key) => {
  const encodedFirst = (first ^ 244 ^ key) & 0xff;
  return [encodedFirst, ((second ?? 0) ^ encodedFirst) & 0xff];
};
const JANUS_OP_32 = (first, second, key) => [((first ?? 0) ^ 97 ^ key) & 0xff, ((second ?? 0) ^ 76 ^ key) & 0xff];
const JANUS_OP_21 = (first, second, key) => [
  first == null ? key : ((first + 177) & 0xff) ^ key,
  second == null ? key : ((second + 177) & 0xff) ^ key,
];

function buildMiniJanus({ now = Date.now(), url = DEFAULT_URL, rng = Math.random } = {}) {
  const timestamp = Number(now);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    const error = new TypeError("MINI_JANUS_NOW_INVALID");
    error.code = "MINI_JANUS_NOW_INVALID";
    throw error;
  }
  if (typeof rng !== "function") {
    const error = new TypeError("MINI_JANUS_RNG_INVALID");
    error.code = "MINI_JANUS_RNG_INVALID";
    throw error;
  }
  const random = Array.from({ length: 7 }, () => {
    const value = Number(rng());
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      const error = new RangeError("MINI_JANUS_RANDOM_INVALID");
      error.code = "MINI_JANUS_RANDOM_INVALID";
      throw error;
    }
    return value;
  });
  const targetUrl = String(url);
  const seconds = Math.floor(timestamp / 1000);
  const key = (Math.floor(random[5] * 256) + 232 * (seconds & 0xff) + 16) & 0xff;
  const timeBytes = Buffer.alloc(8);
  timeBytes.writeBigUInt64BE(BigInt(timestamp + 1));

  const segment1 = janusPairs([...timeBytes.subarray(2), 0], key, janusUnary(JANUS_SBOX_27), janusUnary(JANUS_SBOX_28));
  const segment2 = janusPairs([61, 6, 0, 0, 0, 0, 0, 0, 0, 0], key, JANUS_OP_19, JANUS_OP_30);
  const segment3 = janusPairs(
    [...timeBytes.subarray(2), 6, 0, 1, 17, ...Buffer.from("pages/index/index")],
    key,
    JANUS_OP_24,
    JANUS_OP_1,
  );

  const plain = JANUS_PLAIN.slice();
  plain.splice(1, 4, ...janusU32(janusUrlHash(targetUrl)));
  plain.splice(11, 4, ...janusU32(Math.floor(0xffffffff * random[3])));
  plain.splice(15, 4, ...janusU32(seconds));
  plain.splice(33, 4, ...janusU32(Math.floor(0xffffffff * random[2])));
  plain.splice(37, 4, ...janusU32(Math.floor(0xffffffff * random[6])));
  plain.splice(45, 4, ...janusU32(seconds));
  const encodedPlain = janusPairs(plain, key, JANUS_OP_32, JANUS_OP_21);

  const body = [
    key,
    janusChecksum(segment1, 98) & 0xff,
    7,
    ...segment1,
    janusChecksum(segment2, 233) & 0xff,
    10,
    ...segment2,
    janusChecksum(segment3, 191) & 0xff,
    27,
    ...segment3,
    janusChecksum(encodedPlain, 109) & 0xff,
    111,
    ...encodedPlain,
  ];
  const globalChecksum = janusChecksum(body.slice(1), 123);
  const frame = [(globalChecksum >>> 8) & 0xff, globalChecksum & 0xff, ...body];
  const standard = Buffer.from(frame).toString("base64");
  let encoded = "";
  for (const character of standard) encoded += JANUS_SUB64[BX_STD64.indexOf(character)];
  return `12@${encoded}`;
}

function yes(value) {
  return value === true || /^(1|true|y|yes)$/i.test(String(value || "").trim());
}

function request({ url, method = "GET", headers = {}, body = "", timeout = 12000 }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === "http:" ? http : https;
    const req = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method,
        headers,
        timeout,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300) {
            resolve({ status: res.statusCode, headers: res.headers, text });
          } else {
            const error = new Error(`HTTP_${res.statusCode || 0}`);
            error.status = res.statusCode || 0;
            error.body = text;
            reject(error);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("REQUEST_TIMEOUT")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function stableUtdid(seed = "") {
  return crypto
    .createHash("sha256")
    .update(`${APP_ID}|${seed || os.hostname()}|${os.platform()}|${os.arch()}`)
    .digest("hex")
    .slice(0, 32)
    .toUpperCase();
}

function requestId(now = Date.now()) {
  return `${crypto.randomBytes(16).toString("hex").toUpperCase()}|${now}`;
}

function sessionToXSmallstc(session = {}) {
  const data = { ...session };
  delete data.username;
  return Object.keys(data).length ? JSON.stringify(data) : "";
}

function buildXEleUa({
  session = {},
  lng = "",
  lat = "",
  brand = "microsoft",
  model = "microsoft",
  system = "windows/Unknown",
  wechatVersion = "4.1.11.24",
} = {}) {
  const deviceId =
    session.union_id || session.unionId || session.open_id || session.openId || session.user_id || session.userId || "";
  return [
    "RenderWay/miniProgram",
    `MiniAppId/${APP_ID}`,
    `MiniAppVersion/${APP_VERSION}`,
    deviceId && `DeviceId/${deviceId}`,
    "AppName/Wechat",
    `${brand}/${model}/${system}`,
    `Wechat/${wechatVersion}`,
    "channel/wechat_app",
    "subChannel/wechat_app.default",
    lng && lat && `Longitude/${lng}`,
    lng && lat && `Latitude/${lat}`,
  ]
    .filter(Boolean)
    .join(" ");
}

async function fetchUmid() {
  const result = await request({ url: UMID_URL, method: "POST" });
  const match = result.text.match(/(?:umx\.wu|__fycb)\(['"]([^'"]+)['"]\)/);
  return match ? match[1] : "";
}

async function buildRiskHeaders(opts = {}) {
  const session = opts.session && typeof opts.session === "object" ? opts.session : {};
  const url = String(opts.url || DEFAULT_URL);
  const utdid = String(opts.utdid || stableUtdid(opts.deviceSeed));
  const now = opts.now === undefined ? Date.now() : Number(opts.now);
  const rng = opts.random || Math.random;
  const miniJanusRaw = buildMiniJanus({ url, now, rng });
  const miniJanus = encodeURIComponent(miniJanusRaw);
  const bxUa = buildBxUa({ now, rng });
  let umidToken = String(opts.umidToken || opts["umid-token"] || opts["bx-umidtoken"] || "");
  if (!umidToken && !yes(opts.noNetwork || opts["no-network"])) umidToken = await fetchUmid();

  const headers = {
    "mini-janus": miniJanus,
    "bx-ua": bxUa,
    "x-ele-ua": String(
      opts.xEleUa ||
        buildXEleUa({
          session,
          lng: opts.lng || opts.longitude || "",
          lat: opts.lat || opts.latitude || "",
          brand: opts.brand || "microsoft",
          model: opts.model || "microsoft",
          system: opts.system || "windows/Unknown",
          wechatVersion: opts.wechatVersion || opts.wechat || "4.1.11.24",
        }),
    ),
    "x-eleme-requestid": String(opts.requestId || requestId(opts.now || Date.now())),
    "x-utdid": utdid,
  };
  const smallstc = String(opts.xSmallstc || sessionToXSmallstc(session));
  const uid = String(opts.uid || session.munb || session.user_id || session.userId || "");
  const miniWua = String(opts.xMiniWua || opts["x-mini-wua"] || "");
  if (umidToken) {
    headers["bx-umidtoken"] = umidToken;
    headers["x-umidToken"] = umidToken;
  }
  if (smallstc) headers["x-smallstc"] = smallstc;
  if (uid) headers["x-uid"] = uid;
  if (miniWua) headers["x-mini-wua"] = miniWua;
  return {
    ok: Boolean(miniJanus && bxUa && umidToken),
    params: {
      miniJanus,
      miniJanusRaw,
      bxUa,
      umidToken,
      bxUmidToken: umidToken,
      utdid,
      requestId: headers["x-eleme-requestid"],
    },
    headers,
  };
}

const DEFAULTS = {
  smallcat_id: 1,
  account_mode: "authorized",
  manual_openids: "",
  umid_token: "",
  request_timeout: 30,
  sync_panel: "none",
  sync_qinglong: false,
  qinglong_id: 1,
  daidai_id: 1,
  ql_env_name: "elmck",
  ql_remarks: "",
};

const pluginConfig = new plugin.Form({
  smallcat_id: plugin.Form.integer()
    .title("smallcat 编号")
    .description("命令不带 CODE 时使用；后台 smallcat 页面中的编号，从 1 开始")
    .widget("smallcat-panel")
    .min(1)
    .default(1),
  account_mode: plugin.Form.string()
    .title("openid 获取模式")
    .description("普通用户授权：只读取已授权本插件的账号；手动填写：按下方 openid 读取，留空读取 SmallCat 全部账号")
    .options(["authorized", "manual"])
    .default("authorized"),
  manual_openids: plugin.Form.string()
    .title("手动 openid")
    .description("仅手动填写模式生效；多个用逗号、空格或换行分隔；留空读取全部账号，本插件使用第一个可用账号")
    .widget("textarea")
    .default("")
    .visibleWhen("account_mode", "==", "manual"),
  umid_token: plugin.Form.string()
    .title("固定 bx-umidtoken")
    .description("通常留空自动获取；网络环境取不到 UMID 时可手动填写")
    .widget("password")
    .default(""),
  request_timeout: plugin.Form.integer().title("请求超时秒数").min(5).max(90).default(30),
  sync_panel: plugin.Form.select([
    { label: "不同步", value: "none" },
    { label: "同步青龙", value: "qinglong" },
    { label: "同步呆呆", value: "daidai" },
  ])
    .title("同步目标")
    .description("青龙/呆呆容器编号会根据后台容器列表动态渲染")
    .default("none"),
  qinglong_id: plugin.Form.integer()
    .title("青龙面板编号")
    .widget("qinglong-panel")
    .min(1)
    .default(1)
    .visibleWhen("sync_panel", "==", "qinglong"),
  daidai_id: plugin.Form.integer()
    .title("呆呆面板编号")
    .widget("daidai-panel")
    .min(1)
    .default(1)
    .visibleWhen("sync_panel", "==", "daidai"),
  ql_env_name: plugin.Form.string().title("环境变量名").default("elmck"),
  ql_remarks: plugin.Form.string().title("变量备注").description("留空时自动使用饿了么账号信息").default(""),
});

const ACCOUNT_COOKIE_FIELDS = [
  ["cookie2", ["cookie2", "sid"]],
  ["sid", ["sid"]],
  ["SID", ["SID"]],
  ["userId", ["user_id", "userId", "USERID"]],
  ["openId", ["open_id", "openId"]],
  ["unionId", ["union_id", "unionId"]],
  ["sgcookie", ["sgcookie"]],
  ["munb", ["munb"]],
  ["UTUSER", ["UTUSER"]],
  ["st", ["st"]],
];

async function main() {
  if (!(await s.isAdmin())) {
    await s.reply("仅管理员可用");
    return;
  }
  const cfg = normalizeConfig(await pluginConfig.get());
  try {
    const input = parseCommand(String((await s.getMsg()) || ""));
    const code = await resolveInputCode(cfg, input.code);
    await s.reply(`饿了么 CODE 登录开始（来源：${input.code ? "命令参数" : `smallcat #${cfg.smallcat_id}`}）`);
    const result = await havanaCodeLogin(code, cfg);
    if (!result.ok) throw new Error(result.error || "饿了么 CODE 登录失败");

    let syncAction = "";
    if (cfg.sync_panel !== "none") syncAction = await syncPanelEnv(cfg, result);
    const lines = ["饿了么 CODE 换 Cookie 成功"];
    if (result.username) lines.push(`账号：${result.username}`);
    if (result.userId) lines.push(`userId：${result.userId}`);
    lines.push(`Cookie：${result.cookie}`);
    if (syncAction)
      lines.push(
        `${cfg.sync_panel === "daidai" ? "呆呆" : "青龙"}：${syncAction === "update" ? "已更新" : "已创建"} ${cfg.ql_env_name}`,
      );
    if (result.riskWarning) lines.push(`提示：${result.riskWarning}`);
    await s.reply(lines.join("\n"));
  } catch (error) {
    await s.reply(`饿了么Code登录失败：${errorText(error)}`);
  }
}

function normalizeConfig(raw) {
  const cfg = Object.assign({}, DEFAULTS, raw || {});
  cfg.smallcat_id = positiveInt(cfg.smallcat_id, 1);
  cfg.account_mode = cfg.account_mode === "manual" ? "manual" : "authorized";
  cfg.manual_openids = String(cfg.manual_openids || "").trim();
  cfg.umid_token = String(cfg.umid_token || "").trim();
  cfg.request_timeout = Math.max(5, Math.min(positiveInt(cfg.request_timeout, 30), 90));
  cfg.sync_panel = ["qinglong", "daidai", "none"].includes(String(cfg.sync_panel || ""))
    ? String(cfg.sync_panel)
    : yes(cfg.sync_qinglong)
      ? "qinglong"
      : "none";
  cfg.sync_qinglong = cfg.sync_panel === "qinglong";
  cfg.qinglong_id = positiveInt(cfg.qinglong_id, 1);
  cfg.daidai_id = positiveInt(cfg.daidai_id, 1);
  cfg.ql_env_name = String(cfg.ql_env_name || "elmck").trim() || "elmck";
  cfg.ql_remarks = String(cfg.ql_remarks || "").trim();
  return cfg;
}

function parseCommand(content) {
  const matched = String(content || "").match(
    /^\s*(?:饿了么Code|饿了么|elm)\s*(?:(?:登录|换cookie|取ck)\s*)?([^\s]+)?\s*$/i,
  );
  if (!matched) throw new Error("命令格式：饿了么、饿了么登录 CODE 或 elm取ck CODE");
  const code = String(matched[1] || "").trim();
  if (code.length > 4096) throw new Error("CODE 长度异常");
  return { code };
}

async function resolveInputCode(cfg, directCode) {
  if (directCode) return directCode;
  const smallcat = new container.SmallCat({ id: cfg.smallcat_id });
  if (typeof smallcat.getCode !== "function") throw new Error("当前 SillyGirl 版本缺少 SmallCat.getCode");
  const usersPayload = unwrapServicePayload(await loadSmallcatAccountPayload(smallcat, cfg));
  const users = Array.isArray(usersPayload)
    ? usersPayload
    : usersPayload && Array.isArray(usersPayload.items)
      ? usersPayload.items
      : [];
  const wanted = new Set(splitOpenids(cfg.manual_openids));
  const user = users.find((item) => {
    const openid = String((item && (item.openid || item.openId)) || "").trim();
    return (
      item && !item.disabled && openid && (cfg.account_mode !== "manual" || wanted.size === 0 || wanted.has(openid))
    );
  });
  if (!user) throw new Error("SmallCat 用户列表没有有效 openid");
  const openid = String(user.openid || user.openId).trim();
  const payload = unwrapServicePayload(await smallcat.getCode({ openid, appid: APP_ID }));
  const code = nestedText(payload, ["code", "wxCode", "wx_code", "loginCode"]);
  if (!code) throw new Error(`SmallCat 未返回 CODE：${responseMessage(payload) || "响应字段为空"}`);
  return code;
}

async function loadSmallcatAccountPayload(smallcat, cfg) {
  if (typeof smallcat.request !== "function") throw new Error("当前 SillyGirl 版本缺少 SmallCat.request");
  if (cfg.account_mode === "manual") return smallcat.request("GET", "/api/accounts");
  const allowed = await authorizedOpenidSet();
  return filterSmallcatAccounts(await smallcat.request("GET", "/api/accounts"), allowed);
}

async function authorizedOpenidSet() {
  if (!user || typeof user.getUserList !== "function") throw new Error("当前 SillyGirl 版本缺少 user.getUserList");
  const users = await user.getUserList();
  const allowed = new Set();
  for (const user of Array.isArray(users) ? users : []) {
    if (!user || user.disabled || !user.authorized) continue;
    for (const openid of (user.bindings && user.bindings.smallcat_openids) || []) {
      const value = String(openid || "").trim();
      if (value) allowed.add(value);
    }
  }
  if (!allowed.size) throw new Error("没有普通用户授权的 SmallCat 账号");
  return allowed;
}

function filterSmallcatAccounts(value, allowed) {
  if (Array.isArray(value))
    return value.map((item) => filterSmallcatAccounts(item, allowed)).filter((item) => item !== undefined);
  if (!value || typeof value !== "object") return value;
  const openid = String(value.openid || value.openId || value.open_id || "").trim();
  if (openid && !allowed.has(openid)) return undefined;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const filtered = filterSmallcatAccounts(item, allowed);
    if (filtered !== undefined) result[key] = filtered;
  }
  return result;
}

function splitOpenids(value) {
  return [
    ...new Set(
      String(value || "")
        .split(/[,，;；\s]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

async function havanaCodeLogin(code, cfg) {
  let risk;
  let riskWarning = "";
  try {
    risk = await buildRiskHeaders({ url: LOGIN_ENDPOINT, session: {}, umidToken: cfg.umid_token });
  } catch (error) {
    risk = await buildRiskHeaders({ url: LOGIN_ENDPOINT, session: {}, noNetwork: true });
    riskWarning = `UMID 自动获取失败，已携带 BX-UA/mini-janus 继续请求：${errorText(error)}`;
  }
  if (!risk.params.umidToken && !riskWarning) riskWarning = "UMID 接口未返回 token，已携带 BX-UA/mini-janus 继续请求";

  const authorizationCode = JSON.stringify({ authorizationCode: String(code) });
  const form = new URLSearchParams([
    ["type", "weixin_mini_program"],
    ["appId", APP_ID],
    ["appName", "eleme"],
    ["appEntrance", "weixin"],
    ["lang", "zh_CN"],
    ["isMobile", "true"],
    ["returnUrl", ""],
    ["needPassWebViewCookie", "false"],
    ["authorizationCode", authorizationCode],
  ]);
  if (risk.params.bxUmidToken) form.set("umidToken", risk.params.bxUmidToken);
  const body = form.toString();
  const headers = Object.assign(
    {
      Accept: "application/json,text/plain,*/*",
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept-Language": "zh-CN,zh;q=0.9",
      "User-Agent": `Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.58 miniProgram/${APP_ID}`,
      Referer: `https://servicewechat.com/${APP_ID}/831/page-frame.html`,
      "x-tap": "wx",
      "Content-Length": Buffer.byteLength(body),
    },
    risk.headers,
  );

  const response = await requestTextAny({
    url: LOGIN_ENDPOINT,
    method: "POST",
    headers,
    body,
    timeout: cfg.request_timeout * 1000,
  });
  const payload = parseJson(response.text);
  const content = payload && typeof payload.content === "object" ? payload.content : {};
  const session = content && typeof content.data === "object" && content.data ? Object.assign({}, content.data) : {};
  if (session.sid && !session.cookie2) session.cookie2 = session.sid;
  const cookie = buildAccountCookie(session);
  const ok = response.status >= 200 && response.status < 300 && Boolean(session.cookie2 || session.sid || session.st);
  if (!ok) {
    const message = content.errorMsg || content.msg || payload.msg || session.titleMsg || "";
    const redirectEntries = ["redirect", "iframeRedirect", "redirectUrl", "iframeRedirectUrl"]
      .filter((key) => session[key] !== undefined && session[key] !== null && session[key] !== "")
      .map((key) => [key, printableValue(session[key], 2400)]);
    const details = [];
    if (message) details.push(`接口消息：${printableValue(message, 800)}`);
    if (redirectEntries.length) {
      details.push("接口返回跳转/绑定流程，未直接下发 Cookie");
      for (const [key, value] of redirectEntries) details.push(`${key}：${value}`);
    }
    if (!details.length)
      details.push(`响应无 sid/st/cookie2（HTTP ${response.status}）：${safePreview(response.text, 180)}`);
    return {
      ok: false,
      status: response.status,
      error: details.join("\n"),
      redirects: Object.fromEntries(redirectEntries),
    };
  }
  return {
    ok: true,
    status: response.status,
    cookie,
    session,
    username: String(session.username || ""),
    userId: String(session.user_id || session.userId || session.USERID || ""),
    openId: String(session.open_id || session.openId || ""),
    riskWarning,
  };
}

function buildAccountCookie(session) {
  const parts = [];
  for (const [outputKey, sourceKeys] of ACCOUNT_COOKIE_FIELDS) {
    let value = "";
    for (const key of sourceKeys) {
      if (session[key] !== undefined && session[key] !== null && String(session[key]) !== "") {
        value = String(session[key]);
        break;
      }
    }
    if (!value) continue;
    parts.push(`${outputKey}=${outputKey === "SID" ? value : encodeURIComponent(value)}`);
  }
  return parts.join("; ");
}

function requestTextAny({ url, method = "GET", headers = {}, body = "", timeout = 30000 }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === "http:" ? http : https;
    const req = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method,
        headers,
        timeout,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode || 0,
            headers: response.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("timeout", () => req.destroy(new Error("请求超时")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function syncPanelEnv(cfg, result) {
  if (cfg.sync_panel === "daidai") return syncDaiDai(cfg, result);
  return syncQingLong(cfg, result);
}

async function syncQingLong(cfg, result) {
  const ql = new container.QingLong({ id: cfg.qinglong_id });
  const payload = await ql.getEnvs({ searchValue: cfg.ql_env_name });
  const envs = envItems(payload).filter((item) => item.name === cfg.ql_env_name);
  return upsertEnv({
    panel: ql,
    envs,
    envName: cfg.ql_env_name,
    value: result.cookie,
    remark: envRemark(cfg, result),
    identity: envIdentity(result),
    enable: (id) => ql.enableEnvs([id]),
    missingIdMessage: "已有青龙变量缺少 id/_id",
  });
}

async function syncDaiDai(cfg, result) {
  const dd = new container.DaiDai({ id: cfg.daidai_id });
  const payload = await dd.getEnvs(cfg.ql_env_name);
  const envs = envItems(payload).filter((item) => item.name === cfg.ql_env_name);
  return upsertEnv({
    panel: dd,
    envs,
    envName: cfg.ql_env_name,
    value: result.cookie,
    remark: envRemark(cfg, result),
    identity: envIdentity(result),
    enable: (id) => dd.enableEnv(id),
    missingIdMessage: "已有呆呆变量缺少 id/_id",
  });
}

function envIdentity(result) {
  return result.userId || result.openId || cookieValue(result.cookie, "munb") || cookieValue(result.cookie, "openId");
}

function envRemark(cfg, result) {
  return cfg.ql_remarks || result.username || envIdentity(result) || "饿了么Code登录";
}

async function upsertEnv({ panel, envs, envName, value, remark, identity, enable, missingIdMessage }) {
  const existing = envs.find((item) => {
    if (String(item.remarks || item.remark || "") === remark) return true;
    if (!identity) return String(item.value || "") === value;
    return [item.value, item.remarks, item.remark].some((current) => String(current || "").includes(identity));
  });
  if (existing) {
    const id = existing.id != null ? existing.id : existing._id;
    if (id == null || id === "") throw new Error(missingIdMessage);
    await panel.updateEnv({ id, name: envName, value, remarks: remark });
    try {
      await enable(id);
    } catch (_) {}
    return "update";
  }
  await panel.createEnv({ name: envName, value, remarks: remark });
  return "create";
}

function envItems(payload) {
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload)) return payload;
  const data = payload.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const key of ["data", "list", "items", "envs", "records"]) if (Array.isArray(data[key])) return data[key];
  }
  return [];
}

function cookieValue(cookie, name) {
  const matched = String(cookie || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`, "i"));
  if (!matched) return "";
  try {
    return decodeURIComponent(matched[1]);
  } catch (_) {
    return matched[1];
  }
}

function unwrapServicePayload(payload) {
  if (!payload || typeof payload !== "object") return { value: payload };
  if (payload.status === false) throw new Error(responseMessage(payload) || "SmallCat 接口返回失败状态");
  if (Object.prototype.hasOwnProperty.call(payload, "status") && Object.prototype.hasOwnProperty.call(payload, "data"))
    return unwrapServiceData(payload.data);
  if (Object.prototype.hasOwnProperty.call(payload, "code") && Object.prototype.hasOwnProperty.call(payload, "data")) {
    const statusCode = String(payload.code);
    if (!["0", "200", "201"].includes(statusCode))
      throw new Error(responseMessage(payload) || `SmallCat 状态异常：${statusCode}`);
    return unwrapServiceData(payload.data);
  }
  return payload;
}

function unwrapServiceData(data) {
  if (data && typeof data === "object") return data;
  if (typeof data === "string") {
    const parsed = parseJson(data);
    if (parsed && typeof parsed === "object") return parsed;
  }
  return { value: data };
}

function nestedValue(payload, keys) {
  const wanted = new Set(keys.map((key) => String(key).toLowerCase()));
  const queue = [payload];
  while (queue.length) {
    const value = queue.shift();
    if (!value || typeof value !== "object") continue;
    for (const [key, child] of Object.entries(value)) {
      if (wanted.has(String(key).toLowerCase()) && child !== null && child !== undefined && child !== "") return child;
      if (child && typeof child === "object") queue.push(child);
    }
  }
  return null;
}

function nestedText(payload, keys) {
  const value = nestedValue(payload, keys);
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function responseMessage(payload) {
  const value = nestedValue(payload, ["errmsg", "errMsg", "message", "msg", "error", "retMsg"]);
  return typeof value === "object"
    ? JSON.stringify(value).slice(0, 300)
    : String(value || "")
        .trim()
        .slice(0, 300);
}

function parseJson(text) {
  try {
    const value = JSON.parse(String(text || ""));
    return value && typeof value === "object" ? value : {};
  } catch (_) {
    return {};
  }
}

function printableValue(value, limit) {
  let text;
  if (typeof value === "string") text = value;
  else {
    try {
      text = JSON.stringify(value);
    } catch (_) {
      text = String(value || "");
    }
  }
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function safePreview(text, limit) {
  return String(text || "")
    .replace(/(cookie2|sid|SID|st|sgcookie)=([^;\s"']+)/g, "$1=***")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit || 180);
}

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function errorText(error) {
  return error && error.message ? String(error.message).trim() : String(error || "未知错误").trim();
}

main().catch(async (error) => {
  try {
    await s.reply(`饿了么Code登录异常：${errorText(error)}`);
  } catch (_) {
    console.error("饿了么Code登录异常", error);
  }
});
