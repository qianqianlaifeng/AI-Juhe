// 同步脚本：抓取源站最新渠道数据，更新 data/sites.js 与首页的更新日期/缓存版本。
// 用法：
//   node scripts/sync.mjs                # 在线同步
//   node scripts/sync.mjs --local a.html # 用本地快照同步（测试用）
// 退出码：0 成功（含无变化）；非 0 抓取或解析失败。
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL = "https://share.s17t9.my/p/261aa1ae";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_FILE = resolve(ROOT, "data/sites.js");
const INDEX_FILE = resolve(ROOT, "index.html");

const headMarker = "    const sites = [";
const tailMarker = "\n    const state = { image25";

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

async function load() {
  const localFlag = process.argv.indexOf("--local");
  if (localFlag > -1) {
    const file = process.argv[localFlag + 1];
    if (!file) throw new Error("--local 需要文件路径");
    return readFile(resolve(file), "utf8");
  }
  const res = await fetch(SOURCE_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
      "accept": "text/html,application/xhtml+xml",
      "cache-control": "no-cache"
    },
    signal: AbortSignal.timeout(45000)
  });
  if (!res.ok) throw new Error(`抓取失败：HTTP ${res.status}`);
  return res.text();
}

const html = await load();
const { dataText, dateText } = extract(html);
const count = (dataText.match(/"name"\s*:/g) || []).length;
const hash = createHash("sha256").update(dataText).digest("hex").slice(0, 8);
const dataJs = `// 数据来源：${SOURCE_URL}\n// 由 scripts/sync.mjs 自动生成，请勿手工修改。\n\nconst sites = ${dataText}\n`;

let oldData = "";
try { oldData = await readFile(DATA_FILE, "utf8"); } catch (_) {}

let changed = [];
if (oldData !== dataJs) {
  await writeFile(DATA_FILE, dataJs, "utf8");
  changed.push("data/sites.js");
}

let index = await readFile(INDEX_FILE, "utf8");
let nextIndex = index.replace(/(data\/sites\.js\?v=)[^"']*/g, `$1${hash}`);
if (dateText) {
  nextIndex = nextIndex.replace(/(<div class="date-chip">)[\s\S]*?(<\/div>)/, `$1${dateText}$2`);
}
if (nextIndex !== index) {
  await writeFile(INDEX_FILE, nextIndex, "utf8");
  changed.push("index.html");
}

console.log(`渠道 ${count} 个，数据版本 ${hash}，${dateText || "无更新日期"}；${changed.length ? "已更新：" + changed.join("、") : "无变化"}`);
