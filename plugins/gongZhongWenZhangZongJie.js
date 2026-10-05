// [title: 公众号文章总结]
// [name: gongZhongWenZhangZongJie]
// [desc: 在指定群里发送公众号文章链接，自动总结并生成图文海报]
// [author: Mianpro官方]
// [version: v1.0.0]
// [rule: raw (https?://mp\.weixin\.qq\.com/\S+)]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 100]
// [class: 工具]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/02//KvIKMsPkVYKyKBoQ.png]
// [origin: 自定义]
// [depe: []]

const { sender: s, plugin, utils } = require("sillygirl");

const form = new plugin.Form({
  api_url: plugin.Form.string()
    .title("总结接口地址")
    .description("末尾会自动拼接 ?url=文章链接")
    .default("")
    .required(),
  room_ids: plugin.Form.string().title("允许的群号").description("多个群号用英文逗号分隔，私聊不触发").default(""),
});

async function main() {
  const cfg = (await form.get()) || {};
  const api = String(cfg.api_url || "").trim();
  const allowed = String(cfg.room_ids || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (!api || !allowed.length) return;

  const chatId = String((await s.getChatId()) || "");
  const userId = String((await s.getUserId()) || "");
  // 私聊不触发
  if (!chatId || chatId === userId) return;
  // 只在指定群触发
  if (!allowed.includes(chatId)) return;

  const content = String((await s.getMsg()) || "");
  const m = content.match(/https?:\/\/mp\.weixin\.qq\.com\/\S+/);
  if (!m) return;
  const url = m[0];

  await s.reply("收到公众号文章链接，正在总结并生成图文海报，请稍候（生成图片耗时较长，请耐心等待）");

  try {
    const apiUrl = `${api}?url=${encodeURIComponent(url)}`;
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(600000) });
    if (!res.ok) return s.reply(`请求失败 HTTP ${res.status}`);
    const data = await res.json();
    if (data?.code !== 200) return s.reply(`处理失败：${data?.msg || "未知错误"}`);

    const summary = String(data?.data?.summary_content || "");
    const imageUrl = String(data?.data?.image_url || "");

    if (!imageUrl) {
      return s.reply(`文章总结完成：\n${summary}\n图片生成失败，未获取图片链接`);
    }
    await s.reply(`文章摘要：\n${summary}`);
    await new Promise((r) => setTimeout(r, 300));
    return s.reply(utils.image(imageUrl));
  } catch (error) {
    return s.reply(`请求异常：${String(error?.message || error).slice(0, 300)}`);
  }
}

main().catch(async (error) => {
  try {
    await s.reply(`公众号总结异常：${String(error?.message || error).slice(0, 300)}`);
  } catch (_) {}
});
