// [title: 实时天气]
// [name: shiShiTianQi]
// [desc: 查询实时天气、温度、湿度、风力和日出日落；支持“天气”及“北京天气”]
// [author: XiaoBo_]
// [version: v1.1.0]
// [rule: ^(天气|今天天气)$|^(.+)(天气)$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 工具]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/实时天气_v2.0.0_By.XiaoBo_.txt;backup/天气_v1.0.1_By.qw21560.txt]
// [depe: []]

const { sender: s, plugin } = require("sillygirl");

const config = new plugin.Form({
  city: plugin.Form.string().title("默认城市").default("北京"),
});

async function main() {
  const content = String(await s.getMsg()).trim();
  const conf = await config.get();
  const namedCity = content.match(/^(.+)天气$/)?.[1];
  const city = namedCity && namedCity !== "今天" ? namedCity : conf.city || "北京";
  const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=zh`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`天气接口 HTTP ${response.status}`);

  const data = await response.json();
  const current = data.current_condition?.[0];
  const today = data.weather?.[0];
  if (!current || !today) throw new Error("天气接口数据不完整");
  const place = data.nearest_area?.[0]?.areaName?.[0]?.value || city;
  const desc = current.lang_zh?.[0]?.value || current.weatherDesc?.[0]?.value || "未知";
  const astro = today.astronomy?.[0] || {};
  await s.reply(
    [
      `📍 ${place}：${desc}`,
      `🌡️ ${current.temp_C}℃（体感 ${current.FeelsLikeC}℃）  ${today.mintempC}~${today.maxtempC}℃`,
      `💧 湿度 ${current.humidity}%  💨 ${current.winddir16Point || ""} ${current.windspeedKmph}km/h`,
      `🌅 ${astro.sunrise || "--"}  🌇 ${astro.sunset || "--"}`,
    ].join("\n"),
  );
}

main().catch((error) => s.reply(`天气查询失败：${error.message}`));
