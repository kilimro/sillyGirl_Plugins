// [title: 京东口令]
// [name: jingDongKouLing]
// [desc: 按 Python 的 jComExchange/jCommand 签名流程实现京东口令与活动链接互转]
// [author: chuan]
// [version: v1.3.0]
// [rule: ^(jx|转链接)\s+(.+)$|^(生成口令|转口令)\s+(.+)$]
// [rule: ^.*?起丨住丨力.*?$]
// [rule: ^.*?(连续签到|快来签到|签到还有|每天来|每日来|新增签|口令解析成功|快来一起冲榜).*?]
// [rule: ^([\s\S]+|.*?)(:/！|:/￥|￥|！)([\s\S]+)(￥)([\s\S]+|.*?)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 工具]
// [icon: https://www.jd.com/favicon.ico]
// [origin: backup/jd_口令_v0.0.1_By.authook.py;backup/京东口令解析_v1.2.0_By.chuan.py;backup/口令解析_v1.2.4_By.qingge.js;backup/口令解析_v1.2.4_By.qingge.txt]
// [depe: []]

const { createCipheriv, createHash, randomBytes } = require("crypto");
const { sender: s, plugin } = require("sillygirl");

const API = "https://api.m.jd.com/client.action";
const FROM = "KLMNOPQRSTABCDEFGHIJUVWXYZabcdopqrstuvwxefghijklmnyz0123456789+/";
const TO = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const form = new plugin.Form({
  sign_url: plugin.Form.string()
    .title("自定义 sign 接口")
    .description("例如 http://HOST/api；留空使用内置签名")
    .default(""),
  reply_url: plugin.Form.boolean().title("自动解析时回复完整链接").default(true),
  reply_help_code: plugin.Form.boolean().title("返回助力码").default(false),
});

async function main() {
  try {
    const cfg = (await form.get()) || {};
    const content = String((await s.getMsg()) || "").trim();
    const parseMatch = content.match(/^(?:jx|转链接)\s+([\s\S]+)$/i);
    if (parseMatch) {
      if (!/[()#@$%¥￥!！][0-9a-z]{10,14}[()#@$%¥￥!！]/i.test(parseMatch[1])) return s.reply("好像不是京东口令");
      const data = await exchange(parseMatch[1], cfg);
      const jumpUrl = data?.jumpUrl || data?.url;
      if (!jumpUrl) throw new Error("解析结果缺少链接");
      await s.reply(
        [`标题：${data.title || "未知活动"}`, `来源：${data.userName || "未知"}`, `链接：${jumpUrl}`].join("\n"),
      );
      await s.setMsg(jumpUrl);
      return s.resume();
    }
    const commandMatch = content.match(/^(?:生成口令|转口令)\s+([\s\S]+)$/);
    if (commandMatch) return s.reply(await command(commandMatch[1]));
    if (looksLikeCommand(content)) {
      if (/融App|马上就能拿到大奖|快来一起冲榜/.test(content)) {
        await s.setMsg(`捕鱼口令+${content}`);
        return s.resume();
      }
      const data = await exchange(content, cfg),
        jumpUrl = data?.jumpUrl || data?.url;
      if (!jumpUrl) throw new Error("解析结果缺少链接");
      if (cfg.reply_url !== false) await s.reply(jumpUrl);
      const code = helpCode(jumpUrl);
      if (cfg.reply_help_code && code) await s.reply(`获取到助力码\n${code}`);
      await s.setMsg(routeHelp(jumpUrl, code));
      return s.resume();
    }
  } catch (error) {
    return s.reply(`京东口令处理失败：${String(error?.message || error).slice(0, 300)}`);
  }
}

async function exchange(text, cfg = {}) {
  if (cfg.sign_url) {
    const response = await fetch(`${String(cfg.sign_url).replace(/\/$/, "")}/jComExchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: text }),
      signal: AbortSignal.timeout(10000),
    });
    const remote = await response.json().catch(() => ({}));
    if (
      response.ok &&
      (String(remote.code) === "0" ||
        Number(remote.Code) === 200 ||
        Number(remote.status) === 200 ||
        remote.msg === "获取成功") &&
      remote.data
    )
      return remote.data;
  }
  for (const appCode of ["jApp", "jLite", "jXi", "jHealth"]) {
    const body = { appCode, commandType: 0, text: encodeURIComponent(aes(text)) };
    try {
      const data = await call("jComExchange", body);
      if (String(data.code) === "0" && data.data) return data.data;
    } catch {
      /* 尝试下一个 appCode */
    }
  }
  throw new Error("口令解析失败");
}

function looksLikeCommand(text) {
  return /起丨住丨力|连续签到|快来签到|签到还有|每天来|每日来|新增签|口令解析成功|快来一起冲榜|[:：]\/！|[:：]\/￥|[￥！][\s\S]{6,}[￥！]/.test(
    text,
  );
}
function helpCode(url) {
  try {
    const params = new URL(url).searchParams;
    for (const key of ["wegameInviterId", "inviterId", "inviteCode"]) if (params.get(key)) return params.get(key);
  } catch {}
  return "";
}
function routeHelp(url, code) {
  if (!code) return url;
  const routes = [
    ["38fBeMPN3sLNzhvpxCZBbsteaLsv", "黄金+"],
    ["B2Y13x641hwWfpsoRenCzfbz4jR", "赚赚助力+"],
    ["3ABYwYuC87Dcx4gZYGKw6fqtE8WN", "数码+"],
    ["3n8vJTvbf18Ey2dMDiSCQCpeaooW", "文具+"],
    ["2bMhVoqyXAxUsjkBkTurGZUHAAji", "推红包+"],
    ["2vvWrigCKrEDr1QUSmorqk8rbteV", "推金+"],
    ["4N8Es4Ws9agaWFHMbtWpEjMtzCXU", "开学礼+"],
    ["T3kLpNbq8AJQZtTwfRF9o1HBhKP", "潮电+"],
  ];
  for (const [activity, prefix] of routes) if (url.includes(activity)) return prefix + code;
  if (/Bc9WX7MpCW7nW9QjZ5N3fFeJXMH|42HV4J3Q87B2xFQMJk81PCc1mEs3/.test(url)) return `新助力码助力+${code}`;
  return url;
}

async function command(url) {
  const body = {
    appCode: "jApp",
    command: {
      keyChannel: "Wxfriends",
      keyContent: "未知活动",
      keyEndTime: Date.now() + 30 * 86400000,
      keyId: url,
      keyImg: "",
      keyTitle: "京东用户",
      sourceCode: "babel",
      url,
    },
  };
  const data = await call("jCommand", body);
  if (String(data.code) !== "0" || !data.data) throw new Error(data.msg || "口令生成失败");
  return typeof data.data === "string"
    ? data.data
    : data.data.command || data.data.jCommand || JSON.stringify(data.data);
}

async function call(functionId, body) {
  const params = sign(functionId, body);
  const query = new URLSearchParams(params);
  const response = await fetch(`${API}?${query}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "Mozilla/4.0 (compatible; MSIE 9.0; Windows NT 6.1)",
    },
    body: new URLSearchParams({ body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.msg || `HTTP ${response.status}`);
  return data;
}

function sign(functionId, body) {
  const client = "android";
  const clientVersion = "11.2.8";
  const st = String(Date.now());
  const sv = ["102", "111", "120"][Math.floor(Math.random() * 3)];
  const uuid = randomBytes(16).toString("hex").slice(16);
  const ep = makeEp(uuid, st);
  const bodyText = JSON.stringify(body);
  const raw = `functionId=${functionId}&body=${bodyText}&uuid=${uuid}&client=${client}&clientVersion=${clientVersion}&st=${st}&sv=${sv}`;
  const signed = Buffer.from(
    [...Buffer.from(raw)].map((value, index) => {
      const mask = [0x37, 0x92, 0x44, 0x68, 0xa5, 0x3d, 0xcc, 0x7f, 0xbb, 0x0f, 0xd9, 0x88, 0xee, 0x9a, 0xe9, 0x5a][
        index & 15
      ];
      const key = Buffer.from("80306f4370b39fd5630ad0529f77adb6")[index & 7];
      const mixed = ((mask ^ value ^ key) + mask) & 255;
      return (mask ^ mixed ^ key) & 255;
    }),
  );
  return {
    functionId,
    body: bodyText,
    uuid,
    client,
    clientVersion,
    st,
    sv,
    sign: createHash("md5").update(signed.toString("base64")).digest("hex"),
    ep,
  };
}

function makeEp(uuid, st) {
  const cipher = (value) => translate(Buffer.from(value).toString("base64"));
  return JSON.stringify({
    hdid: "JM9F1ywUPwflvMIpYPok0tt5k9kW4ArJEU3lfLhxBqw=",
    ts: Number(st) - Math.floor(100 + Math.random() * 900),
    ridx: -1,
    cipher: {
      area: cipher(`${rand(10000)}_${rand(10000)}_${rand(10000)}_${rand(10000)}`),
      d_model: cipher(["Mi11Ultra", "Mi11", "Mi10"][rand(3)]),
      wifiBssid: "dW5hbw93bq==",
      osVersion: "CJS=",
      d_brand: "WQvrb21f",
      screen: "CtS1DIenCNqm",
      uuid: cipher(uuid),
      aid: cipher(uuid),
      openudid: cipher(uuid),
    },
    ciphertype: 5,
    version: "1.2.0",
    appname: "com.jingdong.app.mall",
  });
}
function aes(value) {
  const cipher = createCipheriv("aes-128-cbc", Buffer.from("5yKhoqodQjuHGlKZ"), Buffer.from("7WwXmH2TKSCIEJQ3"));
  return Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]).toString("base64");
}
function translate(value) {
  return [...String(value)]
    .map((char) => {
      const index = FROM.indexOf(char);
      return index < 0 ? char : TO[index];
    })
    .join("");
}
function rand(max) {
  return Math.floor(Math.random() * max);
}

main();
