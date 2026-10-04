// [title: 王者战力查询]
// [name: wangZheZhanLiChaXun]
// [desc: 查询王者荣耀英雄最低战力地区]
// [author: sillyGirl]
// [version: v2.0.0]
// [rule: ^战力查询$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 娱乐]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/王者战力查询_v1.1.0_By.yuhualhh.py]
// [depe: []]

const { plugin, sender: s } = require("sillygirl");

const config = new plugin.Form({
  api_url: plugin.Form.string().title("查询接口").default("https://api.key5.site/API/king/new/index.php"),
  api_key: plugin.Form.string()
    .title("接口 Key")
    .default("50e7099a396e7cefcba6a5f1170f01a152334cd1bb36610d916c31cc1abb5819"),
  default_platform: plugin.Form.string().title("默认平台").default("ios_wx"),
});

async function main() {
  const cfg = (await config.get()) || {};
  s.reply("请发送：英雄名 平台；平台可选 qq、wx、ios_qq、ios_wx，省略时使用默认平台。");
  return s.listen({
    rules: ["raw ^([^\\s]+)(?:\\s+(qq|wx|ios_qq|ios_wx))?$"],
    timeout: 60000,
    user_id: await s.getUserId(),
    chat_id: await s.getChatId(),
    handle: (next) => lookup(next, cfg),
  });
}

async function lookup(next, cfg) {
  try {
    const hero = String((await next.param(1)) || "").trim();
    const type = String((await next.param(2)) || cfg.default_platform || "ios_wx").trim();
    if (!hero) throw new Error("英雄名为空");
    if (!/^(qq|wx|ios_qq|ios_wx)$/.test(type)) throw new Error("平台参数错误");
    const url = new URL(String(cfg.api_url || "https://api.key5.site/API/king/new/index.php"));
    const platformType = { qq: "0", wx: "1", ios_qq: "2", ios_wx: "3" }[type];
    url.search = new URLSearchParams({
      apikey: String(cfg.api_key || ""),
      heroName: hero,
      type: platformType,
      areaType: "1",
    });
    const response = await fetch(url, { headers: { accept: "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (data?.code !== undefined && Number(data.code) !== 200 && Number(data.code) !== 0)
      throw new Error(data.msg || `接口状态 ${data.code}`);
    const result = typeof data?.data === "string" ? data.data : JSON.stringify(data?.data ?? data, null, 2);
    return next.reply(`${hero}（${type}）\n${result.slice(0, 1800)}\n数据：夏柔 API / 墨白 API`);
  } catch (error) {
    return next.reply(`战力查询失败：${message(error)}`);
  }
}

function message(error) {
  return String(error?.message || error)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 300);
}

main();
