// 同步脚本：抓取源站最新渠道数据，合并本站补充渠道，更新 data/sites.js 与首页日期/版本。
// 用法：
//   node scripts/sync.mjs                # 在线同步（含补充渠道可用性核验）
//   node scripts/sync.mjs --local a.html # 用本地快照同步（测试用）
//   node scripts/sync.mjs --no-verify    # 跳过补充渠道可用性核验
// 退出码：0 成功（含无变化）；非 0 抓取或解析失败。
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL = "https://share.s17t9.my/p/261aa1ae";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_FILE = resolve(ROOT, "data/sites.js");
const EXTRA_FILE = resolve(ROOT, "data/extra-sites.json");
const INDEX_FILE = resolve(ROOT, "index.html");

const headMarker = "    const sites = [";
const tailMarker = "\n    const state = { image25";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

function extract(html) {
  const headAt = html.indexOf(headMarker);
  const tailAt = html.indexOf(tailMarker);
  if (headAt < 0 || tailAt < 0) throw new Error("源页面未找到数据块标记，可能已改版");
  const dataStart = headAt + headMarker.length - 1;
  const dataText = html.slice(dataStart, tailAt).trimEnd();
  if (!dataText.startsWith("[") || !dataText.endsWith("];")) throw new Error("数据块格式异常");
  const dateMatch = html.match(/<div class="date-chip">([\s\S]*?)<\/div>/);
  return { dataText, dateText: dateMatch ? dateMatch[1].trim() : "" };
}

async function loadSource() {
  const localFlag = process.argv.indexOf("--local");
  if (localFlag > -1) {
    const file = process.argv[localFlag + 1];
    if (!file) throw new Error("--local 需要文件路径");
    return readFile(resolve(file), "utf8");
  }
  const res = await fetch(SOURCE_URL, {
    headers: {
      "user-agent": UA,
      "accept": "text/html,application/xhtml+xml",
      "cache-control": "no-cache"
    },
    signal: AbortSignal.timeout(45000)
  });
  if (!res.ok) throw new Error(`抓取失败：HTTP ${res.status}`);
  return res.text();
}

const beijingDate = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const normName = value => String(value || "").trim().toLowerCase();

async function probe(url) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": UA, "accept": "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(15000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

const html = await loadSource();
const { dataText, dateText } = extract(html);
const upstream = JSON.parse(dataText.slice(0, -1));

let extras = [];
try {
  extras = JSON.parse(await readFile(EXTRA_FILE, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw new Error(`补充渠道文件解析失败：${error.message}`);
}

let extrasChanged = false;
if (!process.argv.includes("--no-verify")) {
  for (const site of extras) {
    if (await probe(site.url)) {
      const today = beijingDate();
      if (site.verifiedAt !== today) {
        site.verifiedAt = today;
        extrasChanged = true;
      }
    }
  }
  if (extrasChanged) {
    await writeFile(EXTRA_FILE, JSON.stringify(extras, null, 2) + "\n", "utf8");
  }
}

const existing = new Set(upstream.map(site => normName(site.name)));
const merged = upstream.concat(extras.filter(site => !existing.has(normName(site.name))));
const dataJs = `// 数据来源：${SOURCE_URL}\n// 由 scripts/sync.mjs 自动生成，请勿手工修改。\n// 本站补充渠道维护在 data/extra-sites.json。\n\nconst sites = ${JSON.stringify(merged, null, 2)};\n`;
const hash = createHash("sha256").update(dataJs).digest("hex").slice(0, 8);

let oldData = "";
try { oldData = await readFile(DATA_FILE, "utf8"); } catch (_) {}

const changed = [];
if (oldData !== dataJs) {
  await writeFile(DATA_FILE, dataJs, "utf8");
  changed.push("data/sites.js");
}

const latestVerify = extras.map(site => site.verifiedAt).filter(Boolean).sort().pop() || "";
const verifyLabel = latestVerify ? latestVerify.replaceAll("-", ".") : "";

let index = await readFile(INDEX_FILE, "utf8");
let nextIndex = index.replace(/(data\/sites\.js\?v=)[^"']*/g, `$1${hash}`);
if (dateText) {
  nextIndex = nextIndex.replace(/(<div class="date-chip">)[\s\S]*?(<\/div>)/, `$1${dateText}$2`);
}
if (verifyLabel) {
  nextIndex = nextIndex.replace(/(<span id="extra-verified">)[\s\S]*?(<\/span>)/, `$1${verifyLabel}$2`);
}
if (nextIndex !== index) {
  await writeFile(INDEX_FILE, nextIndex, "utf8");
  changed.push("index.html");
}

console.log(`源表 ${upstream.length} 个 + 补充 ${merged.length - upstream.length} 个，数据版本 ${hash}，${dateText || "无更新日期"}；${changed.length ? "已更新：" + changed.join("、") : "无变化"}${extrasChanged ? "；补充渠道核验日期已刷新" : ""}`);
