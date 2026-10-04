// [title: 线报猴]
// [name: xianBaoHou]
// [desc: 从线报酷开放接口读取最新线报]
// [author: sillyGirl]
// [version: v2.0.0]
// [rule: ^线报猴$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 任务]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/线报猴_v0.0.1_By.authook.py]
// [depe: []]

const { plugin, sender: s } = require("sillygirl");

const config = new plugin.Form({
  limit: plugin.Form.number().title("返回条数").default(5),
  source_url: plugin.Form.string().title("线报开放接口").default("https://new.ixbk.net/plus/json/push.json"),
});

async function main() {
  const cfg = (await config.get()) || {};
  try {
    const response = await fetch(String(cfg.source_url || "https://new.ixbk.net/plus/json/push.json"), {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const items = unwrap(await response.json());
    const limit = Math.min(10, Math.max(1, Number(cfg.limit) || 5));
    if (!items.length) throw new Error("接口没有返回线报");
    const text = items
      .slice(0, limit)
      .map((item, index) => {
        const url = new URL(String(item.url || ""), "https://new.ixbk.net/").toString();
        return `${index + 1}. ${item.title || "未命名线报"}\n${item.shorttime || item.datetime || ""}\n${url}`;
      })
      .join("\n\n");
    return s.reply(`最新线报\n${text}\n\n来源：线报酷开放接口`);
  } catch (error) {
    return s.reply(`线报获取失败：${message(error)}`);
  }
}

function unwrap(value) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "list", "items", "result"]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function message(error) {
  return String(error?.message || error)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 300);
}

main();
