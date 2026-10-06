// [title: 智能转发脚本]
// [name: smartForwardScript]
// [desc: 搬运群处理脚本：根据关键词/用户条件，把消息转发到目标群/用户]
// [author: MIANPRO官方]
// [version: v3.0.0]
// [rule: ^智能转发$]
// [status: true]
// [admin: false]
// [public: false]
// [carry: true]
// [priority: 0]
// [class: 工具]
// [icon: https://m4.publicimg.browser.qq.com/imgUpload/qbtool.t_tool_info/b91aa2df_W4ZZOk76VO4.png]
// [depe: []]

const { plugin, sender: s } = require("sillygirl");

const config = new plugin.Form({
  keywords: plugin.Form.string()
    .title("触发关键词（多个用逗号分隔，模糊匹配，留空则所有消息都触发）")
    .widget("textarea")
    .default(""),
  from_users: plugin.Form.string()
    .title("触发用户ID（多个用逗号分隔，留空则不限制用户）")
    .widget("textarea")
    .default(""),
  match_logic: plugin.Form.string()
    .title("匹配逻辑（填 or 或 and）")
    .description("or = 或（满足任意一个条件就触发）；and = 且（两个条件都满足才触发）")
    .default("or"),
  target_platform: plugin.Form.string().title("目标平台").required(),
  target_chat_id: plugin.Form.string().title("目标群号/用户ID").required(),
  forward_prefix: plugin.Form.string().title("转发消息前缀").default("【转发】"),
  forward_suffix: plugin.Form.string().title("转发消息后缀").default(""),
  ignore_forwarded: plugin.Form.boolean().title("忽略已转发消息（防止循环）").default(true),
});

async function main() {
  const cfg = normalizeConfig(await config.get());

  const content = String((await s.getMsg()) || "").trim();
  const fromUser = String((await s.getUserId()) || "");
  const chatId = String((await s.getChatId()) || "");
  const platform = String(s.getImType() || "");

  // 忽略已经转发过的消息
  if (cfg.ignore_forwarded && content.startsWith(cfg.forward_prefix)) {
    return;
  }

  // 解析关键词
  const keywords = cfg.keywords.split(/[,，\n]/).map(k => k.trim()).filter(k => k);
  const hasKeywordMatch = keywords.length === 0 || keywords.some(k => content.includes(k));

  // 解析触发用户
  const fromUsers = cfg.from_users.split(/[,，\n]/).map(u => u.trim()).filter(u => u);
  const hasUserMatch = fromUsers.length === 0 || fromUsers.includes(fromUser);

  // 根据匹配逻辑判断是否触发
  let shouldForward = false;
  if (cfg.match_logic === "and") {
    shouldForward = hasKeywordMatch && hasUserMatch;
  } else {
    shouldForward = hasKeywordMatch || hasUserMatch;
  }

  // 不满足条件，跳过
  if (!shouldForward) {
    return;
  }

  // 转发消息
  const forwardContent = cfg.forward_prefix + content + cfg.forward_suffix;
  const targetChatId = cfg.target_chat_id;

  if (!targetChatId) {
    console.log("[智能转发脚本] 未配置目标群号，跳过转发");
    return;
  }

  try {
    // 发送消息到目标群
    const sender = s.Sender2({
      platform: cfg.target_platform,
      chat_id: cfg.target_chat_id,
    });
    await sender.reply(forwardContent);
    console.log(`[智能转发脚本] 转发成功：${platform}/${chatId} -> ${cfg.target_platform}/${cfg.target_chat_id}，内容：${content.substring(0, 50)}`);
  } catch (e) {
    console.error(`[智能转发脚本] 转发失败：${e.message}`);
  }
}

function normalizeConfig(raw) {
  const value = raw || {};
  return {
    keywords: String(value.keywords || "").trim(),
    from_users: String(value.from_users || "").trim(),
    match_logic: value.match_logic === "and" ? "and" : "or",
    target_platform: String(value.target_platform || "").trim(),
    target_chat_id: String(value.target_chat_id || "").trim(),
    forward_prefix: String(value.forward_prefix || "【转发】"),
    forward_suffix: String(value.forward_suffix || ""),
    ignore_forwarded: value.ignore_forwarded !== false,
  };
}

main();
