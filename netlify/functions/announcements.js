// Netlify Function：公告的读写接口。
// 作用：让「后台发布公告」能实时同步到「线上站点」，不再依赖浏览器 localStorage（localStorage 只在同一台浏览器本机有效）。
//   GET  /.netlify/functions/announcements  -> 返回 { mode, announcements }
//   POST /.netlify/functions/announcements  -> 写入配置，需带请求头 x-admin-token（即后台登录密码）
// 存储：优先写入服务端可写目录（Netlify 运行时为 /tmp；本地测试为函数目录）。无外部依赖。

const fs = require('fs');
const path = require('path');

const STORE_DIR = process.env.NETLIFY ? '/tmp' : __dirname;
const STORE_FILE = path.join(STORE_DIR, 'announcements.json');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'zhanglianxin';
const VALID_MODES = ['marquee', 'vertical-up', 'vertical-down', 'fade', 'static'];

function readConfig() {
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { mode: 'static', announcements: parsed };
    return {
      mode: VALID_MODES.includes(parsed.mode) ? parsed.mode : 'static',
      announcements: Array.isArray(parsed.announcements) ? parsed.announcements : []
    };
  } catch (e) {
    return { mode: 'static', announcements: [] };
  }
}

function writeConfig(cfg) {
  fs.writeFileSync(STORE_FILE, JSON.stringify({ mode: cfg.mode || 'static', announcements: cfg.announcements || [] }, null, 2));
}

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store'
};

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      return { statusCode: 200, headers, body: JSON.stringify(readConfig()) };
    }
    if (event.httpMethod === 'POST' || event.httpMethod === 'PUT') {
      const token = event.headers['x-admin-token'] || event.headers['X-Admin-Token'];
      if (token !== ADMIN_TOKEN) {
        return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: 'unauthorized' }) };
      }
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch (e) { body = {}; }
      const cfg = {
        mode: VALID_MODES.includes(body.mode) ? body.mode : 'static',
        announcements: Array.isArray(body.announcements) ? body.announcements : []
      };
      writeConfig(cfg);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }
    return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: 'method not allowed' }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
