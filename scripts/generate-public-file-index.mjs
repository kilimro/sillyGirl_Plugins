import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { format, resolveConfig } from "prettier";

const root = process.cwd();
const pluginsDir = path.join(root, "plugins");
const indexPath = path.join(root, "publicFileIndex.json");
const repo = process.env.GITHUB_REPOSITORY || "kilimro/sillyGirl_Plugins";
const branch = process.env.GITHUB_REF_NAME || "main";
const repoUrl = `https://github.com/${repo}`;
const pluginExts = new Set([".js", ".py"]);
const execFileAsync = promisify(execFile);
let existingIndex = {};
try {
  existingIndex = JSON.parse(await readFile(indexPath, "utf8"));
} catch {
  // 首次生成索引时没有历史发布时间可复用。
}

function normalizeMetaKey(key) {
  const normalized = String(key || "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized === "param") return "";
  if (normalized === "description") return "desc";
  return normalized;
}

function parseMeta(content) {
  const meta = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^[ \t]*(?:\/\/|#+)[ \t]*\[[ \t]*([\w+-]+)[ \t]*:[ \t]*(.*?)[ \t]*\][ \t]*$/);
    if (match) {
      const key = normalizeMetaKey(match[1]);
      if (key) meta[key] = String(match[2] || "").trim();
    }
  }
  return meta;
}

function pluginId(seed) {
  const hash = createHash("md5").update(seed).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
}

function pluginType(file) {
  return path.extname(file).toLowerCase() === ".py" ? "python" : "node";
}

function parseDependencies(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map((item) => String(item || "").trim()).filter(Boolean))].sort();
  } catch {
    return [];
  }
}

async function pluginPublishedAt(pluginFile, relativePath) {
  try {
    const { stdout } = await execFileAsync("git", ["log", "--follow", "--format=%aI", "--", relativePath], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    });
    const history = String(stdout || "")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    const value = history.at(-1);
    if (value && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  } catch {
    // 未安装 Git 或文件尚未提交时使用文件时间，确保本地新插件也能进入“最新发布”。
  }
  const info = await stat(pluginFile);
  const value = info.birthtimeMs > 0 ? info.birthtime : info.mtime;
  return value.toISOString();
}

const files = await readdir(pluginsDir, { withFileTypes: true });
const pluginFiles = files
  .filter((entry) => entry.isFile() && pluginExts.has(path.extname(entry.name).toLowerCase()))
  .map((entry) => path.join(pluginsDir, entry.name))
  .sort((a, b) => a.localeCompare(b));

const result = {};
for (const pluginFile of pluginFiles) {
  const relativePath = path.relative(root, pluginFile).replaceAll("\\", "/");
  const content = await readFile(pluginFile, "utf8");
  const meta = parseMeta(content);
  const pluginName = path.basename(pluginFile, path.extname(pluginFile));
  const name = meta.name || pluginName;
  const author = meta.author || repo.split("/")[0];
  const id = pluginId(`${repo}@${branch}/${relativePath}`);
  const rawBase = `https://raw.githubusercontent.com/${repo}/${branch}`;
  const createAt = existingIndex[id]?.create_at || (await pluginPublishedAt(pluginFile, relativePath));
  const declaredDependencies = parseDependencies(meta.depe);
  const dependencies = declaredDependencies.filter((item) => !item.startsWith("./"));
  const moduleDependencies = declaredDependencies.filter((item) => item.startsWith("./"));
  result[id] = {
    id,
    name,
    title: meta.title || pluginName,
    author,
    version: meta.version || "v1.0.0",
    desc: meta.desc || "",
    icon: meta.icon || "",
    class: meta.class || "",
    rule: meta.rule || "",
    cron: meta.cron || "",
    status: meta.status !== "false",
    public: meta.public === "true",
    admin: meta.admin === "true",
    module: meta.module === "true",
    on_start: meta.on_start === "true",
    web: meta.web === "true",
    carry: meta.carry === "true",
    path: relativePath,
    raw: `${rawBase}/${relativePath}`,
    dependencies,
    module_dependencies: moduleDependencies,
    type: meta.type || pluginType(pluginFile),
    origin: repoUrl,
    create_at: createAt,
  };
}

const prettierOptions = (await resolveConfig(indexPath)) || {};
const output = await format(JSON.stringify(result), { ...prettierOptions, parser: "json" });
await writeFile(indexPath, output);
console.log(`Generated publicFileIndex.json with ${Object.keys(result).length} plugins.`);
