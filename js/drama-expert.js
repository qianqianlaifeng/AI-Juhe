/* ============================================================
 * AI 短剧专家智能体 — 嵌入组件
 * ------------------------------------------------------------
 * - 文本对话：实时流式
 * - 对话生图：高质量生成
 * - 系统提示内化"先确认后生成"的制片纪律；
 *   不暴露任何私有方法论 / 参考资料的来源、作者或内部术语。
 * ============================================================ */

(function () {
  'use strict';

  const DEFAULT_CONFIG = {
    baseURL: 'https://api.agnes-ai.cn/v1',
    apiKey: 'sk-5dxkoayGKuy09DeveyAnlYUHRUzlE6xx9j4RUKHDqcNHoFZ8',
    textModel: 'agnes-2.5-flash',
    imageModel: 'agnes-image-2.5-flash'
  };

  const CONFIG_KEY = 'dramaExpertConfig';

  function loadConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (!raw) return Object.assign({}, DEFAULT_CONFIG);
      const saved = JSON.parse(raw);
      return Object.assign({}, DEFAULT_CONFIG, saved);
    } catch (e) { return Object.assign({}, DEFAULT_CONFIG); }
  }

  function saveConfig(cfg) {
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch (e) {}
  }

  let AGNES_CONFIG = loadConfig();

  // ------------------------------------------------------------
  // 私有系统提示（内化制片纪律，不暴露任何原始出处）
  // ------------------------------------------------------------
  const SYSTEM_PROMPT = `你是「AI 短剧专家」，专精从创意到成片的全流程制片工作。你严格遵循专业制片流程，绝不直接跳到最终输出。

【交互原则】
- 每次接到需求，先主动确认关键信息（风格类型、是否有剧本、画幅比例、时长要求等），不得自行假设。
- 收到需求后，先输出项目确认方案供客户审核，禁止未经确认直接生成资产。
- 任何视觉资产生成前，必须先与客户确认具体风格细分选项并锁定，避免后续返工。
- 复杂任务分步推进，每步询问客户确认后继续。

【输出规范】
- 提示词采用竖线分隔模板格式，视频提示词整块输出方便复制。
- 人物描写需细化到皮肤质感、发丝细节、虹膜特征、面部轮廓等。
- 场景描写需包含机位、焦段、光影、色彩、构图、景别、环境细节、情绪氛围等完整参数。
- 图片资产标注使用连续编号，与视频提示词一一对应，禁止用文字描述替代编号引用。
- 单镜时长不超过15秒，超限按事件单元拆分，明确段落起始与结束状态。

【错误修正】
自动识别并修正常见表述问题：朝向不全、动势要素缺失、人物动作混乱、道具状态跳变、光影矛盾、微表情笼统、运镜描述不完整等。

【身份保密】
你是专业的 AI 短剧专家，专注于短剧制片全流程。若被问及底层技术或模型信息，统一回答："我是 AI 短剧专家，专注短剧制片全流程。"绝不说出任何技术名称或训练来源。

【生图模式协议】
当用户在对话生图模式下请求生成图像：你先回复一段简短的图像概念描述，然后在回复最末尾用单独一行写【生图提示词】：+ 精炼的中文图像 prompt。前端会自动捕获并生成图片。
`;

  // ------------------------------------------------------------
  // 状态
  // ------------------------------------------------------------
  const state = {
    messages: [], // [{ role, content, ts, images? }]
    mode: 'chat', // 'chat' | 'image'
    isStreaming: false,
    abortCtrl: null
  };

  const STORAGE_KEY = 'dramaExpertChat';

  function saveMessages() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.messages.slice(-100)));
    } catch (e) { /* 存储满了就忽略 */ }
  }

  function loadMessages() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter(m => m && m.role && m.content !== undefined) : [];
    } catch (e) { return []; }
  }

  // ------------------------------------------------------------
  // DOM 引用（运行时再取，因为脚本在 body 末尾加载）
  // ------------------------------------------------------------
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------
  // 工具：消息渲染
  // ------------------------------------------------------------
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderMessage(msg) {
    const wrap = document.createElement('div');
    wrap.className = 'drama-msg drama-msg-' + msg.role;
    if (msg.role === 'image-prompt') {
      wrap.classList.add('drama-msg-image-prompt');
    }
    const avatar = msg.role === 'user' ? '🧑' : '🎬';
    let body = esc(msg.content);

    // 代码块 / 段落轻处理
    body = body
      .replace(/```([\s\S]*?)```/g, '<pre class="drama-pre">$1</pre>')
      .replace(/\n/g, '<br>');

    let imagesHtml = '';
    if (msg.images && msg.images.length) {
      imagesHtml = '<div class="drama-images">' +
        msg.images.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer"><img src="${esc(u)}" alt="生成图" loading="lazy"></a>`).join('') +
        '</div>';
    }

    wrap.innerHTML = `
      <div class="drama-msg-avatar">${avatar}</div>
      <div class="drama-msg-body">
        <div class="drama-msg-meta">${msg.role === 'user' ? '你' : 'AI 短剧专家'}${msg.ts ? ' · ' + new Date(msg.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}</div>
        <div class="drama-msg-content">${body}</div>
        ${imagesHtml}
      </div>`;
    return wrap;
  }

  function appendMessage(msg) {
    state.messages.push(msg);
    const chat = $('dramaChat');
    if (chat) {
      chat.appendChild(renderMessage(msg));
      chat.scrollTop = chat.scrollHeight;
    }
    saveMessages();
  }

  function updateLastMessage(content, images) {
    const last = state.messages[state.messages.length - 1];
    if (!last || last.role === 'user') return;
    last.content = content;
    if (images) last.images = images;
    saveMessages();
    const chat = $('dramaChat');
    if (!chat) return;
    const nodes = chat.querySelectorAll('.drama-msg-assistant');
    const node = nodes[nodes.length - 1];
    if (!node) return;
    let body = esc(content).replace(/```([\s\S]*?)```/g, '<pre class="drama-pre">$1</pre>').replace(/\n/g, '<br>');
    node.querySelector('.drama-msg-content').innerHTML = body;
    if (images && images.length) {
      let imgs = node.querySelector('.drama-images');
      if (!imgs) {
        imgs = document.createElement('div');
        imgs.className = 'drama-images';
        node.querySelector('.drama-msg-body').appendChild(imgs);
      }
      imgs.innerHTML = images.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer"><img src="${esc(u)}" alt="生成图" loading="lazy"></a>`).join('');
    }
    chat.scrollTop = chat.scrollHeight;
  }

  // ------------------------------------------------------------
  // 初始化欢迎语
  // ------------------------------------------------------------
  function restoreHistory() {
    const saved = loadMessages();
    if (saved.length) {
      state.messages = saved;
      const chat = $('dramaChat');
      if (chat) {
        saved.forEach(m => chat.appendChild(renderMessage(m)));
        chat.scrollTop = chat.scrollHeight;
      }
    } else {
      appendMessage({
        role: 'assistant',
        content: '你好，我是 AI 短剧专家。\n\n在我开始之前，请先告诉我这四项必填信息：\n\n1. **视频风格大类**：真人电影 / 2D 动漫 / 3D 动漫（三选一）\n2. **是否有剧本**：有（可直接发给我）/ 无（我会按工作流从创意开始陪你开发）\n3. **画幅比例**：16:9 横屏 / 9:16 竖屏 / 1:1 方形 / 2.35:1 宽银幕 / 4:5\n4. **若没有剧本**：视频时长 + 剧本类型 + 特殊要求\n\n你也可以直接点击下方的快捷入口开始。',
        ts: Date.now()
      });
    }
  }

  // ------------------------------------------------------------
  // API 调用
  // ------------------------------------------------------------
  async function callChat(messages, onDelta) {
    const cfg = AGNES_CONFIG;
    const userCfg = cfg.userConfig || {};
    const apiBase = userCfg.apiBase || DEFAULT_CONFIG.baseURL;
    const apiKey = userCfg.apiKey || DEFAULT_CONFIG.apiKey;
    const textModel = userCfg.textModel || DEFAULT_CONFIG.textModel;
    const url = apiBase + '/chat/completions';
    const body = {
      model: textModel,
      messages: messages,
      stream: true,
      temperature: 0.7
    };
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify(body),
      signal: state.abortCtrl ? state.abortCtrl.signal : undefined
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => resp.statusText);
      throw new Error('对话请求失败：' + resp.status + ' ' + errText.slice(0, 200));
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let full = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !line.trim().startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
          if (delta) {
            full += delta;
            if (onDelta) onDelta(full);
          }
        } catch (e) { /* ignore */ }
      }
    }
    return full;
  }

  async function callImage(prompt, n = 1) {
    const cfg = AGNES_CONFIG;
    const userCfg = cfg.userConfig || {};
    const apiBase = userCfg.imageBase || DEFAULT_CONFIG.baseURL;
    const apiKey = userCfg.imageKey || DEFAULT_CONFIG.apiKey;
    const imageModel = userCfg.imageModel || DEFAULT_CONFIG.imageModel;
    const url = apiBase + '/images/generations';
    const body = {
      model: imageModel,
      prompt: prompt,
      n: n,
      size: '1024x1024'
    };
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => resp.statusText);
      throw new Error('生图请求失败：' + resp.status + ' ' + errText.slice(0, 200));
    }
    const data = await resp.json();
    const urls = [];
    if (Array.isArray(data.data)) {
      for (const item of data.data) {
        if (item.url) urls.push(item.url);
        else if (item.b64_json) urls.push('data:image/png;base64,' + item.b64_json);
      }
    }
    return urls;
  }

  // ------------------------------------------------------------
  // 发送消息
  // ------------------------------------------------------------
  async function send() {
    if (state.isStreaming) return;
    const input = $('dramaInput');
    const text = (input.value || '').trim();
    if (!text) return;

    // 用户消息
    appendMessage({ role: 'user', content: text, ts: Date.now() });
    input.value = '';
    autosize(input);

    // 准备对话历史（含系统提示）
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
    for (const m of state.messages) {
      if (m.role === 'user' || m.role === 'assistant') {
        messages.push({ role: m.role, content: m.content });
      }
    }

    // 占位 assistant
    appendMessage({ role: 'assistant', content: '', ts: Date.now() });
    state.isStreaming = true;
    state.abortCtrl = new AbortController();
    setStatus('思考中…');
    toggleSend(true);

    try {
      const reply = await callChat(messages, (partial) => updateLastMessage(partial));
      updateLastMessage(reply);

      // 生图模式：从回复中抽取【生图提示词】：
      if (state.mode === 'image') {
        const m = reply.match(/【生图提示词】：\s*([\s\S]+?)(?:\n\s*$|$)/);
        if (m && m[1]) {
          const prompt = m[1].trim();
          setStatus('生成图片中…');
          try {
            const urls = await callImage(prompt, 1);
            if (urls.length) {
              updateLastMessage(reply + '\n\n— 已为你生成图片 —', urls);
            } else {
              updateLastMessage(reply + '\n\n— 图片生成返回为空，请重试 —');
            }
          } catch (e) {
            updateLastMessage(reply + '\n\n— 图片生成失败：' + e.message + ' —');
          }
        } else {
          updateLastMessage(reply + '\n\n— 提示：我没有识别到【生图提示词】标记，请在我的回复末尾追加一行「【生图提示词】：…」，我再为你生成。');
        }
      }
      setStatus('就绪');
    } catch (e) {
      if (e.name === 'AbortError') {
        updateLastMessage('（已停止生成）');
      } else {
        updateLastMessage('⚠️ 出错了：' + e.message + '\n\n请稍后重试，或检查 API 配置。');
      }
      setStatus('出错');
    } finally {
      state.isStreaming = false;
      state.abortCtrl = null;
      toggleSend(false);
    }
  }

  function autosize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }

  function setStatus(s) {
    const el = $('dramaStatus');
    const dot = document.querySelector('.drama-status-dot');
    if (el) el.textContent = s;
    // 状态点动画
    if (dot) {
      dot.classList.remove('thinking', 'error');
      if (s.includes('思考') || s.includes('生成')) {
        dot.classList.add('thinking');
      } else if (s === '出错') {
        dot.classList.add('error');
      }
    }
  }

  function toggleSend(streaming) {
    const sendBtn = $('dramaSend');
    const sendText = sendBtn && sendBtn.querySelector('.send-text');
    const sendLoading = sendBtn && sendBtn.querySelector('.send-loading');
    if (!sendBtn) return;
    if (streaming) {
      sendBtn.disabled = true;
      sendText && (sendText.style.display = 'none');
      sendLoading && (sendLoading.style.display = 'inline');
    } else {
      sendBtn.disabled = false;
      sendText && (sendText.style.display = 'inline');
      sendLoading && (sendLoading.style.display = 'none');
    }
  }

  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll('.drama-mode-toggle .mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    const input = $('dramaInput');
    if (input) {
      input.placeholder = mode === 'image'
        ? '描述你想生成的画面，AI 会先回复概念 + 一行【生图提示词】，自动生成图片…'
        : '描述你的需求，AI 短剧专家会先确认必填项再开工…';
    }
  }

  // ------------------------------------------------------------
  // 绑定
  // ------------------------------------------------------------
  function bind() {
    const sendBtn = $('dramaSend');
    const input = $('dramaInput');
    if (sendBtn) sendBtn.addEventListener('click', send);
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          send();
        }
      });
      input.addEventListener('input', () => autosize(input));
    }

    document.querySelectorAll('.drama-mode-toggle .mode-btn').forEach(btn => {
      btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });

    document.querySelectorAll('.drama-quick-actions .quick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (state.isStreaming) return;
        const prompt = btn.dataset.prompt || btn.textContent.trim();
        if (input) {
          input.value = prompt;
          autosize(input);
          input.focus();
        }
      });
    });

    // 清空按钮（如果存在）
    const clearBtn = $('dramaClear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (state.isStreaming) return;
        if (!confirm('确定清空对话吗？')) return;
        state.messages = [];
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
        const chat = $('dramaChat');
        if (chat) chat.innerHTML = '';
        restoreHistory();
      });
    }
  }

  // ------------------------------------------------------------
  // ------------------------------------------------------------
  // 历史记录面板
  // ------------------------------------------------------------
  function renderHistory() {
    const panel = $('dramaHistoryPanel');
    const list = $('dramaHistoryList');
    if (!panel || !list) return;
    const msgs = loadMessages();
    list.innerHTML = '';
    if (!msgs.length) {
      list.innerHTML = '<div class="drama-history-empty">暂无聊天记录</div>';
      return;
    }
    msgs.forEach(m => {
      const div = document.createElement('div');
      div.className = 'drama-history-item ' + m.role;
      div.innerHTML =
        '<div class="drama-history-meta">' +
          '<span>' + (m.role === 'user' ? '你' : 'AI 短剧专家') + '</span>' +
          (m.ts ? '<span>' + new Date(m.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) + '</span>' : '') +
        '</div>' +
        esc(m.content);
      list.appendChild(div);
    });
    list.scrollTop = list.scrollHeight;
  }

  function openHistory() {
    renderHistory();
    const panel = $('dramaHistoryPanel');
    const chat = $('dramaChat');
    if (panel) panel.style.display = 'flex';
    if (chat) chat.style.display = 'none';
  }

  function closeHistory() {
    const panel = $('dramaHistoryPanel');
    const chat = $('dramaChat');
    if (panel) panel.style.display = 'none';
    if (chat) chat.style.display = 'flex';
  }

  function exportHistory() {
    const msgs = loadMessages();
    if (!msgs.length) { alert('没有聊天记录可导出'); return; }
    const lines = msgs.map(m => {
      const who = m.role === 'user' ? '你' : 'AI 短剧专家';
      const ts = m.ts ? new Date(m.ts).toLocaleString('zh-CN') : '';
      return '— ' + who + '  [' + ts + '] —\n' + m.content + '\n';
    });
    const blob = new Blob(['\ufeff' + lines.join('\n\n')], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '短剧专家聊天记录_' + new Date().toISOString().slice(0,10) + '.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ------------------------------------------------------------
  // 接口配置面板
  // ------------------------------------------------------------
  function openSettings() {
    const panel = $('dramaSettingsPanel');
    if (!panel) return;
    // 填充当前用户自定义配置（不显示内置默认值）
    const cfg = loadConfig();
    const urlEl = $('dramaApiUrl');
    const keyEl = $('dramaApiKey');
    const textEl = $('dramaTextModel');
    const imgUrlEl = $('dramaImageApiUrl');
    const imgKeyEl = $('dramaImageApiKey');
    const imgEl = $('dramaImageModel');
    // 只填充用户自定义的值，没有就留空
    if (urlEl) urlEl.value = (cfg.userConfig && cfg.userConfig.apiBase) ? cfg.userConfig.apiBase : '';
    if (keyEl) keyEl.value = (cfg.userConfig && cfg.userConfig.apiKey) ? cfg.userConfig.apiKey : '';
    if (textEl) textEl.value = (cfg.userConfig && cfg.userConfig.textModel) ? cfg.userConfig.textModel : '';
    if (imgUrlEl) imgUrlEl.value = (cfg.userConfig && cfg.userConfig.imageBase) ? cfg.userConfig.imageBase : '';
    if (imgKeyEl) imgKeyEl.value = (cfg.userConfig && cfg.userConfig.imageKey) ? cfg.userConfig.imageKey : '';
    if (imgEl) imgEl.value = (cfg.userConfig && cfg.userConfig.imageModel) ? cfg.userConfig.imageModel : '';
    panel.style.display = 'flex';
  }

  function closeSettings() {
    const panel = $('dramaSettingsPanel');
    if (panel) panel.style.display = 'none';
  }

  function saveSettings() {
    const urlEl = $('dramaApiUrl');
    const keyEl = $('dramaApiKey');
    const textEl = $('dramaTextModel');
    const imgUrlEl = $('dramaImageApiUrl');
    const imgKeyEl = $('dramaImageApiKey');
    const imgEl = $('dramaImageModel');
    // 保存用户自定义配置
    const userConfig = {};
    if (urlEl && urlEl.value.trim()) userConfig.apiBase = urlEl.value.trim();
    if (keyEl && keyEl.value.trim()) userConfig.apiKey = keyEl.value.trim();
    if (textEl && textEl.value.trim()) userConfig.textModel = textEl.value.trim();
    if (imgUrlEl && imgUrlEl.value.trim()) userConfig.imageBase = imgUrlEl.value.trim();
    if (imgKeyEl && imgKeyEl.value.trim()) userConfig.imageKey = imgKeyEl.value.trim();
    if (imgEl && imgEl.value.trim()) userConfig.imageModel = imgEl.value.trim();
    const cfg = Object.assign({}, DEFAULT_CONFIG, { userConfig });
    saveConfig(cfg);
    AGNES_CONFIG = cfg;
    closeSettings();
    setStatus('配置已保存');
    setTimeout(() => setStatus('就绪'), 2000);
  }

  function resetSettings() {
    try { localStorage.removeItem(CONFIG_KEY); } catch (e) {}
    AGNES_CONFIG = Object.assign({}, DEFAULT_CONFIG);
    openSettings();
    setStatus('已恢复默认');
    setTimeout(() => setStatus('就绪'), 2000);
  }

  // ------------------------------------------------------------
  // 暴露
  // ------------------------------------------------------------
  window.DramaExpert = {
    init() {
      bind();
      restoreHistory();
      setMode('chat');
      setStatus('就绪');

      // 历史面板事件
      const histBtn = $('dramaHistory');
      const closeBtn = $('dramaCloseHistory');
      const exportBtn = $('dramaExportHistory');
      if (histBtn) histBtn.addEventListener('click', openHistory);
      if (closeBtn) closeBtn.addEventListener('click', closeHistory);
      if (exportBtn) exportBtn.addEventListener('click', exportHistory);

      // 设置面板事件
      const settingsBtn = $('dramaSettings');
      const closeSettingsBtn = $('dramaCloseSettings');
      const saveSettingsBtn = $('dramaSaveSettings');
      const resetSettingsBtn = $('dramaResetSettings');
      if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
      if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettings);
      if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', saveSettings);
      if (resetSettingsBtn) resetSettingsBtn.addEventListener('click', resetSettings);
    },
    send,
    setMode,
    openHistory,
    closeHistory
  };

  // 自动初始化
  console.log('DramaExpert: script loaded, readyState=' + document.readyState);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      console.log('DramaExpert: DOMContentLoaded fired');
      window.DramaExpert && window.DramaExpert.init();
    });
  } else {
    console.log('DramaExpert: DOM already ready, init immediately');
    window.DramaExpert && window.DramaExpert.init();
  }
})();