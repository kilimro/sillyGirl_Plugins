// [title: 网易云任务]
// [name: wangYiYunRenWu]
// [desc: 扫码登录网易云并执行听歌打卡、云贝签到和音乐人任务]
// [author: 960342874]
// [version: v1.0.2]
// [rule: ^(一键网易|网易云任务)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 工具]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/clock.svg]
// [origin: backup/网易云任务_vv1.0.2_By.960342874.txt]
// [depe: []]

const { sender: s, Bucket, plugin, utils } = require("sillygirl");
const store = new Bucket("neteaseMusicTask.accounts");
const form = new plugin.Form({
  api_key: plugin.Form.string().title("任务接口Key").default("lKBPJ4IJ9sg1Unn7HSBTkMv4bu"),
  api_base: plugin.Form.string().title("任务接口").default("https://api.txcnm.cn/api/wyy"),
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
  const q = { token: data.token, id: data.user_id },
    rows = [];
  for (const [path, name] of [
    ["wyuser", "账号信息"],
    ["wyy300", "听歌打卡"],
    ["wyyb", "云贝任务"],
    ["wyyren", "音乐人任务"],
  ]) {
    const result = await api(path, q);
    rows.push(`${name}：${typeof result === "string" ? result : JSON.stringify(result)}`);
  }
  return rows.join("\n\n");
}
async function login() {
  const first = await api("wyylogin", { do: "getqrcode" });
  if (!first?.url || !first?.key) throw new Error(first?.msg || "获取登录二维码失败");
  await s.reply(
    utils.image(`https://api.qrserver.com/v1/create-qr-code/?size=216x216&data=${encodeURIComponent(first.url)}`),
  );
  await s.reply("请在60秒内使用网易云音乐 App 扫码");
  for (let i = 0; i < 30; i += 1) {
    const child = await s.listen({ timeout: 2000 });
    if (child && /^q$/i.test(String((await child.getMsg()) || ""))) throw new Error("已取消扫码");
    const row = await api("wyylogin", { do: "qrlogin", zkey: first.key });
    if (row?.data?.token && row.data?.user_id) return row.data;
  }
  throw new Error("扫码超时");
}
async function main() {
  try {
    const raw = (await form.get()) || {};
    cfg = {
      api_key: String(raw.api_key || "lKBPJ4IJ9sg1Unn7HSBTkMv4bu"),
      api_base: String(raw.api_base || "https://api.txcnm.cn/api/wyy").replace(/\/$/, ""),
      timeout_ms: Number(raw.timeout_ms) || 15000,
    };
    const id = String(await s.getUserId());
    let data;
    try {
      data = JSON.parse(await store.get(id, "{}"));
    } catch (_) {
      data = {};
    }
    if (data.token && data.user_id) {
      try {
        return s.reply(await execute(data));
      } catch (_) {}
    }
    data = await login();
    await store.set(id, JSON.stringify(data));
    return s.reply(await execute(data));
  } catch (error) {
    return s.reply(`网易云任务失败：${String(error?.message || error).slice(0, 300)}`);
  }
}
main();
