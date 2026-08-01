(function() {
  'use strict';

  // 安全存储封装：file:// 或隐私模式导致 storage 被禁用时回退到内存
  function createStorage(store) {
    let memory = {};
    let available = false;
    try {
      const testKey = '__ai_platform_storage_test__';
      store.setItem(testKey, '1');
      store.removeItem(testKey);
      available = true;
    } catch (e) {
      available = false;
    }

    return {
      get(key) {
        try {
          if (available) return store.getItem(key);
        } catch (e) {}
        return memory[key] || null;
      },
      set(key, value) {
        try {
          if (available) {
            store.setItem(key, value);
            return;
          }
        } catch (e) {}
        memory[key] = value;
      },
      remove(key) {
        try {
          if (available) {
            store.removeItem(key);
            return;
          }
        } catch (e) {}
        delete memory[key];
      }
    };
  }

  const storage = createStorage(localStorage);
  const session = createStorage(sessionStorage);

  const STORAGE_KEY = 'ai_platform_projects';
  const INITIALIZED_KEY = 'ai_platform_initialized';
  const VERSION_KEY = 'ai_platform_version';
  const CURRENT_VERSION = '3';
  const SESSION_KEY = 'ai_platform_admin_session';
  const ANNOUNCEMENT_KEY = 'ai_platform_announcements';

  const DEFAULT_USERNAME = 'admin';
  const DEFAULT_PASSWORD = 'zhanglianxin';

  const DEFAULT_PROJECTS = [
    {
      id: 'proj_1',
      title: 'AI 写小说',
      url: 'https://ai-xiaoshuo.netlify.app/',
      description: '基于大语言模型的智能小说创作平台，支持剧情生成、角色塑造与章节续写，让创作者专注于故事本身。',
      tags: ['内容创作', '小说生成', 'LLM'],
      color: 'cyan',
      image: 'assets/images/ai-novel.jpg',
      createdAt: Date.now()
    },
    {
      id: 'proj_2',
      title: 'AI 多账号管理器',
      url: 'https://ai-doubao.netlify.app/',
      description: '面向 AI 服务的多账号集中管理工具，支持账号切换、会话隔离与批量操作，提升团队协作效率。',
      tags: ['账号治理', '效率工具', '多开'],
      color: 'purple',
      image: 'assets/images/ai-accounts.jpg',
      createdAt: Date.now() - 1000
    },
    {
      id: 'proj_3',
      title: '游麟 AI-Agent',
      url: 'https://youlin-ai.netlify.app/',
      description: '具备长期记忆、自主决策与多工具调用能力的 AI Agent，可持续学习并独立完成复杂任务。',
      tags: ['AI Agent', '智能体', '自动化'],
      color: 'blue',
      image: 'assets/images/ai-agent.jpg',
      createdAt: Date.now() - 2000
    }
  ];

  function getProjects() {
    try {
      const raw = storage.get(STORAGE_KEY);
      return raw ? JSON.parse(raw) : DEFAULT_PROJECTS;
    } catch (e) {
      return DEFAULT_PROJECTS;
    }
  }

  function saveProjects(projects) {
    storage.set(STORAGE_KEY, JSON.stringify(projects));
    storage.set(INITIALIZED_KEY, 'true');
    storage.set(VERSION_KEY, CURRENT_VERSION);
  }

  function generateId() {
    return 'proj_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function parseTags(str) {
    return str.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  }

  function showToast(message, type = 'success') {
    let toast = document.querySelector('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `toast ${type}`;
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => toast.classList.remove('show'), 3000);
  }

  function isLoggedIn() {
    return session.get(SESSION_KEY) === 'true';
  }

  function setLoggedIn(value) {
    if (value) session.set(SESSION_KEY, 'true');
    else session.remove(SESSION_KEY);
  }

  function updateStats() {
    const projects = getProjects();
    const totalEl = document.getElementById('stat-total');
    const todayEl = document.getElementById('stat-today');
    const tagsEl = document.getElementById('stat-tags');

    if (totalEl) totalEl.textContent = projects.length;

    if (todayEl) {
      const today = new Date().setHours(0, 0, 0, 0);
      const todayCount = projects.filter(p => (p.createdAt || 0) >= today).length;
      todayEl.textContent = todayCount;
    }

    if (tagsEl) {
      const tagSet = new Set();
      projects.forEach(p => (p.tags || []).forEach(t => tagSet.add(t)));
      tagsEl.textContent = tagSet.size;
    }
  }

  function updateView() {
    const loginSection = document.getElementById('admin-login');
    const dashboard = document.getElementById('admin-dashboard');

    if (isLoggedIn()) {
      loginSection.style.display = 'none';
      dashboard.classList.add('active');
      renderTable();
      updateStats();
      switchAdminView('projects');
    } else {
      loginSection.style.display = 'flex';
      dashboard.classList.remove('active');
    }
  }

  // 后台多视图切换：项目管理 / 接码平台 / 公告管理
  function switchAdminView(view) {
    const navLinks = document.querySelectorAll('.admin-sidebar-nav a[data-view]');
    navLinks.forEach(a => a.classList.toggle('active', a.dataset.view === view));

    const views = ['projects', 'sms', 'announce'];
    views.forEach(v => {
      const el = document.getElementById('view-' + v);
      if (el) el.style.display = (v === view) ? '' : 'none';
    });

    if (view === 'announce') renderAnnounceList();
  }

  function renderTable() {
    const tbody = document.getElementById('projects-tbody');
    if (!tbody) return;

    const projects = getProjects();
    tbody.innerHTML = '';

    if (projects.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="3" class="empty-state">
            <p>暂无项目，请从左侧添加。</p>
          </td>
        </tr>
      `;
      return;
    }

    projects.forEach((proj, index) => {
      const tr = document.createElement('tr');
      const tags = (proj.tags || []).slice(0, 3).map(t => escapeHtml(t)).join('、');
      tr.innerHTML = `
        <td>
          <div class="table-title">${escapeHtml(proj.title)}</div>
          <div class="table-url">${escapeHtml(proj.url)}</div>
        </td>
        <td>${tags || '-'}</td>
        <td>
          <div class="table-actions">
            <button class="btn btn-sm btn-secondary" data-action="edit" data-index="${index}">编辑</button>
            <button class="btn btn-sm btn-danger" data-action="delete" data-index="${index}">删除</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  function resetForm() {
    document.getElementById('project-form').reset();
    document.getElementById('project-id').value = '';
    document.getElementById('form-title').textContent = '添加项目';
    document.getElementById('cancel-edit').style.display = 'none';
  }

  function fillForm(project, index) {
    document.getElementById('project-id').value = project.id || '';
    document.getElementById('p-title').value = project.title || '';
    document.getElementById('p-url').value = project.url || '';
    document.getElementById('p-desc').value = project.description || '';
    document.getElementById('p-tags').value = (project.tags || []).join('，');
    document.getElementById('p-image').value = project.image || '';
    document.getElementById('p-color').value = project.color || 'cyan';
    document.getElementById('form-title').textContent = '编辑项目';
    document.getElementById('cancel-edit').style.display = 'inline-flex';
    document.getElementById('project-form').dataset.editIndex = index;
  }

  function handleFormSubmit(e) {
    e.preventDefault();
    if (!isLoggedIn()) return;

    const id = document.getElementById('project-id').value;
    const title = document.getElementById('p-title').value.trim();
    const url = document.getElementById('p-url').value.trim();
    const description = document.getElementById('p-desc').value.trim();
    const tags = parseTags(document.getElementById('p-tags').value);
    const image = document.getElementById('p-image').value.trim();
    const color = document.getElementById('p-color').value;

    if (!title || !url || !description) {
      showToast('请填写完整信息', 'error');
      return;
    }

    let projects = getProjects();
    const editIndex = document.getElementById('project-form').dataset.editIndex;

    if (editIndex !== undefined && editIndex !== '') {
      const idx = parseInt(editIndex, 10);
      if (projects[idx]) {
        projects[idx] = {
            ...projects[idx],
            title,
            url,
            description,
            tags,
            image,
            color,
            updatedAt: Date.now()
          };
        showToast('项目已更新');
      }
    } else {
      projects.push({
        id: id || generateId(),
        title,
        url,
        description,
        tags,
        image,
        color,
        createdAt: Date.now()
      });
      showToast('项目已添加');
    }

    saveProjects(projects);
    renderTable();
    updateStats();
    resetForm();
    delete document.getElementById('project-form').dataset.editIndex;
  }

  function handleTableAction(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const index = parseInt(btn.dataset.index, 10);
    let projects = getProjects();

    if (action === 'edit') {
      fillForm(projects[index], index);
      document.querySelector('.admin-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (action === 'delete') {
      if (confirm(`确定要删除「${projects[index].title}」吗？`)) {
        projects.splice(index, 1);
        saveProjects(projects);
        renderTable();
        updateStats();
        showToast('项目已删除');
        resetForm();
      }
    }
  }

  /* ===================== 公告管理 ===================== */
  function getAnnounceConfig() {
    try {
      const raw = storage.get(ANNOUNCEMENT_KEY);
      if (!raw) return { mode: 'static', announcements: [] };
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return { mode: 'static', announcements: parsed };
      const validModes = ['marquee', 'vertical-up', 'vertical-down', 'fade', 'static'];
      return {
        mode: validModes.includes(parsed.mode) ? parsed.mode : 'static',
        announcements: Array.isArray(parsed.announcements) ? parsed.announcements : []
      };
    } catch (e) { return { mode: 'static', announcements: [] }; }
  }
  function saveAnnounceConfig(config) {
    storage.set(ANNOUNCEMENT_KEY, JSON.stringify({
      mode: config.mode || 'static',
      announcements: config.announcements || []
    }));
    pushAnnounceToServer();
  }

  // 把当前公告配置推送到 Netlify 函数，使线上站点实时可见（同源才成功；失败静默忽略，localStorage 仍兜底）
  function pushAnnounceToServer() {
    try {
      const config = getAnnounceConfig();
      fetch('/.netlify/functions/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': DEFAULT_PASSWORD },
        body: JSON.stringify({ mode: config.mode || 'static', announcements: config.announcements || [] })
      }).catch(() => {});
    } catch (e) { /* 忽略 */ }
  }
  function getAnnouncements() { return getAnnounceConfig().announcements; }
  function saveAnnouncements(list) {
    const config = getAnnounceConfig();
    config.announcements = list;
    saveAnnounceConfig(config);
  }

  function genAnnId() {
    return 'ann_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
  }

  function toLocalInput(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function renderAnnounceList() {
    const tbody = document.getElementById('announce-tbody');
    if (!tbody) return;
    const list = getAnnouncements();
    tbody.innerHTML = '';

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="3" class="empty-state"><p>暂无公告，请从左侧表单发布。</p></td></tr>`;
      return;
    }

    list.slice().reverse().forEach((a) => {
      const tr = document.createElement('tr');
      const typeLabel = a.type === 'important' ? '重要' : '普通';
      const linkHtml = a.link ? `<div class="table-url">${escapeHtml(a.link)}</div>` : '';
      tr.innerHTML = `
        <td>
          <div class="table-title">${escapeHtml(a.title)}</div>
          <div class="table-url">${escapeHtml(a.content)}</div>
          ${linkHtml}
        </td>
        <td>${typeLabel}</td>
        <td>
          <div class="table-actions">
            <button class="btn btn-sm btn-secondary" data-ann-action="edit" data-id="${a.id}">编辑</button>
            <button class="btn btn-sm btn-danger" data-ann-action="delete" data-id="${a.id}">删除</button>
          </div>
        </td>`;
      tbody.appendChild(tr);
    });
  }

  function resetAnnForm() {
    document.getElementById('announce-form').reset();
    document.getElementById('ann-id').value = '';
    document.getElementById('ann-form-title').textContent = '发布新公告';
    document.getElementById('ann-cancel').style.display = 'none';
  }

  function fillAnnForm(a) {
    document.getElementById('ann-id').value = a.id;
    document.getElementById('ann-title').value = a.title || '';
    document.getElementById('ann-content').value = a.content || '';
    document.getElementById('ann-link').value = a.link || '';
    document.getElementById('ann-type').value = a.type || 'normal';
    document.getElementById('ann-expire').value = a.expiresAt ? toLocalInput(new Date(a.expiresAt)) : '';
    document.getElementById('ann-form-title').textContent = '编辑公告';
    document.getElementById('ann-cancel').style.display = 'inline-flex';
  }

  function handleAnnounceSubmit(e) {
    e.preventDefault();
    if (!isLoggedIn()) return;

    const id = document.getElementById('ann-id').value;
    const title = document.getElementById('ann-title').value.trim();
    const content = document.getElementById('ann-content').value.trim();
    const link = document.getElementById('ann-link').value.trim();
    const type = document.getElementById('ann-type').value;
    const expireVal = document.getElementById('ann-expire').value;
    const expiresAt = expireVal ? new Date(expireVal).getTime() : null;

    if (!title || !content) {
      showToast('请填写标题与内容', 'error');
      return;
    }

    const list = getAnnouncements();
    if (id) {
      const idx = list.findIndex((a) => a.id === id);
      if (idx >= 0) {
        list[idx] = { ...list[idx], title, content, link, type, expiresAt, updatedAt: Date.now() };
        showToast('公告已更新');
      }
    } else {
      list.push({ id: genAnnId(), title, content, link, type, expiresAt, createdAt: Date.now() });
      showToast('公告已发布');
    }
    saveAnnouncements(list);
    renderAnnounceList();
    resetAnnForm();
  }

  function handleAnnounceAction(e) {
    const btn = e.target.closest('button[data-ann-action]');
    if (!btn) return;

    const action = btn.dataset.annAction;
    const id = btn.dataset.id;
    const list = getAnnouncements();

    if (action === 'edit') {
      const a = list.find((x) => x.id === id);
      if (a) {
        fillAnnForm(a);
        const panel = document.querySelector('.admin-panel');
        if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else if (action === 'delete') {
      const a = list.find((x) => x.id === id);
      if (a && confirm(`确定删除公告「${a.title}」吗？`)) {
        saveAnnouncements(list.filter((x) => x.id !== id));
        renderAnnounceList();
        showToast('公告已删除');
      }
    }
  }

  function exportAnnouncements() {
    const config = getAnnounceConfig();
    const data = { version: 1, mode: config.mode, announcements: config.announcements };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'announcements.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('已导出 announcements.json：放入站点 data/ 目录并重新部署，即可让全网访客看到公告');
  }

  function initAnnounceMode() {
    const sel = document.getElementById('ann-mode');
    const saveBtn = document.getElementById('ann-mode-save');
    if (!sel) return;
    sel.value = getAnnounceConfig().mode;
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const config = getAnnounceConfig();
        config.mode = sel.value;
        saveAnnounceConfig(config);
        showToast('展示设置已保存');
      });
    }
  }

  function initPreloader() {
    const preloader = document.getElementById('preloader');
    if (!preloader) return;

    const hide = () => preloader.classList.add('hidden');

    window.addEventListener('load', () => setTimeout(hide, 700));
    setTimeout(hide, 2500);
  }

  document.addEventListener('DOMContentLoaded', () => {
    // 预加载层最先初始化，确保即使后续脚本出错也不会卡死
    initPreloader();

    try {
      updateView();
    } catch (e) {
      console.error('[AI Platform Admin] updateView error:', e);
    }

    const loginForm = document.getElementById('login-form');
    const projectForm = document.getElementById('project-form');
    const projectsTbody = document.getElementById('projects-tbody');
    const logoutBtn = document.getElementById('logout-btn');
    const cancelEdit = document.getElementById('cancel-edit');
    const resetDefaults = document.getElementById('reset-defaults');

    if (loginForm) {
      loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const errorEl = document.getElementById('login-error');

        if (username === DEFAULT_USERNAME && password === DEFAULT_PASSWORD) {
          setLoggedIn(true);
          errorEl.textContent = '';
          updateView();
          showToast('登录成功');
        } else {
          errorEl.textContent = '账号或密码错误';
        }
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        setLoggedIn(false);
        updateView();
        showToast('已退出登录');
      });
    }

    if (projectForm) {
      projectForm.addEventListener('submit', handleFormSubmit);
    }

    if (cancelEdit) {
      cancelEdit.addEventListener('click', () => {
        resetForm();
        delete projectForm.dataset.editIndex;
      });
    }

    if (projectsTbody) {
      projectsTbody.addEventListener('click', handleTableAction);
    }

    if (resetDefaults) {
      resetDefaults.addEventListener('click', () => {
        if (confirm('确定要恢复默认项目吗？当前自定义内容将被覆盖。')) {
          saveProjects(DEFAULT_PROJECTS);
          renderTable();
          updateStats();
          resetForm();
          showToast('已恢复默认项目');
        }
      });
    }

    // 后台侧边栏视图切换
    const navLinks = document.querySelectorAll('.admin-sidebar-nav a[data-view]');
    navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        switchAdminView(link.dataset.view);
      });
    });

    // 公告管理
    const announceForm = document.getElementById('announce-form');
    const announceTbody = document.getElementById('announce-tbody');
    const annExport = document.getElementById('ann-export');
    const annCancel = document.getElementById('ann-cancel');

    if (announceForm) announceForm.addEventListener('submit', handleAnnounceSubmit);
    if (announceTbody) announceTbody.addEventListener('click', handleAnnounceAction);
    if (annExport) annExport.addEventListener('click', exportAnnouncements);
    if (annCancel) annCancel.addEventListener('click', resetAnnForm);
    initAnnounceMode();
  });
})();
