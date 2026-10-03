// [title: 我的记忆]
// [name: memoryNote]
// [desc: 查看/管理 AI 自动记住的关于你的信息。私聊群聊均可，只能看自己的；AI 聊天时提到的个人信息会自动记下。]
// [author: kilimro]
// [version: v1.0.0]
// [rule: ^(?:我的记忆|查看我的记忆|记忆列表|记忆)$]
// [rule: ^忘记我的.+$]
// [rule: ^清空我的记忆$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 大模型]
// [icon: https://ecmb.bdimg.com/tam-ogel/-341441530_114552854_88_88.png]
// [origin: 自定义]
// [depe: ["./memoryCore.js"]]

const { sender: s } = require("sillygirl");
const mem = require("./memoryCore.js");

async function main() {
  const content = String((await s.getMsg()) || "").trim();
  const platform = String((await s.getPlatform()) || "unknown");
  const userId = String((await s.getUserId()) || "");

  if (/^(?:我的记忆|查看我的记忆|记忆列表|记忆)$/.test(content)) {
    const list = await mem.list(platform, userId);
    if (!list.length) {
      return s.reply(
        "我还没记住关于你的任何信息。\n你跟 AI 聊天时提到的个人信息（生日、名字、喜好等）我会自动记下，下次直接问我就行。",
      );
    }
    const lines = list.map((m, i) => `${i + 1}. ${m.key}：${m.value}`);
    return s.reply(
      `📝 我记住的关于你的信息（${list.length} 条）：\n${lines.join("\n")}\n\n发送「忘记我的XX」删除单条，「清空我的记忆」全部删除`,
    );
  }

  const delMatch = content.match(/^忘记我的(.+)$/);
  if (delMatch) {
    const key = delMatch[1].trim();
    const n = await mem.remove(platform, userId, key);
    if (n > 0) return s.reply(`已忘记：${key}`);
    return s.reply(`我没有记住关于「${key}」的信息`);
  }

  if (content === "清空我的记忆") {
    await mem.clear(platform, userId);
    return s.reply("已清空所有关于你的记忆");
  }
}

main().catch(async (error) => {
  try {
    await s.reply(`记忆插件异常：${String(error?.message || error).slice(0, 200)}`);
  } catch (_) {}
});
