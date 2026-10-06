// [title: 智能转发脚本]
// [name: smartForwardScript]
// [desc: 群消息转发：根据关键词/用户条件，把消息转发到指定目标群/用户，支持跨平台]
// [author: Mianpro官方]
// [version: v4.1.5]
// [rule: raw [\s\S]*]
// [status: true]
// [admin: false]
// [public: false]
// [carry: true]
// [priority: 1]
// [class: 工具]
// [icon: https://m4.publicimg.browser.qq.com/imgUpload/qbtool.t_tool_info/b91aa2df_W4ZZOk76VO4.png]
// [depe: []]

const { plugin, sender: s, Adapter } = require("sillygirl");

const config = new plugin.Form({
  enabled: plugin.Form.boolean().title("启用转发").default(true),
  source_platform: plugin.Form.string()
    .title("来源平台（只监听哪个平台，留空=所有平台）")
    .description("如 feishu、yyw、qq 等"),
  source_chat_id: plugin.Form.string().title("来源群号/用户ID（只监听哪个群，留空=所有群）").widget("textarea"),
  keywords: plugin.Form.string()
    .title("触发关键词（逗号分隔，模糊匹配，留空=所有消息）")
    .widget("textarea")
    .default(""),
  from_users: plugin.Form.string().title("触发用户ID（逗号分隔，留空=不限制）").widget("textarea").default(""),
  match_logic: plugin.Form.string().title("匹配逻辑（or=或 / and=且）").default("or"),
  target_platform: plugin.Form.string().title("目标平台（留空=当前平台）").description("如 yyw、qq、tg 等"),
  target_bot_id: plugin.Form.string().title("目标Bot ID（留空=当前Bot）").description("跨平台时需要填目标平台的Bot ID"),
  target_chat_id: plugin.Form.string().title("目标群号/用户ID").required(),
  forward_prefix: plugin.Form.string().title("转发前缀").default("【转发】"),
  forward_suffix: plugin.Form.string().title("转发后缀").default(""),
  ignore_forwarded: plugin.Form.boolean().title("忽略已转发消息（防循环）").default(true),
});

async function main() {
  const cfg = (await config.get()) || {};
  const content = String((await s.getMsg()) || "");
  const chatId = String((await s.getChatId()) || "");
  const platform = String((await s.getPlatform()) || "");

  await s.reply(
    `[调试] enabled=${cfg.enabled} platform=${platform} chatId=${chatId} srcPlatform=${cfg.source_platform} srcChat=${cfg.source_chat_id} targetPlatform=${cfg.target_platform} targetChat=${cfg.target_chat_id} targetBot=${cfg.target_bot_id}`,
  );

  if (!cfg.enabled) return;

  const fromUser = String((await s.getUserId()) || "");
  const botId = String((await s.getBotId()) || "");

  // 忽略机器人自己转发的消息
  if (cfg.ignore_forwarded && content.startsWith(cfg.forward_prefix)) return;

  // 来源平台过滤
  const srcPlatform = String(cfg.source_platform || "").trim();
  if (srcPlatform && platform !== srcPlatform) return;

  // 来源群过滤
  const srcChat = String(cfg.source_chat_id || "").trim();
  if (srcChat && chatId !== srcChat) return;

  // 关键词匹配
  const keywords = String(cfg.keywords || "")
    .split(/[,，\n]/)
    .map((k) => k.trim())
    .filter(Boolean);
  const hasKeyword = keywords.length === 0 || keywords.some((k) => content.includes(k));

  // 用户匹配
  const fromUsers = String(cfg.from_users || "")
    .split(/[,，\n]/)
    .map((u) => u.trim())
    .filter(Boolean);
  const hasUser = fromUsers.length === 0 || fromUsers.includes(fromUser);

  // 逻辑判断
  const shouldForward = cfg.match_logic === "and" ? hasKeyword && hasUser : hasKeyword || hasUser;

  await s.reply(`[调试] keywords=${JSON.stringify(keywords)} hasKeyword=${hasKeyword} fromUsers=${JSON.stringify(fromUsers)} hasUser=${hasUser} logic=${cfg.match_logic} shouldForward=${shouldForward}`);

  if (!shouldForward) return;

  await s.reply(`[调试] 准备转发 -> ${targetPlatform}/${targetBotId}/${cfg.target_chat_id}`);

  const targetChat = String(cfg.target_chat_id || "").trim();
  if (!targetChat) return;

  const targetPlatform = String(cfg.target_platform || "").trim() || platform;
  const targetBotId = String(cfg.target_bot_id || "").trim() || botId;
  const forwardContent = cfg.forward_prefix + content + cfg.forward_suffix;

  try {
    const adapter = new Adapter({ platform: targetPlatform, bot_id: targetBotId });
    await adapter.push({
      user_id: "system",
      chat_id: targetChat,
      content: forwardContent,
    });
    await s.reply(`[调试] 转发成功: ${platform}/${chatId} -> ${targetPlatform}/${targetChat}`);
  } catch (e) {
    await s.reply(`[调试] 转发失败: ${e.message}`);
  }
}

main().catch((e) => console.error(`[智能转发] 异常: ${e.message}`));
