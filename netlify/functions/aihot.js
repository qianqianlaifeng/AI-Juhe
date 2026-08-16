// Netlify Function：服务端聚合「AI 相关」中文实时热榜。
// 关键点：
//  1) 在服务器侧抓取，绕开浏览器 CORS 跨域限制（前端只调同源 /.netlify/functions/aihot）。
//  2) 多源（36氪 / 知乎 / 百度 / IT之家 / 掘金 / 少数派 / CSDN / 51CTO / 酷安 / FreeBuf / V2EX 等）全部抓取后，
//     按 AI 关键词过滤，只保留 AI / 大模型 / 智能 / 科技前沿相关内容。
//  3) 合并去重、按热度排序，返回时【剥离来源字段】，前端不出现任何平台名。
// 这样无论真实数据来自哪个平台，用户看到的都只有「AI 实时热榜」本身。

function pickArray(j) {
  if (Array.isArray(j)) return j;
  if (j && Array.isArray(j.data)) return j.data;
  if (j && Array.isArray(j.result)) return j.result;
  if (j && j.data && Array.isArray(j.data.data)) return j.data.data;
  if (j && j.data && Array.isArray(j.data.list)) return j.data.list;
  if (j && typeof j === 'object') {
    for (const k of Object.keys(j)) {
      if (Array.isArray(j[k])) return j[k];
    }
  }
  return [];
}

// 把热度值统一解析成数字（支持「1.2万」「1234567」「3.4亿」）
function num(h) {
  if (h == null) return 0;
  const s = String(h).replace(/[,，\s]/g, '');
  let m = s.match(/([\d.]+)\s*亿/);
  if (m) return parseFloat(m[1]) * 1e8;
  m = s.match(/([\d.]+)\s*万/);
  if (m) return parseFloat(m[1]) * 10000;
  m = s.match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

// AI / 大模型 / 智能 / 科技前沿 关键词（中英文，宽松匹配，保证只留 AI 相关内容）
function isAI(title) {
  const t = (title || '').toUpperCase();
  if (!t) return false;
  const words = ['AI', 'LLM', 'GPT', 'AGI', 'MCP', 'RAG', 'SORA', 'AIGC',
    'COPILOT', 'GEMINI', 'CLAUDE', 'LLAMA', 'NLP', 'TTS', 'ASR', 'CV',
    'MISTRAL', 'QWEN', 'GLM', 'PERPLEXITY', 'STABLE', 'DIFFUSION', 'NVIDIA',
    'GPU', 'CPU', 'CHATBOT', 'NEURAL', 'TRANSFORMER'];
  const s = ' ' + t + ' ';
  if (words.some(w => s.includes(' ' + w + ' '))) return true;
  const phrases = ['大模型', '智能体', '人工智能', '机器学习', '深度学习', '神经网络',
    '生成式', '算力', '芯片', '智能算力', 'OPENAI', 'CHATGPT', '豆包', '通义',
    '文心', '文心一言', 'KIMI', '智谱', '机器人', '深度研究', '深度思考',
    '推理模型', '多模态', '具身智能', '强化学习', '开源大模型', '模型训练',
    '向量数据库', '知识库', '提示词', 'PROMPT', 'AI智能', '大模型训练',
    'AI AGENT', 'AI应用', '生成式AI', '人工智', 'AI绘画', 'AI视频', 'AI音乐',
    'AIPPT', '数字人', '智能助手', 'AI搜索', 'AI编程', 'AI芯片', '英伟达',
    '月之暗面', '阶跃', '百川', '零一万物', '面壁', 'MINIMAX', 'MIDJOURNEY',
    '数据要素', '算法', '语料', '国产大模型', '星火', 'AI大模型', '智能'];
  return phrases.some(p => t.includes(p));
}

// 上游源（在 Netlify 服务器侧抓取，不受浏览器跨域限制）
// 以「科技 / AI 垂类」板块为主，AI 浓度高，避免综合热榜过滤后为空。
const SOURCES = [
  {
    name: '36kr',
    url: 'https://api.vvhan.com/api/hotlist?type=36k',
    map: d => pickArray(d).map(x => ({
      title: x.title,
      url: x.url || x.link || '',
      hot: String((x.hot != null) ? x.hot : (x.hotValue != null ? x.hotValue : ''))
    }))
  },
  {
    name: 'ithome',
    url: 'https://api.vvhan.com/api/hotlist?type=ithome',
    map: d => pickArray(d).map(x => ({
      title: x.title,
      url: x.url || x.link || '',
      hot: String((x.hot != null) ? x.hot : (x.hotValue != null ? x.hotValue : ''))
    }))
  },
  {
    name: 'csdn',
    url: 'https://api.vvhan.com/api/hotlist?type=csdn',
    map: d => pickArray(d).map(x => ({
      title: x.title,
      url: x.url || x.link || '',
      hot: String((x.hot != null) ? x.hot : (x.hotValue != null ? x.hotValue : ''))
    }))
  },
  {
    name: 'juejin',
    url: 'https://api.vvhan.com/api/hotlist?type=juejin',
    map: d => pickArray(d).map(x => ({
      title: x.title,
      url: x.url || x.link || '',
      hot: String((x.hot != null) ? x.hot : (x.hotValue != null ? x.hotValue : ''))
    }))
  },
  {
    name: 'sspai',
    url: 'https://api.vvhan.com/api/hotlist?type=sspai',
    map: d => pickArray(d).map(x => ({
      title: x.title,
      url: x.url || x.link || '',
      hot: String((x.hot != null) ? x.hot : (x.hotValue != null ? x.hotValue : ''))
    }))
  },
  {
    name: '51cto',
    url: 'https://api.vvhan.com/api/hotlist?type=51cto',
    map: d => pickArray(d).map(x => ({
      title: x.title,
      url: x.url || x.link || '',
      hot: String((x.hot != null) ? x.hot : (x.hotValue != null ? x.hotValue : ''))
    }))
  },
  {
    name: 'coolapk',
    url: 'https://api.vvhan.com/api/hotlist?type=coolapk',
    map: d => pickArray(d).map(x => ({
      title: x.title,
      url: x.url || x.link || '',
      hot: String((x.hot != null) ? x.hot : (x.hotValue != null ? x.hotValue : ''))
    }))
  },
  {
    name: 'freebuf',
    url: 'https://api.vvhan.com/api/hotlist?type=freebuf',
    map: d => pickArray(d).map(x => ({
      title: x.title,
      url: x.url || x.link || '',
      hot: String((x.hot != null) ? x.hot : (x.hotValue != null ? x.hotValue : ''))
    }))
  },
  {
    name: 'baidu',
    url: 'https://api.vvhan.com/api/hotlist?type=baidu',
    map: d => pickArray(d).map(x => ({
      title: x.title,
      url: x.url || x.link || '',
      hot: String((x.hot != null) ? x.hot : (x.hotValue != null ? x.hotValue : ''))
    }))
  },
  {
    name: 'zhihu',
    url: 'https://api.codelife.cc/api/top/list?lang=cn&id=mproPpoq6O&size=50',
    map: d => pickArray(d.data != null ? d.data : d).map(x => ({
      title: x.title,
      url: x.link || x.url || '',
      hot: String((x.hotValue != null) ? x.hotValue : (x.hot != null ? x.hot : ''))
    }))
  }
];

exports.handler = async () => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  };

  const collected = [];
  await Promise.all(SOURCES.map(async (src) => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(src.url, { redirect: 'follow', signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) return;
      const j = await r.json();
      const items = src.map(j).filter(x => x && x.title && isAI(x.title));
      for (const it of items) collected.push({ ...it, _hot: num(it.hot) });
    } catch (e) {
      // 单个源失败不影响其他源
    }
  }));

  // 去重（按标题）
  const seen = new Set();
  const dedup = [];
  for (const it of collected) {
    const key = (it.title || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    dedup.push(it);
  }
  // 按热度降序
  dedup.sort((a, b) => b._hot - a._hot);

  const top = dedup.slice(0, 20).map(({ title, url, hot }) => ({ title, url, hot }));
  if (!top.length) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ ok: false, error: '暂未聚合到 AI 相关热点' })
    };
  }
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: true, count: top.length, items: top })
  };
};
