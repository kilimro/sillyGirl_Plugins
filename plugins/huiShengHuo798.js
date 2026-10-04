// [title: 慧生活798]
// [name: huiShengHuo798]
// [desc: 慧生活798 Token/短信登录、积分查询、签到与任务]
// [author: yuhualhh]
// [version: v1.2.0]
// [rule: ^慧生活(登录|查询|运行|管理|清理|一键运行)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/慧生活798_v1.1.2_By.yuhualhh.py]
// [depe: []]

const { randomUUID } = require("crypto");
const { Bucket, plugin, sender: s } = require("sillygirl");

const users = new Bucket("yuhua_hsh_user"),
  tokens = new Bucket("yuhua_hsh_token"),
  phones = new Bucket("yuhua_hsh_phone");
const config = new plugin.Form({
  ocr_server: plugin.Form.string().title("OCR 服务").default("http://ddddocr.250666.xyz"),
  sign_api: plugin.Form.string().title("签名服务").default("https://yuhualhh.250666.xyz/api/huishenghuo_sign.php"),
  sign_key: plugin.Form.string().title("签名服务 Key").default("feiwu-cnmb-nmsl"),
});

const api = "https://i.ilife798.com";
const headers = (token) => ({
  authorization: token,
  applicationtype: "1,1",
  versioncode: "2.0.12",
  "user-agent": "Android_ilife798_2.0.12",
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path, token = "", options = {}) {
  const response = await fetch(`${api}${path}`, {
    signal: AbortSignal.timeout(20000),
    ...options,
    headers: { ...headers(token), ...(options.headers || {}) },
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 120) || `HTTP ${response.status}`);
  }
  if (!response.ok) throw new Error(data.msg || `HTTP ${response.status}`);
  return { data, response };
}

async function owner() {
  return `${await s.getPlatform()}:${await s.getUserId()}`;
}
async function accounts(target = s) {
  const key = `${await target.getPlatform()}:${await target.getUserId()}`;
  const value = await users.get(key, []);
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveToken(token, phone = "未知", target = s) {
  const check = await request("/api/v1/ui/app/master", token);
  if (Number(check.data.code) !== 0) throw new Error(check.data.msg || "Token 无效");
  const account = check.data?.data?.account || {};
  const id = String(account.id || `${Date.now()}-${randomUUID().slice(0, 8)}`);
  const key = `${await target.getPlatform()}:${await target.getUserId()}`;
  const list = await accounts(target);
  if (!list.includes(id)) list.push(id);
  await Promise.all([users.set(key, list), tokens.set(id, token), phones.set(id, account.pn || phone)]);
  return { id, phone: account.pn || phone };
}

async function tokenLogin(target) {
  await target.reply("请输入慧生活 Token，回复 q 取消");
  return target.listen({
    rules: ["raw ^([\\s\\S]+)$"],
    timeout: 60000,
    handle: async (next) => {
      const token = String((await next.param(1)) || "").trim();
      if (/^q$/i.test(token)) return "已取消";
      try {
        const saved = await saveToken(token, "未知", next);
        return `登录成功：${mask(saved.phone)}（${saved.id}）`;
      } catch (e) {
        return `登录失败：${e.message}`;
      }
    },
  });
}

async function smsLogin(target, cfg) {
  await target.reply("请输入手机号，回复 q 取消");
  return target.listen({
    rules: ["raw ^(1\\d{10}|q)$"],
    timeout: 60000,
    handle: async (next) => {
      const phone = String((await next.param(1)) || "").trim();
      if (/^q$/i.test(phone)) return "已取消";
      try {
        const nonce = Math.random(),
          stamp = Date.now();
        const image = await fetch(`${api}/api/v1/captcha/?s=${nonce}&r=${stamp}`, {
          headers: headers(""),
          signal: AbortSignal.timeout(15000),
        });
        const base64 = Buffer.from(await image.arrayBuffer()).toString("base64");
        const ocr = await fetch(`${cfg.ocrServer.replace(/\/$/, "")}/calculate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ image: base64 }),
          signal: AbortSignal.timeout(15000),
        });
        const raw = await ocr.text();
        let answer = raw.trim().replace(/["']/g, "");
        try {
          const j = JSON.parse(raw);
          answer = String(j.result ?? j.data ?? (j.code === 0 ? j.msg : answer));
        } catch {}
        const sent = await request("/api/v1/acc/login/code", "", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ authCode: answer, s: nonce, un: phone }),
        });
        if (Number(sent.data.code) !== 0) throw new Error(sent.data.msg || "短信发送失败");
        await next.reply("短信已发送，请输入验证码");
        return next.listen({
          rules: ["raw ^([0-9]{4,8}|q)$"],
          timeout: 120000,
          handle: async (third) => {
            const code = String((await third.param(1)) || "").trim();
            if (/^q$/i.test(code)) return "已取消";
            try {
              const login = await request("/api/v1/acc/login", "", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ authCode: code, un: phone }),
              });
              const token = login.data?.data?.al?.token;
              if (Number(login.data.code) !== 0 || !token) throw new Error(login.data.msg || "登录失败");
              const saved = await saveToken(token, phone, third);
              return `登录成功：${mask(saved.phone)}`;
            } catch (e) {
              return `登录失败：${e.message}`;
            }
          },
        });
      } catch (e) {
        return `短信发送失败：${e.message}`;
      }
    },
  });
}

async function queryOne(id) {
  const token = await tokens.get(id, ""),
    phone = await phones.get(id, "未知");
  if (!token) return `${mask(phone)}：本地无 Token`;
  const [stat, mission, detail] = await Promise.all([
    request("/api/v1/acc/stat", token),
    request("/api/v1/acc/score/mission-lst", token),
    request("/api/v1/acc/score/score-lst?page=0&size=20&hasCount=true", token),
  ]);
  if (Number(stat.data.code) !== 0) return `${mask(phone)}：${stat.data.msg || "Token 无效"}`;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const today = (detail.data.data || [])
    .filter((x) => Number(x.ctime) >= start.getTime())
    .reduce((n, x) => n + Number(x?.data?.score || 0), 0);
  return `${mask(phone)}\n当前积分：${mission.data?.data?.accScoreRsp?.score ?? 0}\n今日积分：${today}`;
}

async function getSign(adId, uid, token, cfg) {
  const response = await fetch(cfg.signApi, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adId, uid: String(uid), token: String(token), apiKey: cfg.signKey }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok || Number(data.code) !== 0 || !data.sign) throw new Error(data.msg || "获取签名失败");
  return data.sign;
}

async function runOne(id, cfg) {
  const token = await tokens.get(id, ""),
    phone = await phones.get(id, "未知");
  const info = await request("/api/v1/ui/app/master", token);
  const uid = info.data?.data?.account?.id;
  if (Number(info.data.code) !== 0 || !uid) throw new Error(`${mask(phone)}：用户信息失败`);
  const history = await request("/api/v1/acc/score/score-lst?page=0&size=50&hasCount=true", token);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const rows = (history.data.data || []).filter((x) => Number(x.ctime) >= start.getTime());
  const jobs = [
    {
      name: "每日签到",
      adId: "DAILY_CHECK_IN",
      limit: 1,
      payload: { addScore: 5, addScoreType: 1, weekday: new Date().getDay() || 7 },
    },
    { name: "APP看视频", adId: "1705776998", limit: 5, payload: { addScore: 30, addScoreType: 2, type: 101 } },
    { name: "APP看广告", adId: "popsreen", limit: 5, payload: { addScore: 10, addScoreType: 2, type: 101 } },
    {
      name: "ZFB看视频",
      adId: "ad_tiny_2019061465519660_202402222200083035",
      limit: 5,
      zfb: true,
      payload: { type: 101 },
    },
    { name: "ZFB点外卖", adId: "1435961748560572416", limit: 1, zfb: true, payload: { type: 101 } },
  ];
  const log = [];
  for (const job of jobs) {
    let done = rows.filter((x) => x?.data?.adId === job.adId).length,
      success = 0;
    for (; done + success < job.limit; success++) {
      const sign = await getSign(job.adId, uid, token, cfg);
      const extra = job.zfb
        ? {
            applicationtype: "1,5",
            alipayminimark:
              "OYXJAQr4Vqk8SjMj4n6ostz/6/P8CaZkBPa9NZDpidIZXPE35hjWe8pwKUI9JRTFnumqXjVxUEFy2qxssdEOaM41RcB7nlw2D0f7f4M5reQ=",
          }
        : {};
      const result = await request(`/api/v1/acc/score/score-send?sign=${encodeURIComponent(sign)}`, token, {
        method: "POST",
        headers: { "content-type": "application/json", ...extra },
        body: JSON.stringify({ adId: job.adId, ...job.payload }),
      });
      if (Number(result.data.code) !== 0) {
        log.push(`${job.name}：${result.data.msg || "失败"}`);
        break;
      }
      if (done + success + 1 < job.limit) await sleep(1000);
    }
    if (done + success >= job.limit) log.push(`${job.name}：完成 ${done + success}/${job.limit}`);
  }
  return `${mask(phone)}\n${log.join("\n")}`;
}

async function main() {
  try {
    const content = String((await s.getMsg()) || "").trim();
    const raw = await config.get();
    const cfg = {
      ocrServer: String(raw.ocr_server || "http://ddddocr.250666.xyz"),
      signApi: String(raw.sign_api || "https://yuhualhh.250666.xyz/api/huishenghuo_sign.php"),
      signKey: String(raw.sign_key || "feiwu-cnmb-nmsl"),
    };
    if (content === "慧生活登录") {
      await s.reply("请选择：1 Token登录 / 2 手机号登录 / q 退出");
      return s.listen({
        rules: ["raw ^([12q])$"],
        timeout: 60000,
        user_id: await s.getUserId(),
        chat_id: await s.getChatId(),
        handle: async (next) =>
          String(await next.param(1)) === "1"
            ? tokenLogin(next)
            : String(await next.param(1)) === "2"
              ? smsLogin(next, cfg)
              : "已退出",
      });
    }
    const list = await accounts();
    if (content === "慧生活清理") {
      for (const id of list) await Promise.all([tokens.delete(id), phones.delete(id)]);
      await users.delete(await owner());
      return s.reply(`已清理 ${list.length} 个账号`);
    }
    if (!list.length) return s.reply("未绑定账号，请发送 慧生活登录");
    if (/查询|管理/.test(content)) return s.reply((await Promise.all(list.map(queryOne))).join("\n------\n"));
    if (/运行/.test(content)) {
      if (content === "慧生活一键运行" && !(await s.isAdmin())) return s.reply("需要管理员权限");
      const outputs = [];
      for (const id of list) {
        try {
          outputs.push(await runOne(id, cfg));
        } catch (e) {
          outputs.push(`账号 ${id}：${e.message}`);
        }
      }
      return s.reply(outputs.join("\n------\n"));
    }
  } catch (e) {
    return s.reply(`慧生活处理失败：${e.message}`);
  }
}

function mask(value) {
  const x = String(value || "未知");
  return /^1\d{10}$/.test(x) ? `${x.slice(0, 3)}****${x.slice(-4)}` : x;
}
main();
