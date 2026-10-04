// [title: 摸鱼与随机视频]
// [name: moYuYuShiPin]
// [desc: 摸鱼日报、摸鱼日历、小视频分类及随机视频图集]
// [author: hdbjlizhe,960342874,kevin,297129582]
// [version: v1.0.0]
// [rule: ^(摸鱼|摸鱼日报|小视频|视频菜单|图集菜单|数据统计|随机短视频)$|^dy.*$]
// [cron: 55 12 * * 1-5]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 100]
// [class: 娱乐]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/摸鱼_v1.0.5_By.hdbjlizhe.txt;backup/摸鱼日报_vv1.0.0_By.960342874.txt;backup/小视频_v1.2_By.kevin.txt;backup/随机视频图集_v1.0.5_By.297129582.txt]
// [depe: []]

const { sender: s, plugin, utils } = require("sillygirl");
const form = new plugin.Form({
  random_api: plugin.Form.string().title("随机视频API").default("http://dy.jx.cangg.cn/api"),
  fallback_api: plugin.Form.string().title("备用随机视频API").default("http://dy1.jx.cangg.cn/api"),
  fish_api: plugin.Form.string().title("摸鱼文案API").default("https://vps.gamehook.top/api/face/my"),
  timeout_ms: plugin.Form.integer().title("请求超时毫秒").min(3000).max(60000).default(15000),
});
let cfg = {};
async function req(url, json = false) {
  const r = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(cfg.timeout_ms),
      headers: { "user-agent": "Mozilla/5.0" },
    }),
    text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 100)}`);
  return json ? JSON.parse(text) : { text, url: r.url };
}
async function prompt(text) {
  await s.reply(text);
  const child = await s.listen({ timeout: 60000 });
  return child ? String((await child.getMsg()) || "").trim() : "";
}
async function smallVideo() {
  const options = [
    ["COS", "COS"],
    ["变装喜乐", "ksbianzhuang"],
    ["吊带系列", "diaodai"],
    ["抖音热点", "dy_hot"],
    ["小姐姐系列", "zzxjj"],
    ["萌娃喜乐", "mengwa"],
    ["古风系列", "hanfu"],
    ["玉足系列", "jpmt"],
    ["慢摇喜乐", "manyao"],
    ["清纯系列", "qingchun"],
    ["女高系列", "nvgao"],
    ["欲梦/甜妹", "ndym"],
    ["JK洛丽塔", "jksp"],
    ["帅哥系列", "xgg"],
    ["热舞系列", "rewu"],
  ];
  const input = await prompt(["请选择视频系列", ...options.map((x, i) => `${i + 1}. ${x[0]}`), "Q取消"].join("\n"));
  if (/^q$/i.test(input)) return s.reply("已取消");
  const row = options[Number(input) - 1];
  if (!row) return s.reply("输入的系列无效");
  const result = await req(`http://api.yujn.cn/api/${row[1]}.php?type=video`);
  return s.reply(utils.video(result.url || result.text.trim()));
}
async function randomApi(path) {
  let last;
  for (const base of [cfg.random_api, cfg.fallback_api])
    try {
      return await req(`${base.replace(/\/$/, "")}/${path}`, true);
    } catch (e) {
      last = e;
    }
  throw last;
}
async function menu(type) {
  const data = await req(`${cfg.random_api.replace(/\/$/, "")}/statistics?list_type=${type}`, true),
    lines = String(data.user_types || "")
      .split("\n")
      .filter(Boolean);
  if (!lines.length) throw new Error("菜单为空");
  for (let i = 0; i < lines.length; i += 10)
    await s.reply(
      `-----${type === "album" ? "图集" : "视频"}菜单 ${i / 10 + 1}/${Math.ceil(lines.length / 10)}-----\n${lines.slice(i, i + 10).join("\n")}`,
    );
}
async function randomMedia(content) {
  if (/^(视频菜单|dy视频菜单|dy菜单)$/.test(content)) return menu("video");
  if (/^(图集菜单|dy图集菜单)$/.test(content)) return menu("album");
  if (content === "数据统计") {
    const data = await req(`${cfg.random_api.replace(/\/$/, "")}/statistics?list_type=all`, true);
    return s.reply(JSON.stringify(data, null, 2).slice(0, 3500));
  }
  if (content === "随机短视频") return s.reply("指令：dy视频、dy图集、dy视频名称、dy图集名称、视频菜单、图集菜单");
  const match = content.match(/^dy\s*(视频|图集)?\s*(.*)$/);
  const media = match?.[1] || "视频",
    name = match?.[2]?.trim();
  const q = new URLSearchParams({ media, ...(name ? { name } : {}) }),
    data = await randomApi(`random_link?${q}`);
  if (!data?.link) throw new Error("未找到指定内容");
  if (media === "图集")
    return s.reply((Array.isArray(data.link) ? data.link : [data.link]).slice(0, 18).map(utils.image).join("\n"));
  const result = await req(data.link);
  return s.reply(utils.video(result.url || data.link));
}
async function fish(daily = false) {
  const now = new Date();
  if (daily && [0, 6].includes(now.getDay())) return;
  if (daily) return s.pushAdmin(`摸鱼日报\n${utils.video("https://dayu.qqsuu.cn/moyuribaoshipin/apis.php")}`);
  const text = (await req(cfg.fish_api)).text.replace(/<br\s*\/?\s*>/gi, "\n");
  return s.reply(
    `${text}\n${utils.image(`https://s2.loli.net/2022/02/24/${["SG5svAxd1eXwVDK.jpg", "St2w79Qq5eDABiH.jpg", "UQhuHPlIAnSY4fw.jpg"][now.getDate() % 3]}`)}`,
  );
}
async function main() {
  try {
    const raw = (await form.get()) || {};
    cfg = {
      random_api: String(raw.random_api || "http://dy.jx.cangg.cn/api"),
      fallback_api: String(raw.fallback_api || "http://dy1.jx.cangg.cn/api"),
      fish_api: String(raw.fish_api || "https://vps.gamehook.top/api/face/my"),
      timeout_ms: Number(raw.timeout_ms) || 15000,
    };
    const content = String((await s.getMsg()) || "").trim();
    if (!content) return fish(true);
    if (content === "小视频") return smallVideo();
    if (content === "摸鱼日报") return s.reply(utils.video("https://dayu.qqsuu.cn/moyuribaoshipin/apis.php"));
    if (content === "摸鱼") return fish(false);
    return randomMedia(content);
  } catch (error) {
    return s.reply(`摸鱼与随机视频执行失败：${String(error?.message || error).slice(0, 300)}`);
  }
}
main();
