// [title: 点歌]
// [name: dianGe]
// [desc: 发"点歌xxx"或"来一首xxx"搜索并分享歌曲。Gewe 平台发送音乐分享卡片（appmsg），其他平台发送纯文本信息。歌曲 API、key、参数名、卡片发送者均可在配置中设置。]
// [author: Mianpro官方]
// [version: v1.0.0]
// [rule: ^(点歌|来一首|来首)\s*(.+)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 工具]
// [icon: https://api.920pdd.com/favicon.ico]
// [origin: 自定义]
// [depe: ["./geweCore.js"]]

"use strict";
const { sender: s, plugin } = require("sillygirl");
const geweCore = require("./geweCore.js");

const form = new plugin.Form({
  music_api: plugin.Form.string()
    .title("歌曲搜索 API")
    .description("GET 请求地址，key 等参数自动拼接")
    .default("https://ovoav.com/api/musicv/music")
    .required(),
  api_key: plugin.Form.string().title("API Key").description("请求所需的 key 参数值").default("").required(),
  api_msg_param: plugin.Form.string().title("歌曲参数名").description("搜索关键词使用的参数名").default("msg"),
  api_n_param: plugin.Form.string().title("数量参数名").description("返回数量使用的参数名").default("n"),
  fromusername: plugin.Form.string()
    .title("音乐卡片发送者")
    .description("Gewe 音乐分享卡片的 fromusername，必填（留空则 Gewe 不发卡片）")
    .default(""),
});

// 简化 XML 转义，防止歌曲/歌手名里的特殊字符破坏卡片
function escapeXml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * 组装音乐分享卡片 XML（type=76）。
 * 字段说明：title=歌名、des=歌手、dataurl=播放地址、songalbumurl=封面。
 */
function buildAppmsgXml(song, singer, url, cover, fromusername) {
  return (
    `<appmsg appid="wx0aa69088a182a76e" sdkver="0">\n` +
    `\t\t<title>${escapeXml(song)}</title>\n` +
    `\t\t<des>${escapeXml(singer)}</des>\n` +
    `\t\t<type>76</type>\n` +
    `\t\t<dataurl>${escapeXml(url)}</dataurl>\n` +
    `\t\t<songalbumurl>${escapeXml(cover)}</songalbumurl>\n` +
    `\t\t<appattach>\n` +
    `\t\t\t<cdnthumbaeskey />\n` +
    `\t\t\t<aeskey />\n` +
    `\t\t</appattach>\n` +
    `\t</appmsg>\n` +
    `\t<fromusername>${escapeXml(fromusername)}</fromusername>\n` +
    `\t<scene>0</scene>\n` +
    `\t<appinfo>\n` +
    `\t\t<version>9</version>\n` +
    `\t\t<appname>网易邮箱大师Pro</appname>\n` +
    `\t</appinfo>\n` +
    `\t<commenturl></commenturl>`
  );
}

let cfg = {};
async function main() {
  cfg = (await form.get()) || {};
  const raw = String((await s.getMsg()) || "").trim();
  const m = raw.match(/^(点歌|来一首|来首)\s*(.+)$/);
  if (!m) return;
  const songName = m[2].trim();
  if (!songName) return;

  const toWxid = String((await s.getChatId()) || (await s.getUserId()) || "").trim();
  if (!toWxid) return;

  const platform = String((await s.getPlatform()) || "").toLowerCase();
  const isGewe = platform === "gewe";

  try {
    // 1. 拼搜索 URL
    const api = String(cfg.music_api || "").trim();
    const key = String(cfg.api_key || "").trim();
    const msgParam = String(cfg.api_msg_param || "").trim() || "msg";
    const nParam = String(cfg.api_n_param || "").trim() || "n";
    if (!api) return s.reply("点歌失败：未配置歌曲搜索 API");
    if (!key) return s.reply("点歌失败：未配置 API Key");

    const sep = api.includes("?") ? "&" : "?";
    const searchUrl = `${api}${sep}key=${encodeURIComponent(key)}&${encodeURIComponent(msgParam)}=${encodeURIComponent(songName)}&${encodeURIComponent(nParam)}=1`;

    // 2. 请求搜索 API
    const res = await fetch(searchUrl, {
      method: "GET",
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text().catch(() => "");
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return s.reply(`点歌失败：搜索接口返回异常（HTTP ${res.status}）`);
    }
    if (!data || data.code !== 200 || !data.data) {
      return s.reply("点歌失败：没有找到这首歌");
    }
    const music = data.data;
    const song = String(music.song || "");
    const singer = String(music.singer || "");
    const url = String(music.url || "");
    const cover = String(music.cover || "");
    const interval = String(music.interval || "");
    const link = String(music.link || "");
    if (!song || !url) return s.reply("点歌失败：搜索结果缺少歌曲或播放地址");

    // 3. 按平台发送
    if (isGewe) {
      const fromusername = String(cfg.fromusername || "").trim();
      if (!fromusername) {
        return s.reply("点歌失败：请先配置音乐卡片发送者（fromusername）");
      }
      const appmsg = buildAppmsgXml(song, singer, url, cover, fromusername);
      await geweCore.sendAppMsg({ toWxid, appmsg });
      return; // 卡片本身就是结果，不再回复冗余文字
    }
    // 其他平台：纯文本
    const lines = [`🎵 ${song}${singer ? ` - ${singer}` : ""}`];
    if (interval) lines.push(`⏱️ 时长：${interval}`);
    if (link) lines.push(`🔗 ${link}`);
    await s.reply(lines.join("\n"));
  } catch (error) {
    await s.reply(`点歌失败：${String(error?.message || error).slice(0, 120)}`);
  }
}

main().catch(async (error) => {
  try {
    await s.reply(`点歌异常：${String(error?.message || error).slice(0, 120)}`);
  } catch (_) {}
});
