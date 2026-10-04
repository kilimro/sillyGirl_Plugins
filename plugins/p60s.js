// [title: 60s]
// [name: p60s]
// [desc: 获取每日 60 秒早报，支持文字、图片及定时管理员推送]
// [author: XiaoBo_]
// [version: v1.2.1]
// [rule: ^(早报|新闻|60秒|60s)$|^(文字早报|文本早报)$|^(图文早报|图片早报)$|^早报数据$]
// [cron: 30 7 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 工具]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/60s_v1.1.2_By.XiaoBo_.txt]
// [depe: []]

const { sender: s, plugin } = require("sillygirl");

const config = new plugin.Form({
  api: plugin.Form.string().title("早报接口").default("https://60s.viki.moe/v2/60s"),
  image: plugin.Form.boolean().title("默认使用图片").default(true),
});

async function load(api) {
  const response = await fetch(api, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`早报接口 HTTP ${response.status}`);
  const body = await response.json();
  if (!body?.data) throw new Error("早报接口数据为空");
  return body.data;
}

function text(data) {
  return [
    `📰 每日60秒早报`,
    `📅 ${data.date || ""} ${data.day_of_week || ""}`,
    data.lunar_date ? `🌙 农历：${data.lunar_date}` : "",
    "━━━━━━━━━━━━━━━",
    ...(data.news || []).map((item, index) => `${index + 1}. ${item}`),
    "━━━━━━━━━━━━━━━",
    data.tip ? `☀️ ${data.tip}` : "",
    data.link ? `🔗 ${data.link}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function main() {
  const conf = await config.get();
  const data = await load(conf.api || "https://60s.viki.moe/v2/60s");
  const command = String(await s.getMsg().catch(() => "")).trim();
  if (command === "早报数据") {
    return (await s.isAdmin()) ? s.reply(JSON.stringify(data, null, 2)) : undefined;
  }

  const useImage =
    /^(图文早报|图片早报)$/.test(command) || (!/^(文字早报|文本早报)$/.test(command) && conf.image !== false);
  const output = useImage && data.image ? `[CQ:image,file=${data.image}]` : text(data);
  return command ? s.reply(output) : s.pushAdmin(output);
}

main().catch((error) => s.reply(`早报获取失败：${error.message}`));
