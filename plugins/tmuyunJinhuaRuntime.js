// [title: 天目云金华任务公共模块]
// [name: tmuyunJinhuaRuntime]
// [desc: 掌上武义/西施眼共用的天目云账号登录、金华学习、阅读点赞分享、抽奖滑块、资产查询、账号管理与青龙同步实现。]
// [author: 601712460 / sillyGirl]
// [version: v1.0.1]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 模块]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [module: true]
// [origin: backup/app_武义_v0_By.601712460.py;backup/app_西施_v0_By.601712460.py]
// [depe: ["./vortoUtils.js","undici"]]

const crypto = require("node:crypto");
const { sender: s, Bucket, Adapter, container, plugin, console: sgConsole } = require("sillygirl");
const vorto = require("./vortoUtils");
let ProxyAgent;
try {
  ({ ProxyAgent } = require("undici"));
} catch (_) {}
const logger = sgConsole || globalThis.console;

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQD6XO7e9YeAOs+cFqwa7ETJ+WXizPqQeXv68i5vqw9pFREsrqiBTRcg7wB0RIp3rJkDpaeVJLsZqYm5TW7FWx/iOiXFc+zCPvaKZric2dXCw27EvlH5rq+zwIPDAJHGAfnn1nmQH7wR3PCatEIb8pz5GFlTHMlluw4ZYmnOwg+thwIDAQAB
-----END PUBLIC KEY-----`;
const PLATFORMS = ["qq", "qb", "wx", "tb", "tg", "web", "wxmp"];

function createRuntime(spec) {
  validateSpec(spec);
  const configStore = new Bucket(`${spec.prefix}conf`);
  const Common = new Bucket("vhook_common");
  const Config = new plugin.Form({
    paid: plugin.Form.boolean().title("新增账号收费").default(false),
    fee: plugin.Form.number().title("新增账号费用/元").min(0).default(0),
    qr_code: plugin.Form.string().title("收款码图片URL").default(""),
    proxy_mode: plugin.Form.integer()
      .title("代理模式")
      .description("0关闭，1固定代理，2代理API")
      .min(0)
      .max(2)
      .default(0),
    proxy: plugin.Form.string().title("固定代理").default("").visibleWhen("proxy_mode", "==", 1),
    proxy_api: plugin.Form.string().title("代理API").default("").visibleWhen("proxy_mode", "==", 2),
    ocr_host: plugin.Form.string().title("ddddocr服务地址").description("提供 /capcode 接口").default(""),
    sync_ql: plugin.Form.boolean().title("同步青龙").default(false),
    qinglong_id: plugin.Form.integer().title("青龙容器编号").min(1).default(1).visibleWhen("sync_ql", "==", true),
    env_name: plugin.Form.string().title("青龙变量名").default(spec.defaultEnvName).visibleWhen("sync_ql", "==", true),
    tip: plugin.Form.string().title("消息小尾巴").default(""),
    timeout_ms: plugin.Form.integer().title("接口超时毫秒").min(3000).max(120000).default(30000),
  });
  let runtime = {};

  async function loadConfig() {
    const form = (await Config.get()) || {},
      legacy = await configStore.getAll();
    const common = await Common.getAll();
    const pick = (formKey, legacyKey, fallback) =>
      legacy?.[legacyKey] !== undefined && legacy[legacyKey] !== ""
        ? legacy[legacyKey]
        : form[formKey] !== undefined
          ? form[formKey]
          : fallback;
    runtime = {
      paid: boolValue(pick("paid", "paid", false)),
      fee: Math.max(0, Number(pick("fee", "fee", 0)) || 0),
      qrCode: String(pick("qr_code", "qr_code", "")),
      proxyMode: clampInt(pick("proxy_mode", "proxy_status", 0), 0, 2, 0),
      proxy: String(common.proxy || pick("proxy", "proxy", "")),
      proxyApi: String(common.proxy_api || pick("proxy_api", "proxy_api", "")),
      ocrHost: String(common.ocr_host || form.ocr_host || "").replace(/\/+$/, ""),
      syncQl: boolValue(pick("sync_ql", "sync_ql", false)),
      qinglongId: clampInt(form.qinglong_id, 1, 9999, 1),
      envName: String(pick("env_name", "env_name", spec.defaultEnvName)),
      tip: String(pick("tip", "tip", "")),
      timeout: clampInt(form.timeout_ms, 3000, 120000, 30000),
      dispatcher: null,
    };
    if (runtime.proxyMode) {
      let proxy = runtime.proxy;
      if (runtime.proxyMode === 2 && runtime.proxyApi) {
        try {
          proxy = (await httpText(runtime.proxyApi, { timeout: runtime.timeout })).trim();
        } catch (error) {
          logger.log(`${spec.name}代理API失败：${vorto.errorText(error)}`);
        }
      }
      if (proxy && ProxyAgent) runtime.dispatcher = new ProxyAgent(normalizeProxy(proxy));
    }
    return runtime;
  }

  async function main() {
    await loadConfig();
    const content = String((await s.getMsg()) || "").trim();
    if (!content) return runCron();
    if (content === `${spec.name}配置`) return showConfig();
    if (content === `${spec.name}超管`) return adminOverview();
    if (/登录|登陆/.test(content)) return addAccount();
    if (content === `${spec.name}管理`) return manageAccounts();
    if (content === `${spec.name}签到` || content === spec.adminRunCommand)
      return runCurrent(content === spec.adminRunCommand);
    return s.resume();
  }

  async function showConfig() {
    if (!(await s.isAdmin())) return s.reply("仅管理员可查看配置");
    return s.reply(
      `${spec.name}配置已迁移到插件表单：收费、代理、OCR、青龙同步、变量名和超时均可直接设置。\n当前：收费=${runtime.paid}，代理模式=${runtime.proxyMode}，OCR=${runtime.ocrHost ? "已配置" : "未配置"}，青龙同步=${runtime.syncQl}，变量=${runtime.envName}`,
    );
  }

  async function addAccount() {
    const phone = await vorto.prompt(s, `${spec.name}-请输入手机号：`, 60000);
    if (phone === null) return s.reply("已退出");
    if (!/^1\d{10}$/.test(phone)) return s.reply("手机号格式错误");
    const password = await vorto.prompt(s, `${spec.name}-请输入密码：`, 60000, false);
    if (password === null) return s.reply("密码为空或已超时");
    if (!(await chargeForAccount())) return;
    const platform = String((await s.getPlatform()) || "web"),
      userId = String((await s.getUserId()) || ""),
      store = accountStore(platform);
    const accounts = parseAccounts(await store.get(userId, "[]"));
    const existing = accounts.find((item) => item.name === phone);
    if (existing) {
      existing.pwd = password;
      existing.disable = "n";
      existing.expire = addDays(30);
    } else accounts.push({ name: phone, pwd: password, disable: "n", expire: addDays(30) });
    await store.set(userId, JSON.stringify(accounts));
    await s.reply(existing ? "账号更新成功，开始执行任务……" : "账号添加成功，开始执行任务……");
    return executeAccounts([{ ...(existing || accounts.at(-1)), push_user_id: userId, push_im_type: platform }], false);
  }

  async function chargeForAccount() {
    if (!runtime.paid || runtime.fee <= 0) return true;
    if (!runtime.qrCode) {
      await s.reply("已开启收费但未配置收款码");
      return false;
    }
    await s.reply(`新增${spec.name}账号费用：${runtime.fee}元`);
    await s.reply(`[CQ:image,file=${runtime.qrCode}]`);
    const result = await vorto.waitPaymentEvent(s, runtime.fee, 300000);
    if (!result.paid) await s.reply(result.cancelled ? "已取消" : "支付超时、金额不足或支付事件无效");
    return result.paid;
  }

  async function manageAccounts() {
    const platform = String((await s.getPlatform()) || "web"),
      userId = String((await s.getUserId()) || ""),
      store = accountStore(platform);
    const accounts = parseAccounts(await store.get(userId, "[]"));
    if (!accounts.length) return addAccount();
    const choice = await vorto.prompt(
      s,
      `${spec.name}账号管理（0增加，q退出）\n${accounts.map((item, index) => `${index + 1}. ${maskPhone(item.name)}｜${item.disable === "y" ? "禁用" : "启用"}｜${item.expire || addDays(30)}`).join("\n")}`,
      60000,
    );
    if (choice === null) return s.reply("已退出");
    if (choice === "0") return addAccount();
    if (!/^\d+$/.test(choice) || Number(choice) < 1 || Number(choice) > accounts.length) return s.reply("账号序号错误");
    const index = Number(choice) - 1,
      account = accounts[index];
    const action = await vorto.prompt(
      s,
      `编辑 ${maskPhone(account.name)}\n[0] 删除\n[1] 修改手机号\n[2] 修改密码\n[3] 切换启用/禁用\n[4] 续期30天并立即执行`,
      120000,
    );
    if (action === null) return s.reply("已退出");
    if (action === "0") accounts.splice(index, 1);
    else if (action === "1") {
      const value = await vorto.prompt(s, "请输入新手机号", 60000);
      if (value && /^1\d{10}$/.test(value)) account.name = value;
      else return s.reply("手机号格式错误");
    } else if (action === "2") {
      const value = await vorto.prompt(s, "请输入新密码", 60000, false);
      if (value) account.pwd = value;
      else return s.reply("密码为空");
    } else if (action === "3") account.disable = account.disable === "y" ? "n" : "y";
    else if (action === "4") {
      account.expire = addDays(30, maxDate(account.expire));
      account.disable = "n";
    } else return s.reply("操作序号错误");
    if (accounts.length) await store.set(userId, JSON.stringify(accounts));
    else await store.delete(userId);
    await s.reply(action === "0" ? "账号已删除" : "账号已保存");
    if (action === "4") return executeAccounts([{ ...account, push_user_id: userId, push_im_type: platform }], false);
  }

  async function runCurrent(forceAdmin) {
    if (forceAdmin && !(await s.isAdmin())) return s.reply("仅管理员可执行全部账号任务");
    if (forceAdmin) return runCron(false);
    const platform = String((await s.getPlatform()) || "web"),
      userId = String((await s.getUserId()) || ""),
      store = accountStore(platform);
    const accounts = parseAccounts(await store.get(userId, "[]"));
    if (!accounts.length) return addAccount();
    return executeAccounts(
      accounts.map((item) => ({ ...item, push_user_id: userId, push_im_type: platform })),
      false,
    );
  }

  async function runCron(push = true) {
    const rows = [];
    for (const platform of PLATFORMS) {
      const store = accountStore(platform);
      for (const userId of await store.keys()) {
        const accounts = parseAccounts(await store.get(String(userId), "[]"));
        accounts.forEach((item) => rows.push({ ...item, push_user_id: String(userId), push_im_type: platform }));
      }
    }
    if (!rows.length) return push ? s.pushAdmin(`${spec.name}定时任务：没有账号`) : s.reply("没有账号");
    return executeAccounts(rows, push);
  }

  async function executeAccounts(accounts, push) {
    const runnable = accounts.filter((item) => item.disable !== "y" && (!item.expire || item.expire > today()));
    if (!runnable.length) return s.reply("账号全部被禁用或已过期，请启用/续期后再运行");
    if (!push) await s.reply(`任务开始执行，共 ${runnable.length} 个账号，请稍后……`);
    const reports = [];
    for (let index = 0; index < runnable.length; index++) {
      const account = runnable[index],
        task = new Task(index + 1, account, spec, runtime);
      const result = await task.run();
      reports.push(result.message);
      if (runtime.syncQl && result.ok) await syncQingLong(account, result);
      if (push) await pushReport(account, result.message);
      else await s.reply(result.message);
    }
    if (push) await s.pushAdmin(`${spec.name}定时任务完成：${reports.length} 个账号`);
  }

  async function syncQingLong(account, result) {
    if (!runtime.envName) return false;
    try {
      const ql = new container.QingLong({ id: runtime.qinglongId });
      const remark = `${account.push_im_type}@@${account.push_user_id}@@${account.name}`;
      const rows = normalizeRows(await ql.getEnvs({ searchValue: runtime.envName }));
      const found = rows.find(
        (item) => item?.name === runtime.envName && String(item?.remarks || item?.remark || "") === remark,
      );
      const value = result.sessionId;
      if (found) await ql.updateEnv({ id: found.id || found._id, name: runtime.envName, value, remarks: remark });
      else await ql.createEnv({ name: runtime.envName, value, remarks: remark });
      return true;
    } catch (error) {
      logger.log(`${spec.name}同步青龙失败：${vorto.errorText(error)}`);
      return false;
    }
  }

  async function pushReport(account, message) {
    try {
      const adapter = new Adapter({ platform: account.push_im_type, bot_id: String((await s.getBotId()) || "") });
      await adapter.push({ user_id: account.push_user_id, content: message });
      if (typeof adapter.destroy === "function") await adapter.destroy();
    } catch (_) {
      await s.pushAdmin(message);
    }
  }

  async function adminOverview() {
    if (!(await s.isAdmin())) return s.reply("仅管理员可用");
    const lines = [`${spec.name}账号概览`];
    let total = 0;
    for (const platform of PLATFORMS) {
      const store = accountStore(platform);
      let count = 0;
      for (const key of await store.keys()) count += parseAccounts(await store.get(String(key), "[]")).length;
      if (count) lines.push(`${platform}: ${count}`);
      total += count;
    }
    lines.push(`合计: ${total}`);
    return s.reply(lines.join("\n"));
  }

  function accountStore(platform) {
    return new Bucket(`${spec.prefix}${platform}`);
  }
  return { main, Config, Task };
}

class Task {
  constructor(index, account, spec, runtime) {
    this.index = index;
    this.account = account;
    this.spec = spec;
    this.runtime = runtime;
    this.name = account.name;
    this.password = account.pwd;
    this.host = "https://vapp.tmuyun.com";
    this.tenantId = spec.tenantId;
    this.clientId = spec.clientId;
    this.signatureSalt = "FR*r!isE5W";
    this.jinhuaAppId = spec.jinhuaAppId;
    this.jinhuaKey = spec.jinhuaKey;
    this.jinhuaToken = "";
    this.sessionId = "";
    this.accountId = "";
    this.signatureKey = "";
    this.authorizationCode = "";
    this.studyId = "";
    this.lotteryId = "";
    this.uuid = crypto.randomUUID();
    this.deviceId = this.uuid;
    this.message = `【账号备注】：${maskPhone(this.name)}`;
    const models = [
      "M1903F2A",
      "M2001J2E",
      "M2102K1C",
      "2107119DC",
      "2201123C",
      "2304FPN6DC",
      "23127PN0CC",
      "24031PN0DC",
    ];
    const model = models[Math.floor(Math.random() * models.length)];
    this.ua = `ANDROID;11;${this.clientId};1.7.0;1.0;null;${model}`;
    this.commonUa = `1.7.0;${this.uuid};Xiaomi ${model};Android;11;Release;6.12.0`;
  }

  async run() {
    try {
      if (!(await this.init())) return this.fail("init失败");
      if (!(await this.getSignatureKey())) return this.fail("获取signature_key失败");
      if (!(await this.credentialAuth())) return this.fail("账号密码认证失败");
      if (!(await this.login())) return this.fail("天目云登录失败");
      await this.loadStudyId();
      if (await this.jinhuaLogin()) await this.jinhuaDetail();
      this.message += "\n---------积分阅读----------";
      await this.taskList();
      this.message += "\n---------查询资产----------";
      await this.accountDetail();
      if (this.runtime.tip) this.message += `\n${this.runtime.tip}`;
      return { ok: true, message: this.message, sessionId: this.sessionId, accountId: this.accountId };
    } catch (error) {
      return this.fail(vorto.errorText(error));
    }
  }

  fail(reason) {
    this.message += `\n【执行失败】：${reason}`;
    return { ok: false, message: this.message, sessionId: this.sessionId, accountId: this.accountId };
  }
  signPath(path) {
    const timestamp = Date.now(),
      requestId = crypto.randomUUID(),
      clean = path.split("?")[0];
    return {
      timestamp,
      requestId,
      signature: sha256(
        `${clean}&&${this.sessionId}&&${requestId}&&${timestamp}&&${this.signatureSalt}&&${this.tenantId}`,
      ),
    };
  }
  commonHeaders(path) {
    const sign = this.signPath(path);
    return {
      "x-timestamp": String(sign.timestamp),
      "x-session-id": this.sessionId,
      "x-request-id": sign.requestId,
      "x-signature": sign.signature,
      "x-tenant-id": this.tenantId,
      "x-account-id": this.accountId,
      "cache-control": "no-cache",
      "user-agent": this.commonUa,
    };
  }

  async commonGet(path) {
    return this.json(new URL(path, this.host), { headers: this.commonHeaders(path) });
  }
  async commonPost(path, form) {
    return this.json(new URL(path, this.host), { method: "POST", headers: this.commonHeaders(path), form });
  }

  jinhuaSignature(params) {
    const timestamp = Date.now(),
      nonce = crypto.randomUUID();
    const all = {
      app_id: this.jinhuaAppId,
      device_id: this.deviceId,
      nonce_str: nonce,
      source_type: "app",
      timestamp,
      auth_id: this.accountId,
      token: this.sessionId,
      ...params,
    };
    return {
      timestamp,
      nonce,
      signature: sha256(
        Object.keys(all)
          .sort()
          .map((key) => `${key}=${all[key]}`)
          .join("&&") + `&&${this.jinhuaKey}`,
      ),
    };
  }
  jinhuaHeaders(params) {
    const sign = this.jinhuaSignature(params);
    return {
      "access-type": "app",
      "access-module": "study",
      "access-device-id": this.deviceId,
      "access-auth-id": this.accountId,
      "access-api-signature": sign.signature,
      "access-nonce-str": sign.nonce,
      authorization: this.jinhuaToken,
      "access-app-id": this.jinhuaAppId,
      "access-timestamp": String(sign.timestamp),
      "access-api-token": this.sessionId,
      "content-type": "application/json; charset=UTF-8",
      origin: "https://op-h5.cloud.jinhua.com.cn",
      referer: "https://op-h5.cloud.jinhua.com.cn/",
      "user-agent": this.spec.jinhuaUa,
    };
  }
  async jinhuaGet(path, params) {
    return this.json(new URL(path, "https://op-api.cloud.jinhua.com.cn"), { headers: this.jinhuaHeaders(params) });
  }
  async jinhuaPost(path, body) {
    return this.json(new URL(path, "https://op-api.cloud.jinhua.com.cn"), {
      method: "POST",
      headers: this.jinhuaHeaders(body),
      json: body,
    });
  }

  async init() {
    const result = await this.commonPost("/api/account/init");
    if (Number(result?.code) !== 0) return false;
    this.sessionId = result.data?.session?.id || "";
    return Boolean(this.sessionId);
  }
  async getSignatureKey() {
    const result = await this.json(new URL(`/web/init?client_id=${this.clientId}`, "https://passport.tmuyun.com"), {
      headers: { "x-request-id": crypto.randomUUID(), "user-agent": this.ua },
    });
    if (Number(result?.code) !== 0) return false;
    this.signatureKey = result.data?.client?.signature_key || "";
    return Boolean(this.signatureKey);
  }
  async credentialAuth() {
    const encrypted = crypto
      .publicEncrypt({ key: PUBLIC_KEY, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(this.password))
      .toString("base64");
    const raw = `client_id=${this.clientId}&password=${encrypted}&phone_number=${this.name}`;
    const signature = crypto
      .createHmac("sha256", this.signatureKey)
      .update(`post%%/web/oauth/credential_auth?${raw}%%${this.uuid}%%`)
      .digest("hex");
    const result = await this.json(new URL("/web/oauth/credential_auth", "https://passport.tmuyun.com"), {
      method: "POST",
      headers: { "x-request-id": this.uuid, "x-signature": signature, "user-agent": this.ua },
      form: { client_id: this.clientId, password: encrypted, phone_number: this.name },
    });
    if (Number(result?.code) !== 0) return false;
    this.authorizationCode = result.data?.authorization_code?.code || "";
    return Boolean(this.authorizationCode);
  }
  async login() {
    const result = await this.commonPost("/api/zbtxz/login", {
      check_token: "",
      code: this.authorizationCode,
      token: "",
      type: -1,
      union_id: "",
    });
    if (Number(result?.code) !== 0) {
      this.message += `\n【登陆状态】：登陆失败${JSON.stringify(result)}`;
      return false;
    }
    this.accountId = result.data?.session?.account_id || "";
    this.sessionId = result.data?.session?.id || this.sessionId;
    const account = result.data?.account || {};
    this.message += `\n【登陆状态】：登陆成功✅\n【用户昵称】：${account.nick_name || ""}\n【用户编码】：${account.ref_user_code || ""}\n【绑定手机】：${maskPhone(account.mobile || this.name)}\n【邀请数量】：${account.invitation_number ?? 0}`;
    return true;
  }
  async loadStudyId() {
    const path = `/api/article/channel_list?channel_id=${this.spec.configChannelId}&isDiFangHao=false&is_new=true&list_count=0&size=${this.spec.configSize}`;
    const result = await this.commonGet(path);
    let url = "";
    if (this.spec.configMode === "focus") {
      const articleId = result?.data?.focus_list?.[0]?.channel_article_id;
      if (articleId)
        url = (await this.commonGet(`/api/article/detail?id=${articleId}`))?.data?.article?.share_url || "";
    } else url = result?.data?.article_list?.[0]?.column_news_list?.[0]?.url || "";
    if (url) this.studyId = new URL(url).searchParams.get("id") || "";
  }
  async jinhuaLogin() {
    const result = await this.jinhuaPost("/api/member/login", { debug: 0, userId: "" });
    if (Number(result?.code) !== 0) return false;
    this.jinhuaKey = result.data?.key || this.jinhuaKey;
    this.jinhuaToken = `Bearer ${result.data?.token || ""}`;
    return true;
  }

  async jinhuaDetail() {
    if (!this.studyId) return false;
    const result = await this.jinhuaGet(`/api/study/detail?id=${this.studyId}`, { id: this.studyId });
    if (Number(result?.code) !== 0) return false;
    this.lotteryId = result.data?.lottery?.lottery_id;
    for (const level of result.data?.levels || []) {
      const levelResult = await this.jinhuaGet(`/api/study/level?id=${level.id}`, { id: level.id });
      if (Number(levelResult?.code) !== 0) continue;
      this.message += "\n---------抽奖阅读----------";
      const data = levelResult.data || {};
      if (data.level?.task_num === (data.completedTasks || []).length) {
        this.message += "\n今日阅读已全部完成✅";
        continue;
      }
      for (const task of data.tasks || []) {
        if (this.spec.visitStudyArticles && task.link) await this.visitStudyArticle(task.link);
        const completed = await this.jinhuaPost("/api/study/task/complete", { id: task.id });
        this.message += `\n文章[${task.id}]：${completed?.message || ""}`;
      }
    }
    return this.drawLottery();
  }
  async visitStudyArticle(link) {
    let id = "";
    try {
      id = new URL(link).searchParams.get("id") || "";
    } catch (_) {}
    if (!id) return;
    await this.commonGet(`/api/article/detail?id=${id}`);
    await this.commonPost("/api/favorite/like", { action: true, id });
    await this.commonGet(`/api/article/read_time?channel_article_id=${id}&read_time=5938`);
  }
  async drawLottery() {
    this.message += "\n---------抽奖----------";
    if (!this.lotteryId) return false;
    const countResult = await this.jinhuaPost("/api/lotterybigwheel/_ac_lottery_count", {
      id: this.lotteryId,
      module: "study",
    });
    const count = Number(countResult?.data?.count || 0);
    this.message += `\n抽奖次数：${count}`;
    for (let index = 0; index < count; index++) {
      let draw = await this.jinhuaPost("/api/lotterybigwheel/_ac_lottery", {
        id: this.lotteryId,
        app_id: this.jinhuaAppId,
        module: "study",
        optionHash: "",
      });
      if (Number(draw?.code) === 10000) draw = await this.solveCaptchaAndDraw(index);
      if (Number(draw?.code) === 0)
        this.message += `\n第${index + 1}次抽奖成功：${prizeText(draw.data, this.spec.prizeMode)}`;
    }
    return true;
  }
  async solveCaptchaAndDraw(index) {
    this.message += `\n第${index + 1}次抽奖遇到滑块，开始自动验证`;
    if (!this.runtime.ocrHost) {
      this.message += "\n未配置ddddocr服务";
      return null;
    }
    const captcha = await this.jinhuaPost("/api/captcha/get", { activity_id: this.lotteryId, module: "bigWheel" });
    if (Number(captcha?.code) !== 0) return null;
    const ocr = await this.json(new URL("/capcode", this.runtime.ocrHost), {
      method: "POST",
      json: { slidingImage: captcha.data.jigsawImageUrl, backImage: captcha.data.originalImageUrl },
    });
    if (ocr?.result === undefined) return null;
    const point = aesBase64(JSON.stringify({ x: ocr.result, y: 5 }), captcha.data.secretKey);
    const check = await this.jinhuaPost("/api/captcha/check", {
      activity_id: this.lotteryId,
      module: "bigWheel",
      cap_token: captcha.data.token,
      point,
    });
    if (check?.message !== "操作成功") return null;
    return this.jinhuaPost("/api/lotterybigwheel/_ac_lottery", {
      id: this.lotteryId,
      app_id: this.jinhuaAppId,
      module: "study",
      optionHash: "",
    });
  }

  async taskList() {
    const result = await this.commonGet("/api/user_center/task?type=1&current=1&size=20");
    if (!result?.data?.list) return false;
    let read = false,
      like = false,
      share = false;
    for (const task of result.data.list) {
      this.message += `\n【${task.name}】：${Number(task.completed) === 1 ? "已完成" : "未完成，开始去完成"}`;
      if (Number(task.completed) === 1) continue;
      if (task.name === "新闻资讯阅读") read = true;
      if (task.name === "新闻资讯点赞") like = true;
      if (task.name === "分享资讯给好友") share = true;
      if (this.spec.localServiceTask && task.name === "使用本地服务")
        await this.commonPost("/api/user_mumber/doTask", { memberType: 6, member_type: 6 });
    }
    if (!(read || like || share)) return true;
    const path = `/api/article/channel_list?channel_id=${this.spec.taskChannelId}&isDiFangHao=false&is_new=true&list_count=0&size=${this.spec.taskSize}`;
    const articles = (await this.commonGet(path))?.data?.article_list || [];
    for (const article of articles) {
      const id = article.id;
      if (read) {
        const result = await this.commonGet(
          `/api/article/read_time?channel_article_id=${id}&is_end=true&read_time=3051`,
        );
        if (result?.data?.score_notify?.integral)
          this.message += `\n阅读文章【${id}】:获得${result.data.score_notify.integral}积分`;
      }
      if (like) {
        const result = await this.commonPost("/api/favorite/like", { action: true, id });
        if (result?.data?.score_notify?.integral)
          this.message += `\n点赞文章【${id}】:获得${result.data.score_notify.integral}积分`;
      }
      if (share) {
        const result = await this.commonPost("/api/user_mumber/doTask", {
          memberType: "3",
          member_type: "3",
          target_id: id,
        });
        if (result?.data?.score_notify?.integral)
          this.message += `\n分享文章【${id}】:获得${result.data.score_notify.integral}积分`;
      }
    }
    return true;
  }
  async accountDetail() {
    const result = await this.commonGet("/api/user_mumber/account_detail");
    if (result?.data?.rst) this.message += `\n【积分余额】：${result.data.rst.total_integral ?? 0}`;
  }

  async json(url, options = {}) {
    const result = await httpText(url, {
      ...options,
      timeout: this.runtime.timeout,
      dispatcher: this.runtime.dispatcher,
    });
    try {
      return JSON.parse(result);
    } catch (_) {
      throw new Error(`接口返回非JSON：${String(result).slice(0, 120)}`);
    }
  }
}

async function httpText(url, options = {}) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), options.timeout || 30000);
  const headers = { ...(options.headers || {}) };
  let body = options.body;
  if (options.json !== undefined) {
    body = JSON.stringify(options.json);
    headers["content-type"] ||= "application/json";
  }
  if (options.form !== undefined) {
    body = new URLSearchParams(Object.entries(options.form).filter(([, value]) => value !== undefined)).toString();
    headers["content-type"] ||= "application/x-www-form-urlencoded;charset=UTF-8";
  }
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers,
      body,
      signal: controller.signal,
      dispatcher: options.dispatcher || undefined,
    });
    const text = await response.text();
    if (response.status >= 400) throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
    return text;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("请求超时");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function validateSpec(spec) {
  for (const key of [
    "name",
    "prefix",
    "tenantId",
    "clientId",
    "jinhuaAppId",
    "jinhuaKey",
    "configChannelId",
    "taskChannelId",
    "defaultEnvName",
    "adminRunCommand",
    "jinhuaUa",
  ])
    if (!spec?.[key]) throw new Error(`天目云运行参数缺失：${key}`);
}
function parseAccounts(raw) {
  const rows = vorto.parseStoredList(raw);
  return rows
    .filter((item) => item && typeof item.name === "string" && typeof item.pwd === "string")
    .map((item) => ({ ...item, disable: item.disable || "n", expire: item.expire || addDays(30) }));
}
function normalizeRows(value) {
  return Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : [];
}
function maskPhone(value) {
  const text = String(value || "");
  return text.length === 11 ? `${text.slice(0, 3)}****${text.slice(-4)}` : vorto.maskAccount(text);
}
function today() {
  return formatDate(new Date());
}
function maxDate(value) {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? new Date(`${value}T00:00:00`) : new Date();
  return parsed > new Date() ? parsed : new Date();
}
function addDays(days, start = new Date()) {
  const date = new Date(start);
  date.setDate(date.getDate() + days);
  return formatDate(date);
}
function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}
function aesBase64(value, key) {
  const cipher = crypto.createCipheriv("aes-128-ecb", Buffer.from(String(key), "utf8"), null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]).toString("base64");
}
function prizeText(data, mode) {
  if (mode === "title") return String(data?.title || data?.tip_text || "未知奖励");
  return data?.code
    ? `${data.tip_text || ""},${data.goods_title || ""}`.replace(/^,|,$/g, "")
    : String(data?.tip_text || data?.title || "未知奖励");
}
function normalizeProxy(value) {
  const text = String(value).trim();
  if (/^https?:\/\//i.test(text)) return text;
  return `http://${text}`;
}
function boolValue(value) {
  return value === true || /^(true|1|y|yes|on)$/i.test(String(value));
}
function clampInt(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

module.exports = { createRuntime, Task };
