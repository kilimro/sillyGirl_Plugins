// [title: 泰康管理]
// [name: taiKangGuanLi]
// [desc: 泰康账号unionId/openId校验、积分查询、授权支付、青龙或DumbPanel同步、账号清理，并保留签到/步数挑战/答题/任务API。]
// [author: rujingxianghai]
// [version: v3.0.2]
// [rule: raw ^(泰康|tk)(登录|登陆)$|^登(录|陆)(泰康|tk)$|^(泰康|tk)(查询|管理|授权|检测|教程)$]
// [cron: 0 5 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/泰康管理_v3.0_By.rujingxianghai.py]
// [depe: ["./vortoUtils.js"]]

const crypto = require("node:crypto");
const { sender: s, Bucket, plugin, utils, console } = require("sillygirl");
const vorto = require("./vortoUtils");

const configStore = new Bucket("s_tkzx");
const userStore = new Bucket("s_tkzx_user");
const tokenStore = new Bucket("s_tkzx_token");
const authStore = new Bucket("s_tkzx_auth");
const pointsStore = new Bucket("dd_sign_points");
const Config = new plugin.Form({
  osname: plugin.Form.string().title("面板变量名").default("S_TKRS"),
  qlname: plugin.Form.string()
    .title("独立面板配置")
    .description("Host丨ClientID丨ClientSecret；留空使用Vorto配置/青龙容器")
    .default(""),
  use_daipanel: plugin.Form.boolean().title("使用DumbPanel").default(false),
  panel_group: plugin.Form.string().title("DumbPanel分组").default("").visibleWhen("use_daipanel", "==", true),
  vip_money: plugin.Form.number().title("每账号每月价格").min(0).default(1),
  coin: plugin.Form.integer().title("每账号每月积分").min(0).default(0),
  notify: plugin.Form.string().title("通知渠道").default(""),
  notify_days: plugin.Form.integer().title("提前提醒天数").min(0).max(365).default(3),
  request_timeout_ms: plugin.Form.integer().title("接口超时毫秒").min(3000).max(120000).default(30000),
});

let runtime = {
  osname: "S_TKRS",
  qlname: "",
  useDumbPanel: false,
  panelGroup: "",
  vipMoney: 1,
  coin: 0,
  timeout: 30000,
};

class TaikangOnline {
  constructor(unionId, openId) {
    this.baseUrl = "https://m.tk.cn";
    this.unionId = String(unionId || "");
    this.openId = String(openId || "");
    this.deviceId =
      "WC39ZUyXRgdExSj90tOeGomyOuuFeIVfnoBh4K6/N2S6+cPQvxZzEMpX4YkYGt7bl61lJVmGniEtWjSm22hAKQUL4jL6rQD4StL/WmrP2Tauiuo9Z2Nzm4Q==1487577677129";
    this.headers = {
      connection: "keep-alive",
      xweb_xhr: "1",
      accept: "*/*",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/107.0.0.0 Safari/537.36 MicroMessenger/6.8.0 MiniProgramEnv/Mac",
      referer: "https://servicewechat.com/wx9e3e7020c4a10356/280/page-frame.html",
      "accept-language": "zh-CN,zh;q=0.9",
    };
  }

  encrypt(plainText, key = "EEue2kxI0oh2GBJh") {
    const cipher = crypto.createCipheriv("aes-128-ecb", Buffer.from(key, "utf8"), null);
    cipher.setAutoPadding(true);
    return Buffer.concat([cipher.update(String(plainText), "utf8"), cipher.final()])
      .toString("hex")
      .toUpperCase();
  }

  signature(clientId = "ytngbmji", md5Key = "f2fc9b5e36E90745AB79") {
    const nonStr = crypto.randomUUID(),
      timestamp = Date.now(),
      minute = 60000 * Math.floor(timestamp / 60000);
    const once = md5(`${clientId}${nonStr}${minute}${md5Key}`),
      sign = md5(once);
    return this.encrypt(JSON.stringify({ clientId, nonStr, timestamp, sign }), "xdh3OmA5gEMMy0Mz");
  }

  getFSign() {
    const timestamp = Date.now(),
      nonStr = `${timestamp}${crypto.randomBytes(6).toString("base64url").toLowerCase().slice(0, 8)}`;
    const once = md5(`zehsmfluqja${nonStr}${60000 * Math.floor(timestamp / 60000)}d0ZGEyNGM4MmI3ODZOVE`);
    return this.encrypt(
      JSON.stringify({ clientId: "zehsmfluqja", nonStr, timestamp, sign: md5(once) }),
      "xdh3OmA5gEMMy0Mz",
    );
  }

  async post(path, payload, options = {}) {
    try {
      const headers = Object.assign({}, this.headers, options.headers || {});
      if (options.signed) headers.Signature = this.signature();
      return (
        await vorto.requestJson(new URL(path, this.baseUrl), {
          method: "POST",
          headers,
          json: payload,
          form: options.form,
          timeout: runtime.timeout,
        })
      ).data;
    } catch (error) {
      console.log(`泰康接口 ${path} 失败：${vorto.errorText(error)}`);
      return null;
    }
  }

  async getMemberInfo(unionId = this.unionId) {
    const params = `api_s=member.userbind&api_m=selectwxbindbybindid&params=${encodeURIComponent(JSON.stringify({ platform: "APPLET", fromid: "71672", bindid: unionId }))}`;
    const response = await this.post("/member_api/", undefined, {
      form: Object.fromEntries(new URLSearchParams(params)),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    return response?.data?.token && response?.data?.memberid
      ? { token: response.data.token, memberId: response.data.memberid }
      : null;
  }

  async getNickname(memberId, token) {
    const response = await this.post("/activity_execute/rest/membergoldbean/getMemberGoldbeanNickName", {
      enc: true,
      encData: this.encrypt(JSON.stringify({ memberId, token })),
    });
    return String(response?.data?.nickName || "");
  }

  async getPoints(memberId, token, nickname, openId = this.openId) {
    const body = {
      memberid: memberId,
      token,
      coordinate: "",
      platform: "WECHAT",
      nickName: Buffer.from(nickname).toString("base64"),
      openId,
      fromid: "71672",
      deviceId: this.deviceId,
    };
    const response = await this.post(
      "/activity_execute/rest/membergoldbean/mainPage",
      { enc: true, encData: this.encrypt(JSON.stringify(body)) },
      { signed: true },
    );
    return response?.data ? (response.data.allbeans ?? 0) : null;
  }

  async getPointsInfo() {
    const member = await this.getMemberInfo();
    if (!member) return null;
    const nickname = await this.getNickname(member.memberId, member.token);
    return this.getPoints(member.memberId, member.token, nickname);
  }

  async signIn(memberId, token, unionId, nickname) {
    const body = {
      memberid: memberId,
      token,
      unionid: unionId,
      deviceId: this.deviceId,
      fromid: "71672",
      platform: "WECHAT",
      coordinate: "",
      nickName: Buffer.from(nickname).toString("base64"),
    };
    const response = await this.post("/activity_execute/rest/membergoldbean/sign", {
      enc: true,
      encData: this.encrypt(JSON.stringify(body)),
    });
    return Number(response?.error_code) === 0;
  }

  async walkingChallenge(memberId, token) {
    await this.post(
      "/promotion/activity_execute/rest/springOuting/openChallenge",
      { enc: true, encData: this.encrypt(JSON.stringify({ platform: "WECHAT", memberId, token, openStatus: "Y" })) },
      { signed: true },
    );
    for (const taskNum of ["dailyOneK", "dailyFiveK", "dailyTenK"]) {
      const body = { platform: "WECHAT", memberId, token, fromId: "71672", deviceId: this.deviceId, taskNum };
      await this.post(
        "/promotion/activity_execute/rest/springOuting/draw",
        { enc: true, encData: this.encrypt(JSON.stringify(body)) },
        { signed: true },
      );
    }
  }

  async answerQuestion(memberId, token, unionId = this.unionId, openId = this.openId) {
    const start = { memberId, token, unionId, xcxOpenId: openId, fromId: "72474", platform: "APPLET" };
    const page = await this.post(
      "/promotion/activity_execute/rest/tk/answer/mainPage",
      { enc: true, encData: this.encrypt(JSON.stringify(start)) },
      { signed: true },
    );
    const answer = page?.data?.questionDetail?.answer;
    if (answer === undefined) return false;
    const body = {
      memberId,
      token,
      result: answer,
      deviceId: this.deviceId,
      os: "weapp",
      platform: "APPLET",
      fromId: "72474",
    };
    await this.post(
      "/promotion/activity_execute/rest/tk/answer/answer",
      { enc: true, encData: this.encrypt(JSON.stringify(body)) },
      { signed: true },
    );
    await this.saveEvent(memberId, token, "ANSWER");
    return true;
  }

  async executeTasks(memberId, token) {
    const response = await this.post("/activity_execute/rest/membergoldbean/queryTask", {
      enc: true,
      encData: this.encrypt(JSON.stringify({ memberid: memberId, token, platform: "WECHAT" })),
    });
    for (const task of response?.data || []) {
      if (task?.status === "Y") continue;
      await this.saveEvent(memberId, token, task.taskCode);
      if (task.taskToken)
        await this.post("/activity_execute/rest/callback/taskCallBack", { memberId, taskToken: task.taskToken });
    }
  }

  saveEvent(memberId, token, eventType) {
    const body = {
      memberId,
      token,
      eventType,
      activityCode: "membergoldbean",
      activityId: "",
      assignmentId: "",
      assignmentType: "",
    };
    return this.post("/activity_execute/rest/noseEvent/saveNoseEventLog", {
      enc: true,
      encData: this.encrypt(JSON.stringify(body)),
    });
  }
}

async function main() {
  runtime = await loadConfig();
  const content = String((await s.getMsg()) || "").trim();
  if (!content) return authCheck(true);
  if (/登录|登陆/.test(content)) return bindAccount();
  if (/查询/.test(content) && /(泰康|tk)/i.test(content)) return queryAccounts();
  if (/管理/.test(content) && /(泰康|tk)/i.test(content)) return manageAccounts();
  if (/教程/.test(content) && /(泰康|tk)/i.test(content)) return showTutorial();
  if (/^(泰康|tk)授权$/i.test(content)) return adminAuthorize();
  if (/^(泰康|tk)检测$|^检测泰康$/i.test(content)) return authCheck(false);
  return s.resume();
}

async function loadConfig() {
  const form = (await Config.get()) || {},
    legacy = await configStore.getAll();
  const pick = (formKey, legacyKey, fallback) =>
    legacy?.[legacyKey] !== undefined && legacy[legacyKey] !== ""
      ? legacy[legacyKey]
      : form[formKey] !== undefined
        ? form[formKey]
        : fallback;
  const cfg = {
    osname: String(pick("osname", "osname", "S_TKRS")),
    qlname: String(pick("qlname", "qlname", "")),
    useDumbPanel: boolValue(pick("use_daipanel", "use_daipanel", false)),
    panelGroup: String(pick("panel_group", "panel_group", "")),
    vipMoney: Math.max(0, Number(pick("vip_money", "Vipmoney", 1)) || 0),
    coin: Math.max(0, Number.parseInt(pick("coin", "coin", 0), 10) || 0),
    notify: String(pick("notify", "notify", "")),
    notifyDays: Math.max(0, Number.parseInt(pick("notify_days", "notify_days", 3), 10) || 3),
    timeout: Math.max(3000, Math.min(120000, Number.parseInt(form.request_timeout_ms, 10) || 30000)),
  };
  await Promise.all([
    configStore.set("osname", cfg.osname),
    configStore.set("use_daipanel", String(cfg.useDumbPanel)),
    configStore.set("panel_group", cfg.panelGroup),
    configStore.set("Vipmoney", String(cfg.vipMoney)),
    configStore.set("coin", String(cfg.coin)),
    configStore.set("notify", cfg.notify),
    configStore.set("notify_days", String(cfg.notifyDays)),
  ]);
  return cfg;
}

function panelClient() {
  const explicit = runtime.qlname || undefined;
  return runtime.useDumbPanel
    ? new vorto.DumbPanelClient(runtime.osname, explicit)
    : new vorto.QingLongClient(runtime.osname, explicit);
}
async function updatePanel(account, info) {
  if (!info?.unionId || !info?.openId) return false;
  const expires = await authStore.get(String(account), "未授权");
  return panelClient().updateEnv(
    String(account),
    `${info.unionId}#${info.openId}`,
    `泰康:${account}|到期:${expires}`,
    runtime.panelGroup,
  );
}
async function deletePanel(account) {
  return panelClient().deleteEnv(String(account));
}

async function bindAccount() {
  const input = await vorto.prompt(s, '=====泰康登录=====\n请输入 unionId#openId\n回复"q"退出', 120000);
  if (input === null) return s.reply("✅ 已取消或操作超时");
  const parts = input.split("#");
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim())
    return s.reply("=====格式错误=====\n❌ 格式: unionId#openId\n==================");
  const [unionId, openId] = parts.map((value) => value.trim());
  const member = await new TaikangOnline(unionId, openId).getMemberInfo();
  if (!member) return s.reply("=====数据无效=====\n❌ 无法验证数据有效性，请检查unionId和openId\n==================");
  const userId = await currentUserId(),
    accounts = await loadAccounts(userId),
    isNew = !accounts.includes(unionId);
  if (isNew) accounts.push(unionId);
  const info = { unionId, openId };
  await tokenStore.set(unionId, JSON.stringify(info));
  await saveAccounts(userId, accounts);
  const expires = vorto.extractExpireDate(await authStore.get(unionId, ""));
  let panel = "⚠️ 未授权，未提交面板";
  if (expires && expires >= today()) panel = (await updatePanel(unionId, info)) ? "✅ 已提交面板" : "❌ 面板提交失败";
  return s.reply(
    `=====绑定成功=====\n📱 账号: ${vorto.maskAccount(unionId)}\n🔐 状态: ✅ 已${isNew ? "添加" : "更新"}\n📦 面板: ${panel}\n⏰ 发送 泰康管理 可管理账号\n==================`,
  );
}

async function queryAccounts() {
  const selected = await chooseUserAccounts();
  if (!selected) return;
  await s.reply(`✅ 已选择 ${selected.length} 个账号，正在查询...`);
  for (let index = 0; index < selected.length; index++) {
    const account = selected[index],
      info = vorto.parseStoredObject(await tokenStore.get(account, "{}"));
    if (!info.unionId || !info.openId) {
      await s.reply(`=====查询失败=====\n❌ ${vorto.maskAccount(account)} 数据丢失\n==================`);
      continue;
    }
    const expires = vorto.extractExpireDate(await authStore.get(account, ""));
    const status = expires && expires >= today() ? "✅ 已授权" : expires ? "❌ 已过期" : "⚠️ 未授权";
    const points = await new TaikangOnline(info.unionId, info.openId).getPointsInfo();
    await s.reply(
      `=====账号信息[${index + 1}/${selected.length}]=====\n📱 账号: ${vorto.maskAccount(account)}\n🏷 状态: ${status}\n📅 到期: ${expires || "未授权"}${points === null ? "" : `\n💎 当前积分: ${points}`}\n==================`,
    );
  }
  return s.reply("✅ 查询完成");
}

async function manageAccounts() {
  const userId = await currentUserId();
  let accounts = await loadAccounts(userId);
  if (!accounts.length) return s.reply("=====未绑定账号=====\n❌ 未找到账号\n==================");
  const action = await vorto.prompt(
    s,
    '=====账号管理=====\n[1] 授权账号\n[2] 删除账号\n[3] 提交面板\n回复"q"退出',
    120000,
  );
  if (action === null) return s.reply("✅ 已退出");
  if (action === "1") {
    const selected = await choose(accounts);
    if (selected) await authorizeAccounts(selected);
    return;
  }
  if (action === "2") {
    const selected = await choose(accounts, false);
    if (!selected) return;
    const confirm = await vorto.prompt(
      s,
      `=====确认删除=====\n⚠️ 将删除 ${selected.length} 个账号\n回复 y 确认`,
      120000,
      false,
    );
    if (String(confirm).toLowerCase() !== "y") return s.reply("✅ 已取消");
    let success = 0;
    for (const account of selected) {
      await deletePanel(account);
      await tokenStore.delete(account);
      await authStore.delete(account);
      accounts = accounts.filter((item) => item !== account);
      success++;
    }
    await saveAccounts(userId, accounts);
    return s.reply(`=====删除完成=====\n✅ 成功: ${success}个\n==================`);
  }
  if (action === "3") {
    let success = 0;
    const failed = [];
    for (const account of accounts) {
      const info = vorto.parseStoredObject(await tokenStore.get(account, "{}")),
        expires = vorto.extractExpireDate(await authStore.get(account, ""));
      if (!expires || expires < today()) {
        failed.push(`${vorto.maskAccount(account)} 未授权`);
        continue;
      }
      if (await updatePanel(account, info)) success++;
      else failed.push(`${vorto.maskAccount(account)} 提交失败`);
    }
    return s.reply(
      `=====提交完成=====\n✅ 成功: ${success}个${failed.length ? `\n❌ 失败: ${failed.length}个\n${failed.join("\n")}` : ""}\n==================`,
    );
  }
  return s.reply("❌ 无效选择");
}

async function authorizeAccounts(selected) {
  const rows = [];
  for (const account of selected) {
    const info = vorto.parseStoredObject(await tokenStore.get(account, "{}"));
    if (info.unionId && info.openId) rows.push({ account, info });
  }
  if (!rows.length) return s.reply("❌ 没有有效账号");
  const monthText = await vorto.prompt(s, `✅ ${rows.length} 个有效账号\n请输入授权月数(如:1)`, 120000);
  if (monthText === null) return s.reply("✅ 已取消");
  if (!/^\d+$/.test(monthText) || Number(monthText) <= 0) return s.reply("❌ 月数必须大于0");
  const months = Number(monthText),
    totalMoney = roundMoney(rows.length * months * runtime.vipMoney),
    paid = await takePayment(rows.length, months, totalMoney);
  if (!paid) return;
  const success = [],
    failed = [];
  for (const row of rows) {
    try {
      const expires = await vorto.calculateAuthTime("s_tkzx_auth", row.account, { months });
      await authStore.set(row.account, expires);
      await updatePanel(row.account, row.info);
      success.push(`${vorto.maskAccount(row.account)} → ${expires}`);
    } catch (error) {
      failed.push(`${vorto.maskAccount(row.account)} ${vorto.errorText(error)}`);
    }
  }
  return s.reply(
    `=====授权完成=====\n✅ 成功: ${success.length}个\n${success.join("\n")}${failed.length ? `\n❌ 失败: ${failed.length}个\n${failed.join("\n")}` : ""}\n==================`,
  );
}

async function takePayment(accountCount, months, totalMoney) {
  const payConfig = await vorto.getPayConfig(),
    methods = [];
  if (payConfig.qr_pay_switch) methods.push(["扫码支付", "qrcode"]);
  if (payConfig.ma_pay_switch)
    for (const [key, name] of Object.entries(payConfig.pay_types)) methods.push([`${name}(码支付)`, `mapay_${key}`]);
  if (runtime.coin > 0) methods.push(["积分兑换", "coin"]);
  if (!methods.length) {
    await s.reply("❌ 未配置支付方式");
    return false;
  }
  const choice = await vorto.prompt(
    s,
    `=====选择支付方式=====\n💰 总价: ${totalMoney}元(${accountCount}个×${months}月×${runtime.vipMoney}元)\n${methods.map((item, index) => `[${index + 1}] ${item[0]}`).join("\n")}`,
    120000,
  );
  if (choice === null) {
    await s.reply("✅ 已取消");
    return false;
  }
  const method = methods[Number(choice) - 1];
  if (!method) {
    await s.reply("❌ 无效选择");
    return false;
  }
  if (method[1] === "coin") {
    const userId = await currentUserId(),
      required = accountCount * months * runtime.coin,
      balance = Number.parseInt(await pointsStore.get(userId, "0"), 10) || 0;
    if (balance < required) {
      await s.reply(`=====积分不足=====\n❌ 当前: ${balance}\n💰 需要: ${required}\n==================`);
      return false;
    }
    await pointsStore.set(userId, String(balance - required));
    return true;
  }
  if (method[1] === "qrcode") {
    if (totalMoney === 0) return true;
    if (!payConfig.zsm) {
      await s.reply("❌ 未配置收款码");
      return false;
    }
    await s.reply(
      `======扫码支付======\n🎫 商品: 泰康授权\n📅 时长: ${months}月\n💰 金额: ${totalMoney}元\n==================`,
    );
    await s.reply(utils.image(payConfig.zsm));
    const event = await vorto.waitPaymentEvent(s, totalMoney, 300000);
    if (!event.paid) await s.reply(event.cancelled ? "✅ 已取消" : "❌ 支付超时、金额不足或支付事件无效");
    return event.paid;
  }
  return maPay(months, totalMoney, method[1].slice(6));
}

async function maPay(months, money, payType) {
  if (money === 0) return true;
  const client = new vorto.MaPayClient(),
    orderNo = `TKZX${compactTime()}${Math.floor(10000 + Math.random() * 90000)}`;
  const order = await client.createOrder(money, payType, orderNo, `泰康授权-${money}`, await currentUserId());
  if (order.error) {
    await s.reply(`❌ 创建订单失败: ${order.error}`);
    return false;
  }
  await s.reply(`=====码支付信息=====\n🎫 商品: 泰康授权\n📅 时长: ${months}月\n💰 金额: ${money}元`);
  await s.reply(utils.image(await vorto.generateQrcodeUrl(order.pay_url)));
  for (let index = 0; index < 60; index++) {
    const child = await s.listen({ timeout: 5000 });
    if (child && /^q$/i.test(String((await child.getMsg()) || "").trim())) {
      await s.reply("✅ 已取消支付");
      return false;
    }
    if (await client.isPaid(orderNo)) {
      await s.reply("✅ 支付成功！");
      return true;
    }
  }
  await s.reply("❌ 支付超时");
  return false;
}

async function adminAuthorize() {
  if (!(await s.isAdmin())) return s.reply("❌ 仅限管理员");
  const choice = await vorto.prompt(s, '=====管理员授权=====\n[1] 授权所有用户\n[2] 按用户授权\n回复"q"退出', 120000);
  if (choice === null) return s.reply("✅ 已退出");
  if (choice === "1") return vorto.adminAuthAllAccounts(s, "s_tkzx_user", "s_tkzx_auth", "s_tkzx_token", updatePanel);
  if (choice === "2") return vorto.adminAuthByUser(s, "s_tkzx_user", "s_tkzx_auth", "s_tkzx_token", updatePanel);
  return s.reply("❌ 无效选择");
}

async function authCheck(cron) {
  if (!cron && !(await s.isAdmin())) return s.reply("❌ 仅限管理员");
  if (!cron) await s.reply("🔍 正在检测...");
  const result = await vorto.checkAuthStatus(
    "s_tkzx",
    "s_tkzx_user",
    "s_tkzx_auth",
    "s_tkzx_token",
    "泰康",
    deletePanel,
    s,
  );
  return cron ? s.pushAdmin(result) : s.reply(result);
}

function showTutorial() {
  return s.reply(
    "=====泰康教程=====\n用户：泰康登录 / 泰康查询 / 泰康管理 / 泰康教程\n管理员：泰康授权 / 泰康检测\n绑定格式：unionId#openId\n==================",
  );
}
async function chooseUserAccounts() {
  const accounts = await loadAccounts(await currentUserId());
  if (!accounts.length) {
    await s.reply("=====未绑定账号=====\n❌ 未找到账号\n💡 发送 泰康登录 绑定\n==================");
    return null;
  }
  return choose(accounts);
}
async function choose(accounts, allowAll = true) {
  const lines = ["========选择账号======="];
  if (allowAll) lines.push("[0] 全部账号");
  for (let index = 0; index < accounts.length; index++) {
    const expires = vorto.extractExpireDate(await authStore.get(accounts[index], ""));
    lines.push(
      `[${index + 1}]${vorto.maskAccount(accounts[index])}(${!expires ? "未授权" : expires < today() ? "已过期" : `到期:${expires}`})`,
    );
  }
  const input = await vorto.prompt(s, `${lines.join("\n")}\n支持多选，用逗号分隔\n回复"q"退出`, 120000);
  if (input === null) {
    await s.reply("✅ 已退出");
    return null;
  }
  const selected = allowAll && input === "0" ? [...accounts] : vorto.parseSelection(input, accounts);
  if (!selected.length) {
    await s.reply("❌ 未选择有效账号");
    return null;
  }
  return selected;
}

async function currentUserId() {
  return String((await s.getUserId()) || "");
}
async function loadAccounts(userId) {
  return vorto.parseStoredList(await userStore.get(String(userId), "[]")).map(String);
}
async function saveAccounts(userId, accounts) {
  return accounts.length ? userStore.set(String(userId), JSON.stringify(accounts)) : userStore.delete(String(userId));
}
function md5(value) {
  return crypto.createHash("md5").update(String(value)).digest("hex");
}
function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function compactTime() {
  const date = new Date();
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}${String(date.getSeconds()).padStart(2, "0")}`;
}
function boolValue(value) {
  return value === true || /^(true|1|yes|on)$/i.test(String(value));
}
function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

main().catch(async (error) => {
  console.log(`泰康管理执行失败：${error?.stack || error}`);
  await s.reply(`泰康管理执行失败：${vorto.errorText(error)}`);
});
