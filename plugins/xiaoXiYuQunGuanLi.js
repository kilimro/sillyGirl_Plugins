// [title: 消息与群管理]
// [name: xiaoXiYuQunGuanLi]
// [desc: 合并 Python 的人工通知、消息推送、QQ关联、手机号撤回和 Vorto 入群验证，直接使用 Sender/Adapter/Bucket 导出]
// [author: sillyGirl]
// [version: v1.0.0]
// [rule: ^(人工|售后|QQ关联|qq关联)$|^回复\s+([a-fA-F0-9]{8})\s+([\s\S]+)$|^推送\s+(\w+)\s+(\S+)\s+([\s\S]+)$|^1[3-9]\d{9}$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 工具]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/bc_qq手机号撤回_v1.0.0_By.241793.py;backup/QQ关联_v1.0.2_By.chuan.py;backup/Vorto群管理_v1.0_By.rujingxianghai.py;backup/人工通知_v1.0.3_By.sky2022.py;backup/消息推送_v1.6.3_By.chuan.py]
// [depe: []]

const { Adapter, Bucket, plugin, sender: s, utils } = require("sillygirl");

const form = new plugin.Form({
  verify_groups: plugin.Form.string().title("开启入群验证的群号").description("逗号分隔").default(""),
  disable_math: plugin.Form.boolean().title("关闭算术验证").default(false),
  welcome: plugin.Form.string().title("欢迎语").default("欢迎加入本群，请阅读群公告并遵守群规。"),
  reject: plugin.Form.string().title("验证失败提示").default("验证超时或答案错误，将移出群聊。"),
});
const tickets = new Bucket("user_help_request");

async function main() {
  try {
    const event = await s.getEvent();
    if (isJoin(event)) return verifyJoin(event, await form.get());
    const content = String((await s.getMsg()) || "").trim();
    if (/^1[3-9]\d{9}$/.test(content)) return recallPhone();
    if (/^(QQ关联|qq关联)$/.test(content)) return linkQQ();
    if (/^(人工|售后)$/.test(content)) return createTicket();
    const reply = content.match(/^回复\s+([a-f\d]{8})\s+([\s\S]+)$/i);
    if (reply) return answerTicket(reply[1], reply[2]);
    const push = content.match(/^推送\s+(\w+)\s+(\S+)\s+([\s\S]+)$/);
    if (push) return directPush(push[1], push[2], push[3]);
  } catch (error) {
    return s.reply(`消息与群管理失败：${err(error)}`);
  }
}

async function recallPhone() {
  const messageId = await s.getMsgId();
  await s.doAction({ action: "delete_msg", message_id: messageId });
  return s.reply("手机号消息已撤回");
}

async function linkQQ() {
  const username = String((await s.getUserName()) || "");
  if (username.includes("@")) return s.reply("请先添加机器人为好友");
  await s.reply("请发送需要关联的 QQ，输入 q 取消。");
  return s.listen({
    rules: ["raw ^(\\S+)$"],
    timeout: 60000,
    user_id: await s.getUserId(),
    chat_id: await s.getChatId(),
    handle: async (next) => {
      const qq = String((await next.param(1)) || "").trim();
      if (/^q$/i.test(qq)) return "已取消";
      const source = await new Bucket("pinQQ").getAll();
      const pins = Object.entries(source)
        .filter(([, value]) => String(value) === qq)
        .map(([pin]) => pin);
      if (!pins.length) return next.reply("该 QQ 没有绑定任何账号");
      const platform = String(await next.getPlatform()).toUpperCase();
      const target = new Bucket(`pin${platform}`);
      const userId = await next.getUserId();
      for (const pin of pins) await target.set(pin, userId);
      return next.reply(`已将 ${pins.length} 个账号关联到 ${platform}:${userId}`);
    },
  });
}

async function createTicket() {
  const userId = await s.getUserId();
  const platform = await s.getPlatform();
  for (const [id, raw] of Object.entries(await tickets.getAll())) {
    const row = parseJSON(raw);
    if (row.userId === userId && row.status === "pending" && Date.now() - row.time < 1800000)
      return s.reply(`已有待处理请求：${id}`);
  }
  await s.reply("请描述问题，可发送文字或图片，输入 q 取消。");
  return s.listen({
    rules: ["raw ^([\\s\\S]+)$"],
    timeout: 60000,
    user_id: userId,
    chat_id: await s.getChatId(),
    handle: async (next) => {
      const question = String((await next.param(1)) || "").trim();
      if (/^q$/i.test(question)) return "已取消";
      const id = hash(`${platform}:${userId}:${Date.now()}`).slice(0, 8);
      const row = { userId, platform, botId: await next.getBotId(), question, time: Date.now(), status: "pending" };
      await tickets.set(id, JSON.stringify(row));
      await next.pushAdmin(
        ["用户求助", `请求ID：${id}`, `用户：${platform}:${userId}`, question, `回复格式：回复 ${id} 内容`].join("\n"),
      );
      return next.reply(`求助已提交，请求ID：${id}`);
    },
  });
}

async function answerTicket(id, content) {
  if (!(await s.isAdmin())) return s.reply("仅管理员可回复");
  const raw = await tickets.get(id, "");
  if (!raw) return s.reply(`未找到请求：${id}`);
  const row = parseJSON(raw);
  if (row.status !== "pending") return s.reply(`请求已处理：${id}`);
  const adapter = new Adapter({ platform: row.platform, bot_id: row.botId });
  await adapter.push({ user_id: row.userId, content: `管理员回复（${id}）：\n${content}` });
  await adapter.destroy();
  await tickets.set(id, JSON.stringify({ ...row, status: "replied", reply: content, replyTime: Date.now() }));
  return s.reply(`回复已发送：${id}`);
}

async function directPush(platform, userId, content) {
  if (!(await s.isAdmin())) return s.reply("仅管理员可推送");
  const botId = await s.getBotId();
  const adapter = new Adapter({ platform, bot_id: botId });
  const messageId = await adapter.push({ user_id: userId, content });
  await adapter.destroy();
  return s.reply(`推送完成：${messageId || "ok"}`);
}

async function verifyJoin(event, cfg) {
  const groupId = String(event.group_id || event.chat_id || (await s.getChatId()));
  const userId = String(event.user_id || (await s.getUserId()));
  const groups = new Set(
    String(cfg.verify_groups || "")
      .split(/[,，]/)
      .map((x) => x.trim())
      .filter(Boolean),
  );
  if (!groups.has(groupId)) return;
  const at = utils.buildCQTag("at", { qq: userId });
  if (cfg.disable_math === true) return s.reply(`${at}\n${cfg.welcome}`);
  const left = Math.floor(Math.random() * 100);
  const right = Math.floor(Math.random() * 100);
  await s.reply(`${at}\n请在 90 秒内回答：${left}+${right}=?`);
  const answer = await s.listen({
    rules: ["raw ^([+-]?\\d+)$"],
    timeout: 90000,
    allow_users: [userId],
    allow_groups: [groupId],
  });
  if (answer && Number(await answer.param(1)) === left + right) return s.reply(`${at}\n${cfg.welcome}`);
  await s.reply(`${at}\n${cfg.reject}`);
  return s.doAction({ action: "set_group_kick", group_id: groupId, user_id: userId, reject_add_request: false });
}

function isJoin(event) {
  return ["qq-notice-group-increase", "qq-notice-group_increase-approve", "qq-notice-group_increase"].includes(
    String(event?.type || event?.event_type || event?.post_type || ""),
  );
}
function parseJSON(value) {
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    return {};
  }
}
function hash(value) {
  return require("crypto").createHash("md5").update(value).digest("hex");
}
function err(error) {
  return String(error?.message || error)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 300);
}

main();
