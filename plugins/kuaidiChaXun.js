// [title: 快递查询]
// [name: kuaidiChaXun]
// [desc: 发"查快递圆通YT7644075867052"查快递物流，支持圆通/申通/顺丰/韵达/中通/EMS/京东/邮政/百世/极兔/德邦]
// [author: Mianpro官方]
// [version: v2.0.0]
// [rule: ^查快递(.+)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 50]
// [class: 工具]
// [icon: https://cdn.kuaidi100.com/images/openApiWeb/common/favicon.ico]
// [origin: 自定义]
// [depe: []]

const { sender: s, plugin } = require("sillygirl");

const COM_MAP = {
  圆通: "yuantong",
  圆通速递: "yuantong",
  申通: "shentong",
  申通快递: "shentong",
  顺丰: "shunfeng",
  顺丰速运: "shunfeng",
  韵达: "yunda",
  韵达快递: "yunda",
  中通: "zhongtong",
  中通快递: "zhongtong",
  ems: "ems",
  EMS: "ems",
  京东: "jd",
  京东物流: "jd",
  邮政: "youzhengguonei",
  邮政快递: "youzhengguonei",
  百世: "huitongkuaidi",
  百世快递: "huitongkuaidi",
  极兔: "jtexpress",
  极兔速递: "jtexpress",
  德邦: "debangkuaidi",
  德邦快递: "debangkuaidi",
};

const form = new plugin.Form({
  api_key: plugin.Form.string().title("API Key (id)").default("").required(),
});

async function main() {
  const cfg = (await form.get()) || {};
  if (!String(cfg.api_key || "").trim()) return;

  const raw = String((await s.getMsg()) || "").trim();
  const m = raw.match(/^查快递(.+)$/);
  if (!m) return;
  const input = m[1].trim();
  if (!input) return;

  // 从开头匹配快递公司名
  let com = "";
  let nu = input;
  for (const name of Object.keys(COM_MAP).sort((a, b) => b.length - a.length)) {
    if (input.startsWith(name)) {
      com = COM_MAP[name];
      nu = input.slice(name.length).trim();
      break;
    }
  }
  if (!com)
    return s.reply(
      "请指定快递公司，例如：查快递圆通YT7644075867052\n支持：圆通/申通/顺丰/韵达/中通/EMS/京东/邮政/百世/极兔/德邦",
    );
  if (!nu) return s.reply("请输入快递单号");

  try {
    const url = `http://api.kuaidi.com/openapi.html?id=${cfg.api_key}&com=${com}&nu=${encodeURIComponent(nu)}&show=0&muti=1&order=desc`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { "user-agent": "Mozilla/5.0" },
    });
    if (!res.ok) return s.reply(`查询失败 HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.success || !Array.isArray(data.data) || !data.data.length) {
      return s.reply(data?.reason || "未查到物流信息，请确认快递公司和单号是否正确");
    }
    const lines = data.data.map((item) => `${item.time}\n  ${item.context}`);
    await s.reply(`快递 ${nu} 物流：\n\n${lines.join("\n\n")}`);
  } catch (error) {
    await s.reply(`快递查询失败：${String(error?.message || error).slice(0, 200)}`);
  }
}

main().catch(async (error) => {
  try {
    await s.reply(`快递查询异常：${String(error?.message || error).slice(0, 200)}`);
  } catch (_) {}
});
