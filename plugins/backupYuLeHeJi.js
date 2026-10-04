// [title: Backup娱乐合集]
// [name: backupYuLeHeJi]
// [desc: 迁移 backup 中保安日记、疯狂星期四、懒羊羊、绿茶语录、生活常识、舔狗日记、笑话和美女插件]
// [author: qw21560,960342874,blycoris,kevin]
// [version: v1.0.0]
// [rule: ^(保安日记|疯狂星期四|周四|kfc|KFC|肯德基|懒羊羊|绿茶|常识|舔狗日记|美女)$|^笑话.*$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 100]
// [class: 娱乐]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/保安日记_v1.0.0_By.qw21560.txt;backup/疯狂星期四KFC_v1.0.0_By.qw21560.txt;backup/懒羊羊翻唱歌曲_v1.0.0_By.qw21560.txt;backup/绿茶语录_v1.0.0_By.qw21560.txt;backup/随机生活常识_v1.0.0_By.qw21560.txt;backup/舔狗日记_vv1.0.1_By.960342874.txt;backup/笑话_v1.0.0_By.blycoris.txt;backup/美女_v1.0.0_By.kevin.txt]
// [depe: []]

const { sender: s, plugin, Bucket, utils } = require("sillygirl");
const config = new plugin.Form({
  tianapi_key: plugin.Form.string().title("天行笑话 API Key").default(""),
  timeout_ms: plugin.Form.integer().title("请求超时毫秒").min(3000).max(60000).default(15000),
  beauty_cooldown: plugin.Form.integer().title("美女图片冷却秒数").min(0).max(3600).default(20),
});
const cooldown = new Bucket("backupYuLeHeJi.cooldown");
let cfg = {};

async function getText(url) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(cfg.timeout_ms),
    headers: { "user-agent": "Mozilla/5.0" },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 120)}`);
  return { text, response };
}

async function beauty() {
  const id = `${await s.getPlatform()}:${await s.getUserId()}`,
    now = Date.now(),
    last = Number(await cooldown.get(id, "0"));
  if (now - last < cfg.beauty_cooldown * 1000)
    return s.reply(`调用频繁，请 ${Math.ceil((cfg.beauty_cooldown * 1000 - now + last) / 1000)} 秒后再试`);
  await cooldown.set(id, String(now));
  return s.reply(utils.image(`http://api.yujn.cn/api/yht.php?type=image&t=${now}`));
}

async function joke() {
  if (!cfg.tianapi_key) return s.reply("请先在插件配置填写天行笑话 API Key");
  const { text } = await getText(
    `https://apis.tianapi.com/joke/index?key=${encodeURIComponent(cfg.tianapi_key)}&num=1`,
  );
  const data = JSON.parse(text),
    row = data?.result?.list?.[0] || data?.newslist?.[0];
  if (!row) throw new Error(data.msg || "笑话接口未返回内容");
  return s.reply(String(row.content || row.title || "").replace(/<[^>]+>/g, ""));
}

async function main() {
  try {
    const raw = (await config.get()) || {};
    cfg = {
      tianapi_key: String(raw.tianapi_key || ""),
      timeout_ms: Number(raw.timeout_ms) || 15000,
      beauty_cooldown: Number(raw.beauty_cooldown ?? 20),
    };
    const content = String((await s.getMsg()) || "").trim();
    if (content === "美女") return beauty();
    if (/^笑话/.test(content)) return joke();
    if (content === "懒羊羊") {
      const result = await getText("http://api.yujn.cn/api/lyy.php?type=video");
      return s.reply(utils.video(result.response.url || result.text.trim()));
    }
    if (content === "舔狗日记") return s.reply(utils.image(`https://api.suyanw.cn/api/tgbj.php?a=${Math.random()}`));
    const endpoints = {
      保安日记: "http://api.yujn.cn/api/baoan.php",
      疯狂星期四: "https://oiapi.net/API/KFC/",
      周四: "https://oiapi.net/API/KFC/",
      kfc: "https://oiapi.net/API/KFC/",
      KFC: "https://oiapi.net/API/KFC/",
      肯德基: "https://oiapi.net/API/KFC/",
      绿茶: "http://api.yujn.cn/api/lvchayy.php",
      常识: "https://api.yujn.cn/api/shcs.php",
    };
    const { text } = await getText(endpoints[content]);
    if (/KFC/i.test(endpoints[content] || "")) {
      const data = JSON.parse(text);
      return s.reply(data.message || data.msg || text);
    }
    return s.reply(text.trim());
  } catch (error) {
    return s.reply(`娱乐插件执行失败：${String(error?.message || error).slice(0, 300)}`);
  }
}
main();
