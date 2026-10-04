// [title: 短链接工具]
// [name: duanLianJieGongJu]
// [desc: 解析普通短链接与京东 u.jd.com 短链接并返回最终地址]
// [author: hdbjlizhe,qingge]
// [version: v1.0.0]
// [rule: ^dljx\s+(.+)$]
// [rule: ^[\s\S]*u\.jd\.com\/[0-9A-Za-z]{7}[\s\S]*$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 999999]
// [class: 工具]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/短链解析_v1.0.1_By.hdbjlizhe.txt;backup/链接还原_v0.1.5_By.qingge.js]
// [depe: []]

const { sender: s } = require("sillygirl");
async function finalUrl(url) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
    headers: { "user-agent": "Mozilla/5.0" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.url;
}
async function main() {
  try {
    const content = String((await s.getMsg()) || "").trim();
    if (/^dljx\s+/i.test(content)) {
      const url = content.replace(/^dljx\s+/i, "").match(/https?:\/\/\S+/)?.[0];
      if (!url) return s.reply("未找到短链接");
      return s.reply(await finalUrl(url));
    }
    const links = [
      ...new Set(
        (content.match(/(?:https?:\/\/)?u\.jd\.com\/[0-9A-Za-z]{7}/g) || []).map((x) =>
          /^https?:/.test(x) ? x : `https://${x}`,
        ),
      ),
    ];
    if (!links.length) return s.reply("未找到京东短链接");
    const out = [];
    for (const link of links) {
      const first = await fetch(link, {
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
        headers: { "user-agent": "Mozilla/5.0" },
      });
      const body = await first.text();
      const embedded = body.match(/hrl=['"](.+?)['"]/i)?.[1]?.replace(/&amp;/g, "&");
      out.push(await finalUrl(embedded || first.headers.get("location") || link));
    }
    return s.reply(out.join("\n"));
  } catch (error) {
    return s.reply(`短链接解析失败：${String(error?.message || error).slice(0, 300)}`);
  }
}
main();
