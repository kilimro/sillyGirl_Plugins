// [title: 匠心中华]
// [name: jiangXinZhongHua]
// [desc: 匠心中华CK登录、积分明细、物流、地址及积分商品兑换]
// [author: huawei]
// [version: v1.3.7]
// [rule: ^匠心(教程|登录|管理|查询|物流|兑换|地址|注销|授权|清理|上传|CK)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 工具类]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/匠心中华_v1.3.7_By.huawei.py]
// [depe: ["./mrconliAccountRuntime.js"]]

const { sender: s } = require("sillygirl");
const { createHash } = require("crypto");
const { createAccountRuntime } = require("./mrconliAccountRuntime");
const H = "https://api.quwayouxuan.com",
  URL = {
    user: "/dmluser/center.do",
    task: "/task/task/taskList.do",
    points: "/points/api/getpointslist.do",
    orders: "/selfsupport/order/list.do",
    products: "/selfsupport/product/getProducts.do",
    detail: "/selfsupport/product/getProductDetail.do",
    createOrder: "/selfsupport/order/createOrder.do",
    addresses: "/selfsupport/address/list.do",
    deleteAddress: "/selfsupport/address/del.do",
    createAddress: "/selfsupport/address/create.do",
    area: "/address/getArea.do",
    logoff: "/login/logoff.do",
  };
const WEB_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/132 Safari/537.36 MicroMessenger/7.0.20 MiniProgramEnv/Windows",
  APP_UA = "quwa/1.6.1 (iPhone; iOS 26.3.1; Scale/3.00)";
function sign(extra = {}, app = false, raw = false) {
  const p = app
    ? {
        appInfo: "1.6.1",
        current_time: Date.now(),
        deviceabout: "system:26.3.1,platform:iOS",
        idfa: "00000000-0000-0000-0000-000000000000",
        os: "ios",
      }
    : {
        current_time: Date.now(),
        os: "miniProgram",
        deviceabout: "miniProgram",
        version: "1.3.01",
        miniprogram_os: "Windows",
      };
  Object.assign(p, extra);
  let joined =
    Object.keys(p)
      .sort()
      .filter((k) => p[k] !== null && p[k] !== undefined && String(p[k]) !== "signature")
      .map((k) => `${k}=${String(p[k])}`)
      .join("") + "superjing";
  if (!raw)
    joined = encodeURIComponent(joined.replace(/\s+/g, ""))
      .replace(/~/g, "%7E")
      .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  p.key = createHash("sha1").update(joined).digest("hex");
  return p;
}
async function post(ctx, path, extra = {}, app = false) {
  const call = (raw) =>
    ctx.requestJson(H + path, {
      method: "POST",
      form: sign(extra, app, raw),
      headers: {
        "user-agent": app ? APP_UA : WEB_UA,
        accept: "*/*",
        referer: "https://servicewechat.com/wxddaa0832e6acc5f1/123/page-frame.html",
      },
    });
  let r = await call(false),
    m = String(r?.message || r?.msg || "").toLowerCase();
  if (String(r?.code) === "10002" || /校验|验签|签名|signature|invalid sign|sign error|invalid key/.test(m))
    r = await call(true);
  if (Number(r?.code) !== 1) throw new Error(r?.message || r?.msg || `接口失败 code=${r?.code}`);
  return r.data;
}
function session(token) {
  if (typeof token === "string" && token.trim().startsWith("{")) return JSON.parse(token);
  const [userId, accessToken, refreshToken = ""] = String(token || "").split("#");
  if (!accessToken) throw new Error("CK格式应为 userId#token#refreshToken");
  return { userId, token: accessToken, refreshToken };
}
async function info(ctx, x) {
  const [u, t, p] = await Promise.all([
    post(ctx, URL.user, { token: x.token }, true),
    post(ctx, URL.task, { token: x.token, source: "4" }, true),
    post(
      ctx,
      URL.points,
      { sj_h5: "1", token: x.token, page: "1", date: "", type: "1", points_type: "0", version: "2.0.0", os: "h5" },
      true,
    ),
  ]);
  return { user: u?.user_info || {}, task: t?.userinfo || {}, records: (p?.dataRows?.[0]?.list || []).slice(0, 10) };
}
async function orders(ctx, x) {
  return post(ctx, URL.orders, { token: x.token, status: "3", page: "1", keywords: "" });
}
async function products(ctx, x) {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const rows = await post(ctx, URL.products, {
      token: x.token,
      page: String(page),
      points: "2",
      points_price_stage: "0",
      tag_id: "0",
      type: "6",
      mode: "0",
    });
    if (!Array.isArray(rows) || !rows.length) break;
    all.push(...rows);
    if (rows.length < 10) break;
  }
  return all;
}
async function addresses(ctx, x) {
  return post(ctx, URL.addresses, { token: x.token });
}
function first(obj, keys) {
  for (const k of keys) if (obj?.[k] !== undefined && obj[k] !== null && String(obj[k])) return obj[k];
  return "";
}
function skuFrom(node, pn) {
  if (!node || typeof node !== "object") return "";
  for (const k of ["product_sku", "sku", "sku_id", "skuId", "spec_id", "id"]) {
    const v = node[k];
    if (v && String(v) !== String(pn || "")) return v;
  }
  for (const v of Object.values(node)) {
    if (Array.isArray(v)) {
      for (const item of v) {
        const got = skuFrom(item, pn);
        if (got) return got;
      }
    } else if (v && typeof v === "object") {
      const got = skuFrom(v, pn);
      if (got) return got;
    }
  }
  return "";
}
async function owned(ctx) {
  const uid = await ctx.currentUserId(),
    a = JSON.parse((await ctx.users.get(uid, "[]")) || "[]");
  if (!a.length) throw new Error("未绑定匠心账号");
  return Promise.all(
    a.map(async (account) => ({
      account,
      remark: await ctx.remarks.get(account, account),
      x: session(await ctx.tokens.get(account, "")),
    })),
  );
}
async function logistics(ctx) {
  const lines = [];
  for (const a of await owned(ctx)) {
    try {
      const rows = await orders(ctx, a.x);
      lines.push(`【${a.remark}】待收货${rows.length}单`);
      for (const [i, o] of rows.slice(0, 3).entries()) {
        const title =
            (o.list || [])
              .map((v) => v.product_title)
              .filter(Boolean)
              .join("、") || "未知商品",
          l = o.logistic_data || {};
        lines.push(
          `${i + 1}. ${title}\n状态：${o.statusTxt || o.status || "未知"}\n快递：${l.logisticsCompanyName || "待发货"} ${o.order_number || ""}\n轨迹：${l.theLastMessage || "暂无"}`,
        );
      }
    } catch (e) {
      lines.push(`【${a.remark}】${e.message}`);
    }
  }
  return ctx.sender.reply(lines.join("\n"));
}
async function exchange(ctx) {
  const a = (await owned(ctx))[0],
    list = await products(ctx, a.x);
  if (!list.length) return ctx.sender.reply("暂无可兑换商品");
  const input = await ctx.prompt(
    ctx.sender,
    [
      `账号：${a.remark}`,
      ...list
        .slice(0, 30)
        .map(
          (p, i) =>
            `[${i + 1}] ${first(p, ["product_title", "title", "name"])}｜${first(p, ["points", "points_price", "price"])}积分`,
        ),
      "回复序号，q退出",
    ].join("\n"),
    120000,
  );
  if (input === null) return ctx.sender.reply("已退出");
  const p = list[Number(input) - 1];
  if (!p) throw new Error("商品序号无效");
  const addrs = await addresses(ctx, a.x);
  if (!addrs.length) throw new Error("请先在匠心地址中添加收货地址");
  let address = addrs[0];
  if (addrs.length > 1) {
    const c = await ctx.prompt(
      ctx.sender,
      addrs
        .map(
          (v, i) =>
            `[${i + 1}] ${v.name || v.receiver} ${String(v.mobile || "").replace(/(\d{3})\d{4}(\d{4})/, "$1****$2")} ${v.address || v.full_address || ""}`,
        )
        .join("\n"),
      60000,
    );
    address = addrs[Number(c) - 1];
    if (!address) throw new Error("地址序号无效");
  }
  const pn = first(p, ["productNum", "product_num", "id"]),
    detail = await post(ctx, URL.detail, { token: a.x.token, productNum: String(pn), numcode: "" }),
    sku = skuFrom(detail, pn) || skuFrom(p, pn),
    pid = first(p, ["product_id", "id", "productId"]) || first(detail, ["product_id", "id", "productId"]);
  if (!sku || !pid) throw new Error("商品响应缺少 product_id/product_sku");
  const result = await post(ctx, URL.createOrder, {
    token: a.x.token,
    source: "2",
    address_id: String(first(address, ["address_id", "id"])),
    product_id: String(pid),
    product_sku: String(sku),
    num: "1",
    comment: "",
    group_name_id: "",
    sid: "",
    is_point_deduct: "2",
    pay_type: "3",
    coupon_id: "0",
    optimal_deduction: "2",
    isPickup: "2",
    pickupMobile: "",
    commission_deduction_type: "2",
  });
  return ctx.sender.reply(
    `兑换成功：${first(p, ["product_title", "title", "name"])}${result?.order_number ? `\n订单：${result.order_number}` : ""}`,
  );
}
async function addressManage(ctx) {
  const a = (await owned(ctx))[0],
    list = await addresses(ctx, a.x);
  if (!list.length) return ctx.sender.reply("暂无收货地址，请先在匠心中华小程序添加");
  const choice = await ctx.prompt(
    ctx.sender,
    [
      ...list.map(
        (v, i) => `[${i + 1}] ${v.name || v.receiver} ${v.mobile || ""} ${v.address || v.full_address || ""}`,
      ),
      "回复 d序号 删除地址，q退出",
    ].join("\n"),
    120000,
  );
  if (choice === null) return ctx.sender.reply("已退出");
  const m = String(choice).match(/^d(\d+)$/i);
  if (!m) return ctx.sender.reply("地址列表已展示");
  const addr = list[Number(m[1]) - 1];
  if (!addr) throw new Error("地址序号无效");
  await post(ctx, URL.deleteAddress, { token: a.x.token, address_id: String(first(addr, ["address_id", "id"])) });
  return ctx.sender.reply("地址已删除");
}
const rt = createAccountRuntime({
  title: "匠心中华",
  shortName: "匠心",
  prefix: "G_JXZH",
  defaultEnvName: "G_JXZH_TOKEN",
  orderPrefix: "JX",
  requireAuthForQuery: false,
  async login(ctx) {
    const raw = await ctx.prompt(ctx.sender, "请提交CK，格式：备注#userId#token#refreshToken；多账号换行", 120000);
    if (raw === null) return [];
    const out = [];
    for (const [i, line] of raw
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean)
      .entries()) {
      const p = line.split("#");
      let remark = `匠心账号${i + 1}`,
        x;
      if (p.length >= 4) {
        remark = p.shift();
        x = session(p.join("#"));
      } else x = session(line);
      const q = await info(ctx, x),
        account = String(q.user.mobile || x.userId || `jx_${i + 1}`);
      out.push({ account, token: JSON.stringify(x), remark: remark || q.user.username || account });
    }
    return out;
  },
  async query(ctx, item) {
    const q = await info(ctx, session(item.token)),
      u = q.user,
      t = q.task;
    return `👤 昵称：${t.username || u.username || item.remark}\n⭐ 今日积分：${t.task_rice || 0}\n⭐ 总积分：${t.points || u.points || 0}\n🍚 米粒：${u.rice || 0}\n🧾 积分明细：\n${q.records.length ? q.records.map((v) => `${String(v.addtime || "").split(" ")[0]} ${v.actlog || ""} ${v.points || 0}`).join("\n") : "暂无记录"}`;
  },
  async handle(ctx, c) {
    if (/物流/.test(c)) return logistics(ctx);
    if (/兑换/.test(c)) return exchange(ctx);
    if (/地址/.test(c)) return addressManage(ctx);
    if (/注销/.test(c)) {
      const a = (await owned(ctx))[0];
      await post(ctx, URL.logoff, { token: a.x.token });
      return ctx.sender.reply("匠心账号已在上游注销，请再到匠心管理删除本地账号");
    }
  },
  async cronCheck(ctx, item) {
    const q = await info(ctx, session(item.token));
    return `会话有效，总积分${q.task.points || q.user.points || 0}`;
  },
  envValue(_c, item) {
    return item.token;
  },
  tutorial:
    "抓取匠心中华登录响应中的 userId、token、refreshToken，发送“匠心登录”绑定；匠心查询查积分，匠心物流查订单，匠心地址查看/删除地址，匠心兑换使用默认或选定地址创建积分订单。",
});
rt.main().catch((e) => s.reply(`匠心执行失败：${e?.message || e}`));
