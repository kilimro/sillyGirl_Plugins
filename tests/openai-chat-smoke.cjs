#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");

const calls = [];
let nextResponse = { status: 200, body: { choices: [{ message: { content: "fixture-reply" } }] } };

global.fetch = async (input, options = {}) => {
  calls.push({ url: String(input), options });
  const status = nextResponse.status || 200;
  const body = typeof nextResponse.body === "string" ? nextResponse.body : JSON.stringify(nextResponse.body || {});
  return new Response(body, { status, headers: { "content-type": "application/json" } });
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "sillygirl") return {};
  return originalLoad.call(this, request, parent, isMain);
};

(async () => {
  const core = require(path.join(root, "plugins", "openaiChatCore.js"));

  assert.equal(core.normalizeBaseUrl("api.openai.com"), "https://api.openai.com/chat/completions");
  assert.equal(core.normalizeBaseUrl("https://api.openai.com/v1/"), "https://api.openai.com/v1/chat/completions");
  assert.equal(
    core.normalizeBaseUrl("https://example.com/v1/chat/completions"),
    "https://example.com/v1/chat/completions",
  );

  assert.equal(core.maskKey("sk-1234567890abcdef"), "sk-1***cdef");
  assert.equal(core.maskKey("short"), "***");

  const history = [
    { role: "user", content: "你好" },
    { role: "assistant", content: "嗨" },
    { role: "user", content: "在吗" },
    { role: "assistant", content: "在的" },
    { role: "user", content: "今天天气" },
  ];
  const trimmed = core.trimHistory(history, 1);
  assert.equal(trimmed.length, 2);
  assert.equal(trimmed[0].content, "在的");
  assert.equal(trimmed[1].content, "今天天气");

  const messages = core.buildMessages("你是助手", history, "继续问");
  assert.equal(messages[0].role, "system");
  assert.equal(messages[0].content, "你是助手");
  assert.equal(messages[messages.length - 1].role, "user");
  assert.equal(messages[messages.length - 1].content, "继续问");

  nextResponse = {
    status: 200,
    body: { choices: [{ message: { content: "你好呀" } }] },
  };
  const result = await core.chat({
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "hi" }],
    timeout: 3000,
  });
  assert.equal(result.content, "你好呀");
  const lastCall = calls[calls.length - 1];
  assert.equal(lastCall.url, "https://api.example.com/v1/chat/completions");
  const sent = JSON.parse(lastCall.options.body);
  assert.equal(sent.model, "gpt-4o-mini");
  assert.equal(sent.stream, false);
  assert.equal(lastCall.options.headers.authorization, "Bearer sk-test");

  nextResponse = { status: 401, body: { error: { message: "invalid api key" } } };
  await assert.rejects(
    () =>
      core.chat({
        baseUrl: "https://api.example.com/v1",
        apiKey: "bad",
        model: "gpt-4o-mini",
        messages: [],
        timeout: 3000,
      }),
    /HTTP 401/,
  );

  console.log(`openai_chat_core_fixtures=PASS requests=${calls.length}`);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
