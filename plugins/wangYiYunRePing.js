// [title: 网抑云热评]
// [name: wangYiYunRePing]
// [desc: 随机返回一条网易云热评]
// [author: qw21560]
// [version: v1.1.0]
// [rule: ^网抑云$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 娱乐]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/网抑云热评_v1.0.0_By.qw21560.txt]
// [depe: []]

const { sender: s } = require("sillygirl");

async function main() {
  const response = await fetch("http://api.yujn.cn/api/wyrp.php", {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`热评接口 HTTP ${response.status}`);
  const text = (await response.text()).trim();
  await s.reply(text || "热评接口返回为空");
}

main().catch((error) => s.reply(`获取热评失败：${error.message}`));
