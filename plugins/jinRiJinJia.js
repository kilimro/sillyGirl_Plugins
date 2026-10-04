// [title: 今日金价]
// [name: jinRiJinJia]
// [desc: 查询实时金银价格，并按设定价格定时通知管理员]
// [author: 974566903@qq.com]
// [version: v1.8.1]
// [rule: ^今日金价$|^金价监控设置$|^金价监控通知$]
// [cron: */5 * * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 工具]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/今日金价_v1.7_By.974566903@qq.com.txt]
// [depe: []]

const { sender: s, Bucket, plugin } = require("sillygirl");

new plugin.Form({});
const store = new Bucket("goldPriceMonitor");
const API = "https://i.jzj9999.com/res/quote/pq.json";

async function quote() {
  const response = await fetch(`${API}?t=${Date.now()}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`金价接口 HTTP ${response.status}`);
  const items = (await response.json())?.items;
  if (!Array.isArray(items)) throw new Error("金价接口数据不完整");
  const gold = items.find((item) => item.code === "Au99.99");
  const silver = items.find((item) => item.code === "JZJ_ag");
  if (!gold) throw new Error("未找到 Au99.99 行情");
  return { gold, silver };
}

function number(item) {
  for (const key of ["newprice", "cur", "askprice", "bidprice", "high"]) {
    const value = Number(item?.[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return NaN;
}

function time(timestamp) {
  const date = new Date(Number(timestamp) * 1000);
  return Number.isNaN(date.getTime()) ? "未知" : date.toLocaleString("zh-CN", { hour12: false });
}

function summary({ gold, silver }) {
  const lines = ["今日金价信息", `黄金 Au99.99：${number(gold)} 元/克`, `更新时间：${time(gold.stime)}`];
  if (silver) lines.splice(2, 0, `白银（含税）：买入 ${silver.bidprice || "--"} / 卖出 ${silver.askprice || "--"}`);
  return lines.join("\n");
}

async function setMonitor(data) {
  await s.reply(`${summary(data)}\n请输入监控价格（输入 q 取消）`);
  await s.listen({
    rules: ["raw ^(.+)$"],
    timeout: 60000,
    handle: async (next) => {
      const input = String(await next.param(1)).trim();
      if (/^q$/i.test(input)) return next.reply("已取消设置");
      const target = Number(input);
      if (!Number.isFinite(target) || target <= 0) return next.reply("价格格式错误，请重新执行“金价监控设置”");
      await store.set("target", String(target));
      await store.set("last_notice", "0");
      return next.reply(`监控价格已设置为 ${target} 元/克`);
    },
  });
}

async function monitor(data, manual) {
  const current = number(data.gold);
  const target = Number(await store.get("target", ""));
  if (!Number.isFinite(target)) {
    if (manual) await s.reply(`${summary(data)}\n尚未设置监控价格`);
    return;
  }

  const exceeded = current >= target;
  const message = `${summary(data)}\n监控价：${target} 元/克\n${exceeded ? "⚠️ 已达到监控价格" : "当前未达到监控价格"}`;
  if (manual) await s.reply(message);
  if (!exceeded) return;

  const now = Date.now();
  const last = Number(await store.get("last_notice", "0"));
  if (now - last < 10 * 60 * 1000) return;
  await store.set("last_notice", String(now));
  await s.pushAdmin(message);
}

async function main() {
  const command = String(await s.getMsg().catch(() => "")).trim();
  const data = await quote();
  if (command === "今日金价") return s.reply(summary(data));
  if (command === "金价监控设置") return setMonitor(data);
  return monitor(data, command === "金价监控通知");
}

main().catch((error) => s.reply(`金价查询失败：${error.message}`));
