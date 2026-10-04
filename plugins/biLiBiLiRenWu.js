// [title: 哔哩哔哩任务]
// [name: biLiBiLiRenWu]
// [desc: 扫码登录哔哩哔哩并执行每日经验、观看、投币、直播及漫画任务]
// [author: 960342874]
// [version: v1.0.2]
// [rule: ^一键哔哩$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 工具]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/哔哩哔哩任务_vv1.0.2_By.960342874.txt]
// [depe: []]

const { sender: s, Bucket, plugin, utils } = require("sillygirl");
const store = new Bucket("bilibiliTask.accounts");
const form = new plugin.Form({
  api_key: plugin.Form.string().title("任务接口Key").default("lKBPJ4IJ9sg1Unn7HSBTkMv4bu"),
  api_base: plugin.Form.string().title("任务接口").default("https://api.txcnm.cn/api/bilibili"),
  timeout_ms: plugin.Form.integer().title("请求超时毫秒").min(3000).max(120000).default(15000),
});
let cfg = {};
async function api(path, query = {}) {
  const url = new URL(`${cfg.api_base}/${path}`);
  url.searchParams.set("key", cfg.api_key);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const r = await fetch(url, { signal: AbortSignal.timeout(cfg.timeout_ms) }),
    text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 120)}`);
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}
async function execute(data) {
  const q = { mid: data.mid, mid_md5: data.mid_md5, token: data.token, csrf: data.csrf },
    info = await api("biliuser", q),
    result = await api("bilibili", q);
  return `您的信息如下：\n${typeof info === "string" ? info : JSON.stringify(info)}\n\n任务执行如下：\n${typeof result === "string" ? result : JSON.stringify(result)}`;
}
async function login() {
  const first = await api("bililogin", { do: "getqrcode" });
  if (!first?.url || !first?.key) throw new Error(first?.msg || "获取登录二维码失败");
  await s.reply(
    utils.image(`https://api.qrserver.com/v1/create-qr-code/?size=216x216&data=${encodeURIComponent(first.url)}`),
  );
  await s.reply("请在60秒内使用哔哩哔哩 App 扫码");
  for (let i = 0; i < 30; i += 1) {
    const child = await s.listen({ timeout: 2000 });
    if (child && /^q$/i.test(String((await child.getMsg()) || ""))) throw new Error("已取消扫码");
    const row = await api("bililogin", { do: "qrlogin", zkey: first.key });
    if (row?.data?.token && row.data?.csrf) return row.data;
  }
  throw new Error("扫码超时");
}
async function main() {
  try {
    const raw = (await form.get()) || {};
    cfg = {
      api_key: String(raw.api_key || "lKBPJ4IJ9sg1Unn7HSBTkMv4bu"),
      api_base: String(raw.api_base || "https://api.txcnm.cn/api/bilibili").replace(/\/$/, ""),
      timeout_ms: Number(raw.timeout_ms) || 15000,
    };
    const id = String(await s.getUserId());
    let data;
    try {
      data = JSON.parse(await store.get(id, "{}"));
    } catch (_) {
      data = {};
    }
    if (data.token && data.csrf) {
      try {
        return s.reply(await execute(data));
      } catch (_) {}
    }
    data = await login();
    await store.set(id, JSON.stringify(data));
    return s.reply(await execute(data));
  } catch (error) {
    return s.reply(`哔哩哔哩任务失败：${String(error?.message || error).slice(0, 300)}`);
  }
}
main();
