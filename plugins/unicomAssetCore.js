// [title: 联通资产公共模块]
// [name: unicomAssetCore]
// [desc: 中国联通账号资产查询与格式化公共能力]
// [author: sillyGirl]
// [version: v1.0.0]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 模块]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [module: true]
// [carry: false]
// [origin: 自定义]
// [depe: []]

function normalize(raw) {
  const s = String(raw || "").trim();
  if (s.includes("ecs_token=")) return s;
  return `ecs_token=${s}`;
}
async function get(ctx, token) {
  token = normalize(token);
  const h = { cookie: token, "user-agent": "Mozilla/5.0 ChinaUnicom" };
  const valid = await ctx.requestJson("https://act.10010.com/SigninApp/convert/getTelephone", {
    method: "POST",
    headers: h,
    json: {},
  });
  if (String(valid?.status) !== "0000") throw new Error(valid?.message || "联通凭证失效");
  const tel = valid.data || {};
  let score = "0",
    expire = "0",
    today = "0",
    coupons = [];
  try {
    const d = await ctx.requestJson("https://m.client.10010.com/welfare-mall-front/mobile/show/bj2205/v2/1", {
      method: "POST",
      headers: { ...h, origin: "https://img.client.10010.com", referer: "https://img.client.10010.com/" },
      form: { position: "123", isTermShow: "1" },
    });
    for (const x of d?.resdata?.data || []) {
      if (String(x.type) === "1") score = String(x.number || 0);
      if (String(x.type) === "5") expire = String(x.number || 0);
    }
  } catch {}
  try {
    const now = new Date(),
      ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`,
      day = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }),
      d = await ctx.requestJson("https://m.client.10010.com/welfare-mall-front/new/integral/querySummaryList/v1", {
        method: "POST",
        headers: { ...h, origin: "https://img.client.10010.com", referer: "https://img.client.10010.com/" },
        form: { scoreType: "2", typeChar: "0", yearMonth: ym, from: "97000001317,003" },
      }),
      rows = d?.data?.list || d?.data?.records || [];
    today = rows
      .filter((x) => String(x.date || x.createTime || x.scoreDate || "").startsWith(day))
      .reduce((n, x) => n + Number(x.score || x.integral || x.number || 0), 0);
  } catch {}
  try {
    const d = await ctx.requestJson(
      "https://m.client.10010.com/myPrizeForActivity/openServices/listWinningRecordsForDouble11",
      {
        method: "POST",
        headers: { ...h, origin: "https://img.client.10010.com", referer: "https://img.client.10010.com/" },
        form: {
          sysActiveStr:
            "SHAKECLIENT_AC20220811152323,SHAKECLIENT_AC20231127165002,SIGNIN_AC20141230175502,SHAKECLIENT_AC20230322151845,SHAKECLIENT_AC20240806140724,SHAKECLIENT_AC20241119161231,SHAKECLIENT_AC20250226023238",
          enMobile: "",
          otherFlag: "1",
        },
      },
    );
    coupons = (d?.data?.winningRecords || [])
      .filter((x) => x.prizeState === "00")
      .map((x) => `${x.prizeName || "卡券"}，至${String(x.deadLineTime || "").slice(0, 10)}`);
  } catch {}
  return {
    token,
    phone: tel.mobile || tel.telephoneNumber || "",
    tel: tel.telephone || "0.00",
    telExp: tel.needexpNumber || "0",
    telMonth: String(tel.month || ""),
    score,
    expire,
    today,
    coupons,
  };
}
module.exports = { normalize, get };
