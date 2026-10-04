// [title: upsListen]
// [name: upsListen]
// [desc: 获取 UPS 状态并监控断电情况]
// [author: smallfawn]
// [version: v1.0.1]
// [rule: ^(ups)$]
// [status: false]
// [admin: true]
// [public: true]
// [priority: 0]
// [class: 工具]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: smallfawn/Bncr_Plugins]
// [depe: []]

const net = require("net");
const { sender: s, console, plugin } = require("sillygirl");

const config = new plugin.Form({
  ups_nut_server_ip: plugin.Form.string().title("ups-nut-server 地址").description("格式：192.168.x.x"),
  ups_nut_server_port: plugin.Form.number().title("ups-nut-server 端口").default(3493),
  ups_nut_server_username: plugin.Form.string().title("ups nut server 用户名").default("nut"),
  ups_nut_server_password: plugin.Form.string().title("ups nut server 密码").default("nut").widget("password"),
  ups_nut_server_ups_name: plugin.Form.string().title("ups nut server ups 名称").default("ups0"),
});
const testMap = {
  "Done and passed": "通过",
  "Done and warned": "警告",
  "Done and error": "错误",
  Aborted: "已中止",
  "In progress": "正在进行",
};

function queryNut(conf, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let buffer = "";
    let done = false;

    const finish = (error, data) => {
      if (done) return;
      done = true;
      client.destroy();
      if (error) reject(error);
      else resolve(data);
    };

    client.setTimeout(timeout, () => finish(new Error("UPS 查询超时")));
    client.on("error", (error) => finish(error));
    client.on("data", (data) => {
      buffer += data.toString();
      if (buffer.includes("END LIST")) finish(null, buffer);
      if (buffer.includes("ERR ")) finish(new Error(buffer.trim()));
    });
    client.connect(conf.ups_nut_server_port, conf.ups_nut_server_ip, () => {
      const upsName = conf.ups_nut_server_ups_name || "ups0";
      client.write(`USERNAME ${conf.ups_nut_server_username}\n`);
      client.write(`PASSWORD ${conf.ups_nut_server_password}\n`);
      client.write(`LIST VAR ${upsName}\n`);
    });
  });
}

function parseNut(rawData) {
  const vars = Object.fromEntries([...rawData.matchAll(/VAR \S+ (\S+) "(.*)"/g)].map((item) => [item[1], item[2]]));
  const status = vars["ups.status"] || "";
  const runtime = Number.parseInt(vars["battery.runtime"] || "0", 10);
  return {
    status,
    isPowerOff: status.includes("OB"),
    charge: vars["battery.charge"] || "N/A",
    load: vars["ups.load"] || "N/A",
    runtime: Number.isFinite(runtime) ? (runtime / 60).toFixed(1) : "N/A",
    inVolts: vars["input.voltage"] || "N/A",
    outVolts: vars["output.voltage"] || vars["ups.voltage"] || "N/A",
    testResult: vars["ups.test.result"] || "无记录",
  };
}

function buildMessage(status) {
  const translatedTest = testMap[status.testResult] || status.testResult;
  return [
    "-----------------------------------------",
    `电量：${status.charge}% | 续航：${status.runtime}分 | 负载：${status.load}%`,
    `输入：${status.inVolts}V | 输出：${status.outVolts}V | 自检：${translatedTest}`,
    "-----------------------------------------",
  ].join("\n");
}

async function main() {
  const conf = await config.get();

  if (!conf.ups_nut_server_ip) {
    await s.reply("未配置 ups-nut-server 地址。");
    return;
  }

  let status;
  try {
    status = parseNut(await queryNut(conf));
  } catch (error) {
    console.error("UPS 查询失败：%s", error.message);
    await s.reply(`UPS 查询失败：${error.message}`);
    return;
  }

  await s.reply(buildMessage(status));
}

main().catch((error) => {
  console.error(error);
});
