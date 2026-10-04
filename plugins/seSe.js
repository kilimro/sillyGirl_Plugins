// [title: 涩涩]
// [name: seSe]
// [desc: jkapi 随机图片命令；默认禁用，与 Python 源保持一致]
// [author: Jray_P]
// [version: v1.1.0]
// [rule: ^我要(乃子|美女|黑丝|白丝|头像|壁纸)$]
// [status: false]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 娱乐]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/涩涩_v1.0.8_By.Jray_P.py]
// [depe: []]

const { plugin, sender: s, utils } = require("sillygirl");

const config = new plugin.Form({
  notify_admin: plugin.Form.boolean().title("触发后通知管理员").default(false),
  notify_text: plugin.Form.string().title("通知文案").default("触发了随机图片"),
});

const commands = {
  我要乃子: ["yo_cup", "9d02cd6e10c51f16ccc27cc164ac4b6d", "乃子"],
  我要美女: ["meinv_img", "5139167a391a2f282283bc8eb28fe6ab", "美女"],
  我要黑丝: ["heisi_img", "9f2132d1e1ace9d304afe3c4e999e0ad", "黑丝"],
  我要白丝: ["baisi_img", "efa4842cc08a1265d7fe54f5dd4f1f32", "白丝"],
  我要头像: ["avatar_woman", "", "头像"],
  我要壁纸: ["bing_img", "", "壁纸"],
};

async function main() {
  const content = String((await s.getMsg()) || "").trim();
  const item = commands[content];
  if (!item) return s.resume();
  const [type, key, feature] = item;
  const url = new URL(`https://jkapi.com/api/${type}`);
  if (key) url.searchParams.set("apiKey", key);
  try {
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const cfg = await config.get();
    if (cfg.notify_admin)
      await s.pushAdmin(`${await s.getUserName()} ${cfg.notify_text || "触发了随机图片"} ${feature}`);
    return s.reply(utils.image(response.url));
  } catch (e) {
    return s.reply(`图片获取失败：${e.message}`);
  }
}

main();
