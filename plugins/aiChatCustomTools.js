// ============================================================
// aiChat 自定义工具（示例模板）
// ------------------------------------------------------------
// 本文件与 aiChat.js 放在同一目录（plugins/local/）。
// aiChat 启动时会自动加载本文件并合并进工具列表：
//   - 文件不存在 / 语法错误 / 导出非数组：自动忽略，仅用内置工具
//   - 随「启用内置工具(enable_tools)」开关一并控制，无需单独开关
//
// 每个工具 = OpenAI function calling 对象 + execute 执行函数：
//   function.name       模型调用时使用的工具名（全局唯一，别与内置/其他自定义重名）
//   function.description 告诉模型“什么时候该调用我、参数是什么”，写得越清楚模型越准
//   function.parameters 参数 JSON Schema（OpenAI 标准）
//   execute(args)       真正干活：args 是模型填的参数对象，返回字符串即可
//                        （模型会把返回内容转述给用户）
//
// 注意事项：
//   1. execute 必须返回字符串（或能被 String() 正常转成字符串的值）
//   2. 网络请求请加超时（AbortSignal.timeout），失败要 throw 错误，模型会如实转述
//   3. 本项目是公开仓库：涉及密钥/内网地址的工具请只在你本地维护，
//      不要把真实 Key、Token、私有接口地址提交到 GitHub
// ============================================================
"use strict";

module.exports = [
  // ----- 示例 1：实时汇率换算（免费接口 open.er-api.com，无需 Key）-----
  {
    type: "function",
    function: {
      name: "get_exchange_rate",
      description:
        "查询实时汇率并换算金额，例如“100 美元等于多少人民币”“日元兑欧元汇率”。参数 from=源货币代码、to=目标货币代码、amount=金额(默认1)",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "源货币代码，如 USD/CNY/EUR/JPY" },
          to: { type: "string", description: "目标货币代码，如 CNY/USD" },
          amount: { type: "number", description: "要换算的金额，不填默认 1" },
        },
        required: ["from", "to"],
      },
    },
    async execute(args) {
      const from = String(args.from || "").toUpperCase().trim();
      const to = String(args.to || "").toUpperCase().trim();
      if (!from || !to) throw new Error("缺少 from/to 货币代码");
      const res = await fetch("https://open.er-api.com/v6/latest/" + encodeURIComponent(from), {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error("汇率接口 HTTP " + res.status);
      const data = await res.json();
      const rate = data?.rates?.[to];
      if (!rate) throw new Error("没有 " + to + " 的汇率数据");
      const amount = Number(args.amount) || 1;
      return `${amount} ${from} ≈ ${(amount * rate).toFixed(2)} ${to}（1 ${from} = ${rate} ${to}）`;
    },
  },

  // ----- 示例 2：一言（免费接口 v1.hitokoto.cn，无需 Key）-----
  {
    type: "function",
    function: {
      name: "get_hitokoto",
      description: "获取一句随机一言（名人名言/动漫台词/网络流行语），适合在聊天中活跃气氛",
      parameters: { type: "object", properties: {}, required: [] },
    },
    async execute() {
      const res = await fetch("https://v1.hitokoto.cn/?encode=json", {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error("一言接口 HTTP " + res.status);
      const data = await res.json();
      return `${data.hitokoto || ""} ——${data.from || "未知来源"}`;
    },
  },

  // ----- 示例 3：今日诗词（免费接口 v1.jinrishici.com，无需 Key）-----
  {
    type: "function",
    function: {
      name: "get_today_poem",
      description: "获取一首今日推荐的古诗词（含作者与释义方向），适合回答“今天有什么诗”这类问题",
      parameters: { type: "object", properties: {}, required: [] },
    },
    async execute() {
      const res = await fetch("https://v1.jinrishici.com/all.json", {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error("诗词接口 HTTP " + res.status);
      const data = await res.json();
      return `${data.content || ""} ——${data.author || ""}《${data.origin || ""}》`;
    },
  },
];
