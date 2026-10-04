// [title: 夸克推广]
// [name: kuaKeTuiGuang]
// [desc: 搜索夸克资源、自动转存、重新分享并按时清理临时目录]
// [author: rujingxianghai]
// [version: v1.0.0]
// [rule: ^我要看(.+)$|^夸克清理$|^夸克登录$]
// [cron: 0 0 0 0 0]
// [status: true]
// [admin: false]
// [public: true]
// [priority: 99999]
// [class: 工具类]
// [icon: https://wiki.920pdd.com/uploads/avatars/2024/12/01//fwUbpklrVjbmOWJz.png]
// [origin: backup/夸克推广_v1.0.0_By.rujingxianghai.py]
// [depe: ["./vortoUtils.js"]]

const { plugin, sender: s, utils } = require("sillygirl");
const vorto = require("./vortoUtils"),
  PC = "https://drive-pc.quark.cn/1/clouddrive",
  DRIVE = "https://drive.quark.cn/1/clouddrive";
const form = new plugin.Form({
  cookies: plugin.Form.string().title("夸克网盘Cookie").widget("textarea").default(""),
  save_folder: plugin.Form.string().title("保存文件夹名称").default(""),
  share_option: plugin.Form.integer().title("分享选项1-8").min(1).max(8).default(1),
  search_api: plugin.Form.string().title("Pansou搜索API").default("https://so.252035.xyz"),
  clean_folder_id: plugin.Form.string().title("清理文件夹ID").default(""),
  clean_expire_minutes: plugin.Form.integer().title("清理过期分钟").min(1).default(60),
});
function qp(extra = {}) {
  return new URLSearchParams({
    pr: "ucpro",
    fr: "pc",
    uc_param_str: "",
    __dt: String(Math.floor(100 + Math.random() * 9900)),
    __t: String(Date.now()),
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])),
  }).toString();
}
function hdr(c) {
  return {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 Chrome/94 Safari/537.36",
    origin: "https://pan.quark.cn",
    referer: "https://pan.quark.cn/",
    "accept-language": "zh-CN,zh;q=0.9",
    cookie: c,
  };
}
async function q(c, url, opt = {}) {
  const r = await fetch(url, {
      method: opt.method || "GET",
      headers: { ...hdr(c), ...(opt.headers || {}) },
      body: opt.json === undefined ? undefined : JSON.stringify(opt.json),
      signal: AbortSignal.timeout(60000),
    }),
    j = await r.json();
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return j;
}
function ok(j) {
  if (Number(j?.code) !== 0 && Number(j?.status) !== 200) throw new Error(j?.message || `夸克接口失败 code=${j?.code}`);
  return j.data;
}
async function search(api, kw) {
  const r = await fetch(`${api.replace(/\/$/, "")}/api/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kw, cloud_types: ["quark"] }),
      signal: AbortSignal.timeout(15000),
    }),
    j = await r.json();
  if (!r.ok || Number(j?.code) !== 0) throw new Error(j?.message || "搜索失败");
  return j.data?.merged_by_type?.quark || [];
}
async function token(c, url) {
  const u = new URL(url),
    pwd = u.pathname.split("/s/")[1]?.split("/")[0],
    pass = u.searchParams.get("pwd") || "";
  if (!pwd) throw new Error("分享链接缺少pwd_id");
  const d = ok(
    await q(c, `${PC}/share/sharepage/token?${qp()}`, { method: "POST", json: { pwd_id: pwd, passcode: pass } }),
  );
  return { pwd, stoken: d.stoken };
}
async function detail(c, pwd, stoken, pdir = "0") {
  const all = [];
  for (let page = 1; page <= 100; page++) {
    const j = await q(
        c,
        `${PC}/share/sharepage/detail?${qp({ pwd_id: pwd, stoken, pdir_fid: pdir, force: 0, _page: page, _size: 50, _sort: "file_type:asc,updated_at:desc" })}`,
      ),
      d = j.data || {},
      list = d.list || [];
    all.push(...list);
    if (list.length < 50) return { owner: Number(d.is_owner) === 1, list: all };
  }
  return { owner: false, list: all };
}
async function list(c, fid) {
  const all = [];
  for (let page = 1; page <= 100; page++) {
    const j = await q(
        c,
        `${PC}/file/sort?${qp({ pdir_fid: fid, _page: page, _size: 50, _fetch_total: 1, _fetch_sub_dirs: 0, _sort: "created_at:asc" })}`,
      ),
      a = j.data?.list || [];
    all.push(...a);
    if (a.length < 50) break;
  }
  return all;
}
async function find(c, name, parent = "0") {
  return (await list(c, parent)).find((v) => v.dir && v.file_name === name)?.fid || "";
}
async function mkdir(c, name, parent = "0") {
  const j = await q(c, `${PC}/file?${qp()}`, {
    method: "POST",
    json: { pdir_fid: parent, file_name: name, dir_path: "", dir_init_lock: false },
  });
  if (Number(j.code) === 0) return j.data?.fid;
  if (Number(j.code) === 23008) return find(c, name, parent);
  throw new Error(j.message || "创建文件夹失败");
}
async function poll(c, taskId, field) {
  for (let i = 0; i < 50; i++) {
    await utils.sleep(600);
    const j = await q(c, `${PC}/task?${qp({ task_id: taskId, retry_index: i })}`);
    if (Number(j.code) === 32003) throw new Error("网盘容量不足");
    if (j.message === "ok" && (Number(j.data?.status) === 2 || j.data?.[field])) return field ? j.data[field] : j.data;
  }
  throw new Error("夸克任务超时");
}
async function saveShare(c, source, folder, opt) {
  const t = await token(c, source),
    d = await detail(c, t.pwd, t.stoken);
  if (d.owner) throw new Error("该文件已在当前网盘");
  if (!d.list.length) throw new Error("分享中没有文件");
  const parent = await mkdir(c, folder),
    save = ok(
      await q(c, `${DRIVE}/share/sharepage/save?${qp()}`, {
        method: "POST",
        json: {
          fid_list: d.list.map((v) => v.fid),
          fid_token_list: d.list.map((v) => v.share_fid_token),
          to_pdir_fid: parent,
          pwd_id: t.pwd,
          stoken: t.stoken,
          pdir_fid: "0",
          scene: "link",
        },
      }),
    );
  await poll(c, save.task_id);
  await utils.sleep(1500);
  let target = parent,
    title = folder;
  if (d.list.length === 1 && d.list[0].dir) {
    title = d.list[0].file_name;
    target = await find(c, title, parent);
    if (!target) throw new Error(`转存后未找到目录${title}`);
  }
  const encrypted = opt >= 5,
    expired = encrypted ? opt - 4 : opt,
    share = ok(
      await q(c, `${PC}/share?${qp()}`, {
        method: "POST",
        json: {
          fid_list: [target],
          title,
          url_type: encrypted ? 2 : 1,
          expired_type: expired,
          ...(encrypted ? { passcode: String(Math.floor(1000 + Math.random() * 9000)) } : {}),
        },
      }),
    ),
    shareId = await poll(c, share.task_id, "share_id"),
    final = ok(await q(c, `${PC}/share/password?${qp()}`, { method: "POST", json: { share_id: shareId } }));
  return final.share_url + (final.passcode ? `?pwd=${final.passcode}` : "");
}
async function clean(c, fid, minutes) {
  const a = await list(c, fid),
    cut = Date.now() - minutes * 60000,
    ids = a.filter((v) => Number(v.itime_ms || 0) < cut).map((v) => v.fid);
  if (!ids.length) return 0;
  ok(
    await q(c, `${PC}/file/delete?${qp()}`, {
      method: "POST",
      json: { action_type: 2, filelist: ids, exclude_fids: [] },
    }),
  );
  return ids.length;
}
async function main() {
  const cfg = (await form.get()) || {};
  const content = String((await s.getMsg()) || "").trim();
  if (!cfg.cookies) throw new Error("请先在插件配置填写夸克Cookie");
  if (content === "夸克登录") {
    const root = await list(cfg.cookies, "0");
    return s.reply(`夸克Cookie有效，根目录项目${root.length}个`);
  }
  if (content === "夸克清理") {
    if (!cfg.clean_folder_id) throw new Error("请配置清理文件夹ID");
    return s.reply(
      `夸克清理完成：删除${await clean(cfg.cookies, cfg.clean_folder_id, Number(cfg.clean_expire_minutes) || 60)}项`,
    );
  }
  const kw = String((await s.param(1)) || content.replace(/^我要看/, "")).trim();
  await s.reply("正在为您检索中...");
  const rows = await search(String(cfg.search_api || "https://so.252035.xyz"), kw);
  if (!rows.length) return s.reply("未找到相关资源");
  const choice = await vorto.prompt(
    s,
    [
      ...rows
        .slice(0, 50)
        .map((v, i) => `[${i + 1}] ${String(v.note || "未知").slice(0, 40)}｜${String(v.datetime || "").slice(0, 10)}`),
      "回复序号转存并生成新分享",
    ].join("\n"),
    120000,
  );
  if (choice === null) return s.reply("已退出");
  const item = rows[Number(choice) - 1];
  if (!item) throw new Error("资源序号无效");
  const src = item.url + (item.password ? `${item.url.includes("?") ? "&" : "?"}pwd=${item.password}` : ""),
    folder = String(cfg.save_folder || `转存_${Math.floor(Date.now() / 1000)}`),
    url = await saveShare(cfg.cookies, src, folder, Number(cfg.share_option) || 1);
  await s.reply(utils.image(`https://api.qrtool.cn/?text=${encodeURIComponent(url)}&size=300&level=M`));
  return s.reply(`转存并分享成功：\n${url}`);
}
main().catch((e) => s.reply(`夸克推广执行失败：${e?.message || e}`));
