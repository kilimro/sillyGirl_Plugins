// [title: 京东 Cookie 上传]
// [name: jdCookieUpload]
// [desc: 提交你的京东 Cookie，自动同步到青龙容器]
// [author: MianPro]
// [version: v1.0.0]
// [cron: * * * * *]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 1000]
// [class: 工具类]
// [icon: https://www.jd.com/favicon.ico]
// [carry: false]
// [depe: ["./jdLegacyCore.js"]]

"use strict";
const { Bucket, container, plugin } = require("sillygirl");
const core = require("./jdLegacyCore.js");

const form = new plugin.Form({
  cookie: plugin.Form.textarea()
    .title("JD_COOKIE")
    .description("粘贴你的京东 Cookie，格式：pt_key=xxx;pt_pin=xxx;")
    .required(),
  source_id: plugin.Form.integer().title("青龙容器编号").min(1).default(1),
});

const processed = new Bucket("jd_cookie_upload_processed");
const formRecords = new Bucket("plugin_user_form_records");

async function main() {
  const cfg = normalize((await form.get()) || {});
  const ql = new container.QingLong({ id: cfg.sourceId });
  const current = await core.qlEnvs(ql, "JD_COOKIE");

  // 遍历所有用户提交的表单记录
  const keys = formRecords.keys();
  let uploaded = 0;

  for (const key of keys) {
    try {
      const raw = formRecords.get(key);
      if (!raw) continue;

      let records;
      try {
        records = JSON.parse(raw.replace(/^o:/, ""));
      } catch (e) {
        continue;
      }

      if (!Array.isArray(records)) continue;

      for (const record of records) {
        const recordId = record.id || "";
        if (!recordId) continue;

        // 跳过已处理的
        if (processed.get(recordId)) continue;

        const cookie = String(record.values?.cookie || "").trim();
        if (!cookie) continue;

        // 解析 Cookie
        const cookies = core.parseCookies(cookie);
        for (const ck of cookies) {
          const pin = core.ptPin(ck);
          await core.upsertEnv(
            ql,
            {
              name: "JD_COOKIE",
              value: ck,
              remarks: core.decode(pin),
            },
            current,
          );
          uploaded++;
        }

        // 标记为已处理
        processed.set(recordId, Date.now());
      }
    } catch (e) {
      console.error("处理 Cookie 记录失败:", e);
    }
  }

  if (uploaded > 0) {
    console.log(`jdCookieUpload: 已上传 ${uploaded} 个京东 Cookie`);
  }
}

function normalize(value) {
  return {
    sourceId: Number(value.source_id) || 1,
  };
}

main();
module.exports = {};
