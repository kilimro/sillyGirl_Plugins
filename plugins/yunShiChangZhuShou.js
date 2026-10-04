// [title: 云市场助手]
// [name: yunShiChangZhuShou]
// [desc: 合并云市场、云订阅、奥特曼助手、插件加白与插件解密，复用同一组市场 Bucket]
// [author: yuhualhh,241793,sky2022]
// [version: v2.0.0]
// [rule: ^云端.*$|^(订阅|市场)源?$|^订阅(助手|列表|拉黑|搜索.*|一键添加|一键更新|动态|采集)$|^(一键订阅|一键更新|插件搜索|插件下载|云动态)$|^(查询云币|添加云币|删除云币|添加白名单|删除白名单|查询白名单|插件授权|已购买|定时推送|助手教程)$|^插件加白$|^插件解密$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 工具]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/云市场助手_v1.2.0_By.yuhualhh.py;backup/云订阅助手_v1.1.7_By.yuhualhh.py;backup/奥特曼助手_v1.0.4_By.241793.py;backup/插件加白_v1.0.0_By.sky2022.py;backup/插件解密_v1.0.4_By.yuhualhh.py;backup/订阅源_v1.0.2_By.hdbjlizhe.txt;backup/订阅源集合_v1.4.6_By.specter.txt]
// [depe: []]

const { createHash, randomUUID } = require("crypto");
const { Bucket, plugin, sender: s } = require("sillygirl");

const buckets = Object.fromEntries(
  [
    "autMarketCoins",
    "autMarketCfgs",
    "autMarketBoughts",
    "autMarketBoughtDetails",
    "autSysCroncmds",
    "cloud",
    "yuhua_sqzs_user",
    "plugins_script",
    "plugins",
  ].map((x) => [x, new Bucket(x)]),
);
const config = new plugin.Form({
  backend_url: plugin.Form.string()
    .title("订阅云端接口")
    .default("https://yuhualhh.250666.xyz/api/subscription_hub.php"),
  backend_key: plugin.Form.string().title("订阅云端 Key").default("yuhualhh666666"),
  local_api: plugin.Form.string().title("本机 AutMan API").description("例：http://127.0.0.1:8080").default(""),
  local_cookie: plugin.Form.string().title("本机 AutMan Cookie").default(""),
  decrypt_api: plugin.Form.string().title("插件解密接口").default("http://yuhualhh.250666.xyz/api/plugin_receive.php"),
  decrypt_key: plugin.Form.string().title("插件解密 Key").default("YuhuaReceiveApi888"),
  legacy_source_url: plugin.Form.string().title("旧版订阅源接口").default("http://aut.zhelee.cn/market/records"),
});

const list = (value) =>
  String(value || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const unique = (values) => [...new Set(values)];
const isEncrypted = (value) => {
  const x = String(value || "").trim();
  return x.startsWith("V3v") || (x.length >= 32 && x.length % 2 === 0 && /^[0-9a-f]+$/i.test(x));
};
async function owner(target = s) {
  return `${await target.getPlatform()}:${await target.getUserId()}`;
}
async function isAdmin(target = s) {
  if (!(await target.isAdmin())) throw new Error("需要管理员权限");
}

async function ask(target, prompt, handle, timeout = 60000) {
  await target.reply(prompt);
  return target.listen({
    rules: ["raw ^([\\s\\S]+)$"],
    timeout,
    handle: async (next) => {
      const value = String((await next.param(1)) || "").trim();
      return /^q$/i.test(value) ? "已取消" : handle(value, next);
    },
  });
}

async function backend(cfg, action, params = {}) {
  const url = new URL(cfg.backendUrl);
  url.searchParams.set("action", action);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = await fetch(url, { headers: { "x-api-key": cfg.backendKey }, signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok || Number(data.code) !== 200) throw new Error(data.message || `HTTP ${response.status}`);
  return data.data || {};
}
async function local(cfg, method, path, body) {
  if (!cfg.localApi) throw new Error("请在插件配置填写本机 AutMan API");
  const response = await fetch(`${cfg.localApi.replace(/\/$/, "")}${path}`, {
    method,
    headers: { cookie: cfg.localCookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok || Number(data.code) !== 200) throw new Error(data.message || `HTTP ${response.status}`);
  return data.data;
}

async function bind(target) {
  return ask(target, "请输入云账号，回复 q 取消", async (value) => {
    await buckets.yuhua_sqzs_user.set(await owner(target), value);
    return `已绑定云账号：${value}`;
  });
}
async function cloudStatus(target) {
  const user = await buckets.yuhua_sqzs_user.get(await owner(target), "");
  if (!user) return "未绑定云账号，请发送 云端绑定";
  const coin = await buckets.autMarketCoins.get(user, "0"),
    bought = list(await buckets.autMarketBoughts.get(user, ""));
  const cfgs = await buckets.autMarketCfgs.getAll(),
    white = list(cfgs.testers),
    black = list(cfgs.blacklist);
  return `云账号：${user}\n云币：${coin}\n已授权插件：${bought.length ? bought.join("、") : "无"}\n状态：${black.includes(user) ? "黑名单" : white.includes(user) ? "白名单" : "普通用户"}`;
}
async function setCsv(bucket, key, value, add) {
  const now = list(await bucket.get(key, ""));
  const next = add ? unique([...now, value]) : now.filter((x) => x !== value);
  await bucket.set(key, next.join(","));
  return next;
}

async function editCoin(content, target) {
  await isAdmin(target);
  const add = /添加|加币/.test(content);
  return ask(target, "请输入 云账号#数量，回复 q 取消", async (value) => {
    const [user, raw] = value.split("#"),
      amount = Number(raw);
    if (!user || !Number.isFinite(amount) || amount <= 0) return "格式错误，应为 云账号#正数";
    const current = Number(await buckets.autMarketCoins.get(user, "0")) || 0,
      next = add ? current + amount : current - amount;
    if (next < 0) return "余额不足";
    await buckets.autMarketCoins.set(user, String(next));
    return `${user} 当前云币：${next}`;
  });
}
async function editWhite(content, target) {
  await isAdmin(target);
  const remove = /删除|删白/.test(content);
  return ask(target, "请输入云账号，回复 q 取消", async (value) => {
    const rows = await setCsv(buckets.autMarketCfgs, "testers", value, !remove);
    return `${remove ? "删除" : "添加"}成功\n当前白名单：${rows.join("、") || "空"}`;
  });
}
async function showWhite() {
  return `市场白名单：${list(await buckets.autMarketCfgs.get("testers", "")).join("、") || "空"}`;
}
async function grant(target) {
  await isAdmin(target);
  return ask(target, "请输入 云账号#插件名，多个账号用逗号分隔", async (value) => {
    const cut = value.indexOf("#");
    if (cut < 1) return "格式错误";
    const users = list(value.slice(0, cut)),
      title = value.slice(cut + 1).trim();
    let count = 0;
    for (const user of users) {
      const before = list(await buckets.autMarketBoughts.get(user, ""));
      if (!before.includes(title)) {
        await buckets.autMarketBoughts.set(user, [...before, title].join(","));
        await buckets.autMarketBoughtDetails.set(String(Date.now()) + count, `${user},${title},0`);
        count++;
      }
    }
    return `插件 ${title} 加白完成：${count}/${users.length}`;
  });
}

function renderSources(data) {
  const sources = data.sources || [];
  return (
    sources
      .slice(0, 80)
      .map(
        (x, i) =>
          `${i + 1}. ${x.author || x.name || "未知"} ${x.online ? "✅" : "❌"}（${(x.plugins || []).length}个插件）`,
      )
      .join("\n") || "订阅列表为空"
  );
}
async function subscription(content, cfg, target) {
  if (content === "订阅助手") return "订阅列表 / 订阅搜索 / 订阅一键添加 / 订阅一键更新";
  if (content.startsWith("订阅搜索")) {
    const query = content.slice(4).trim();
    return query
      ? renderSearch(await backend(cfg, "search", { q: query, limit: "100" }), query)
      : ask(target, "请输入插件关键词", async (value) =>
          renderSearch(await backend(cfg, "search", { q: value, limit: "100" }), value),
        );
  }
  const catalog = await backend(cfg, "catalog");
  const black = list(await buckets.autMarketCfgs.get("subscription_blacklist", ""));
  if (Array.isArray(catalog.sources))
    catalog.sources = catalog.sources.filter((x) => !black.includes(String(x.author || x.name || "")));
  if (content === "订阅列表" || content === "订阅动态" || content === "订阅采集") return renderSources(catalog);
  if (/一键添加|一键更新/.test(content)) {
    await isAdmin(target);
    const sources = (catalog.sources || []).filter(
      (x) => x.author && (x.online || Number(x.heartbeat_at) > Date.now() / 1000 - 600),
    );
    const current = await local(cfg, "GET", "/market/subs?searchValue=");
    const known = new Set((current || []).map((x) => x.author || x.name));
    const add = sources
      .filter((x) => !known.has(x.author))
      .map((x) => ({ author: x.author, name: x.name || x.author }));
    if (add.length) await local(cfg, "POST", "/market/subs", add);
    let updated = 0;
    if (content.includes("更新")) {
      for (const source of sources) {
        for (const item of source.plugins || []) {
          try {
            await local(
              cfg,
              "POST",
              `/js/install?language=${encodeURIComponent(item.language)}&title=${encodeURIComponent(item.title)}&author=${encodeURIComponent(source.author)}&tab=${encodeURIComponent(source.author)}`,
            );
            updated++;
          } catch {}
        }
      }
    }
    return `新增订阅：${add.length}\n更新插件：${updated}`;
  }
}
function renderSearch(data, query) {
  const items = data.items || [];
  return `“${query}”搜索结果：\n${
    items
      .slice(0, 50)
      .map(
        (x, i) =>
          `${i + 1}. ${x.title || x.plugin?.title || "未知"} / ${x.author || x.source_author || "未知"} / v${x.version || "?"}`,
      )
      .join("\n") || "无结果"
  }`;
}

async function legacySources(cfg) {
  const username = String((await buckets.cloud.get("username", "")) || ""),
    password = String((await buckets.cloud.get("password", "")) || "");
  const url = new URL(cfg.legacySourceUrl);
  url.searchParams.set("username", username);
  url.searchParams.set("password", password);
  const response = await fetch(url, { headers: { username }, signal: AbortSignal.timeout(20000) }),
    text = await response.text();
  if (!response.ok) throw new Error(`订阅源接口 HTTP ${response.status}`);
  const data = JSON.parse(text),
    rows = Array.isArray(data.data) ? data.data : [];
  return `获取可用订阅源${rows.length}个\n--------------\n${rows.join("\n") || "未获取到数据"}`;
}
async function editSubscriptionBlacklist(cfg, target) {
  await isAdmin(target);
  const current = list(await buckets.autMarketCfgs.get("subscription_blacklist", ""));
  return ask(target, `当前拉黑：${current.join("、") || "空"}\n输入 +作者 或 -作者`, async (value) => {
    const remove = value.startsWith("-"),
      name = value.replace(/^[+-]/, "").trim();
    if (!name) return "作者不能为空";
    const next = remove ? current.filter((x) => x !== name) : unique([...current, name]);
    await buckets.autMarketCfgs.set("subscription_blacklist", next.join(","));
    return `订阅源黑名单：${next.join("、") || "空"}`;
  });
}
async function pluginDownload(cfg, target) {
  await isAdmin(target);
  return ask(target, "请输入插件关键词", async (query) => {
    const data = await backend(cfg, "search", { q: query, limit: "100" }),
      items = data.items || [];
    if (!items.length) return "没有搜索结果";
    await target.reply(
      items
        .slice(0, 30)
        .map((x, i) => `${i + 1}. ${x.title || x.plugin?.title} / ${x.author || x.source_author}`)
        .join("\n") + "\n回复序号下载",
    );
    const child = await target.listen({ timeout: 60000 });
    if (!child) return "输入超时";
    const row = items[Number(String((await child.getMsg()) || "")) - 1];
    if (!row) return "序号无效";
    const title = row.title || row.plugin?.title,
      author = row.author || row.source_author,
      language = row.language || row.plugin?.language || "js";
    await local(
      cfg,
      "POST",
      `/js/install?language=${encodeURIComponent(language)}&title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}&tab=${encodeURIComponent(author)}`,
    );
    return `插件下载完成：${author}/${title}`;
  });
}

async function market(content, cfg, target) {
  if (content === "云端助手")
    return "云端绑定 / 云端解绑 / 云端查询 / 云端市场 / 云端授权 / 云端加币 / 云端减币 / 云端加白 / 云端删白";
  if (content === "云端绑定") return bind(target);
  if (content === "云端解绑") {
    await buckets.yuhua_sqzs_user.delete(await owner(target));
    return "已解绑";
  }
  if (content === "云端查询") return cloudStatus(target);
  if (/云端(加币|减币)/.test(content)) return editCoin(content, target);
  if (/云端(加白|删白)/.test(content)) return editWhite(content, target);
  if (content === "云端授权") return grant(target);
  if (content === "云端市场") {
    const author = await buckets.yuhua_sqzs_user.get(await owner(target), "");
    const data = await local(
      cfg,
      "GET",
      `/js/cloud?tab=${encodeURIComponent(author)}&keyword=&class=&page=1&pageSize=120&orderby=`,
    );
    const rows = data?.data || data || [];
    return (
      (Array.isArray(rows) ? rows : [])
        .map((x, i) => `${i + 1}. ${x.title} / ${x.author} / ${x.price || 0}云币 / v${x.version || "?"}`)
        .join("\n") || "市场为空"
    );
  }
  return `该云端指令保留本地数据兼容；当前状态：\n${await cloudStatus(target)}`;
}

async function decryptPlugin(cfg, target) {
  await isAdmin(target);
  const cloud = String(await buckets.cloud.get("username", "")).trim();
  if (!cloud) throw new Error("cloud.username 未配置");
  const items = [];
  for (const name of ["plugins_script", "plugins"]) {
    const all = await buckets[name].getAll();
    for (const [key, value] of Object.entries(all)) {
      if (key.includes(":"))
        items.push({
          bucket: name,
          key,
          value,
          author: key.split(":", 1)[0],
          filename: key.slice(key.indexOf(":") + 1),
        });
    }
  }
  if (!items.length) return "未找到已安装插件";
  await target.reply(
    items
      .map((x, i) => `${i + 1}. ${x.author}/${x.filename} ${isEncrypted(x.value) ? "已加密" : "未加密"}`)
      .join("\n") + "\n回复数字选择，q退出",
  );
  return target.listen({
    rules: ["raw ^([0-9]+|q)$"],
    timeout: 60000,
    handle: async (next) => {
      const raw = String((await next.param(1)) || "");
      if (/^q$/i.test(raw)) return "已取消";
      const item = items[Number(raw) - 1];
      if (!item) return "无效选择";
      if (!isEncrypted(item.value)) return "该插件未加密";
      const ks = (length) => {
        const out = [];
        for (let i = 0; out.length < length; i++)
          out.push(...createHash("sha256").update(`YuhuaDist888888:${i}`).digest());
        return out.slice(0, length);
      };
      const bytes = Buffer.from(cloud),
        stream = ks(bytes.length),
        enc = Buffer.from(bytes.map((x, i) => x ^ stream[i])).toString("hex");
      const token = `d_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        voucher = `${enc}-${item.bucket}-${item.key}`;
      const response = await fetch(`${cfg.decryptApi}?action=decrypt_plugin&token=${token}`, {
        method: "POST",
        headers: { "x-api-key": cfg.decryptKey, "content-type": "application/json" },
        body: JSON.stringify({
          author: item.author,
          plugin_name: item.filename,
          admin_user: cloud,
          email: (await buckets.cloud.get("email", "")) || "",
          encrypted_content: item.value,
          voucher,
          enc_cloud_user: enc,
          target_bucket: item.bucket,
          target_name: item.key,
        }),
        signal: AbortSignal.timeout(60000),
      });
      const data = await response.json();
      if (!response.ok || Number(data.code) !== 0) return `解密失败：${data.msg || `HTTP ${response.status}`}`;
      return `分发凭证：${voucher}\n分发链接：${cfg.decryptApi}?token=${token}`;
    },
  });
}

async function main() {
  try {
    let content = String((await s.getMsg()) || "").trim(),
      raw = await config.get(),
      cfg = {
        backendUrl: String(raw.backend_url || "https://yuhualhh.250666.xyz/api/subscription_hub.php"),
        backendKey: String(raw.backend_key || "yuhualhh666666"),
        localApi: String(raw.local_api || ""),
        localCookie: String(raw.local_cookie || ""),
        decryptApi: String(raw.decrypt_api || "http://yuhualhh.250666.xyz/api/plugin_receive.php"),
        decryptKey: String(raw.decrypt_key || "YuhuaReceiveApi888"),
        legacySourceUrl: String(raw.legacy_source_url || "http://aut.zhelee.cn/market/records"),
      };
    let result;
    if (/^(订阅|市场)源?$/.test(content)) result = await legacySources(cfg);
    else if (content === "订阅拉黑") result = await editSubscriptionBlacklist(cfg, s);
    else if (content === "插件下载") result = await pluginDownload(cfg, s);
    else if (content === "插件搜索") result = await subscription("订阅搜索", cfg, s);
    else if (content === "云动态") result = await subscription("订阅动态", cfg, s);
    else if (content === "一键订阅") result = await subscription("订阅一键添加", cfg, s);
    else if (content === "一键更新") result = await subscription("订阅一键更新", cfg, s);
    else if (content.startsWith("云端")) result = await market(content, cfg, s);
    else if (content.startsWith("订阅")) result = await subscription(content, cfg, s);
    else if (content === "插件解密") result = await decryptPlugin(cfg, s);
    else if (content === "插件加白" || content === "插件授权") result = await grant(s);
    else if (/添加云币|删除云币/.test(content)) result = await editCoin(content, s);
    else if (/添加白名单|删除白名单/.test(content)) result = await editWhite(content, s);
    else if (content === "查询白名单") result = await showWhite();
    else if (content === "查询云币")
      result = await ask(
        s,
        "请输入云账号",
        async (value) => `${value} 云币：${await buckets.autMarketCoins.get(value, "0")}`,
      );
    else if (content === "已购买")
      result = await ask(
        s,
        "请输入云账号",
        async (value) => `${value} 已购买：${list(await buckets.autMarketBoughts.get(value, "")).join("、") || "无"}`,
      );
    else if (content === "定时推送") {
      await isAdmin(s);
      const all = await buckets.autSysCroncmds.getAll();
      result =
        Object.entries(all)
          .map(([id, v]) => {
            try {
              const x = typeof v === "string" ? JSON.parse(v) : v;
              return `${id}. ${x.cmd} / ${x.cron} / ${x.disable ? "禁用" : "启用"}`;
            } catch {
              return `${id}. ${v}`;
            }
          })
          .join("\n") || "暂无定时";
    } else result = "助手教程：查询云币、添加/删除云币、添加/删除/查询白名单、插件授权、已购买、定时推送";
    if (typeof result === "string") return s.reply(result);
  } catch (e) {
    return s.reply(`云市场工具处理失败：${e.message}`);
  }
}
main();
