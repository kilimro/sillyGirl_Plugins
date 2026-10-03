#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");

const buckets = new Map();
const replies = [];
let content = "现在几点了";

class Bucket {
  constructor(name) {
    this.name = name;
    if (!buckets.has(name)) buckets.set(name, new Map());
  }
  async get(key, fallback = "") {
    return buckets.get(this.name).has(String(key)) ? buckets.get(this.name).get(String(key)) : fallback;
  }
  async set(key, value) {
    buckets.get(this.name).set(String(key), value);
    return true;
  }
  async delete(key) {
    buckets.get(this.name).delete(String(key));
    return true;
  }
}

const chain = () => {
  const value = {};
  for (const method of [
    "title",
    "description",
    "default",
    "min",
    "max",
    "widget",
    "options",
    "format",
    "required",
    "visibleWhen",
    "match",
    "err",
    "multiple",
    "keyBy",
  ])
    value[method] = () => value;
  return value;
};
function Form() {
  this.get = async () => ({
    base_url: "https://api.example.com/v1",
    api_key: "sk-test",
    model: "gpt-4o-mini",
    system_prompt: "你是{nickname}，现在是{now}",
    trigger_prefix: "ai",
    context_rounds: 5,
    reply_probability: 0,
    enable_tools: true,
    temperature: 0.8,
    max_tokens: 200,
    timeout: 3000,
    enable_group: true,
    enable_private: true,
  });
}
for (const name of ["string", "integer", "number", "boolean", "select", "array", "object"]) Form[name] = chain;

const sender = {
  getMsg: async () => content,
  getUserId: async () => "fixture-user",
  getChatId: async () => "",
  getPlatform: async () => "qq",
  getUserName: async () => "测试用户",
  isAdmin: async () => false,
  reply: async (text) => {
    replies.push(String(text));
    return text;
  },
  resume: async () => {
    replies.push("__RESUMED__");
  },
  pushAdmin: async () => true,
};

const fake = { Bucket, sender, plugin: { Form } };
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "sillygirl") return fake;
  return originalLoad.call(this, request, parent, isMain);
};

const apiCalls = [];
global.fetch = async (input, options = {}) => {
  apiCalls.push(String(input));
  const body = JSON.parse(String(options.body || "{}"));
  // 第一次：模型决定调用 get_current_time
  if (!body.messages.some((m) => m.role === "tool")) {
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "get_current_time", arguments: "{}" },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  // 第二次：工具结果已回填，模型给出最终自然语言回答
  return new Response(JSON.stringify({ choices: [{ message: { content: "现在是测试时间 12:00:00" } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

(async () => {
  content = "现在几点了";
  require(path.join(root, "plugins", "aiChat.js"));
  await settle();

  assert.equal(apiCalls.length, 2, `应发生 2 次模型请求，实际 ${apiCalls.length}`);
  assert.equal(replies.length, 1, `应回复 1 条，实际 ${replies.length}`);
  assert.match(replies[0], /12:00:00/, `最终回复应包含工具时间：${replies[0]}`);

  // 验证历史被写入 Bucket（用户问 + AI 答）
  const historyRaw = [...buckets.values()][0]?.get?.("qq:fixture-user:fixture-user") || "";
  const history = JSON.parse(historyRaw);
  assert.equal(history.length, 2);
  assert.equal(history[0].role, "user");
  assert.equal(history[0].content, "现在几点了");
  assert.equal(history[1].role, "assistant");

  console.log(`ai_chat_tools_fixtures=PASS api_calls=${apiCalls.length} replies=${replies.length}`);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 50));
}
