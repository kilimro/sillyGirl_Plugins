// [title: 消息面分析]
// [name: xiaoXiMianFenXi]
// [desc: 抓取网页正文并调用 DeepSeek OpenAI 兼容接口分析]
// [author: hdbjlizhe]
// [version: v1.1.0]
// [rule: ^(精读|总结|分析)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 工具]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/消息面分析_v1.0.1_By.hdbjlizhe.py]
// [depe: []]

const { plugin, sender: s } = require("sillygirl");

const defaultPrompt = `你是专业的文章分析助手。请严格按以下格式用中文返回：
📖 概述（50字内）
----------------------------
🔑 关键要点（4点）
----------------------------
📈 对股市的影响（100字内）
----------------------------
🏷️ 标签（3个）`;

const config = new plugin.Form({
  api_key: plugin.Form.string().title("DeepSeek Key").required(true),
  base_url: plugin.Form.string().title("API Base URL").default("https://api.deepseek.com/v1"),
  model: plugin.Form.string().title("模型").default("deepseek-chat"),
  template: plugin.Form.string().title("分析模板").default(defaultPrompt),
});

const cleanHtml = (html) =>
  String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();

async function loadArticle(url) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
    headers: {
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1",
    },
  });
  if (!response.ok) throw new Error(`网页 HTTP ${response.status}`);
  const html = await response.text();
  const title = cleanHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || response.url);
  return { title, content: cleanHtml(html).slice(0, 6000) };
}

async function analyze(article, cfg) {
  const response = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: cfg.template || defaultPrompt },
        {
          role: "user",
          content: `请分析以下文章：\n\n标题：${article.title}\n内容：${article.content.slice(0, 6000)}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 3500,
      top_p: 0.9,
    }),
  });
  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(raw.slice(0, 150));
  }
  if (!response.ok) throw new Error(data?.error?.message || `AI HTTP ${response.status}`);
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("AI 未返回正文");
  return text;
}

async function main() {
  const raw = await config.get();
  const cfg = {
    apiKey: String(raw.api_key || "").trim(),
    baseUrl: String(raw.base_url || "https://api.deepseek.com/v1").trim(),
    model: String(raw.model || "deepseek-chat").trim(),
    template: String(raw.template || defaultPrompt),
  };
  if (!cfg.apiKey) return s.reply("请先在插件配置填写 DeepSeek Key");
  await s.reply("请输入文章网址，回复 q 取消");
  return s.listen({
    rules: ["raw ^([\\s\\S]+)$"],
    timeout: 60000,
    user_id: await s.getUserId(),
    chat_id: await s.getChatId(),
    handle: async (next) => {
      const url = String((await next.param(1)) || "").trim();
      if (/^q$/i.test(url)) return "已取消";
      if (!/^https?:\/\//i.test(url)) return "请输入 http/https 网址";
      try {
        await next.reply("分析中，请稍候...");
        return await analyze(await loadArticle(url), cfg);
      } catch (e) {
        return `分析失败：${e.message}`;
      }
    },
  });
}

main();
