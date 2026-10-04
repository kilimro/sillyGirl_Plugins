// [title: 粉象生活]
// [name: fenXiangShengHuo]
// [desc: 粉象生活账号管理、签到、余额查询和提现。]
// [author: sillyGirl]
// [version: v1.0.1]
// [rule: ^\s*粉象(登录|管理|查询|一键运行|全部签到|全部提现|提现|授权|签到)\s*$]
// [cron: 38 0,22 * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 20]
// [class: 任务]
// [icon: https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/puzzle.svg]
// [origin: backup/彼得_粉象生活_vV6.25_By.Bidepan.py;backup/粉象生活_vV6.35_By.sky2022.py;backup/粉象生活（授权版）_vV6.26_By.linzixuan.py;backup/wqwl-粉象生活_v1.0.3_By.wqwlkj2985.js;backup/wqwl-粉象生活_v1.0.3_By.wqwlkj2985.txt]
// [depe: []]

const crypto = require("node:crypto");
const http = require("node:http");
const https = require("node:https");
const zlib = require("node:zlib");
const { sender: s, Bucket, plugin, console } = require("sillygirl");

let userIdx = 0;
let strSplitor = "#";

const DEFAULTS = {
  cron_run: true,
  random_user: false,
  sign_date: "20260428",
  sign_end_date: "20260504",
  request_timeout: 20000,
};

const pluginConfig = new plugin.Form({
  cron_run: plugin.Form.boolean()
    .title("定时自动运行")
    .description("cron 触发时自动执行粉象一键运行")
    .default(DEFAULTS.cron_run),
  random_user: plugin.Form.boolean()
    .title("任务账号乱序")
    .description("管理员一键运行时是否随机账号顺序")
    .default(DEFAULTS.random_user),
  sign_date: plugin.Form.string()
    .title("临时签到期数")
    .description("粉象临时签到 activityId，默认沿用旧插件")
    .default(DEFAULTS.sign_date),
  sign_end_date: plugin.Form.string()
    .title("临时签到结束日期")
    .description("格式如 20260504")
    .default(DEFAULTS.sign_end_date),
  request_timeout: plugin.Form.integer().title("接口超时毫秒").min(3000).max(120000).default(DEFAULTS.request_timeout),
});

let runtimeConfig = Object.assign({}, DEFAULTS);
const $ = {
  log: (...args) => console.log(args.map((v) => (typeof v === "string" ? v : safeJson(v))).join(" ")),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, Number(ms) || 0)),
};

function normalizeConfig(input) {
  const cfg = Object.assign({}, DEFAULTS, input || {});
  cfg.cron_run = input && input.cron_run !== undefined ? Boolean(input.cron_run) : DEFAULTS.cron_run;
  cfg.random_user = Boolean(cfg.random_user);
  cfg.sign_date = String(cfg.sign_date || DEFAULTS.sign_date).trim();
  cfg.sign_end_date = String(cfg.sign_end_date || DEFAULTS.sign_end_date).trim();
  cfg.request_timeout = Math.max(
    3000,
    Math.min(120000, parseInt(cfg.request_timeout || DEFAULTS.request_timeout, 10) || DEFAULTS.request_timeout),
  );
  return cfg;
}

async function syncLegacyConfig(cfg) {
  const configBucket = new Bucket("wqwl_config");
  await Promise.all([
    configBucket.set("fxsh_isRandomUser", cfg.random_user ? "true" : "false"),
    configBucket.set("fxsh_signDate", cfg.sign_date),
    configBucket.set("fxsh_signEndDate", cfg.sign_end_date),
  ]);
}

class SgSenderAdapter {
  constructor(options) {
    this.forceAdmin = Boolean(options && options.forceAdmin);
  }
  async reply(content) {
    return s.reply(String(content ?? ""));
  }
  async listen(timeout) {
    const child = await s.listen({ timeout: Number(timeout) || 60000 });
    if (!child) return "";
    return String((await child.getMsg()) || "").trim();
  }
  async input(timeout) {
    return this.listen(timeout);
  }
  async getUserID() {
    return String((await s.getUserId()) || "");
  }
  async getMessage() {
    return String((await s.getMsg()) || "").trim();
  }
  async getImtype() {
    return String((await s.getPlatform()) || "");
  }
  async isAdmin() {
    return this.forceAdmin || Boolean(await s.isAdmin());
  }
  async bucketGet(bucket, key) {
    return new Bucket(String(bucket)).get(String(key), "");
  }
  async bucketSet(bucket, key, value) {
    await new Bucket(String(bucket)).set(String(key), value);
    return true;
  }
  async bucketAll(bucket) {
    return new Bucket(String(bucket)).getAll();
  }
}

async function axios(options) {
  const data = await httpJson(options.url, {
    method: String(options.method || "GET").toUpperCase(),
    headers: options.headers || {},
    body: options.data !== undefined ? options.data : options.body,
    timeout: runtimeConfig.request_timeout,
  });
  return { data };
}

function httpJson(rawUrl, options) {
  return new Promise((resolve) => {
    let urlObj;
    try {
      urlObj = new URL(rawUrl);
    } catch (error) {
      resolve({ code: -1, message: "URL 无效", error: errorText(error) });
      return;
    }
    const isHttps = urlObj.protocol === "https:";
    const body = normalizeBody(options.body);
    const headers = Object.assign({}, options.headers || {});
    if (body && !hasHeader(headers, "content-length")) headers["Content-Length"] = Buffer.byteLength(body);
    const req = (isHttps ? https : http).request(
      {
        protocol: urlObj.protocol,
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: options.method || "GET",
        headers,
        rejectUnauthorized: false,
        timeout: options.timeout || DEFAULTS.request_timeout,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          inflate(buffer, String(res.headers["content-encoding"] || ""), (err, out) => {
            const text = String(err ? buffer : out || buffer);
            try {
              resolve(JSON.parse(text || "{}"));
            } catch (_) {
              resolve({ code: res.statusCode || -1, message: text || res.statusMessage || "empty response" });
            }
          });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("request timeout")));
    req.on("error", (error) => resolve({ code: -1, message: "接口请求失败", error: errorText(error) }));
    if (body) req.write(body);
    req.end();
  });
}

function normalizeBody(body) {
  if (body === undefined || body === null || body === "") return "";
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === "string") return body;
  return JSON.stringify(body);
}

function hasHeader(headers, name) {
  const target = String(name).toLowerCase();
  return Object.keys(headers || {}).some((key) => String(key).toLowerCase() === target);
}

function inflate(buffer, encoding, cb) {
  if (/br/i.test(encoding)) return zlib.brotliDecompress(buffer, cb);
  if (/gzip/i.test(encoding)) return zlib.gunzip(buffer, cb);
  if (/deflate/i.test(encoding)) return zlib.inflate(buffer, cb);
  return cb(null, buffer);
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

function errorText(error) {
  return error && (error.message || error.stack) ? String(error.message || error.stack) : String(error);
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}
class Task {
  constructor(str) {
    this.index = ++userIdx;
    this.did = str.split(strSplitor)[0];
    this.finger = str.split(strSplitor)[1]; //单账号多变量分隔符
    this.token = str.split(strSplitor)[2]; //单账号多变量分隔符
    this.oaid = str.split(strSplitor)[3]; //单账号多变量分隔符
    this.name = str.split(strSplitor)[4];
    this.ckStatus = true;
    this.taskList = [];
  }
  async main() {
    await this.user_info();
    if (!this.ckStatus) {
      return;
    }
    await this.sign_reward();
    await this.play_video();
    await this.activity_withdraw_check();
    await this.special_finish();
    await this.task_list();
    for (let i of this.taskList) {
      await $.wait(3000);
      await this.task_finish(i.id, i.title);
    }
  }

  async user_info() {
    let result = await this.taskRequest("get", `https://api.fenxianglife.com/njia/users/info`);
    if (result.code == 200) {
      $.log(
        `✅账号[${this.index}]  欢迎用户，Id ${result.data.userInfo.id} 昵称 ${result.data.userInfo.nickname} 手机号 ${result.data.userInfo.mobile}🎉`,
      );
      this.ckStatus = true;
    } else {
      console.log(`❌账号[${this.index}]  用户查询: 失败`);
      this.ckStatus = false;
    }
  }
  async task_finish(id, title) {
    let result = await this.taskRequest(
      "post",
      `https://fenxiang-lottery-api.fenxianglife.com/fenxiang-lottery/lotteryCode/task/finish`,
      JSON.stringify({
        taskId: id,
      }),
    );
    console.log(result);
    if (result.code == 200) {
      $.log(`✅账号[${this.index}]  任务[${id}][${title}]完成🎉`);
    } else {
      console.log(`❌账号[${this.index}]  任务[${id}][${title}]失败`);
    }
  }

  async activity_withdraw_check() {
    let result = await this.taskRequest(
      "get",
      `https://fenxiang-lottery-api.fenxianglife.com/fenxiang-lottery/withdraw/index`,
      "",
    );
    if (result.code == 200) {
      $.log(
        `✅账号[${this.index}]  今天开奖金额 ${result.data?.totalRewardAmount / 100}元 ${result.data?.amountReceiveStatus == 1 ? "未领取" : "已领取"}🎉`,
      );

      await this.activity_receive_all();
    } else {
      console.log(`❌账号[${this.index}]  查询今日开奖金额: 失败`);
    }
  }

  async activity_receive_all() {
    let result = await this.taskRequest(
      "post",
      `https://fenxiang-lottery-api.fenxianglife.com/fenxiang-lottery/periodical/open/result/receiveAll`,
      JSON.stringify({}),
    );
    console.log(result);
    if (result.code == 200) {
      $.log(`✅账号[${this.index}]  提现开奖金额成功🎉`);
    } else {
      console.log(`❌账号[${this.index}]  提现开奖金额: 失败`);
    }
  }

  async special_finish() {
    let result = await this.taskRequest(
      "post",
      `https://api.fenxianglife.com/njia/game/task/special/finish`,
      JSON.stringify({}),
    );
    console.log(result);
    if (result.errcode == 0) {
      $.log(`✅账号[${this.index}]  欢迎用户: ${result.errcode}🎉`);
      this.ckStatus = true;
    } else {
      console.log(`❌账号[${this.index}]  用户查询: 失败`);
      this.ckStatus = false;
    }
  }

  async game_finish(gameTask) {
    let result = await this.taskRequest(
      "post",
      `https://api.fenxianglife.com/njia/game/task/finish`,
      JSON.stringify({ taskId: gameTask?.item?.id, gameType: gameTask?.activityType }),
    );
    if (result.code == 200) {
      $.log(
        `✅账号[${this.index}]  完成领现金兑商品活动 任务[${gameTask?.name}][${gameTask?.item?.id}][${gameTask?.item?.taskChanceUse}/${gameTask?.item?.taskChance}]: ${result.data?.toastText || `获得${result.data?.awardCount || 0}金币`}🎉`,
      );
      this.ckStatus = true;
      if (result.data?.awardCount) {
        if (gameTask?.item?.taskChanceUse < gameTask?.item?.taskChance) {
          $.log(`✅账号[${this.index}]  延迟${gameTask?.item?.taskDuration}秒执行下一个任务`);
          await $.wait(Number(gameTask?.item?.taskDuration) * 1000 + Math.random() * 1000);
          return this.game_finish(gameTask);
        }
      }
    } else {
      console.log(`❌账号[${this.index}]  完成领现金兑商品活动 任务[${gameTask?.name}][${gameTask?.item?.id}] 失败`);
      this.ckStatus = false;
      console.log(result);
    }
  }

  async open_box() {
    let result = await this.taskRequest(
      "post",
      `https://api-1.fenxianglife.com/njia/elephant/activity/limitedTime/complete`,
      JSON.stringify({ doublingKey: "doubling" }),
    );
    if (result.success == true) {
      $.log(`✅账号[${this.index}]  开宝箱成功，获得 ${result?.data?.reward || 0} 金币🎉`);
      return result?.data;
    } else {
      console.log(`❌账号[${this.index}]  开宝箱失败`);
      console.log(result);
    }
  }

  async invite(initiatorId = "515233097") {
    let result = await this.taskRequest(
      "post",
      `https://api-1.fenxianglife.com/njia/elephant/mammon/help`,
      JSON.stringify({
        initiatorId: initiatorId,
      }),
    );
    if (result.success == true) {
      $.log(`✅账号[${this.index}]  助力成功🎉`);
      return result?.data;
    } else {
      console.log(`❌账号[${this.index}]  助力失败`);
      console.log(result);
    }
  }

  async sign() {
    let result = await this.taskRequest(
      "post",
      `https://api-1.fenxianglife.com/njia/elephant/sign`,
      JSON.stringify({}),
    );
    if (result.success == true) {
      $.log(`✅账号[${this.index}]  签到成功🎉`);
      return result?.data;
    } else {
      console.log(`❌账号[${this.index}]  签到失败`);
      console.log(result);
    }
  }

  async coin_receive() {
    let result = await this.taskRequest(
      "post",
      `https://api-1.fenxianglife.com/njia/elephant/coin/receive`,
      JSON.stringify({}),
    );
    if (result.success == true) {
      $.log(`✅账号[${this.index}]  收取金币成功🎉`);
      return result?.data;
    } else {
      console.log(`❌账号[${this.index}]  收取金币失败`);
      console.log(result);
    }
  }

  async play_video() {
    let result = await this.taskRequest(
      "post",
      `https://api-1.fenxianglife.com/njia/game/task/finish`,
      JSON.stringify({
        taskId: 1,
        gameType: 2,
      }),
    );
    if (result.success == true) {
      $.log(`✅账号[${this.index}]  短视频观看成功🎉`);
      return result?.data;
    } else {
      console.log(`❌账号[${this.index}]  短视频观看失败`);
      console.log(result);
    }
  }

  async game_task() {
    let result = await this.taskRequest(
      "post",
      `https://api-1.fenxianglife.com/njia/game/task/list`,
      JSON.stringify({ gameType: 2, platform: "android", version: "6.7.1" }),
    );
    if (result.success == true) {
      $.log(`✅账号[${this.index}]  获取游戏任务列表成功🎉`);
      return result?.data;
    } else {
      console.log(`❌账号[${this.index}]  获取游戏任务列表失败`);
      console.log(result);
    }
  }

  async sign_reward() {
    let result = await this.taskRequest(
      "post",
      `https://fenxiang-lottery-api.fenxianglife.com/fenxiang-lottery/user/sign/reward`,
      JSON.stringify({}),
    );
    if (result.code == 200) {
      $.log(`✅账号[${this.index}]  签到成功🎉`);
    } else {
      console.log(`❌账号[${this.index}]  签到失败`);
      console.log(result);
    }
  }
  async task_list() {
    let result = await this.taskRequest(
      "post",
      "https://fenxiang-lottery-api.fenxianglife.com/fenxiang-lottery/home/data/V2",
      JSON.stringify({
        plateform: "android",
        version: "6.7.1",
      }),
    );
    if (result.code == 200) {
      for (let i of result.data.taskModule.taskResult) {
        if (i.taskStatus == 0) {
          this.taskList.push(i);
        }
      }
    } else {
      console.log(`❌账号[${this.index}]  获取任务失败`);
    }
  }
  async query_fruiter() {
    let result = await this.taskRequest("get", `https://api-1.fenxianglife.com/njia/orchard/user/fruiter/detail`, "");
    if (result.code == 200) {
      $.log(`✅账号[${this.index}]  查询果园信息成功：${result?.data?.fruiterDesc || "未种植"}🎉`);
      return result?.data?.id;
    } else {
      console.log(`❌账号[${this.index}]  查询果园信息失败`);
      console.log(result);
    }
  }
  async fruiter_sign_detail() {
    let result = await this.taskRequest(
      "get",
      `https://api-1.fenxianglife.com/njia/orchard/loginAward/user/detail`,
      "",
    );
    if (result.code == 200) {
      $.log(`✅账号[${this.index}]  获取果园签到信息成功🎉`);
      return result?.data;
    } else {
      console.log(`❌账号[${this.index}]  获取果园签到信息失败`);
      console.log(result);
    }
  }
  async query_fruite_tasks() {
    let result = await this.taskRequest("get", `https://api-1.fenxianglife.com/njia/orchard/task/list`, "");
    if (result.code == 200) {
      $.log(`✅账号[${this.index}]  查询果园任务成功：${result?.data?.length || "0"}个任务 🎉`);
      return result?.data;
    } else {
      console.log(`❌账号[${this.index}]  查询果园任务失败`);
      console.log(result);
    }
  }
  async query_fruiter_list() {
    let result = await this.taskRequest("get", `https://api-1.fenxianglife.com/njia/orchard/fruiter/list`, "");
    if (result.code == 200) {
      $.log(`✅账号[${this.index}]  当前可选择的种植水果个数为 ：${result?.data?.length || "0"}🎉`);
      return result?.data;
    } else {
      console.log(`❌账号[${this.index}]  查询可选择的种植水果信息失败`);
      console.log(result);
    }
  }

  async water_fruiter(userFruiterId) {
    let result = await this.taskRequest(
      "post",
      `https://api-1.fenxianglife.com/njia/orchard/user/fruiter/water`,
      JSON.stringify({ userFruiterId: userFruiterId }),
    );
    if (result.success == true) {
      $.log(`✅账号[${this.index}]  浇水[${userFruiterId}]成功  ${result?.data?.upgradeContext || ""} 🎉`);
      return result?.data;
    } else {
      console.log(`❌账号[${this.index}]  浇水[${userFruiterId}]失败`);
      console.log(result);
    }
  }

  async loginAwardReceive(day) {
    let result = await this.taskRequest(
      "post",
      `https://api-1.fenxianglife.com/njia/orchard/loginAward/receive`,
      JSON.stringify({ day: day }),
    );
    if (result.success == true) {
      $.log(`✅账号[${this.index}]  领取签到奖励成功 🎉`);
      return result?.data;
    } else {
      console.log(`❌账号[${this.index}]  领取签到奖励失败`);
      console.log(result);
    }
  }

  async finish_fruiter_task(type, taskInfoId) {
    let result = await this.taskRequest(
      "post",
      `https://api-1.fenxianglife.com/njia/orchard/task/finish`,
      JSON.stringify({ type: type, taskInfoId: taskInfoId }),
    );
    if (result.success == true) {
      $.log(`✅账号[${this.index}]  完成任务[${taskInfoId}]成功，获得水滴 ${result?.data?.upgradeContext || ""} 🎉`);
      return result?.data;
    } else {
      console.log(`❌账号[${this.index}]  完成任务[${taskInfoId}]失败`);
      console.log(result);
    }
  }

  async finish_push() {
    let result = await this.taskRequest(
      "post",
      `https://api-1.fenxianglife.com/njia/orchard/task/push/finish`,
      JSON.stringify({}),
    );
    if (result.success == true) {
      $.log(`✅账号[${this.index}]  领取开启推送通知奖励成功，获得 ${result?.data?.awardCount || 0}个水滴 🎉`);
      return result?.data;
    } else {
      console.log(`❌账号[${this.index}]  领取开启推送通知奖励失败`);
      console.log(result);
    }
  }

  async acquireWater_fruiter(userFruiterId, canAcquireWaterId) {
    let result = await this.taskRequest(
      "post",
      `https://api-1.fenxianglife.com/njia/orchard/user/fruiter/acquireWater`,
      JSON.stringify({ canAcquireWaterId: canAcquireWaterId, userFruiterId: userFruiterId }),
    );
    if (result.success == true) {
      $.log(`✅账号[${this.index}]  领取浇水奖励成功 🎉`);
      return result?.data;
    } else {
      console.log(`❌账号[${this.index}]  领取浇水奖励失败`);
      console.log(result);
    }
  }

  async plat_fruiter(fruiterId) {
    let result = await this.taskRequest(
      "post",
      `https://api-1.fenxianglife.com/njia/orchard/user/fruiter/plant`,
      JSON.stringify({ fruiterId: fruiterId }),
    );
    if (result.success == true) {
      $.log(`✅账号[${this.index}]  种植水果[${fruiterId}]成功，水果树ID为 ${result?.data?.userFruiterId || ""} 🎉`);
      return result?.data?.userFruiterId;
    } else {
      console.log(`❌账号[${this.index}]  种植水果[${fruiterId}]失败`);
      console.log(result);
    }
  }
  async stealWater(friendId = -1) {
    let result = await this.taskRequest(
      "post",
      `https://api-1.fenxianglife.com/njia/orchard/friend/stealWater`,
      JSON.stringify({ friendId: friendId }),
    );
    if (result.success == true) {
      $.log(`✅账号[${this.index}]  从朋友[${friendId}]  ${result?.data || ""} 🎉`);
      return result?.data?.userFruiterId;
    } else {
      console.log(`❌账号[${this.index}]  从朋友[${friendId}]偷取水滴失败`);
      console.log(result);
    }
  }

  async query() {
    let result = "=====账号信息=====\n";
    try {
      let raw1 = await this.taskRequest(
        "post",
        `https://api.fenxianglife.com/njia/order/withdraw/v4/create`,
        JSON.stringify({ orderType: 5 }),
      );

      let raw2 = await this.taskRequest(
        "get",
        `https://fenxiang-lottery-api.fenxianglife.com/fenxiang-lottery/withdraw/index`,
        "",
      );

      let raw3 = await this.taskRequest(
        "post",
        `https://fenxiang-lottery-api.fenxianglife.com/fenxiang-lottery/home/data/V2`,
        JSON.stringify({
          plateform: "android",
          version: "6.7.1",
        }),
      );
      const dataStr = raw2?.data?.dateStr || "";

      const isToday = this.getDateRange().includes(dataStr) ? true : false;
      result += `🤪 用户ID(备注)：${this.name}\n`;
      if (raw1.code == 200) {
        result += `🧧活动奖励余额：${raw1?.data?.maxWithdrawAmount / 100}元(最低0.1起提)\n`;
      } else {
        result += `🧧活动奖励余额：查询失败，原因：${raw1?.message || "未知原因"}\n`;
      }

      if (raw2.code == 200) {
        if (isToday) {
          result += `🎰本期开奖期数：${dataStr}期\n`;
          result += `🎉本期开奖金额：${raw2?.data?.totalRewardAmount / 100}元 (${result.data?.amountReceiveStatus == 1 ? "未领取" : "已领取"})\n`;
          if (raw2?.data?.freeOrderCount > 0 && raw2?.data?.freeItem?.itemTitle) {
            result += `🎁本期免单商品：【${raw2?.data?.freeItem?.itemTitle}】\n`;
          } else {
            result += "🎁本期免单商品：无\n";
          }
        } else {
          result += "🎉本期开奖金额：0元(未开奖)\n";
        }
      } else {
        result += `🎉本期开奖金额：查询失败，原因：${raw2?.message || "未知原因"}\n`;
      }

      if (raw3.code == 200) {
        if (
          raw3?.data?.openLotteryModule?.now?.rewardCodes.length <= 0 ||
          raw3?.data?.openLotteryModule?.now?.rewardCodes[0]?.dateStr === undefined
        )
          result += `🏆现有奖码个数：${raw3?.data?.openLotteryModule?.now?.rewardCodes.length}个 \n`;
        else
          result += `🏆现有奖码个数：${raw3?.data?.openLotteryModule?.now?.rewardCodes.length}个 (${raw3?.data?.openLotteryModule?.now?.rewardCodes[0]?.dateStr}期)\n`;
      } else {
        result += `🏆现有奖码个数：查询失败，原因：${raw3?.message || "未知原因"}\n`;
      }
    } catch (e) {
      console.error("请求失败:", e);
      result = `❌用户【${this.name}】信息查询失败，原因：${e.message}\n`;
    }
    return result;
  }

  async smsCode(phone) {
    const result = await this.taskRequest(
      "post",
      "https://api.fenxianglife.com/njia/util/sms/code",
      JSON.stringify({
        validateType: 1,
        mobileArea: "86",
        mobile: phone,
        type: 1,
      }),
    );
    return result;
  }
  async login(phone, code) {
    const result = await this.taskRequest(
      "post",
      "https://api.fenxianglife.com/njia/login/mobile",
      JSON.stringify({
        mobileArea: "86",
        smsCode: this.MD5(code),
        mobile: phone,
      }),
    );
    return result;
  }

  async withDraw(userName) {
    let result = {
      isSuccess: false,
      msg: "",
      money: 0,
    };

    const res1 = await this.taskRequest(
      "post",
      "https://api.fenxianglife.com/njia/order/withdraw/v4/create",
      JSON.stringify({
        orderType: 5,
      }),
    );

    if (
      res1?.code != 200 ||
      res1?.data?.alipayAccountInfo?.userName == null ||
      res1?.data?.alipayAccountInfo?.identityCard == null ||
      res1?.data?.alipayAccountInfo?.alipayAccount == null
    ) {
      result.msg = `❌${userName}提现创建失败，请确保绑定了zfb,接口返回原因：${res1?.message}`;
      result.money = 0;
      result.isSuccess = false;
      return result;
    }

    const maxWithdrawAmount = res1?.data?.maxWithdrawAmount || 0;

    if (maxWithdrawAmount < 10) {
      result.money = 0;
      result.isSuccess = false;
      result.msg = `❌${userName}提现创建失败，还不够0.1提啥呢，当前可提现余额：${maxWithdrawAmount / 100}元`;
      return result;
    }

    const res2 = await this.taskRequest(
      "post",
      "https://api.fenxianglife.com/njia/order/withdraw/submit",
      JSON.stringify({
        orderType: 5,
        withdrawAmount: maxWithdrawAmount,
      }),
    );

    if (res2?.code != 200) {
      result.money = 0;
      result.isSuccess = false;
      result.msg = `❌${userName}提现提交失败，接口返回原因：${res2?.message || "未知原因"}`;
      return result;
    }
    const subTitle = res2?.data?.subTitle.replace(/\n/g, ",");
    result.msg = `🎉${userName}提现提交成功，估计到账${maxWithdrawAmount / 100}元,${subTitle}`;
    result.isSuccess = true;
    result.money = maxWithdrawAmount / 100;
    return result;
  }

  async clockSign(activityId) {
    const res = await this.taskRequest(
      "post",
      "https://api.fenxianglife.com/njia/takeaway/clock/in/sign",
      JSON.stringify({
        activityId: activityId,
      }),
    );
    return res;
  }

  tokenStr(phone) {
    return `${this.did}#${this.finger}#${this.token}#${this.oaid}#${phone.slice(0, 3)}****${phone.slice(-4)}`;
  }
  async taskRequest(method, url, body = "") {
    function convertObjectToQueryString(obj) {
      let queryString = "";
      if (obj) {
        const keys = Object.keys(obj).sort();
        keys.forEach((key) => {
          const value = obj[key];
          if (value !== null && typeof value !== "object") {
            queryString += `&${key}=${value}`;
          }
        });
      }
      return queryString.slice(1);
    }

    const g = {
      traceid: this.MD5(new Date().getTime().toString() + Math.random().toString()),
      noncestr: Math.random().toString().slice(2, 10),
      timestamp: Date.now(),
      platform: "android",
      did: this.did,
      version: "6.7.1",
      finger: this.finger,
      token: this.token,
      oaid: this.oaid,
    };
    const c = "\u7c89\u8c61\u597d\u725b\u903cnb3b16f5a02479a0e34df78d14aefe76";
    let s = method === "get" ? void 0 : JSON.parse(body);
    let e = void 0 === s ? {} : s;
    g.sign = this.MD5(c + convertObjectToQueryString(e) + convertObjectToQueryString(g));
    let headers = {
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 10; MI 8 Lite Build/QKQ1.190910.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/80.0.3987.99 Mobile Safari/537.36 AgentWeb/5.0.0  UCBrowser/11.6.4.950",
      Accept: "application/json, text/plain, */*",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
      origin: "https://m.fenxianglife.com",
      "sec-fetch-dest": "empty",
      "x-requested-with": "com.n_add.android",
      "sec-fetch-site": "same-site",
      "sec-fetch-mode": "cors",
      referer: "https://m.fenxianglife.com",
      "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
      "Content-Type": "application/json",
    };
    Object.assign(headers, g);
    const requestOptions = {
      url: url,
      method: method,
      headers: headers,
      data: body, // axios 中使用 data 而不是 body
    };

    try {
      const response = await axios(requestOptions);
      return response.data;
    } catch (error) {
      return { code: -1, message: "接口请求失败", error: error.message };
    }
  }
  MD5(e) {
    return crypto.createHash("md5").update(e).digest("hex");
  }

  getDate() {
    const now = new Date();
    const padZero = (num) => String(num).padStart(2, "0");

    const year = now.getFullYear().toString().slice(2); // 取后两位：2025 → '25'
    const month = padZero(now.getMonth() + 1); // getMonth() 是从 0 开始的，所以要 +1
    const day = padZero(now.getDate());

    return `${year}${month}${day}`;
  }
  getDateRange() {
    const padZero = (num) => String(num).padStart(2, "0");

    const getDateStr = (date) => {
      const year = date.getFullYear().toString().slice(2);
      const month = padZero(date.getMonth() + 1);
      const day = padZero(date.getDate());
      return `${year}${month}${day}`;
    };

    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    return [getDateStr(today), getDateStr(yesterday)];
  }
}

const Fxsh = class {
  static sqlName = "wqwl_fxsh";
  constructor(user, Sender) {
    this.user = user;
    this.Sender = Sender;
    this.store = new Bucket(Fxsh.sqlName);
    this.stats = new Bucket(`${Fxsh.sqlName}_stats`);
  }

  async loadUser(userId = this.user) {
    return parseJsonArray(await this.store.get(String(userId), "[]"));
  }

  async saveUser(allData, userId = this.user) {
    await this.store.set(String(userId), JSON.stringify(allData));
    return true;
  }

  async addUser() {
    try {
      this.Sender.reply(
        '=====登录方式=====\n[1] 短信登录\n[2] cookie登录\n------------------\n回复数字选择方式\n回复"q"退出',
      );
      let select = await this.Sender.listen(60000);
      let userInput;
      if (select === "1") {
        const fx = new Task("did#finger#token#oaid#备注");
        fx.token = "";
        fx.did = this.randomDid();
        fx.oaid = this.randomOaid(fx.did);
        fx.finger = this.randomFinger();
        this.Sender.reply("请输入手机号(输入q退出)：");
        let phone = await this.Sender.listen(60000);
        if (phone === "q") {
          this.Sender.reply("❌已退出登录！");
          return;
        }
        if (phone === "" || phone === null) {
          this.Sender.reply("❌输入超时");
          return;
        }
        if (phone.length != 11 || !phone.match(/^1[3-9]\d{9}$/)) {
          this.Sender.reply("❌手机号格式错误");
          return;
        }
        const sendResult = await fx.smsCode(phone);
        if (sendResult.code == 200) {
          this.Sender.reply("✅发送成功，请回复短信验证码");
          let code = await this.Sender.listen(60000);
          if (code === "" || code === null) {
            this.Sender.reply("❌输入超时");
            return;
          }
          let loginResult = await fx.login(phone, code);
          if (loginResult.code == 200) {
            this.ckStatus = true;
            fx.token = loginResult.data.token;
            userInput = fx.tokenStr(phone);
          } else {
            this.Sender.reply("❌登录失败,请检查验证码是否正确");
            return;
          }
        } else {
          this.Sender.reply(`❌发送失败，请稍后再试,返回结果：${JSON.stringify(sendResult)}`);
          return;
        }
      } else if (select === "2") {
        this.Sender.reply("正在使用ck登录！请按照以下格式输入：\n did#finger#token#oaid#备注 \n 退出输入'q'!");
        userInput = await this.Sender.listen(60000);
        if (userInput === "q") {
          this.Sender.reply("❌已退出登录！");
          return;
        }
        if (userInput === "" || userInput === null) {
          this.Sender.reply("❌输入超时");
          return;
        }
      } else {
        this.Sender.reply("❌输入错误或q退出！");
        return;
      }
      let allData = await this.loadUser();
      const userData = userInput.split("#");
      if (userData.length !== 5) {
        this.Sender.reply("❌输入格式错误！请按照以下格式重新添加：\n did#finger#token#oaid#备注");
        return;
      }
      if (this.isUserExist(allData, userData)) {
        this.Sender.reply("用户已经存在，是否进行覆盖？(y/n)");
        const tmp = await this.Sender.listen(60000);
        if (tmp.toLowerCase() === "y") {
          const isSuccess = this.updateSame(allData, userData);
          if (isSuccess) {
          } else {
            this.Sender.reply(`❌覆盖失败！请重新添加！`);
            return;
          }
        } else {
          this.Sender.reply(`❌已取消覆盖！请重新添加！`);
          return;
        }
      } else {
        allData.push(userInput);
      }
      const res = await this.saveUser(allData);

      if (!res) {
        this.Sender.reply(`❌添加失败！请重新添加！`);
        return;
      }
      return this.Sender.reply(`✅添加成功，请回复【粉象查询】查看是否成功添加！`);
    } catch (e) {
      this.Sender.reply(`❌添加失败！请重新添加！错误原因：${e.message}`);
      return;
    }
  }

  isUserExist(allData, userData) {
    for (let i = 0; i < allData.length; i++) {
      const item = allData[i];
      const itemFields = item.split("#");
      if (itemFields[4] === userData[4]) {
        return true;
      }
    }
    return false;
  }

  updateSame(allData, userData) {
    const fields = userData; // [did, finger, token, oaid, 备注]

    for (let i = 0; i < allData.length; i++) {
      const item = allData[i];
      const itemFields = item.split("#");

      const hasMatch = itemFields.some((field) => fields.includes(field));

      if (hasMatch) {
        allData[i] = userData.join("#"); // 替换整条记录
        return true; // 表示已找到并替换
      }
    }

    return false; // 没有找到匹配项
  }

  async manageUser() {
    const allData = await this.loadUser();
    if (allData.length === 0) {
      this.Sender.reply(`=====未绑定账号=====\n❌ 未找到任何账号信息\n发送 粉象登录 绑定账号\n==================`);
      return;
    }
    let msg = `=====粉象账号管理=====\n[0] 全部账号运行`;
    for (let i = 0; i < allData.length; i++) msg += `\n[${i + 1}] ${allData[i].split("#")[4] || "账号" + (i + 1)}`;
    msg += `\n------------------\n回复数字选择账号\n回复'q'退出`;
    this.Sender.reply(msg);
    const input = await this.Sender.listen(60000);
    if (input === "q") return this.Sender.reply("✅已退出操作！");
    if (input === "" || input === null) return this.Sender.reply("❌输入超时");
    const userId = parseInt(input, 10) - 1;
    if (parseInt(input, 10) === 0) return this.runAllAccounts(allData);
    if (isNaN(userId) || userId < 0 || userId >= allData.length) return this.Sender.reply("❌无效的选择");
    this.Sender.reply(
      `=====账号操作=====\n[1] 运行任务\n[2] 余额提现\n[3] 删除账号\n------------------\n回复数字选择操作\n回复'q'退出`,
    );
    const action = await this.Sender.listen(60000);
    if (action === "q") return this.Sender.reply("✅已退出操作！");
    if (action === "1") return this.runAlone(userId, [], allData);
    if (action === "2") return this.withDraw(userId, [], allData, true);
    if (action === "3") return this.deleteAuth(userId, [], allData);
    return this.Sender.reply("❌输入错误");
  }
  async withDraw(userId, authData, allData, isAlone = false) {
    try {
      const userCk = allData[userId];
      const task = new Task(userCk);
      const userName = userCk.split("#")[4] || `账号${userId + 1}`;
      const result = await task.withDraw(userName);
      if (result && result.isSuccess) {
        const money = Number(result.money || 0);
        if (money < 0.1) {
          const msg = `❌${userName}提现跳过：当前可提现余额 ${money.toFixed(2)} 元，低于 0.1 元`;
          if (isAlone) await this.Sender.reply(msg);
          return { isSuccess: false, money: 0, msg };
        }
        await this.addSumWithdraw(money);
        const msg = result.msg || `🎉${userName}提现提交成功：${money.toFixed(2)}元`;
        if (isAlone) await this.Sender.reply(msg);
        return { isSuccess: true, money, msg };
      }
      const msg = result && result.msg ? result.msg : `❌${userName}提现失败：${safeJson(result)}`;
      if (isAlone) await this.Sender.reply(msg);
      return { isSuccess: false, money: 0, msg };
    } catch (e) {
      const msg = `❌账号提现失败！错误原因：${e.message}`;
      if (isAlone) await this.Sender.reply(msg);
      return { isSuccess: false, money: 0, msg };
    }
  }
  async withDrawAll() {
    const allData = await this.loadUser();
    if (allData.length === 0) {
      this.Sender.reply(`=====未绑定账号=====\n❌ 未找到任何账号信息\n发送 粉象登录 绑定账号\n==================`);
      return;
    }
    let times = 0;
    let sumMoney = 0;
    let success = 0;
    for (let i = 0; i < allData.length; i++) {
      const result = await this.withDraw(i, [], allData);
      if (result.isSuccess) {
        sumMoney += result.money;
        success++;
      }
      await this.Sender.reply(result.msg);
      times++;
      await this.wait(3);
    }
    const msg = `\n=====粉象提现统计====\n✨ 总账号数: ${times}个\n✅ 提现成功: ${success}个\n❌ 提现失败: ${times - success}个\n🧧 总提金额: ${sumMoney.toFixed(2)}元\n${await this.getSumWithdraw()}\n==================`;
    await this.Sender.reply(msg);
  }

  async getSumWithdraw() {
    const rawData = await this.stats.get("withdraw", "");
    let allData = {
      money: 0,
      times: 0,
    };
    if (rawData && typeof rawData === "string") {
      try {
        allData = JSON.parse(rawData);
      } catch (e) {
        console.error("JSON 解析失败:", e);
        allData = {
          money: 0,
          times: 0,
        };
      }
    }
    if (allData.money === 0 && allData.times === 0) {
      true;
    }
    return `💰 累计提现: ${parseFloat(allData.money).toFixed(2)}元(${allData.times}次)`;
  }

  async addSumWithdraw(money) {
    const rawData = await this.stats.get("withdraw", "");
    let allData = {
      money: 0,
      times: 0,
    };
    if (rawData && typeof rawData === "string") {
      try {
        allData = JSON.parse(rawData);
      } catch (e) {
        console.error("JSON 解析失败:", e);
        allData = {
          money: 0,
          times: 0,
        };
      }
    }
    if (money > 0) {
      allData.money += money;
      allData.times++;
      await this.stats.set("withdraw", JSON.stringify(allData));
    }
  }
  async runAlone(userId, authData, allData) {
    try {
      const userCk = allData[userId];
      const task = new Task(userCk);
      const userName = userCk.split("#")[4] || `账号${userId + 1}`;
      this.Sender.reply(`🚀开始运行账号: ${userName}`);
      const startTime = Date.now();
      await task.main();
      let result = await task.query();
      const endTime = Date.now();
      result += `==================\n⏰ 运行耗时: ${(endTime - startTime) / 1000}秒\n📅 运行时间: ${this.getCurrentTime()}`;
      this.Sender.reply(result);
    } catch (e) {
      this.Sender.reply(`❌运行账号失败！错误原因：${e.message}`);
    }
  }

  async deleteAuth(userId, authData, allData) {
    const name = allData[userId].split("#")[4] || `账号${userId + 1}`;
    this.Sender.reply(`⚠️您确定删除账号【${name}】吗？(y/n)`);
    let answer = await this.Sender.listen(60000);
    if (answer === "" || answer === null) return this.Sender.reply("❌输入超时");
    if (answer.toLowerCase() === "y") {
      allData.splice(userId, 1);
      const res2 = await this.saveUser(allData);
      if (res2) this.Sender.reply("✅删除成功");
      else this.Sender.reply("❌删除失败");
    } else {
      this.Sender.reply("❌已取消删除");
    }
  }

  async query() {
    let allData = await this.loadUser();
    if (allData.length === 0) {
      this.Sender.reply(`=====未绑定账号=====\n❌ 未找到任何账号信息\n💡 发送 粉象登录 绑定账号\n==================`);
      return;
    }
    let choiceMsg = `请输入要查询的账号：\n[0] 全部查询\n${"-".repeat(20)}`;
    for (let i = 0; i < allData.length; i++)
      choiceMsg += `\n[${i + 1}] ${allData[i].split("#")[4] || "账号" + (i + 1)}`;
    this.Sender.reply(choiceMsg);
    let choice = await this.Sender.listen(60000);
    if (choice === "q") return this.Sender.reply("✅已退出操作！");
    if (choice === "" || choice === null) return this.Sender.reply("❌输入超时");
    this.Sender.reply("正在查询...");
    choice = parseInt(choice, 10) - 1;
    if (choice === -1) {
      for (let i = 0; i < allData.length; i++) {
        const task = new Task(allData[i]);
        let result = await task.query();
        this.Sender.reply(result + "================\n");
        await this.wait(1);
      }
    } else {
      if (isNaN(choice) || choice < 0 || choice >= allData.length) return this.Sender.reply("❌无效的选择");
      const task = new Task(allData[choice]);
      let result = await task.query();
      this.Sender.reply(result + "================\n");
    }
  }

  async run() {
    const isAdmin = await this.Sender.isAdmin();
    if (!isAdmin) return;
    let rawData = await this.store.getAll();
    let allData = [];
    if (rawData && typeof rawData === "object") {
      for (const userId of Object.keys(rawData)) allData.push(...parseJsonArray(rawData[userId]));
    }
    if (allData.length === 0) return this.Sender.reply("没有添加任何账号");
    return this.runAllAccounts(allData);
  }

  async runAllAccounts(allData) {
    let accounts = [];
    for (let i = 0; i < allData.length; i++) accounts.push({ userId: this.user, index: i, ck: allData[i] });
    if (runtimeConfig.random_user) accounts = accounts.sort(() => Math.random() - 0.5);
    let success = 0;
    let fail = 0;
    const startTime = Date.now();
    for (const item of accounts) {
      const task = new Task(item.ck);
      const name = item.ck.split("#")[4] || `账号${item.index + 1}`;
      try {
        await task.main();
        success++;
        await this.Sender.reply(`✅${name} 运行完成`);
      } catch (e) {
        fail++;
        await this.Sender.reply(`❌${name} 运行失败：${e.message}`);
      }
      await this.wait(3);
    }
    await this.Sender.reply(
      `=====粉象运行统计=====\n✅ 成功：${success}\n❌ 失败：${fail}\n⏰ 耗时：${((Date.now() - startTime) / 1000).toFixed(1)}秒\n==================`,
    );
  }

  async clockSignAlone() {
    const act = (await this.Sender.bucketGet(`wqwl_config`, "fxsh_signDate")) || "20260428";
    const allData = await this.loadUser();
    if (allData.length === 0)
      return this.Sender.reply(
        `=====未绑定账号=====\n❌ 未找到任何账号信息\n发送 粉象登录 绑定账号\n==================`,
      );
    let msg = `请输入要签到的账号：\n[0] 全部签到\n${"-".repeat(20)}`;
    for (let i = 0; i < allData.length; i++) msg += `\n[${i + 1}] ${allData[i].split("#")[4] || "账号" + (i + 1)}`;
    this.Sender.reply(msg);
    let choice = await this.Sender.listen(60000);
    if (choice === "q") return this.Sender.reply("✅已退出操作！");
    if (choice === "" || choice === null) return this.Sender.reply("❌输入超时");
    choice = parseInt(choice, 10) - 1;
    if (choice === -1) return this._clockSign(this.user, [], allData, act);
    if (isNaN(choice) || choice < 0 || choice >= allData.length) return this.Sender.reply("❌无效的选择");
    return this._clockSign(this.user, [], [allData[choice]], act);
  }

  async _clockSign(userId, authData, allData, activityId) {
    let success = 0;
    let fail = 0;
    let sumMoney = 0;
    for (let i = 0; i < allData.length; i++) {
      try {
        const userCk = allData[i];
        const task = new Task(userCk);
        const userName = userCk.split("#")[4] || `账号${i + 1}`;
        this.Sender.reply(`🚀开始签到账号: ${userName}`);
        const result = await task.clockSign(activityId);
        if (result?.code === 200) {
          const money = Number(result?.data?.rewardAmount || 0) / 100;
          success++;
          sumMoney += money;
          await this.Sender.reply(`✅${userName} 签到成功，获得${money.toFixed(2)}元`);
        } else {
          fail++;
          await this.Sender.reply(
            `❌${userName} 签到失败：${result?.message || result?.msg || JSON.stringify(result)}`,
          );
        }
      } catch (e) {
        fail++;
        await this.Sender.reply(`❌签到异常：${e.message}`);
      }
      await this.wait(1);
    }
    return {
      isSuccess: success > 0,
      msg: `签到完成：成功${success}，失败${fail}，金额${sumMoney.toFixed(2)}元`,
      money: sumMoney,
    };
  }
  formatDate(timestamp) {
    const date = new Date(timestamp.toString().length === 10 ? timestamp * 1000 : timestamp);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();

    return year + "-" + month + "-" + day;
  }

  getCurrentTime() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  randomDid() {
    const uuid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });

    return "njia" + uuid.slice(4);
  }
  randomOaid(did) {
    return crypto.createHash("md5").update(did).digest("hex").slice(8, 24);
  }

  randomFinger() {
    return crypto
      .createHash("md5")
      .update(Date.now() + "")
      .digest("hex");
  }

  async adminAuth() {
    if (!(await this.Sender.isAdmin())) return this.Sender.reply("❌仅管理员可授权");
    this.Sender.reply("请输入要授权的用户ID（回复q退出）：");
    const targetUser = await this.Sender.listen(60000);
    if (!targetUser || targetUser.toLowerCase() === "q") return this.Sender.reply("✅已退出操作！");
    const allData = await this.loadUser(targetUser);
    if (!allData.length) return this.Sender.reply(`❌未找到用户【${targetUser}】的账号信息`);
    const authStore = new Bucket(`${Fxsh.sqlName}_auth`);
    const authData = parseJsonArray(await authStore.get(String(targetUser), "[]"));
    let msg = `=====用户【${targetUser}】账号列表=====\n[0] 授权全部账号`;
    for (let i = 0; i < allData.length; i++) {
      const expires = Number(authData[i] || 0);
      msg += `\n[${i + 1}] ${allData[i].split("#")[4] || `账号${i + 1}`} ${expires > Date.now() ? `✅${this.formatDate(expires)}` : "❌未授权/已过期"}`;
    }
    this.Sender.reply(`${msg}\n回复数字选择账号，q退出`);
    const selected = await this.Sender.listen(60000);
    if (!selected || selected.toLowerCase() === "q") return this.Sender.reply("✅已退出操作！");
    const index = Number(selected);
    if (!Number.isInteger(index) || index < 0 || index > allData.length) return this.Sender.reply("❌无效的选择");
    this.Sender.reply("请输入授权月数（支持负数扣除，不能为0）：");
    const months = Number(await this.Sender.listen(60000));
    if (!Number.isInteger(months) || months === 0) return this.Sender.reply("❌授权月数无效");
    const targets = index === 0 ? allData.map((_, i) => i) : [index - 1];
    const delta = months * 30 * 86400000;
    for (const i of targets) {
      const old = Number(authData[i] || 0);
      authData[i] = Math.max(0, (months > 0 && old < Date.now() ? Date.now() : old) + delta);
    }
    await authStore.set(String(targetUser), JSON.stringify(authData));
    return this.Sender.reply(
      `✅授权完成：用户 ${targetUser}，${targets.length} 个账号，${months > 0 ? "增加" : "扣除"} ${Math.abs(months) * 30} 天`,
    );
  }

  async wait(s) {
    return await new Promise((resolve) => setTimeout(resolve, s * 1000));
  }
};

async function main() {
  runtimeConfig = normalizeConfig(await pluginConfig.get());
  await syncLegacyConfig(runtimeConfig);

  const message = String((await s.getMsg()) || "").trim();
  const sender = new SgSenderAdapter({ forceAdmin: !message && runtimeConfig.cron_run });
  const user = await sender.getUserID();
  const fxsh = new Fxsh(user, sender);
  if (!message && runtimeConfig.cron_run) return fxsh.run();
  if (!message) return;

  if (message === "粉象登录") return fxsh.addUser();
  if (message === "粉象管理") return fxsh.manageUser();
  if (message === "粉象查询") return fxsh.query();
  if (message === "粉象一键运行") return fxsh.run();
  if (message === "粉象全部提现" || message === "粉象提现") return fxsh.withDrawAll();
  if (message === "粉象签到") return fxsh.clockSignAlone();
  if (message === "粉象授权") return fxsh.adminAuth();
}

main().catch(async (error) => {
  console.log(error && error.stack ? error.stack : String(error));
  try {
    await s.reply("粉象生活执行异常：" + errorText(error));
  } catch (_) {}
});
