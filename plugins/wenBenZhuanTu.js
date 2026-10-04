// [title: 文本转图]
// [name: wenBenZhuanTu]
// [desc: 调用自建 /api/v1/render 将文本渲染为图片]
// [author: yuhualhh]
// [version: v1.1.0]
// [rule: ^文本转图$|^切换转图主题.*$|^设置转图接口.*$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 工具]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/文本转图_v1.0.3_By.yuhualhh.py]
// [depe: []]

const { plugin, sender: s, utils } = require("sillygirl");

const config = new plugin.Form({
  api_domain: plugin.Form.string()
    .title("文本转图接口")
    .description("例：127.0.0.1:3000 或 https://HOST")
    .default("127.0.0.1:3000"),
  theme: plugin.Form.string().title("主题").default("白蓝"),
});

const endpoint = (domain, path) => {
  const base = /^https?:\/\//i.test(domain) ? domain : `http://${domain}`;
  return `${base.replace(/\/$/, "")}${path}`;
};

async function render(text, cfg) {
  const response = await fetch(endpoint(cfg.domain, "/api/v1/render"), {
    method: "POST",
    signal: AbortSignal.timeout(115000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "image-text", content: text, template: cfg.theme, output: { return_type: "url" } }),
  });
  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`渲染响应异常：${raw.slice(0, 120)}`);
  }
  if (!response.ok) throw new Error(data.error || data.message || `HTTP ${response.status}`);
  if (data.image_url) return new URL(data.image_url, endpoint(cfg.domain, "/")).href;
  if (data.image_data) return `base64://${String(data.image_data).replace(/^data:image\/\w+;base64,/, "")}`;
  throw new Error(data.error || "接口未返回 image_url/image_data");
}

async function main() {
  try {
    const raw = await config.get();
    const cfg = {
      domain: String(raw.api_domain || "127.0.0.1:3000").trim(),
      theme: String(raw.theme || "白蓝").trim(),
    };
    const content = String((await s.getMsg()) || "").trim();
    if (content.startsWith("设置转图接口")) return s.reply("请直接在插件配置中填写文本转图接口，当前：" + cfg.domain);
    if (content.startsWith("切换转图主题")) {
      const response = await fetch(endpoint(cfg.domain, "/api/v1/templates"), { signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      const themes = data.templates || data.data || data;
      return s.reply(
        `当前主题：${cfg.theme}\n可用主题：${Array.isArray(themes) ? themes.map((x) => x.name || x).join("、") : JSON.stringify(themes)}`,
      );
    }
    await s.reply("请发送要转换的文本，回复 q 取消");
    return s.listen({
      rules: ["raw ^([\\s\\S]+)$"],
      timeout: 120000,
      user_id: await s.getUserId(),
      chat_id: await s.getChatId(),
      handle: async (next) => {
        const text = String((await next.param(1)) || "").trim();
        if (/^q$/i.test(text)) return "已取消";
        try {
          return utils.image(await render(text, cfg));
        } catch (e) {
          return `文本转图失败：${e.message}`;
        }
      },
    });
  } catch (e) {
    return s.reply(`文本转图失败：${e.message}`);
  }
}

main();
