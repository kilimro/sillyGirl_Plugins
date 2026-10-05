// [title: 电影热榜]
// [name: dianYingReBang]
// [desc: 发"电影热榜"查豆瓣实时电影热度榜]
// [author: Mianpro官方]
// [version: v1.0.0]
// [rule: ^电影热榜$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 工具]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: 自定义]
// [depe: []]

const { sender: s } = require("sillygirl");

async function main() {
  try {
    const res = await fetch("https://api.920pdd.com/API/dyrbang.php?type=douban&num=10", {
      signal: AbortSignal.timeout(10000),
      headers: { "user-agent": "Mozilla/5.0" },
    });
    if (!res.ok) return s.reply(`查询失败 HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.msg) return s.reply("查询失败，接口未返回数据");
    await s.reply(`豆瓣电影热榜\n\n${data.msg}`);
  } catch (error) {
    await s.reply(`电影热榜查询失败：${String(error?.message || error).slice(0, 200)}`);
  }
}

main().catch(async (error) => {
  try {
    await s.reply(`电影热榜异常：${String(error?.message || error).slice(0, 200)}`);
  } catch (_) {}
});
