#!/usr/bin/env node
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const Module = require("node:module");

const memory = new Map();
const replies = [];
class Bucket {
  constructor(name) {
    this.name = name;
    if (!memory.has(name)) memory.set(name, new Map());
  }
  async get(key, fallback) {
    return memory.get(this.name).has(String(key)) ? memory.get(this.name).get(String(key)) : fallback;
  }
  async set(key, value) {
    memory.get(this.name).set(String(key), value);
    return { changed: true };
  }
  async delete(key) {
    memory.get(this.name).delete(String(key));
    return { changed: true };
  }
  async getAll() {
    return Object.fromEntries(memory.get(this.name));
  }
  async keys() {
    return [...memory.get(this.name).keys()];
  }
}
const field = () => {
  const value = {};
  for (const name of ["title", "description", "default", "min", "max", "format", "required"]) value[name] = () => value;
  return value;
};
function Form() {
  this.get = async () => ({});
}
for (const name of ["string", "number", "integer", "boolean", "array", "object"]) Form[name] = field;
class QingLong {
  async getEnvs() {
    return [];
  }
  async createEnv() {}
  async updateEnv() {}
  async deleteEnvs() {}
  async enableEnvs() {}
}
class Adapter {
  async push() {}
  async destroy() {}
}
const sender = {
  getMsg: async () => "__fixture__",
  getUserId: async () => "user",
  getPlatform: async () => "qq",
  getBotId: async () => "bot",
  isAdmin: async () => false,
  reply: async (text) => {
    replies.push(String(text));
  },
  listen: async () => undefined,
  resume: async () => undefined,
  pushAdmin: async () => [],
  getEvent: async () => ({}),
  getAdapter: async () => ({ push: async () => {} }),
};
const fakeSillyGirl = {
  sender,
  Bucket,
  Adapter,
  container: { QingLong },
  plugin: { Form },
  utils: { image: (url) => `[image:${url}]` },
  console,
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "sillygirl") return fakeSillyGirl;
  if (request === "undici") return { ProxyAgent: class ProxyAgent {} };
  return originalLoad.call(this, request, parent, isMain);
};

const calls = [];
global.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  calls.push({ method: options.method || "GET", url: url.toString() });
  let data;
  if (url.pathname === "/api/account/init") data = { code: 0, data: { session: { id: "session-init" } } };
  else if (url.pathname === "/web/init")
    data = { code: 0, data: { client: { signature_key: "fixture-signature-key" } } };
  else if (url.pathname === "/web/oauth/credential_auth")
    data = { code: 0, data: { authorization_code: { code: "authorization-code" } } };
  else if (url.pathname === "/api/zbtxz/login")
    data = {
      code: 0,
      data: {
        session: { id: "session-login", account_id: "account-id" },
        account: { nick_name: "fixture", ref_user_code: "R001", mobile: "13800138000", invitation_number: 2 },
      },
    };
  else if (url.pathname === "/api/article/channel_list" && url.searchParams.get("channel_id") === "config-channel")
    data = {
      code: 0,
      data: { article_list: [{ column_news_list: [{ url: "https://op-h5.cloud.jinhua.com.cn/study?id=study-id" }] }] },
    };
  else if (url.pathname === "/api/member/login") data = { code: 0, data: { key: "jinhua-key", token: "jinhua-token" } };
  else if (url.pathname === "/api/study/detail")
    data = { code: 0, data: { lottery: { lottery_id: "lottery-id" }, levels: [] } };
  else if (url.pathname === "/api/lotterybigwheel/_ac_lottery_count") data = { code: 0, data: { count: 0 } };
  else if (url.pathname === "/api/user_center/task") data = { code: 0, data: { list: [] } };
  else if (url.pathname === "/api/user_mumber/account_detail")
    data = { code: 0, data: { rst: { total_integral: 88 } } };
  else throw new Error(`unexpected fixture request: ${url}`);
  return { status: 200, headers: new Headers(), text: async () => JSON.stringify(data) };
};

(async () => {
  const root = path.resolve(__dirname, "..");
  const vorto = require(path.join(root, "plugins", "vortoUtils.js"));
  assert.equal(vorto.maskAccount("13800138000"), "138****8000");
  assert.deepEqual(vorto.parseBatchAccounts("a#b\nc#d"), [
    { field0: "a", field1: "b" },
    { field0: "c", field1: "d" },
  ]);
  await new Bucket("auth-fixture").set("account", "2026-08-10");
  assert.match(await vorto.calculateAuthTime("auth-fixture", "account", { days: 1 }), /^\d{4}-\d{2}-\d{2}$/);

  const xiaomi = require(path.join(root, "plugins", "xiaomiStepsCore.js"));
  assert.equal(xiaomi.DATA_TEMPLATE.length, 15317);
  const rendered = xiaomi.renderData(12345, new Date(2026, 7, 7));
  assert.match(rendered, /date%22%3A%222026-08-07%22%2C%22data/);
  assert.match(rendered, /ttl%5C%22%3A12345%2C%5C%22dis/);
  assert.equal(
    crypto.createHash("sha256").update(rendered).digest("hex"),
    "7fdbc520cfab4b7b9dd74665eca4ba5a6cec8ac09337cac67fdf11c396e03f42",
  );
  const oldFetch = global.fetch;
  const zeppCalls = [];
  global.fetch = async (input, options = {}) => {
    zeppCalls.push({ url: String(input), options });
    const index = zeppCalls.length;
    const data =
      index === 1
        ? { access: "ACCESS" }
        : index === 2
          ? { token_info: { login_token: "LOGIN", user_id: "UID" } }
          : index === 3
            ? { token_info: { app_token: "APP" } }
            : { ok: true };
    return new Response(JSON.stringify(data), { status: 200 });
  };
  const signed = await xiaomi.login("13800138000", "password", { timeout: 3000 });
  const app = await xiaomi.getAppToken(signed.loginToken, { timeout: 3000 });
  const changed = await xiaomi.changeSteps(signed.userId, app.appToken, 23456, {
    timeout: 3000,
    date: new Date(2026, 7, 7),
  });
  global.fetch = oldFetch;
  assert.equal(changed.ok, true);
  assert.equal(zeppCalls.length, 4);
  assert.match(zeppCalls[0].url, /api-user\.zepp\.com\/registrations/);
  assert.match(String(zeppCalls[3].options.body), /ttl%5C%22%3A23456%2C%5C%22dis/);

  console.log(`shared_runtime_fixtures=PASS requests=${calls.length} zepp_requests=${zeppCalls.length}`);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
