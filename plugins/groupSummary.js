// [title: 群聊总结]
// [name: groupSummary]
// [desc: 持续记录群聊消息（仅群聊，私聊不记录），发"群聊总结"用 AI 生成当日精华总结报告。支持文字/图片两种输出（图片用 MiniMax 画一张总结封面）。兼容 Gewe / yyw / 飞书等全平台。]
// [author: Mianpro官方]
// [version: v1.1.2]
// [rule: *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 999]
// [class: 工具]
// [icon: https://api.920pdd.com/favicon.ico]
// [origin: 自定义]
// [depe: ["./openaiChatCore.js","./aiDrawCore.js"]]

"use strict";
const { sender: s, Bucket, plugin } = require("sillygirl");
const ai = require("./openaiChatCore.js");
const draw = require("./aiDrawCore.js");

const STORE_BUCKET = "group_summary_store"; // 消息积累存储
const storeBucket = new Bucket(STORE_BUCKET);
const MAX_KEYS_PER_GROUP = 2000; // 单群最多存的唯一键（超了清最旧）

const form = new plugin.Form({
  // ---- 总结 AI（独立配置，不依赖 aiChat）----
  base_url: plugin.Form.string()
    .title("AI BaseURL")
    .description("OpenAI 兼容接口地址，如 https://api.openai.com/v1")
    .default("")
    .required(),
  api_key: plugin.Form.string().title("AI API Key").default("").required(),
  model: plugin.Form.string().title("AI 模型").default("gpt-4o-mini").required(),
  // ---- 总结参数 ----
  default_count: plugin.Form.number()
    .title("默认总结条数")
    .description("发「群聊总结」时默认取最近多少条消息")
    .min(10)
    .max(200)
    .default(50),
  max_stored: plugin.Form.number()
    .title("每群最大存储条数")
    .description("超过则清理最旧消息，防止膨胀")
    .min(50)
    .max(1000)
    .default(200),
  summarize_prompt: plugin.Form.string()
    .title("总结提示词")
    .description("自定义总结要求，{messages} 会被替换为聊天记录")
    .default("您是一位专业的中文群聊总结助手，专门负责分析和总结微信群聊记录。您的主要任务是从繁杂的群聊中提取关键信息，生成一份全面、简洁且易读的群聊报告。这份报告旨在帮助群成员快速了解当天的主要讨论内容，不错过重要信息。\n请仔细阅读提供的微信群聊记录，并按照以下详细指南创建一份高质量的今日群聊总结报告：\n报告标题： 「群聊精华总结」\n重要提醒（如果有）：\n在报告最上方，使用「❗️重要提醒」标注任何置顶或 @所有人 这种需要所有成员注意的信息\n简明扼要地陈述提醒内容，确保醒目\n话题概要： 分析并总结不超过5个主要话题。对于每个话题，请提供以下信息：\na) 话题标题：\n长度：30-50个字\n格式：[序号] [简洁而吸引人的标题] [热度指数☆]\n热度指数说明：使用1-5个☆表示，根据讨论的持续时间、参与人数和互动程度综合评定\nc) 讨论时间：\n格式：HH:MM - HH:MM\nd) 内容摘要：\n字数：100-200字\n要求： 准确概括讨论的核心内容、主要观点和结论，使用客观、中立的语言，如有分歧请公正呈现各方观点，突出讨论中的创新想法或解决方案\ne) 一句话点评：\n字数：20-30字\n要求：简明扼要地总结该话题讨论的价值、影响或启示，语气积极、富有洞察力，避免过于主观或争议性评论\n趣味互动（如果有）：\n简要记录群聊中有趣的对话、幽默的评论或暖心的互动，以轻松愉快的语气呈现\n待跟进事项：\n列出讨论中提到的需要后续行动的事项，格式：[负责人]：[具体任务] (截止日期：MM月DD日)\n其他话题简述：\n如果有超过5个话题被讨论，在报告末尾简要列出其他话题的标题\n总体要求：语言风格正式、专业同时保持友好易读；信息准确；客观中立；敏感内容谨慎处理；结构清晰；控制长度\n结语：简短的结语，鼓励群成员继续积极参与讨论\n请基于以上指南分析所提供的群聊记录，生成一份内容丰富、结构清晰、易于阅读的群聊总结报告。\n群聊记录：\n{messages}\n请按照以下格式输出您的群聊总结报告：\n「群聊精华总结」\n❗️重要提醒： [如有 @所有人 或者置顶的信息，请在此处列出]\n今日热门话题\n[话题标题] ☆☆☆\n时间点：HH:MM - HH:MM\n内容摘要： [100-140字的讨论内容概括] ☑ 点评：[20-30字的简短评论]\n（重复上述格式，呈现5个主要话题）\n趣味互动\n[如有趣味性的互动，在此处简要描述]\n工具及其观点看法\n[如有人寻求推荐或者请求对某件事的看法，在此处简要描述问题和观点]\n待跟进事项\n[负责人]：[具体任务] (截止日期：MM月DD日)\n其他讨论话题\n[如果有更多话题，在此简要列出]\n结语\n[简短的总结语，鼓励继续积极参与讨论]"),
  // ---- 输出模式 ----
  output_mode: plugin.Form.string()
    .title("输出模式")
    .description("text=纯文字总结；image=文字总结+图片封面（MiniMax 画图）")
    .default("text"),
  // ---- 图片封面（image 模式用）----
  draw_api_key: plugin.Form.string().title("MiniMax 画图 API Key").default(""),
  draw_model: plugin.Form.string()
    .title("MiniMax 画图模型")
    .description("image-01 或 image-01-live")
    .default("image-01"),
  draw_aspect: plugin.Form.string()
    .title("封面画幅")
    .description("1:1 / 16:9 / 9:16 / 4:3 / 3:4")
    .default("16:9"),
  draw_prompt: plugin.Form.string()
    .title("封面提示词")
    .description("生成总结封面图的提示词，{topic} 会被替换为总结标题")
    .default("现代扁平插画风格，一群微信用户围坐在一起热烈讨论的群聊场景，手机屏幕上显示聊天记录和气泡，温暖明亮的色调，中央有标题「群聊精华总结」，简洁大气，适合作为聊天总结报告封面"),
});

// 消息去重与积累存储。键结构：<platform>:<chatId>:<时间戳>:<随机>（不依赖 msgId，兼容各平台）
async function recordMessage() {
  const platform = String((await s.getPlatform()) || "").toLowerCase();
  const chatId = String((await s.getChatId()) || "").trim();
  const userId = String((await s.getUserId()) || "").trim();
  const botId = String((await s.getBotId()) || "").trim();

  // 调试日志：便于在后端日志定位"为什么某条没记录"
  console.log(
    `[groupSummary] 收到 platform=${platform} chatId=${chatId} userId=${userId} botId=${botId} msg=${String((await s.getMsg()) || "").slice(0, 30)}`,
  );

  // 仅群聊（chatId 非空且不是私聊对等 ID），全平台通用
  if (!chatId || !userId || chatId === userId) {
    console.log(`[groupSummary] 跳过：非群聊（chatId=${chatId} userId=${userId}）`);
    return;
  }
  // 跳过机器人自己发的（避免记录自己触发的总结命令等）
  if (botId && userId === botId) {
    console.log(`[groupSummary] 跳过：机器人自己发的（userId=${userId}）`);
    return;
  }

  const raw = String((await s.getMsg()) || "").trim();
  if (!raw) return;

  // 内容归一化：非文本消息用 CQ 码占位描述；去掉 yyw 的 [YW.emoji] 尾巴
  let content = raw.replace(/\[YW\.[^\]]*\]/g, "");
  const cqMatch = content.match(/\[CQ:(\w+)/);
  if (cqMatch) {
    const type = cqMatch[1];
    const map = { image: "[图片]", record: "[语音]", video: "[视频]", file: "[文件]", at: "@" };
    content = map[type] || `[${type}]`;
    // 若整条只有 CQ 码，直接存占位；否则保留文本
    if (raw.replace(/\[CQ:[^\]]*\]/g, "").trim()) {
      content = raw.replace(/\[CQ:image[^\]]*\]/g, "[图片]").replace(/\[CQ:record[^\]]*\]/g, "[语音]").replace(/\[CQ:video[^\]]*\]/g, "[视频]").replace(/\[CQ:file[^\]]*\]/g, "[文件]");
    }
  }
  // 跳过纯命令消息（避免把"群聊总结"也存进去）
  if (/^(群聊总结|总结群聊)/.test(content)) return;

  const bucket = storeBucket;
  const groupPrefix = `${platform}:${chatId}:`;
  const now = Date.now();
  const nickname = String((await s.getUserName()) || userId);

  // 去重：5 秒内同群同发送者同内容视为重复（拦截中间件重复触发/同消息多次推送；
  // 不依赖 msgId，因为部分平台 getMsgId 不可靠会返回空或恒定值）
  const keys = (await bucket.keys()).filter((k) => k.startsWith(groupPrefix));
  const recent = [];
  for (const k of keys) {
    const v = await bucket.get(k);
    if (v && v.time) recent.push(v);
  }
  recent.sort((a, b) => b.time - a.time);
  const dup = recent.slice(0, 10).find(
    (r) => Math.abs(r.time - now) < 5000 && r.userId === userId && r.content === content,
  );
  if (dup) return;

  // 键：平台:群ID:时间戳:随机后缀
  const key = `${groupPrefix}${now}:${Math.random().toString(36).slice(2, 8)}`;

  await bucket.set(key, {
    time: Date.now(),
    userId,
    nickname,
    content,
  });

  // 控制单群存储量：超过 max_stored 时清掉该群最旧的
  const cfg = (await form.get()) || {};
  const maxStored = Number(cfg.max_stored) || 200;
  const allKeys = (await bucket.keys()).filter((k) => k.startsWith(groupPrefix));
  if (allKeys.length > maxStored + 100) {
    // 按存储时间排序，删最旧的
    const withTime = [];
    for (const k of allKeys) {
      const v = await bucket.get(k);
      if (v && v.time) withTime.push({ k, time: v.time });
    }
    withTime.sort((a, b) => a.time - b.time);
    const excess = withTime.length - maxStored;
    for (let i = 0; i < excess; i++) {
      await bucket.delete(withTime[i].k);
    }
  }
}

// 读取某群最近 N 条消息（按时间正序）
async function readRecentMessages(prefix, count) {
  const bucket = storeBucket;
  const keys = (await bucket.keys()).filter((k) => k.startsWith(prefix));
  const items = [];
  for (const k of keys) {
    const v = await bucket.get(k);
    if (v && v.time) items.push(v);
  }
  items.sort((a, b) => a.time - b.time);
  return items.slice(-count);
}

// 读取某群今天的消息
async function readTodayMessages(prefix) {
  const bucket = storeBucket;
  const keys = (await bucket.keys()).filter((k) => k.startsWith(prefix));
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const items = [];
  for (const k of keys) {
    const v = await bucket.get(k);
    if (v && v.time >= startOfDay) items.push(v);
  }
  items.sort((a, b) => a.time - b.time);
  return items;
}

// 格式化消息供 AI 总结
function formatMessages(items) {
  return items.map((m) => {
    const t = new Date(m.time);
    const hh = String(t.getHours()).padStart(2, "0");
    const mm = String(t.getMinutes()).padStart(2, "0");
    return `${hh}:${mm} ${m.nickname}：${m.content}`;
  }).join("\n");
}

// 调用 AI 总结
async function summarize(items, cfg) {
  const messages = formatMessages(items);
  const prompt = String(cfg.summarize_prompt || "").replace(/\{messages\}/g, messages);
  const res = await ai.chat({
    baseUrl: cfg.base_url,
    apiKey: cfg.api_key,
    model: cfg.model,
    messages: [
      { role: "system", content: "你是群聊总结助手。" },
      { role: "user", content: prompt },
    ],
    temperature: 0.4,
    maxTokens: 3000,
  });
  return String(res?.content || "").trim();
}

let cfg = {};
async function main() {
  // 中间件：先积累消息（如果匹配到总结命令则本轮跳过积累）
  cfg = (await form.get()) || {};
  const raw = String((await s.getMsg()) || "").trim();

  const isCmd = /^(群聊总结|总结群聊)/.test(raw);
  if (!isCmd) {
    await recordMessage();
    return s.resume();
  }

  // 全平台执行总结（Gewe/yyw/飞书等）
  const platform = String((await s.getPlatform()) || "").toLowerCase();
  const chatId = String((await s.getChatId()) || "").trim();
  const userId = String((await s.getUserId()) || "").trim();
  // 私聊不生效
  if (!chatId || chatId === userId) return s.reply("群聊总结仅在群聊中可用");

  const groupPrefix = `${platform}:${chatId}:`;

  // 解析参数：群聊总结 100 / 群聊总结 今天 / 群聊总结 清空
  const arg = (raw.match(/^(?:群聊总结|总结群聊)(?:\s+(.+))?$/) || [])[1] || "";
  const argTrim = arg.trim();

  if (argTrim === "状态") {
    // 显示本群积累情况，便于排查
    const bucket = storeBucket;
    const keys = (await bucket.keys()).filter((k) => k.startsWith(groupPrefix));
    const items = [];
    for (const k of keys) {
      const v = await bucket.get(k);
      if (v && v.time) items.push(v);
    }
    items.sort((a, b) => a.time - b.time);
    if (!items.length) return s.reply("本群暂无积累记录，群成员发的消息会由插件自动记录");
    const last = items.slice(-5).map((m) => {
      const t = new Date(m.time);
      return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")} ${m.nickname}：${m.content}`;
    }).join("\n");
    return s.reply(`本群已积累 ${items.length} 条（最近 5 条）：\n${last}`);
  }

  if (argTrim === "清空") {
    // 仅管理员可清空
    const isAdmin = await s.isAdmin();
    if (!isAdmin) return s.reply("仅管理员可清空群聊记录");
    const bucket = storeBucket;
    const keys = (await bucket.keys()).filter((k) => k.startsWith(groupPrefix));
    for (const k of keys) await bucket.delete(k);
    return s.reply(`已清空本群 ${keys.length} 条记录`);
  }

  // 读取消息
  let items = [];
  if (argTrim === "今天") {
    items = await readTodayMessages(groupPrefix);
  } else if (/^\d+$/.test(argTrim)) {
    const count = Math.min(Number(argTrim), 200);
    items = await readRecentMessages(groupPrefix, count);
  } else {
    const count = Number(cfg.default_count) || 50;
    items = await readRecentMessages(groupPrefix, count);
  }

  if (!items.length) return s.reply("本群还没有积累消息，先聊起来再总结吧");

  try {
    await s.reply(`正在总结最近 ${items.length} 条消息，请稍候…`);
    const summary = await summarize(items, cfg);
    if (!summary) return s.reply("总结生成失败，请稍后再试");

    if (String(cfg.output_mode || "text") === "image") {
      await sendSummaryWithImage(summary, cfg);
    } else {
      await sendTextSummary(summary);
    }
  } catch (error) {
    await s.reply(`群聊总结失败：${String(error?.message || error).slice(0, 120)}`);
  }
}

// 文字模式：直接发总结（框架通用 reply）
async function sendTextSummary(summary) {
  await s.reply(summary);
}

// 图片模式：文字总结 + MiniMax 画封面图（框架通用 CQ 发图）
async function sendSummaryWithImage(summary, cfg) {
  const drawKey = String(cfg.draw_api_key || "").trim();
  if (!drawKey) {
    // 没配画图 key 就退回纯文字
    return sendTextSummary(summary);
  }
  // 先发文字总结
  await sendTextSummary(summary);
  // 再画封面
  try {
    const title = (summary.match(/「(.+?)」/) || [])[1] || "群聊精华总结";
    const prompt = String(cfg.draw_prompt || "").replace(/\{topic\}/g, title);
    const urls = await draw.draw({
      provider: "minimax",
      apiKey: drawKey,
      model: cfg.draw_model || "image-01",
      prompt,
      aspectRatio: cfg.draw_aspect || "16:9",
    });
    const imgUrl = Array.isArray(urls) ? urls[0] : "";
    if (imgUrl) {
      await s.reply(`[CQ:image,url=${imgUrl}]`);
    }
  } catch (error) {
    // 画图失败不影响总结已发出
    console.log(`[groupSummary] 封面生成失败: ${error?.message || error}`);
  }
}

// 中间件 + 命令共用入口
main().catch(async (error) => {
  try {
    await s.reply(`群聊总结异常：${String(error?.message || error).slice(0, 120)}`);
  } catch (_) {}
});
