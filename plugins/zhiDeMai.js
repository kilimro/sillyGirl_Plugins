// [title: 值得买]
// [name: zhiDeMai]
// [desc: 查询什么值得买近三小时好价 TOP20]
// [author: chuan85]
// [version: v1.1.0]
// [rule: ^zdm$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 工具]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/值得买_v1.0.0_By.chuan85.txt]
// [depe: []]

const { sender: s } = require("sillygirl");

async function main() {
  const response = await fetch("https://suzhi.fun/api/post/list", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ s: "0002001" }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`好价接口 HTTP ${response.status}`);
  const items = (await response.json())?.data?.l;
  if (!Array.isArray(items) || !items.length) throw new Error("好价接口数据为空");
  await s.reply(
    items
      .slice(0, 20)
      .map((item, index) => `${index + 1}. ${item.t}${item.ls?.length ? `【${item.ls.join(" / ")}】` : ""}\n${item.u}`)
      .join("\n\n"),
  );
}

main().catch((error) => s.reply(`获取好价失败：${error.message}`));
