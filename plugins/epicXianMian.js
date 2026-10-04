// [title: Epic限免]
// [name: epicXianMian]
// [desc: 查询 Epic Games Store 当前和即将开始的免费领取游戏]
// [author: buzhi]
// [version: v1.0.3]
// [rule: ^(epic|EPIC|Epic)限免$|^(epic|EPIC|Epic)限免?$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 任务]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/Epic限免_v1.0.1_By.buzhi.txt]
// [depe: []]

const { plugin, sender: s } = require("sillygirl");

const API = "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions";
const config = new plugin.Form({
  locale: plugin.Form.string().title("地区语言").default("zh-CN"),
  country: plugin.Form.string().title("国家代码").default("CN"),
  show_upcoming: plugin.Form.boolean().title("显示即将限免").default(true),
});

async function main() {
  const cfg = normalizeConfig(await config.get());
  try {
    const url = `${API}?${new URLSearchParams({
      locale: cfg.locale,
      country: cfg.country,
      allowCountries: cfg.country,
    })}`;
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const offers = parseOffers(await response.json(), new Date());
    const sections = [];
    if (offers.current.length) sections.push(formatSection("正在限免", offers.current, cfg.locale));
    if (cfg.showUpcoming && offers.upcoming.length)
      sections.push(formatSection("即将限免", offers.upcoming, cfg.locale));
    await s.reply(sections.length ? sections.join("\n\n") : "当前没有查到 Epic 限免游戏");
  } catch (error) {
    await s.reply(`Epic限免查询失败：${message(error)}`);
  }
}

function normalizeConfig(raw) {
  const value = raw || {};
  const country = String(value.country || "CN")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new Error("国家代码必须是两个英文字母");
  return {
    locale: String(value.locale || "zh-CN").trim() || "zh-CN",
    country,
    showUpcoming: value.show_upcoming !== false,
  };
}

function parseOffers(payload, now) {
  const elements = payload?.data?.Catalog?.searchStore?.elements;
  if (!Array.isArray(elements)) throw new Error("Epic 返回结构缺少游戏列表");
  const current = [];
  const upcoming = [];
  for (const item of elements) {
    collectPromotions(item, item?.promotions?.promotionalOffers, now, current, false);
    collectPromotions(item, item?.promotions?.upcomingPromotionalOffers, now, upcoming, true);
  }
  return { current: unique(current), upcoming: unique(upcoming) };
}

function collectPromotions(item, groups, now, output, futureOnly) {
  if (!Array.isArray(groups)) return;
  for (const group of groups) {
    for (const offer of group?.promotionalOffers || []) {
      if (Number(offer?.discountSetting?.discountPercentage) !== 0) continue;
      const start = new Date(offer.startDate);
      const end = new Date(offer.endDate);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) continue;
      if (futureOnly ? start <= now : !(start <= now && now < end)) continue;
      output.push({
        title: String(item.title || "未命名游戏"),
        start,
        end,
        url: storeUrl(item),
      });
    }
  }
}

function storeUrl(item) {
  const mapping = item?.offerMappings?.[0] || item?.catalogNs?.mappings?.[0];
  const slug = mapping?.pageSlug || item?.productSlug || item?.urlSlug;
  return slug
    ? `https://store.epicgames.com/p/${String(slug).replace(/^\/+|\/+$/g, "")}`
    : "https://store.epicgames.com/free-games";
}

function unique(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.title}|${item.start.toISOString()}|${item.end.toISOString()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatSection(title, items, locale) {
  return [
    title,
    ...items.map((item) =>
      [`• ${item.title}`, `${formatTime(item.start, locale)} - ${formatTime(item.end, locale)}`, item.url].join("\n"),
    ),
  ].join("\n");
}

function formatTime(value, locale) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

function message(error) {
  return String(error?.message || error)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 300);
}

main();
