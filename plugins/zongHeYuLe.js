// [title: 综合娱乐插件]
// [name: zongHeYuLe]
// [desc: 油价、详细天气和多平台视频解析；按 backup Python 接口实现]
// [author: rujingxianghai,sky2022]
// [version: v2.0.0]
// [rule: ^油价(.+)$|^天气(.+)$|^(视频解析|解析视频)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 娱乐]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/综合娱乐插件_v1.2.0_By.rujingxianghai.py;backup/视频解析_v1.2.1_By.sky2022.py]
// [depe: []]

const { plugin, sender: s, utils } = require("sillygirl");

const config = new plugin.Form({
  weather_key: plugin.Form.string().title("天气 API Key").description("在 xxapi.cn 获取").default(""),
  video_api: plugin.Form.string().title("视频解析接口").default("https://api.qsy.ink/api/douyin"),
  video_key: plugin.Form.string().title("视频解析 Key").default("DYYY"),
});

const provinces = {
  北京: "11",
  天津: "12",
  河北: "13",
  山西: "14",
  河南: "41",
  山东: "37",
  上海: "31",
  江苏: "32",
  浙江: "33",
  安徽: "34",
  福建: "35",
  江西: "36",
  湖北: "42",
  湖南: "43",
  广东: "44",
  广西: "45",
  云南: "53",
  贵州: "52",
  海南: "46",
  重庆: "50",
  四川: "51",
  新疆: "65",
  内蒙古: "15",
  辽宁: "21",
  吉林: "22",
  宁夏: "64",
  陕西: "61",
  黑龙江: "23",
  西藏: "54",
  青海: "63",
  甘肃: "62",
};

const jsonRequest = async (url, options = {}) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(options.timeout || 30000), ...options });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`响应不是 JSON: ${text.slice(0, 120)}`);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.message || data.msg || text.slice(0, 80)}`);
  return data;
};

async function queryOil(province) {
  const id = provinces[province];
  if (!id) return `不支持“${province}”\n支持：${Object.keys(provinces).join("、")}`;
  const result = await jsonRequest("https://cx.sinopecsales.com/yjkqiantai/data/switchProvince", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0" },
    body: JSON.stringify({ provinceId: id }),
    timeout: 10000,
  });
  const d = result?.data?.provinceData;
  if (!d) throw new Error("接口未返回油价数据");
  const rows = [
    ["92号汽油", "GAS_92"],
    ["95号汽油", "GAS_95"],
    ["98号汽油", "GAS_98"],
    ["0号柴油", "CHECHAI_0"],
    ["10号柴油", "CHECHAI_10"],
  ]
    .filter(([, k]) => d[k] !== undefined && d[k] !== null && d[k] !== "")
    .map(([name, k]) => {
      const delta = Number(d[`${k}_STATUS`] || 0);
      return `${name}：${d[k]}元/升${delta ? `（${delta > 0 ? "+" : ""}${delta}）` : ""}`;
    });
  return `=====油价查询=====\n省份：${province}\n${rows.join("\n")}${d.START_DATE ? `\n更新时间：${d.START_DATE}` : ""}`;
}

async function queryWeather(city, key) {
  if (!key) return "请先在插件配置填写天气 API Key";
  const result = await jsonRequest(
    `https://v2.xxapi.cn/api/weatherDetails?city=${encodeURIComponent(city)}&key=${encodeURIComponent(key)}`,
    { timeout: 10000 },
  );
  if (Number(result.code) !== 200 || !result.data) throw new Error(result.msg || "天气查询失败");
  const list = result.data.data || [];
  const now = list[0] || {};
  const weather = [
    now.weather_from,
    now.weather_to && now.weather_to !== now.weather_from ? `转${now.weather_to}` : "",
  ].join("");
  const future = list
    .slice(1, 4)
    .map(
      (x) =>
        `${x.date || ""} ${x.day || ""}：${x.weather_from || ""}${x.weather_to && x.weather_to !== x.weather_from ? `转${x.weather_to}` : ""} ${x.low_temp || "?"}~${x.high_temp || "?"}℃`,
    );
  return `=====详细天气=====\n城市：${result.data.city || city}\n${now.date || ""} ${now.day || ""}\n天气：${weather}\n温度：${now.low_temp || "?"}~${now.high_temp || "?"}℃\n风向：${now.wind_from || ""} ${now.wind_level_from || ""}${future.length ? `\n---未来三天---\n${future.join("\n")}` : ""}`;
}

const extractUrl = (text) => (String(text).match(/https?:\/\/[^\s]+/i) || [])[0] || "";
async function resolveDouyin(url) {
  if (!/v\.douyin\.com/i.test(url)) return url;
  const response = await fetch(url, {
    redirect: "follow",
    method: "HEAD",
    signal: AbortSignal.timeout(10000),
    headers: { "user-agent": "Mozilla/5.0" },
  });
  const id = response.url.match(/\/video\/(\d+)/)?.[1];
  return id ? `https://www.iesdouyin.com/share/video/${id}` : response.url;
}

async function parseVideo(url, cfg, target = s) {
  const resolved = await resolveDouyin(url);
  let result;
  if (/api\.qsy\.ink\/api\/douyin/i.test(cfg.videoApi)) {
    const u = new URL(cfg.videoApi);
    u.searchParams.set("key", cfg.videoKey || "DYYY");
    u.searchParams.set("url", resolved);
    result = await jsonRequest(u, { headers: { accept: "*/*", "user-agent": "Aweme/348020" } });
  } else {
    result = await jsonRequest(cfg.videoApi, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: resolved, format: "json" }),
    });
  }
  if (![0, 200, "ok"].includes(result.code) && result.success !== true)
    throw new Error(result.message || result.msg || "解析失败");
  const d = result.data || result.result || {};
  const videos = (d.video_list || d.videos || []).filter(
    (x) => x?.url && !/免责声明|未经作者授权|播放量/.test(x.level || ""),
  );
  const pics = d.pics || d.images || [];
  const direct = d.video || d.url || videos[0]?.url;
  const lines = [
    d.title && `标题：${d.title}`,
    d.description && d.description !== d.title && `描述：${String(d.description).slice(0, 150)}`,
  ].filter(Boolean);
  if (lines.length) await target.reply(lines.join("\n"));
  if (direct) return target.reply(utils.video(direct));
  if (pics.length) return target.reply(pics.slice(0, 12).map(utils.image).join("\n"));
  throw new Error("未找到视频或图集地址");
}

async function main() {
  try {
    const content = String((await s.getMsg()) || "").trim();
    const raw = await config.get();
    const cfg = {
      weatherKey: String(raw.weather_key || "").trim(),
      videoApi: String(raw.video_api || "https://api.qsy.ink/api/douyin").trim(),
      videoKey: String(raw.video_key || "DYYY").trim(),
    };
    if (content.startsWith("油价")) return s.reply(await queryOil(content.slice(2).trim()));
    if (content.startsWith("天气")) return s.reply(await queryWeather(content.slice(2).trim(), cfg.weatherKey));
    await s.reply("请在 120 秒内发送视频分享链接，回复 q 取消");
    return s.listen({
      rules: ["raw ^([\\s\\S]+)$"],
      timeout: 120000,
      user_id: await s.getUserId(),
      chat_id: await s.getChatId(),
      handle: async (next) => {
        const input = String((await next.param(1)) || "").trim();
        if (/^q$/i.test(input)) return "已取消";
        const url = extractUrl(input);
        if (!url) return "未找到有效链接";
        try {
          await parseVideo(url, cfg, next);
        } catch (e) {
          return `视频解析失败：${e.message}`;
        }
      },
    });
  } catch (e) {
    return s.reply(`执行失败：${e.message}`);
  }
}

main();
