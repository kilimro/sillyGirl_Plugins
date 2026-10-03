// [title: 记忆存储模块]
// [name: memoryCore]
// [desc: 用户记忆存储与 AI 提取公共模块，供 aiChat 和 memoryNote 共用]
// [author: kilimro]
// [version: v1.0.0]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 大模型]
// [icon: https://ecmb.bdimg.com/tam-ogel/-341441530_114552854_88_88.png]
// [module: true]
// [origin: 自定义]
// [depe: []]

const MEMORY_BUCKET = "user_memories";

function bucketKey(platform, userId) {
  return `${platform}:${userId}`;
}

async function getBucket() {
  const { Bucket } = require("sillygirl");
  return new Bucket(MEMORY_BUCKET);
}

async function list(platform, userId) {
  const db = await getBucket();
  const raw = String(await db.get(bucketKey(platform, userId), "[]"));
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

async function upsert(platform, userId, key, value) {
  const k = String(key || "").trim();
  const v = String(value || "").trim();
  if (!k || !v) return false;
  const list = await list(platform, userId);
  const now = new Date().toISOString();
  const idx = list.findIndex((m) => m.key === k);
  if (idx >= 0) {
    list[idx].value = v;
    list[idx].updatedAt = now;
  } else {
    list.push({ key: k, value: v, updatedAt: now });
  }
  const db = await getBucket();
  await db.set(bucketKey(platform, userId), JSON.stringify(list));
  return true;
}

async function remove(platform, userId, key) {
  const k = String(key || "").trim();
  const list = await list(platform, userId);
  const filtered = list.filter((m) => m.key !== k);
  const db = await getBucket();
  await db.set(bucketKey(platform, userId), JSON.stringify(filtered));
  return list.length - filtered.length;
}

async function clear(platform, userId) {
  const db = await getBucket();
  await db.delete(bucketKey(platform, userId));
}

function formatContext(list) {
  if (!list || !list.length) return "";
  const lines = list.map((m) => `- ${m.key}：${m.value}`);
  return `\n【关于这个用户你之前记住的信息】\n${lines.join("\n")}\n用户提到这些信息时，直接用上，不要再说"我不知道"。`;
}

// 用大模型从一条用户消息里提取值得长期记住的个人事实
// opts: { baseUrl, apiKey, model, timeout }
async function extractFromMessage(content, opts) {
  const text = String(content || "").trim();
  if (!text) return null;
  const prompt = `判断下面这条用户消息是否包含值得长期记住的个人事实（生日、名字、昵称、喜好、职业、家庭、偏好、宠物、重要日期等）。
规则：
1. 只提取用户明确陈述的事实，不要猜测、不要提取临时问题或请求。
2. key 用简短中文标签（如"生日""昵称""喜欢的食物""职业"）。
3. value 保留原文关键信息。
4. 如果不值得记，返回 null。
只返回 JSON，不要解释：
- 值得记：{"key":"生日","value":"1990-01-01"}
- 不值得记：null

用户消息：${text}`;

  try {
    const baseUrl = String(opts.baseUrl || "").replace(/\/+$/, "");
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: "system", content: "你是一个信息提取助手，只输出 JSON，不要任何解释。" },
          { role: "user", content: prompt },
        ],
        temperature: 0,
        max_tokens: 200,
      }),
      signal: AbortSignal.timeout(opts.timeout || 15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const out = data?.choices?.[0]?.message?.content || "";
    const match = out.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const obj = JSON.parse(match[0]);
    if (obj && obj.key && obj.value) return obj;
    return null;
  } catch (_) {
    return null;
  }
}

module.exports = { list, upsert, remove, clear, formatContext, extractFromMessage, MEMORY_BUCKET };
