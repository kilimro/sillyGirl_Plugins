#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");
const buckets = new Map(),
  replies = [],
  qlEnvs = [];
let content = "__fixture__";
class Bucket {
  constructor(name) {
    this.name = name;
    if (!buckets.has(name)) buckets.set(name, new Map());
  }
  get(key, fallback = "") {
    return buckets.get(this.name).has(String(key)) ? buckets.get(this.name).get(String(key)) : fallback;
  }
  set(key, value) {
    buckets.get(this.name).set(String(key), value);
    return true;
  }
  delete(key) {
    buckets.get(this.name).delete(String(key));
    return true;
  }
  deleteAll() {
    buckets.get(this.name).clear();
    return true;
  }
  getAll() {
    return Object.fromEntries(buckets.get(this.name));
  }
  keys() {
    return [...buckets.get(this.name).keys()];
  }
}
const chain = () => {
  const value = {};
  for (const method of ["title", "description", "default", "min", "max", "widget", "options", "format", "required"])
    value[method] = () => value;
  return value;
};
function Form() {
  this.get = async () => ({
    yyb_url: "https://yyb.test",
    license_key: "license-key",
    wait_seconds: 5,
    poll_seconds: 0.05,
    qinglong_id: 1,
    env_name: "JD_COOKIE",
  });
}
for (const name of ["string", "integer", "number", "boolean", "array", "object", "select"]) Form[name] = chain;
class QingLong {
  constructor({ id }) {
    this.id = id;
  }
  async getEnvs({ searchValue } = {}) {
    return qlEnvs.filter((item) => !searchValue || item.name.includes(searchValue));
  }
  async createEnv(env) {
    qlEnvs.push({ ...env, id: String(qlEnvs.length + 1), status: 0 });
  }
  async updateEnv(env) {
    const item = qlEnvs.find((row) => row.id === env.id || row._id === env.id);
    if (item) Object.assign(item, env);
  }
  async enableEnvs(ids) {
    for (const item of qlEnvs) if (ids.includes(item.id)) item.status = 0;
  }
  async disableEnvs(ids) {
    for (const item of qlEnvs) if (ids.includes(item.id)) item.status = 1;
  }
  async request(method, endpoint) {
    if (method === "GET" && endpoint === "/crons") return [];
    return { code: 200, data: [] };
  }
}
const sender = {
  getMsg: async () => content,
  getUserId: async () => "fixture-user",
  getPlatform: async () => "qq",
  getChatId: async () => "",
  isAdmin: async () => true,
  reply: async (value) => {
    replies.push(value);
    return value;
  },
  pushAdmin: async (value) => {
    replies.push(value);
    return true;
  },
  listen: async () => undefined,
  resume: async () => undefined,
};
const fake = {
  Bucket,
  sender,
  container: { QingLong },
  plugin: { Form },
  utils: { sleep: async () => undefined, image: (url) => `[CQ:image,file=${url}]` },
  console,
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "sillygirl") return fake;
  return originalLoad.call(this, request, parent, isMain);
};

global.fetch = async (input) => {
  const url = new URL(String(input));
  let data;
  if (url.pathname === "/qr") data = { session_id: "fixture-session", url: "https://fixture.invalid/qr" };
  else if (url.pathname.endsWith("/poll")) data = { status: "confirmed", openid: "fixture-openid" };
  else if (url.pathname === "/jd/pt/exchange")
    data = {
      success: true,
      pt_key: "fixture-key",
      pt_pin: "fixture-pin",
      ck: "pt_key=fixture-key;pt_pin=fixture-pin;",
    };
  else if (url.pathname === "/user_new/info/GetJDUserInfoUnion")
    data = { data: { userInfo: { baseInfo: { nickname: "fixture-account" } }, assetInfo: { beanNum: 88 } } };
  else if (url.pathname === "/beanDetail/detail.json")
    data = { detailList: [{ date: localDate(), amount: "5", eventMassage: "签到" }] };
  else if (url.pathname === "/client.action" && url.searchParams.get("functionId") === "myhongbao_balance")
    data = { result: { balance: 3.2 } };
  else if (url.pathname === "/activeapi/queryjdcouponlistwithfinance") data = { coupon: { useable: [{ id: 1 }] } };
  else if (url.pathname === "/client.action" && url.searchParams.get("functionId") === "farm_home")
    data = { data: { farmUserPro: { treeName: "苹果", treeEnergy: 10, treeTotalEnergy: 100 }, totalEnergy: 20 } };
  else if (url.pathname === "/cgi-bin/ml/islogin") data = { islogin: "1" };
  else if (url.pathname === "/api/login/start")
    data = { success: true, sessionId: "session-yyb", qrcodeUrl: "https://fixture.invalid/qr2" };
  else if (url.pathname === "/api/login/status")
    data = { status: "success", account: { openid: "fixture-openid-yyb" } };
  else if (url.pathname === "/api/yyb/get-code") data = { success: true, code: "wx-code" };
  else if (url.hostname === "we.jd.com") data = { data: { tk: "eid-token" } };
  else if (url.hostname === "wxapplogin.m.jd.com") data = { err_code: 0, pt_key: "fixture-key", pt_pin: "fixture-pin" };
  else throw new Error(`unexpected fixture URL: ${url}`);
  return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
};

(async () => {
  const core = require(path.join(root, "plugins", "jdLegacyCore.js"));
  assert.equal(core.normalizeCookie("x=1; pt_key=K; pt_pin=P;"), "pt_key=K;pt_pin=P;");
  assert.deepEqual(core.parseCookies("pt_key=A;pt_pin=one;\npt_key=B;pt_pin=two;"), [
    "pt_key=A;pt_pin=one;",
    "pt_key=B;pt_pin=two;",
  ]);

  const sign = require(path.join(root, "plugins", "jdSignLegacy.js"));
  assert.equal(sign.signCore(Buffer.from("abc")), "qvAv");
  const fixed = {
    ts: 1700000000000,
    jduuid: "0123456789abcdef",
    area: "01_0001_00001_0001",
    brand: "OPPO",
    model: "PAFM00",
    wifiBssid: "TP_LINK_abcdef",
    osVersion: "10",
    screen: "640x1136",
    versionPair: [0, 2],
    random: () => 0,
  };
  assert.equal(
    sign.getSignPython("testFn", { eid: "E" }, "android", "12.1.4", fixed).data.sign,
    "bdb2062824d9bb59618bdca03e097ea8",
  );
  assert.equal(
    sign.getSignEs5("testFn", { eid: "E" }, "android", "12.1.4", fixed).data.sign,
    "8a4fa1fe1e09fd1390332d680f33ccd7",
  );

  content = "应用宝登录";
  require(path.join(root, "plugins", "jdYingYongBaoDengLu.js"));
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(qlEnvs.length, 1);
  assert.equal(qlEnvs[0].value, "pt_key=fixture-key;pt_pin=fixture-pin;");

  content = "资产查询";
  const assets = require(path.join(root, "plugins", "jdZiChanChaXun.js"));
  await settle();
  const result = await assets.queryCookie(
    qlEnvs[0].value,
    { maxDetailPages: 1, showRedPacket: true, showCoupon: true },
    qlEnvs[0],
  );
  assert.equal(result.bean, 88);
  assert.equal(result.todayIncome, 5);
  assert.equal(result.redPacket, 3.2);
  assert.equal(result.coupons, 1);

  content = "农场状态";
  const farm = require(path.join(root, "plugins", "jdNongChang.js"));
  await settle();
  const home = await farm.farmHome(qlEnvs[0].value, { h5stApi: "" });
  assert.equal(home.data.farmUserPro.treeName, "苹果");

  content = "检测评价";
  require(path.join(root, "plugins", "jdZiDongPingJia.js"));
  await settle();
  content = "COOKIE状态";
  require(path.join(root, "plugins", "jdCookieGuanLi.js"));
  await settle();

  assert.ok(replies.length >= 6);
  console.log(`jd_runtime_fixtures=PASS ql_envs=${qlEnvs.length} replies=${replies.length}`);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}
