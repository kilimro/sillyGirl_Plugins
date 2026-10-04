// [title: getPrinterStatus]
// [name: getPrinterStatus]
// [desc: 定时获取打印机状态，支持 IPP 打印测试图片]
// [author: smallfawn]
// [version: v1.0.1]
// [rule: ^(打印机|打印机状态|打印测试图片)$]
// [status: false]
// [admin: true]
// [public: true]
// [priority: 0]
// [class: 工具]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: smallfawn/Bncr_Plugins]
// [depe: ["ipp"]]

const http = require("http");
const https = require("https");
const ipp = require("ipp");
const { promisify } = require("node:util");
const { sender: s, console, plugin } = require("sillygirl");

const config = new plugin.Form({
  print_url: plugin.Form.string().title("打印机 IPP 地址").description("格式：http://192.168.x.x:631/ipp/print"),
  test_enable: plugin.Form.boolean().title("是否开启每周自动打印测试图防止堵头").default(false),
  test_image: plugin.Form.string()
    .title("测试打印图片地址")
    .default(
      "https://raw.githubusercontent.com/smallfawn/Bncr_Plugins/main/plugins/smallfawn/assets/printer_test.jpeg",
    ),
});
class PrinterService {
  async execute(operation, message, url) {
    if (!url) throw new Error("打印机 URL 未提供，请先设置 print_url");
    const printer = ipp.Printer(url);
    const execute = promisify(printer.execute).bind(printer);
    return execute(operation, message);
  }

  async getStatus(url) {
    const msg = {
      "operation-attributes-tag": {
        "requesting-user-name": "SillyGirl-Monitor",
        "attributes-charset": "utf-8",
        "attributes-natural-language": "zh-cn",
        "printer-uri": url,
        "requested-attributes": [
          "printer-is-accepting-jobs",
          "printer-state",
          "printer-state-reasons",
          "marker-names",
          "marker-levels",
        ],
      },
    };
    const res = await this.execute("Get-Printer-Attributes", msg, url);
    const attrs = res["printer-attributes-tag"] || {};
    const reasonMap = {
      none: "就绪",
      "media-empty-report": "缺纸",
      "media-jam": "卡纸",
      "marker-supply-low": "墨水余量低",
      "marker-supply-empty": "墨水耗尽",
      "cover-open": "扫描盖未关好",
      "door-open": "维修门未关严",
      offline: "打印机离线",
    };
    const stateMap = { idle: "idle", processing: "processing", stopped: "stopped" };
    const colorMap = { "Black ink": "黑", "Cyan ink": "青", "Magenta ink": "洋红", "Yellow ink": "黄" };
    const rawReasons = attrs["printer-state-reasons"] || [];
    const reasonList = Array.isArray(rawReasons) ? rawReasons : [rawReasons];
    const warnings = reasonList.filter((r) => r !== "none").map((r) => reasonMap[r] || `其他故障 (${r})`);
    const ink = {};
    if (attrs["marker-names"] && attrs["marker-levels"]) {
      attrs["marker-names"].forEach((name, index) => {
        ink[colorMap[name] || name] = attrs["marker-levels"][index];
      });
    }
    return {
      isAccepting: attrs["printer-is-accepting-jobs"],
      warnings: warnings.length ? warnings : ["状态正常"],
      deviceState: stateMap[attrs["printer-state"]] || `未知状态 (${attrs["printer-state"]})`,
      inkLevels: ink,
    };
  }

  async printJob(filename, buffer, mimetype, url, copies = 1) {
    const msg = {
      "operation-attributes-tag": {
        "requesting-user-name": "SillyGirl-Print",
        "job-name": filename,
        "document-format": mimetype,
        "printer-uri": url,
      },
      "job-attributes-tag": {
        copies,
        sides: "one-sided",
        media: "iso_a4_210x297mm",
      },
      data: buffer,
    };
    const res = await this.execute("Print-Job", msg, url);
    if (res.statusCode !== "successful-ok") {
      throw new Error(`打印机拒绝任务：${res.statusCode}`);
    }
    return res["job-attributes-tag"]["job-id"];
  }
}

const printer = new PrinterService();

function downloadBuffer(url, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const req = client.get(url, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        resolve({
          buffer: Buffer.concat(chunks),
          contentType: res.headers["content-type"] || "",
        });
      });
    });
    req.setTimeout(timeout, () => req.destroy(new Error("下载图片超时")));
    req.on("error", reject);
  });
}

async function getPrinterStatus() {
  const conf = await config.get();
  const url = conf.print_url;
  if (!url) return "打印机 URL 未配置";

  let status;
  try {
    status = await printer.getStatus(url);
  } catch (error) {
    console.error(error);
    status = { deviceState: "unknown", warnings: ["无法获取状态"], inkLevels: {} };
  }

  const stateMap = { idle: "空闲", processing: "处理中", stopped: "已停止" };
  const deviceStateZh = stateMap[status.deviceState] || status.deviceState;
  const warningsStr = status.warnings.join("，");
  const inkStr =
    Object.entries(status.inkLevels)
      .map(([name, level]) => `${name} ${level}%`)
      .join("/") || "无余墨信息";
  return `打印机状态：${deviceStateZh}，警告：${warningsStr}，墨量：${inkStr}`;
}

async function printTest() {
  const conf = await config.get();
  const imageUrl = conf.test_image;
  const printUrl = conf.print_url;
  if (!imageUrl || !printUrl) return "测试图片地址或打印机 URL 未配置";

  let filename = imageUrl.split("/").pop() || "test_print.jpg";
  if (!filename.includes(".")) filename += ".jpg";

  try {
    const response = await downloadBuffer(imageUrl);
    let contentType = response.contentType;
    if (!contentType || !contentType.startsWith("image/")) {
      contentType = filename.endsWith(".png") ? "image/png" : "image/jpeg";
    }
    const jobId = await printer.printJob(filename, response.buffer, contentType, printUrl, 1);
    const status = await getPrinterStatus();
    return `测试图片打印成功，任务ID：${jobId}\n${status}`;
  } catch (error) {
    let message = `打印测试图片失败：${error.message}`;
    try {
      message += `\n当前打印机状态：${await getPrinterStatus()}`;
    } catch (statusError) {
      message += `\n获取打印机状态也失败：${statusError.message}`;
    }
    return message;
  }
}

async function content() {
  try {
    return await s.getMsg();
  } catch (error) {
    return "";
  }
}

async function main() {
  const conf = await config.get();

  if (!conf.print_url) {
    await s.reply("未输入打印机 IPP 地址，退出。");
    return;
  }

  const msg = await content();
  if (msg === "打印测试图片") {
    if (!conf.test_enable) {
      await s.reply("未启用打印测试图片，跳过打印。");
      return;
    }
    await s.reply("开始打印测试图片，请稍后。");
    await s.reply(await printTest());
    return;
  }
  await s.reply(await getPrinterStatus());
}

main().catch((error) => {
  console.error(error);
});
