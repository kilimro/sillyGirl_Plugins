// [title: 爱仙居助手]
// [name: aiXianJuZhuShou]
// [desc: 爱仙居图形验证码短信登录或Session/Account批量绑定、红包钱包与抽奖次数查询、授权、青龙同步和账号管理。]
// [author: mrconli / 8165799]
// [version: v1.8.1]
// [rule: raw ^爱仙居(登录|登陆|上车|查询|管理|授权|清理|教程)$]
// [cron: 18 10 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 55]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/m038_爱仙居_v1.5.0_By.mrconli.py;backup/爱仙居_v1.8_By.8165799.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const crypto = require("node:crypto");
const { sender: s, utils } = require("sillygirl");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const VAPP = "https://vapp.tmuyun.com",
  UA0 =
    "Mozilla/5.0 (Linux; Android 14; M2102K1C Build/TP1A.555555.055; wv) AppleWebKit/537.36 Version/4.0 Chrome/130.0.7000.132 Mobile Safari/537.36;xsb_xianju;xsb_xianju;2.1.3;native_app;7.8.0";
function sig(path, session, id, time) {
  const p = path.startsWith("/api/v1") ? path.replace("/api/v1", "") : path;
  return crypto.createHash("sha256").update(`${p}&&${session}&&${id}&&${time}&&FR*r!isE5W&&62`).digest("hex");
}
function parseToken(raw) {
  const p = String(raw).split("#");
  return {
    session: p[0] || "",
    account: p[1] || "",
    ua: p.slice(2).join("#").includes("Mozilla") ? p.slice(2).join("#") : UA0,
  };
}
function mainHeaders(state, path) {
  const id = crypto.randomUUID(),
    time = String(Date.now());
  return {
    "user-agent": state.ua,
    accept: "application/json, text/plain, */*",
    "x-requested-with": "com.increator.cc.xianjusmk",
    "x-tenant-id": "62",
    "x-session-id": state.session,
    "x-request-id": id,
    "x-timestamp": time,
    "x-signature": sig(path, state.session, id, time),
    "x-account-id": state.account,
  };
}
async function main(ctx, state, path, params) {
  const url = new URL(VAPP + path);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const d = await ctx.requestJson(url, { headers: mainHeaders(state, path) });
  if (d?.error) throw new Error(d.error);
  return d;
}
function activityHeaders(state, extra = {}) {
  return {
    "user-agent": state.ua,
    accept: "application/json, text/plain, */*",
    "x-requested-with": "com.increator.cc.xianjusmk",
    "x-tenant-id": "62",
    ...extra,
  };
}
async function act(ctx, state, method, url, headers = {}, json) {
  return ctx.requestJson(url, { method, headers: activityHeaders(state, headers), json });
}
async function info(ctx, state) {
  let mobile = "未知";
  try {
    mobile = String(
      (await main(ctx, state, "/api/user_mumber/numberCenter", { is_new: 1 }))?.data?.rst?.mobile || "未知",
    );
  } catch (_) {}
  const q = "1GwxSBurLoUdKeZiyHuqn7u0cv2qTf081Qj/sdyPH2E=",
    task = await act(
      ctx,
      state,
      "POST",
      "https://act.tmlyun.com/activity-api/task/h5/auth/userLogin",
      { "content-type": "application/json" },
      { q, accountId: state.account, sessionId: state.session, tenantCode: "xsb_xianju" },
    );
  if (!task?.data?.token && mobile === "未知") throw new Error(task?.message || "会话已过期");
  let dynamic = q,
    activityId = 569,
    remain = 0,
    wallet = { alipay: 0, withdraw: 0, total: 0 };
  if (task?.data?.token) {
    try {
      const a = await act(ctx, state, "GET", "https://act.tmlyun.com/activity-api/task/h5/activity/getActivityInfo", {
          authorization: task.data.token,
        }),
        url = a?.data?.activityStyle?.lotteryButtonUrl;
      if (url) dynamic = new URL(url).searchParams.get("q") || dynamic;
    } catch (_) {}
    const lot = await act(
        ctx,
        state,
        "POST",
        "https://act.tmlyun.com/activity-api/lottery/api/auth/userLogin",
        {
          "content-type": "application/json",
          origin: "https://act.tmlyun.com",
          referer: `https://act.tmlyun.com/lottery/?q=${encodeURIComponent(dynamic)}&gaze_open=1`,
        },
        { q: dynamic, accountId: state.account, sessionId: state.session, tenantCode: "xsb_xianju" },
      ),
      lt = lot?.data?.token;
    activityId = lot?.data?.thirdId || activityId;
    if (lt) {
      try {
        remain = Number(
          (
            await act(
              ctx,
              state,
              "GET",
              `https://act.tmlyun.com/activity-api/lottery/h5/activity/lottery/frontPageNum?activityId=${activityId}`,
              { authorization: lt },
            )
          )?.data?.remainPrizeNum || 0,
        );
      } catch (_) {}
      try {
        const jump = await act(
            ctx,
            state,
            "GET",
            "https://act.tmlyun.com/activity-api/lottery/h5/activity/lottery/accountPrizeRecord/jumpEquityWallet",
            {
              authorization: lt,
              referer: `https://act.tmlyun.com/lottery/prizeRecord?q=${encodeURIComponent(dynamic)}`,
            },
          ),
          u = new URL(String(jump?.data || ""), "https://my.tmlyun.com").searchParams.get("u");
        if (u) {
          const auth = await act(
              ctx,
              state,
              "POST",
              "https://my.tmlyun.com/equity-api/user/auth/userLogin",
              { "content-type": "application/json" },
              { u, accountId: state.account, sessionId: state.session },
            ),
            ut = auth?.data?.token;
          if (ut) {
            const device = `00000000-${state.session.slice(0, 4)}-${state.session.slice(4, 8)}-0000-0000${state.account.slice(0, 8)}`,
              w = await act(
                ctx,
                state,
                "GET",
                `https://my.tmlyun.com/equity-api/redBag/getWalletInfo?device=${device}`,
                {
                  authorization: ut,
                  "x-request-id": crypto.randomUUID(),
                  "x-token": "dxA2jxuFFRjq5pngScCY2mol9UwV37AiJRZzxSWH6ZUDF4q+IAHP3vlc1ThxdvFAwoH30tw34I71U5ckf7l56g==",
                },
              ),
              d = Array.isArray(w?.data) ? w.data[0] : {};
            wallet = { total: d?.totalPrice || 0, withdraw: d?.totalTransPrice || 0, alipay: d?.aliPayTotalPrice || 0 };
          }
        }
      } catch (_) {}
    }
  }
  return { mobile, wallet, activityId, remain };
}
function smsHeaders() {
  return {
    "user-agent": UA0,
    accept: "application/json, text/plain, */*",
    "x-request-id": crypto.randomUUID(),
    "x-signature": crypto.createHash("sha256").update(`${crypto.randomUUID()}${Date.now()}`).digest("hex"),
    "x-tenant-id": "62",
    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    "x-requested-with": "com.increator.cc.xianjusmk",
  };
}
function cookies(headers) {
  const raw = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie") || ""];
  return raw
    .filter(Boolean)
    .map((v) => v.split(";", 1)[0])
    .join("; ");
}
async function smsLogin(ctx) {
  const phone = await ctx.prompt(ctx.sender, "请输入11位手机号", 120000);
  if (!/^1[3-9]\d{9}$/.test(String(phone || ""))) throw new Error("手机号格式错误");
  const first = await ctx.request("https://passport.tmuyun.com/web/security/send_security_code", {
      method: "POST",
      headers: smsHeaders(),
      form: { captcha: "0000", client_id: "10016", phone_number: phone },
    }),
    ck = cookies(first.headers),
    image = await ctx.requestBytes("https://passport.tmuyun.com/web/security/captcha_image", {
      headers: { ...smsHeaders(), cookie: ck },
    });
  await ctx.sender.reply("请输入图片验证码");
  await ctx.sender.reply(utils.image(`data:image/jpeg;base64,${image.bytes.toString("base64")}`));
  const cap = await ctx.prompt(ctx.sender, "图片验证码", 120000),
    sent = await ctx.requestJson("https://passport.tmuyun.com/web/security/send_security_code", {
      method: "POST",
      headers: { ...smsHeaders(), cookie: ck },
      form: { captcha: cap, client_id: "10016", phone_number: phone },
    });
  if (Number(sent?.code) !== 0) throw new Error(sent?.message || "短信发送失败");
  const code = await ctx.prompt(ctx.sender, "请输入短信验证码", 120000),
    auth = await ctx.requestJson("https://passport.tmuyun.com/web/oauth/security_code_auth", {
      method: "POST",
      headers: { ...smsHeaders(), cookie: ck },
      form: { client_id: "10016", phone_number: phone, security_code: code },
    }),
    ac = auth?.data?.authorization_code?.code;
  if (!ac) throw new Error(auth?.message || "验证码登录失败");
  const session = "68ff31bd3cbc283c4ca83496",
    id = crypto.randomUUID(),
    time = String(Date.now()),
    res = await ctx.requestJson(`${VAPP}/api/zbtxz/login`, {
      method: "POST",
      headers: {
        ...activityHeaders({ ua: UA0 }),
        "x-session-id": session,
        "x-request-id": id,
        "x-timestamp": time,
        "x-signature": sig("/api/zbtxz/login", session, id, time),
        "content-type": "application/x-www-form-urlencoded",
      },
      form: { check_token: "", code: ac, token: "", type: "-1", union_id: "" },
    });
  if (Number(res?.code) !== 0 || !res?.data?.session?.id) throw new Error(res?.message || "最终登录失败");
  return { phone, token: `${res.data.session.id}#${res.data.session.account_id}#${UA0}` };
}
const rt = createAccountRuntime({
  title: "爱仙居",
  shortName: "爱仙居",
  prefix: "dd_axj",
  defaultEnvName: "axj",
  orderPrefix: "AXJ",
  requireAuthForQuery: true,
  async login(ctx) {
    const choice = await ctx.prompt(ctx.sender, "[1] 图形验证码+短信登录\n[2] Session/Account Token登录", 60000);
    if (choice === null) return [];
    if (choice === "1")
      try {
        const x = await smsLogin(ctx);
        return [{ account: x.phone, token: x.token, remark: x.phone }];
      } catch (error) {
        await ctx.sender.reply(`短信登录失败：${error?.message || error}`);
        return [];
      }
    const input = await ctx.prompt(ctx.sender, "格式：手机号#X-SESSION-ID#X-ACCOUNT-ID[#UA]，支持批量", 120000);
    if (input === null) return [];
    const rows = [];
    for (const line of input.split(/\r?\n/).filter(Boolean))
      try {
        const p = line.trim().split("#"),
          phone = p.shift();
        if (!/^1[3-9]\d{9}$/.test(phone) || p.length < 2) throw new Error("格式错误");
        const token = p.join("#"),
          x = await info(ctx, parseToken(token));
        rows.push({ account: phone, token, remark: x.mobile !== "未知" ? x.mobile : phone });
      } catch (error) {
        await ctx.sender.reply(`爱仙居登录失败：${error?.message || error}`);
      }
    return rows;
  },
  async query(ctx, item) {
    const x = await info(ctx, parseToken(item.token));
    return `📱 账号：${x.mobile}\n💰 余额：${x.wallet.alipay}元\n📩 提现：${x.wallet.withdraw}元\n📊 累计：${x.wallet.total}元\n🎯 今日活动ID：${x.activityId}\n🎰 当前剩余抽奖次数：${x.remain}`;
  },
  async cronCheck(ctx, item) {
    try {
      await info(ctx, parseToken(item.token));
      return "";
    } catch (_) {
      return "Session/Account会话检测失效，请重新登录";
    }
  },
  envValue(_ctx, item) {
    return item.token;
  },
  tutorial:
    "=====爱仙居教程=====\n支持图形验证码+短信自动提取，或手机号#SessionID#AccountID[#UA]批量提交\n查询红包余额、提现、累计和当前抽奖次数\n指令：爱仙居登录、查询、管理、授权、清理、教程\n==================",
});
rt.main().catch(async (e) => s.reply(`爱仙居执行失败：${e?.message || e}`));
