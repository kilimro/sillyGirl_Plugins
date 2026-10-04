// [title: 文字或链接转二维码]
// [name: wenZiHuoLianJieZhuanErWeiMa]
// [desc: 将命令后的文字或链接生成二维码]
// [author: 偷CK的六舅哥]
// [version: v1.2.0]
// [rule: ^转二维码(?:\s+(.+))?$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 工具]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/文字或链接转二维码_v1.1.0_By.偷CK的六舅哥.txt]
// [depe: []]

const { sender: s } = require("sillygirl");

function sendQRCode(text, target = s) {
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(text)}`;
  return target.reply(`[CQ:image,file=${url}]`);
}

async function main() {
  const content = String(await s.getMsg())
    .replace(/^转二维码\s*/, "")
    .trim();
  if (content) return sendQRCode(content);

  await s.reply("请发送要转换的文字或链接");
  await s.listen({
    rules: ["raw ^(.+)$"],
    timeout: 60000,
    handle: async (next) => sendQRCode(await next.param(1), next),
  });
}

main().catch((error) => s.reply(`二维码生成失败：${error.message}`));
