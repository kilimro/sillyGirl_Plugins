// [title: 雪乃改密]
// [name: xueNaiGaiMi]
// [desc: 13 个天目云项目短信验证与密码重置]
// [author: rujingxianghai]
// [version: v1.1.0]
// [rule: ^(雪乃|西施眼|望潮|新江北|桐庐|ZSWY|SHPJ|越城|大潮|融磐安|蓝精灵|爱海盐|青椒|荆州)(改密|改密码|修改密码)$|^雪乃(教程|管理|配置)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 工具]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/雪乃改密_v1.0.1_By.rujingxianghai.py]
// [depe: []]

const { randomUUID, createHash, createHmac, publicEncrypt, constants } = require("crypto");
const { plugin, sender: s } = require("sillygirl");

const projects = {
  1: { name: "西施眼", k: "34", p: "50" },
  2: { name: "望潮", k: "64", p: "10019" },
  3: { name: "新江北", k: "102", p: "10050" },
  4: { name: "桐庐", k: "59", p: "10017" },
  5: { name: "ZSWY", k: "73", p: "10024" },
  6: { name: "SHPJ", k: "14", p: "12" },
  7: { name: "越城", k: "31", p: "48" },
  8: { name: "大潮", k: "94", p: "10048" },
  9: { name: "融磐安", k: "30", p: "45" },
  10: { name: "蓝精灵", k: "72", p: "10026" },
  11: { name: "爱海盐", k: "60", p: "10018" },
  12: { name: "青椒", k: "23", p: "34" },
  13: { name: "荆州", k: "92", p: "10046" },
};
const rsaKey = `-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQD6XO7e9YeAOs+cFqwa7ETJ+WXi\nzPqQeXv68i5vqw9pFREsrqiBTRcg7wB0RIp3rJkDpaeVJLsZqYm5TW7FWx/iOiXF\nc+zCPvaKZric2dXCw27EvlH5rq+zwIPDAJHGAfnn1nmQH7wR3PCatEIb8pz5GFlT\nHMlluw4ZYmnOwg+thwIDAQAB\n-----END PUBLIC KEY-----`;
const config = new plugin.Form({
  ocr_server: plugin.Form.string().title("OCR服务").default("https://ddddocr.xzxxn7.live"),
  timeout: plugin.Form.number().title("超时秒数").default(30),
});

const ua = (p) => ({
  passport: `ANDROID;11;${p};6.0.2;1.0;null;2210132C`,
  common: `6.0.2;${randomUUID()};Xiaomi 2210132C;Android;11;Release;6.10.0`,
});
const form = (object) => new URLSearchParams(object).toString();
const parse = async (response) => {
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 120) || `HTTP ${response.status}`);
  }
  if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
  return { data, response };
};
const cookieOf = (response) =>
  (typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")]
  )
    .filter(Boolean)
    .map((x) => x.split(";")[0])
    .join("; ");

function passportSign(path, key, body = "") {
  const id = randomUUID();
  let source;
  if (body) source = `post%%${path}?${body}%%${id}%%`;
  else if (path.includes("?")) {
    const [p, q] = path.split("?", 2);
    source = `get%%${p}?${q}%%${id}%%`;
  } else source = `get%%${path}%%${id}%%`;
  return { id, signature: key ? createHmac("sha256", key).update(source).digest("hex") : "" };
}

async function passport(path, project, key = "", cookie = "", body = "") {
  const sig = passportSign(path, key, body),
    headers = { "x-request-id": sig.id, "cache-control": "no-cache", "user-agent": ua(project.p).passport };
  if (cookie) headers.cookie = cookie;
  if (body) {
    headers["x-signature"] = sig.signature;
    headers["content-type"] = "application/x-www-form-urlencoded;charset=UTF-8";
  }
  return parse(
    await fetch(`https://passport.tmuyun.com${path}`, {
      method: body ? "POST" : "GET",
      headers,
      body: body || undefined,
      signal: AbortSignal.timeout(project.timeout),
    }),
  );
}

async function vapp(path, project, session = "", account = "", body = "") {
  const id = randomUUID(),
    time = Date.now(),
    clean = path.split("?")[0];
  const signature = createHash("sha256")
    .update(`${clean}&&${session}&&${id}&&${time}&&FR*r!isE5W&&${project.k}`)
    .digest("hex");
  const headers = {
    "x-timestamp": String(time),
    "x-session-id": session,
    "x-request-id": id,
    "x-signature": signature,
    "x-tenant-id": project.k,
    "x-account-id": account,
    "user-agent": ua(project.p).common,
    "content-type": "application/x-www-form-urlencoded",
  };
  return parse(
    await fetch(`https://vapp.tmuyun.com${path}`, {
      method: "POST",
      headers,
      body: body || undefined,
      signal: AbortSignal.timeout(project.timeout),
    }),
  );
}

async function initialize(project) {
  const session = (await vapp("/api/account/init", project)).data?.data?.session?.id;
  if (!session) throw new Error("初始化会话失败");
  const init = await passport(`/web/init?client_id=${project.p}`, project);
  const key = init.data?.data?.client?.signature_key;
  if (!key) throw new Error("获取签名密钥失败");
  return { session, key, cookie: cookieOf(init.response) };
}

async function solveCaptcha(project, cookie, cfg) {
  const response = await fetch("https://passport.tmuyun.com/web/security/captcha_image", {
    headers: { "x-request-id": randomUUID(), cookie, "user-agent": ua(project.p).passport },
    signal: AbortSignal.timeout(project.timeout),
  });
  if (!response.ok) throw new Error(`图片验证码 HTTP ${response.status}`);
  const image = Buffer.from(await response.arrayBuffer()).toString("base64");
  const ocr = await fetch(`${cfg.ocrServer.replace(/\/$/, "")}/classification`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image }),
    signal: AbortSignal.timeout(project.timeout),
  });
  const raw = await ocr.text();
  let value = raw.trim().replace(/["']/g, "");
  try {
    const j = JSON.parse(raw);
    value = String(j.result ?? j.data ?? j.text ?? value);
  } catch {}
  if (!value) throw new Error("图片验证码识别失败");
  return value;
}

async function sendCode(phone, project, state, cfg) {
  let body = form({ client_id: project.p, phone_number: phone });
  let result = await passport("/web/security/send_security_code", project, state.key, state.cookie, body);
  if (Number(result.data.code) === 0) return;
  const captcha = await solveCaptcha(project, state.cookie, cfg);
  body = form({ captcha, client_id: project.p, phone_number: phone });
  result = await passport("/web/security/send_security_code", project, state.key, state.cookie, body);
  if (Number(result.data.code) !== 0) throw new Error(result.data.message || "验证码发送失败");
}

async function reset(phone, code, password, project, state) {
  const checked = await passport(
    `/web/security/check_security_code?client_id=${project.p}&phone_number=${phone}&security_code=${code}`,
    project,
    state.key,
    state.cookie,
  );
  if (Number(checked.data.code) !== 0) throw new Error(checked.data.message || "短信验证码错误");
  const encrypted = publicEncrypt(
    { key: rsaKey, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(password),
  ).toString("base64");
  let result = await passport(
    "/web/oauth/reset_password",
    project,
    state.key,
    state.cookie,
    form({ client_id: project.p, new_password: encrypted, phone_number: phone, security_code: code }),
  );
  if (Number(result.data.code) === 0) return "密码修改成功";
  if (Number(result.data.code) === 100001) {
    const auth = await passport(
      "/web/oauth/security_code_auth",
      project,
      state.key,
      state.cookie,
      form({ client_id: project.p, phone_number: phone, security_code: code }),
    );
    const token = auth.data?.data?.authorization_code?.code;
    if (Number(auth.data.code) !== 0 || !token) throw new Error(auth.data.message || "获取授权码失败");
    const reg = await vapp(
      "/api/zbtxz/login",
      project,
      "",
      "",
      form({ check_token: "", code: token, token: "", type: "-1", union_id: "" }),
    );
    if (Number(reg.data.code) !== 0) throw new Error(reg.data.message || "注册失败");
    return "注册并设置密码成功";
  }
  throw new Error(result.data.message || "密码修改失败");
}

async function flow(project, cfg, target = s) {
  await target.reply(`已选择：${project.name}\n请输入手机号，回复 q 取消`);
  return target.listen({
    rules: ["raw ^(1\\d{10}|q)$"],
    timeout: 120000,
    handle: async (next) => {
      const phone = String((await next.param(1)) || "");
      if (/^q$/i.test(phone)) return "已取消";
      try {
        const state = await initialize(project);
        await sendCode(phone, project, state, cfg);
        await next.reply("验证码已发送，请输入短信验证码");
        return next.listen({
          rules: ["raw ^([0-9]{4,8}|q)$"],
          timeout: 300000,
          handle: async (third) => {
            const code = String((await third.param(1)) || "");
            if (/^q$/i.test(code)) return "已取消";
            await third.reply("请输入新密码");
            return third.listen({
              rules: ["raw ^([\\s\\S]+)$"],
              timeout: 120000,
              handle: async (fourth) => {
                const password = String((await fourth.param(1)) || "").trim();
                if (/^q$/i.test(password)) return "已取消";
                if (password.length < 6) return "密码至少 6 位";
                try {
                  return `${await reset(phone, code, password, project, state)}\n项目：${project.name}\n手机号：${phone.slice(0, 3)}****${phone.slice(-4)}`;
                } catch (e) {
                  return `修改失败：${e.message}`;
                }
              },
            });
          },
        });
      } catch (e) {
        return `初始化或发码失败：${e.message}`;
      }
    },
  });
}

async function main() {
  const content = String((await s.getMsg()) || "").trim();
  if (/教程|配置|管理/.test(content))
    return s.reply(
      `支持项目：\n${Object.entries(projects)
        .map(([k, v]) => `${k}. ${v.name}`)
        .join("\n")}\n发送“项目名改密”可直接选择。`,
    );
  const raw = await config.get(),
    cfg = {
      ocrServer: String(raw.ocr_server || "https://ddddocr.xzxxn7.live"),
      timeout: Math.max(5, Number(raw.timeout) || 30) * 1000,
    };
  const direct = Object.values(projects).find((x) => content.startsWith(x.name));
  if (direct) return flow({ ...direct, timeout: cfg.timeout }, cfg);
  await s.reply(
    `请选择项目：\n${Object.entries(projects)
      .map(([k, v]) => `${k}. ${v.name}`)
      .join("\n")}\n回复 q 取消`,
  );
  return s.listen({
    rules: ["raw ^(1[0-3]|[1-9]|q)$"],
    timeout: 120000,
    user_id: await s.getUserId(),
    chat_id: await s.getChatId(),
    handle: async (next) => {
      const key = String((await next.param(1)) || "");
      return /^q$/i.test(key) ? "已取消" : flow({ ...projects[key], timeout: cfg.timeout }, cfg, next);
    },
  });
}
main();
