// Netlify Function：宝藏趣站的数据中转层。
// 关键安全设计：前端【不直连】Supabase，所有读写都经此函数；仅在此服务端使用 SERVICE_ROLE_KEY（Secret）。
// 因此前端拿不到任何 Supabase Key，也无法绕过校验直接写库。
//
// 环境变量（在 Netlify 后台配置）：
//   SUPABASE_URL              例如 https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY 项目的 service_role 密钥（Secret，切勿暴露给前端）
//
// 数据表：treasure_sites（建表语句见仓库 netlify/treasure-sites.sql）
//
// 接口：
//   GET  /.netlify/functions/treasure-sites        -> { ok, sites:[{id,name,url,description,image_url,created_at}], configured }
//   POST /.netlify/functions/treasure-sites        -> body: { name, url, description, image_url }
//                                                   -> { ok, site } 或 { ok:false, error }

const TABLE = 'treasure_sites';

function getEnv() {
  return {
    url: process.env.SUPABASE_URL || '',
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  };
}

function supabaseHeaders(key) {
  return {
    'apikey': key,
    'Authorization': 'Bearer ' + key,
    'Content-Type': 'application/json'
  };
}

function json(body, statusCode, extra) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      ...(extra || {})
    },
    body: JSON.stringify(body)
  };
}

function isHttpUrl(v) {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

// 基础校验：返回 null 表示通过，否则返回错误文案
function validate(payload) {
  const name = (payload.name || '').toString().trim();
  const url = (payload.url || '').toString().trim();
  const description = (payload.description || '').toString().trim();
  const imageUrl = (payload.image_url || payload.imageUrl || '').toString().trim();

  if (!name) return '请填写网站名称';
  if (name.length > 60) return '网站名称不能超过 60 字';
  if (!url) return '请填写网站网址';
  if (url.length > 500) return '网址过长';
  if (!isHttpUrl(url)) return '网址格式不正确（需以 http:// 或 https:// 开头）';
  if (!description) return '请填写网站介绍';
  if (description.length > 300) return '网站介绍不能超过 300 字';
  if (!imageUrl) return '请填写网站图片 URL';
  if (imageUrl.length > 500) return '图片 URL 过长';
  if (!isHttpUrl(imageUrl)) return '图片 URL 格式不正确';

  return null;
}

exports.handler = async (event) => {
  const env = getEnv();
  const configured = !!(env.url && env.key);

  if (event.httpMethod === 'GET') {
    if (!configured) {
      return json({ ok: true, sites: [], configured: false }, 200);
    }
    try {
      const resp = await fetch(
        `${env.url}/rest/v1/${TABLE}?select=*&order=created_at.desc`,
        { headers: supabaseHeaders(env.key) }
      );
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        return json({ ok: false, error: '读取失败：' + txt.slice(0, 200) }, 502);
      }
      const rows = await resp.json();
      const sites = Array.isArray(rows) ? rows : [];
      return json({ ok: true, sites, configured: true }, 200);
    } catch (e) {
      return json({ ok: false, error: '服务暂时不可用' }, 502);
    }
  }

  if (event.httpMethod === 'POST') {
    if (!configured) {
      return json({ ok: false, error: '服务暂未启用（缺少 Supabase 配置）' }, 503);
    }
    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch (e) {
      return json({ ok: false, error: '请求格式错误' }, 400);
    }

    const err = validate(payload);
    if (err) return json({ ok: false, error: err }, 400);

    const row = {
      name: payload.name.trim(),
      url: payload.url.trim(),
      description: payload.description.trim(),
      image_url: (payload.image_url || payload.imageUrl || '').trim()
    };

    try {
      const resp = await fetch(`${env.url}/rest/v1/${TABLE}`, {
        method: 'POST',
        headers: { ...supabaseHeaders(env.key), 'Prefer': 'return=representation' },
        body: JSON.stringify([row])
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        return json({ ok: false, error: '提交失败：' + txt.slice(0, 200) }, 502);
      }
      const inserted = await resp.json();
      const site = Array.isArray(inserted) ? inserted[0] : inserted;
      return json({ ok: true, site }, 200);
    } catch (e) {
      return json({ ok: false, error: '提交失败，请稍后再试' }, 502);
    }
  }

  return json({ ok: false, error: '不支持的请求方法' }, 405);
};
