// [title: 星芽免费短剧]
// [name: xingYaMianFeiDuanJu]
// [desc: 星芽免费短剧凭证绑定、青龙同步、账号查询与 Python 同源时长上报]
// [author: Jiang0529]
// [version: v2.1.0]
// [rule: ^星芽教程$|^星芽登录$|^星芽登陆$|^星芽查询$|^星芽ck提交$|^星芽CK提交$|^星芽管理$|^星芽$|^星芽刷时长$]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 0]
// [class: 任务]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/星芽免费短剧_v2.2_By.Jiang0529.py;backup/星芽时长刷取_v1.0.0_By.rujingxianghai.py;backup/星芽短剧_v2.7.0_By.mrconli.py]
// [depe: []]

const { randomUUID } = require("crypto");
const { container, plugin, sender: s } = require("sillygirl");

const config = new plugin.Form({
  qinglong_id: plugin.Form.number().title("青龙容器编号").default(1),
  env_name: plugin.Form.string().title("脚本环境变量名").default("XING_YA_MIAN_FEI_DUAN_JU"),
  max_duration: plugin.Form.number().title("单次最大时长（分钟）").default(120),
});

async function main() {
  try {
    const cfg = normalize(await config.get());
    const content = String((await s.getMsg()) || "").trim();
    const ql = new container.QingLong({ id: cfg.qinglongId });
    if (/刷时长|时长刷取/.test(content)) return durationFlow(cfg.maxDuration);
    if (/教程|说明/.test(content)) return s.reply("发送登录指令后提交原始凭证；可用 备注::凭证 添加备注，多账号换行。");
    if (/查询|管理|检测|统计|订单查询|上传|同步|刷新|后台/.test(content)) return showAccounts(ql, cfg.envName);
    if (/清理|删除/.test(content)) return removeAccounts(ql, cfg.envName);
    if (/登录|登陆|绑定|上车|提交/.test(content)) {
      s.reply("请发送原始账号凭证；可用 备注::凭证 添加备注，多账号换行，输入 q 取消。");
      return s.listen({
        rules: ["raw ^([\\s\\S]+)$"],
        timeout: 60000,
        user_id: await s.getUserId(),
        chat_id: await s.getChatId(),
        handle: async (next) => {
          const value = String((await next.param(1)) || "").trim();
          if (/^q$/i.test(value)) return "已取消";
          return saveAccounts(ql, cfg.envName, value, next);
        },
      });
    }
    return s.reply("星芽免费短剧：请使用登录、查询、管理或清理指令");
  } catch (error) {
    return s.reply(`星芽免费短剧处理失败：${message(error)}`);
  }
}

async function durationFlow(maxDuration) {
  await s.reply("请输入 authorization#device_id，回复 q 取消");
  return s.listen({
    rules: ["raw ^([\\s\\S]+)$"],
    timeout: 120000,
    user_id: await s.getUserId(),
    chat_id: await s.getChatId(),
    handle: async (next) => {
      const value = String((await next.param(1)) || "").trim();
      if (/^q$/i.test(value)) return "已取消";
      const cut = value.lastIndexOf("#");
      if (cut < 1) return "格式错误，应为 authorization#device_id";
      const auth = value.slice(0, cut).trim(),
        deviceId = value.slice(cut + 1).trim();
      try {
        const user = await xingyaInfo(auth, deviceId);
        await next.reply(`账号校验成功：${maskId(user.userId)}\n请输入刷取分钟数（1-${maxDuration}），回复 q 取消`);
        return next.listen({
          rules: ["raw ^([\\s\\S]+)$"],
          timeout: 60000,
          handle: async (third) => {
            const raw = String((await third.param(1)) || "").trim();
            if (/^q$/i.test(raw)) return "已取消";
            const minutes = Number(raw);
            if (!Number.isInteger(minutes) || minutes < 1 || minutes > maxDuration)
              return `请输入 1-${maxDuration} 的整数`;
            try {
              await reportDuration(auth, deviceId, user.userId, minutes);
              return `成功上报 ${minutes} 分钟观看时长`;
            } catch (e) {
              return `时长上报失败：${message(e)}`;
            }
          },
        });
      } catch (e) {
        return `账号校验失败：${message(e)}`;
      }
    },
  });
}

const xingyaHeaders = (auth, deviceId) => ({
  authorization: auth,
  device_id: deviceId,
  device_platform: "android",
  device_type: "2210132C",
  device_brand: "Xiaomi",
  os_version: "15",
  channel: "default",
  raw_channel: "default",
  app_version: "3.8.5",
  accept: "application/json, text/plain, */*",
  origin: "https://h5static.xingya.com.cn",
  "user-agent": "Mozilla/5.0 (Linux; Android 15; 2210132C) AppleWebKit/537.36 Mobile Safari/537.36 _dsbridge",
});

async function xingyaInfo(auth, deviceId) {
  const response = await fetch(`https://speciesweb.whjzjx.cn/v1/sign/info?device_id=${encodeURIComponent(deviceId)}`, {
    headers: xingyaHeaders(auth, deviceId),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  if (!response.ok || data.code !== "ok" || !data.data?.account_id)
    throw new Error(data.msg || `HTTP ${response.status}`);
  return { userId: data.data.account_id, cashRemain: data.data.cash_remain, species: data.data.species };
}

async function reportDuration(auth, deviceId, userId, minutes) {
  const now = Date.now();
  const body = [
    {
      event_id: "action_episode_view",
      page_id: "page_drama_detail",
      eventType: "action",
      event_type: "action",
      timestamp: now,
      user_id: String(userId),
      login_status: true,
      retry: 0,
      device_id: deviceId,
      device_type: "Xiaomi",
      phone_version: "2210132C",
      os_type: 1,
      os_name: "15",
      version: "3.8.3.1",
      package_name: "com.jz.xydj",
      app_id: "7",
      channel: "default",
      raw_channel: "default",
      font_scale: 1,
      define_args: JSON.stringify({
        page: "page_drama_detail",
        theater_id: "4328",
        theater_number: "1",
        theater_duration: String(minutes * 60),
        lock: "0",
        complete: "0",
        show_id: "7de1f4a3cfb04c93bb31c11f7e896ad8",
        classification_id: "0",
        position: "4",
        entrance_scene: "0",
        entrance: "5",
        top_classification_id: "1",
        top_classification_name: "剧场",
        ab_id: "",
        last_page: "page_drama_detail",
      }),
    },
  ];
  const headers = {
    ...xingyaHeaders(auth, deviceId),
    "x-app-id": "7",
    platform: "1",
    manufacturer: "Xiaomi",
    version_name: "3.8.3.1",
    app_version: "3.8.3.1",
    personalized_recommend_status: "1",
    uuid: `randomUUID_${randomUUID()}`,
    support_h265: "1",
    font_scale: "1.0",
    "content-type": "application/json; charset=utf-8",
  };
  const response = await fetch("https://xingya-track.shytkjgs.com/receive", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  if (!response.ok || data.code !== "ok") throw new Error(data.msg || `HTTP ${response.status}`);
}

async function saveAccounts(ql, envName, input, replySender) {
  try {
    const rows = parseRows(input);
    const owner = await ownerKey(replySender);
    const current = onlyNamed(await ql.getEnvs({ searchValue: envName }), envName);
    let created = 0,
      updated = 0;
    for (const row of rows) {
      const existing = current.find(
        (item) => ownedBy(item, owner) && (remarkOf(item) === row.remark || item.value === row.value),
      );
      const remarks = `${owner}|${row.remark}`;
      if (existing) {
        await ql.updateEnv({ id: envId(existing), name: envName, value: row.value, remarks });
        updated += 1;
      } else {
        await ql.createEnv({ name: envName, value: row.value, remarks });
        created += 1;
      }
    }
    return replySender.reply(`星芽免费短剧同步完成：新增 ${created}，更新 ${updated}`);
  } catch (error) {
    return replySender.reply(`星芽免费短剧提交失败：${message(error)}`);
  }
}

async function showAccounts(ql, envName) {
  const owner = await ownerKey(s);
  const all = onlyNamed(await ql.getEnvs({ searchValue: envName }), envName);
  const visible = (await s.isAdmin()) ? all : all.filter((item) => ownedBy(item, owner));
  if (!visible.length) return s.reply("没有找到你的星芽免费短剧账号");
  return s.reply(
    [
      `星芽免费短剧账号：${visible.length} 个`,
      ...visible.map((item, index) => `${index + 1}. ${remarkOf(item) || "未备注"}${item.status ? "（已禁用）" : ""}`),
    ].join("\n"),
  );
}

async function removeAccounts(ql, envName) {
  const owner = await ownerKey(s);
  const all = onlyNamed(await ql.getEnvs({ searchValue: envName }), envName);
  const admin = await s.isAdmin();
  const ids = all
    .filter((item) => admin || ownedBy(item, owner))
    .map(envId)
    .filter(Boolean);
  if (!ids.length) return s.reply("没有可清理的星芽免费短剧账号");
  await ql.deleteEnvs(ids);
  return s.reply(`已清理 ${ids.length} 个星芽免费短剧账号`);
}

function parseRows(input) {
  const values = String(input)
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);
  if (!values.length) throw new Error("凭证为空");
  return values.map((value, index) => {
    const cut = value.indexOf("::");
    const remark = cut >= 0 ? value.slice(0, cut).trim() : `账号${index + 1}`;
    const payload = cut >= 0 ? value.slice(cut + 2).trim() : value;
    if (!remark || !payload) throw new Error(`第 ${index + 1} 行格式错误`);
    return { remark, value: payload };
  });
}

function onlyNamed(value, name) {
  const rows = Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : [];
  return rows.filter((item) => item?.name === name);
}
async function ownerKey(sender) {
  return "xingYaMianFeiDuanJu|" + (await sender.getPlatform()) + ":" + (await sender.getUserId());
}
function ownedBy(item, owner) {
  return String(item?.remarks || item?.remark || "").startsWith(owner + "|");
}
function remarkOf(item) {
  return String(item?.remarks || item?.remark || "")
    .split("|")
    .slice(2)
    .join("|");
}
function envId(item) {
  return item?.id || item?._id;
}
function normalize(raw) {
  const value = raw || {};
  const envName = String(value.env_name || "XING_YA_MIAN_FEI_DUAN_JU").trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName)) throw new Error("环境变量名格式错误");
  return {
    qinglongId: Number(value.qinglong_id) || 1,
    envName,
    maxDuration: Math.max(1, Math.min(1440, Number(value.max_duration) || 120)),
  };
}
function maskId(value) {
  const x = String(value || "");
  return x.length > 8 ? `${x.slice(0, 4)}****${x.slice(-4)}` : x;
}
function message(error) {
  return String(error?.message || error)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 300);
}

main();
