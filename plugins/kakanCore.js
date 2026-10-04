// [title: 卡看公共模块]
// [name: kakanCore]
// [desc: 卡看业务签名、请求和任务公共能力]
// [author: sillyGirl]
// [version: v1.0.0]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 模块]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [module: true]
// [carry: false]
// [origin: 自定义]
// [depe: []]

const crypto = require("crypto");
const PRIVATE_KEY = crypto.createPrivateKey({
    key: Buffer.from(
      "MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCWLxnotIP3pNK4Vb/MEvm205lz1gRyFuXS0Td1v2cDfkJibxwWBRGtkP5LjmhxH/6TuFaoKGrEqBKqpfNuMcOG8l6FRTO7XgqMr6QfCb47I/FHsg3j4UNGy8cMzA3Ei/PpM9SxeTImIclvJ7zBXlJZjQyZ8jMClEfm+AnzXb4dXJe/tjd+iLnms15+2T2HjOCI9+EsBdbtHZ482F/G+nO1OL7J2/MmEkwnjhm+WcXm3fu5MjXIUHBKL11vYMYSvIh0+w0xI85hDiuz1Q6lYS7AdIaEGWtA0wfGT0iYQNQc+cDU3Ev9PMyTowdfOeTcnfwq6+BkOcW0AwZOzPQA++8BAgMBAAECggEAK0X0FbCZy8vSqamPg5o+GJdcwls62bLOUtHUxJk7ce656wnv0kpwnw3Fr/ifEGVzIZY+ZeKLbRGumzwI6cnt+F6yrHzVnJnKuWHMjOLuTLUdCxb7WJtqGqaRupa7KtRWme3EzcRJlmIq29vbz+3BFauGI399gjM+iocSuuxaYLQBenDu0xlI2a3bYH4zxV8kJ4pKc4qu+jmM84csc/sFoGkEFOQ5im6TJubNQ+PVdHSpSAitR/E7Sq57Nyw5IFkbZxX5R0XequX8f4XDt6lOmg5dBu/mouBMEPhGvnbY/5YpD0TGTi1BcAWWbMDjqhHX6L0WV/e1bQqwlBK5faO8pwKBgQDTBYW5AJfLVRcv6UJNPD5U5+stDTy2FGdZaaEW+AytbPT6xkDl8MVoey6zV5G6gDn8wOGwhW3YoJCchwT34jCR9rYlhCIxRRX7aaRAzqyiXM7B3ZACLVSfaCkiPA/7tYAlReaKKOIRXRVlmRKy5KKvEHzqkIPAGc6Z/e2ZmgD3AwKBgQC2MfOUa29DAEc9s8QXwc0hvAIRgjPjTn/8KNUQyhwVSRb5Xj/GRuAMII4dUGsKR1DnME4CHixRZhjEJwTeS04BPb2Mgnu9s/Wl7A/pd+3lm8Qzux+uDmP6vmlJe4hsPfm5axPOCAMGI0gq5YM01GiRwPqYIpjuL7UrpXg5wmJQqwKBgFVSDElK5hT+aIukonwb+Y/W3Y2vpnZwNYE/ZjSlQmr0fPDQK/lMqmSeObmllHR11/xL+HSo3ksSUKYZKXcYa075E5iDnleReVvX0OOrLL3RDH/yF4Hp1idFtCv1YPkC37cyVg5SjWU736TeiWLvcp+Z6QfmOn73cENvGhxa2j0FAoGBAITLPaVE9PBZyJMRbnB+Ydwfo0ZNpzIa6i/JNxqopPVis2sIJeWHjQ9pvwtgrNPuDOqki4cBpP2jM5PseKDpNC61aG18QWKQQxAvUZ2yOuPqt4OY9MsxU+/TTvwvHM0AEv7xK5s0vbeAib4yUIJ1+s2ZYUz3ko2wmhT44vr+UhhHAoGBALeia7zaiLQWr5h+X+DQfIaMWX2FrFwx16UXxKPAlTSdrj0UGQDZsG9uk7KIMZVs/LFnasAhflWRwX6gYADssXyPGeeOSWkOk7fTSZduj7KXXKMQYIl5OQ9nnCaqJNVHh/7xt+0avU2DlcUSrjSFxeF4cd6tO/kWcnPlWqp9M9OB",
      "base64",
    ),
    format: "der",
    type: "pkcs8",
  }),
  AES_KEY = Buffer.from("5d5e2890a7e84598"),
  AES_IV = AES_KEY;
function aes(text) {
  const c = crypto.createCipheriv("aes-128-cbc", AES_KEY, AES_IV);
  return Buffer.concat([c.update(text), c.final()]).toString("base64url");
}
function sec(timestamp = String(Date.now())) {
  let n = Number(timestamp),
    k = [];
  for (let i = 0; i < 4; i++) {
    k.push(n % 10);
    n = Math.trunc(n / 10);
  }
  const p = Buffer.from(JSON.stringify({ ne: "d0", zy: "d0" })),
    r = Buffer.alloc(p.length + 2);
  r[1] = 1;
  for (let i = 0; i < p.length; i++) r[i + 2] = p[i] ^ k[i & 3];
  return r.toString("base64");
}
function enc(v) {
  return encodeURIComponent(String(v)).replace(/%20/g, "+").replace(/%7E/g, "~");
}
function params(obj, encoded = true) {
  return Object.entries(obj)
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${encoded ? enc(v) : v}`)
    .join("&");
}
function signature(obj, t, path, s) {
  const origin = `${params(obj)}&&${path}&${t}`,
    input = Buffer.concat([Buffer.from(origin), Buffer.from("&" + s)]);
  return crypto.sign("RSA-SHA256", input, PRIVATE_KEY).toString("base64");
}
function device() {
  const hex = (n) =>
      crypto
        .randomBytes(Math.ceil(n / 2))
        .toString("hex")
        .slice(0, n),
    android = "13",
    model = "Pixel7",
    build = hex(8).toUpperCase(),
    oaid = hex(32),
    aid = hex(16),
    visitor = "tj" + String(Math.floor(1e15 + Math.random() * 9e15));
  return {
    p1: String(Date.now()) + String(Math.floor(1e5 + Math.random() * 9e5)),
    p16: model,
    p31: aid,
    p28: oaid,
    p2: "731001",
    p21: "3",
    p22: android,
    p24: "0",
    p25: "12030",
    p29: "zya3c0e0",
    p3: "101200017",
    p33: "com.zhangyue.app.shortplay.kakandj",
    p34: "navigationbar_is_min",
    p4: "501617",
    p5: "16",
    p7: oaid,
    p9: "2",
    pc: "10",
    build_id: build,
    usr: visitor,
    visitor_id: visitor,
    zyeid: hex(32),
    zysid: hex(32),
  };
}
function common(d, s) {
  const p = {
    p1: d.p1,
    p16: d.p16,
    p2: d.p2,
    p21: d.p21,
    p22: d.p22,
    p24: d.p24,
    p25: d.p25,
    p28: d.p28,
    p29: d.p29,
    p3: d.p3,
    p31: d.p31,
    p33: d.p33,
    p34: d.p34,
    p4: d.p4,
    p5: d.p5,
    p7: d.p7,
    p9: d.p9,
    pc: d.pc,
    zyeid: d.zyeid,
  };
  if (s) {
    p.usr = s.encrypt_user_id || s.user_id || "";
    p.zysid = s.session_id || "";
  }
  return p;
}
async function call(ctx, method, url, obj, d) {
  const path = new URL(url).pathname,
    t = String(Date.now()),
    ss = sec(t),
    headers = {
      "x-appid": "zya3c0e0",
      "content-type": "application/x-www-form-urlencoded",
      "x-sig-sign": signature(obj, t, path, ss),
      "x-sig-alg": "RSA-SHA256",
      "x-sig-timestamp": t,
      "x-sig-ver": "v1.1",
      "x-sig-sec": ss,
      "user-agent": `Dalvik/2.1.0 (Linux; U; Android ${d.p22}; ${d.p16} Build/${d.build_id})`,
    };
  return ctx.requestJson(method === "GET" ? `${url}?${params(obj, false)}` : url, {
    method,
    headers,
    ...(method === "GET" ? {} : { body: params(obj) }),
  });
}
module.exports = { aes, device, common, call };
