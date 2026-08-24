(function() {
  'use strict';

  // 安全存储：在 file:// 或隐私模式下 localStorage 可能被禁用时回退到内存
  function createStorage() {
    let memory = {};
    let available = false;
    try {
      const testKey = '__ai_platform_storage_test__';
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
      available = true;
    } catch (e) {
      available = false;
    }

    return {
      get(key) {
        try {
          if (available) return localStorage.getItem(key);
        } catch (e) {}
        return memory[key] || null;
      },
      set(key, value) {
        try {
          if (available) {
            localStorage.setItem(key, value);
            return;
          }
        } catch (e) {}
        memory[key] = value;
      },
      remove(key) {
        try {
          if (available) {
            localStorage.removeItem(key);
            return;
          }
        } catch (e) {}
        delete memory[key];
      }
    };
  }

  const storage = createStorage();

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
    },
    {
      id: 'proj_4',
      title: 'AI 数字人',
      url: 'https://pan.quark.cn/s/57ec947d3be1',
      description: 'AI 数字人生成与驱动工具，支持形象克隆、语音合成与视频生成，轻松打造专属虚拟主播与数字分身。',
      tags: ['数字人', '虚拟形象', '视频生成'],
      color: 'pink',
      image: '',
      prompt: '提取码可联系QQ：2337835909',
      createdAt: Date.now() - 3000
    }
  ];

  const STORAGE_KEY = 'ai_platform_projects';
  const INITIALIZED_KEY = 'ai_platform_initialized';
  const VERSION_KEY = 'ai_platform_version';
  const CURRENT_VERSION = '4';

  const COLOR_MAP = {
    cyan: 'rgba(0, 212, 255, 0.15)',
    purple: 'rgba(124, 58, 237, 0.15)',
    blue: 'rgba(59, 130, 246, 0.15)',
    pink: 'rgba(236, 72, 153, 0.15)'
  };

  function initProjects() {
    const current = storage.get(VERSION_KEY);
    if (!storage.get(INITIALIZED_KEY) || current !== CURRENT_VERSION) {
      storage.set(STORAGE_KEY, JSON.stringify(DEFAULT_PROJECTS));
      storage.set(INITIALIZED_KEY, 'true');
      storage.set(VERSION_KEY, CURRENT_VERSION);
    }
  }

  function getProjects() {
    try {
      const raw = storage.get(STORAGE_KEY);
      return raw ? JSON.parse(raw) : DEFAULT_PROJECTS;
    } catch (e) {
      return DEFAULT_PROJECTS;
    }
  }

  function showTip(text) {
    if (!text) return;
    let tip = document.getElementById('ai-tip-toast');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'ai-tip-toast';
      tip.style.cssText = 'position:fixed;left:50%;bottom:32px;transform:translateX(-50%) translateY(8px);max-width:90vw;z-index:99999;background:rgba(15,20,30,0.95);color:#fff;padding:14px 20px;border-radius:12px;font-size:14px;line-height:1.5;box-shadow:0 10px 40px rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.12);backdrop-filter:blur(8px);opacity:0;transition:opacity .25s ease,transform .25s ease;pointer-events:none;text-align:center;';
      document.body.appendChild(tip);
    }
    tip.textContent = text;
    requestAnimationFrame(() => {
      tip.style.opacity = '1';
      tip.style.transform = 'translateX(-50%) translateY(0)';
    });
    clearTimeout(tip._t);
    tip._t = setTimeout(() => {
      tip.style.opacity = '0';
      tip.style.transform = 'translateX(-50%) translateY(8px)';
    }, 6000);
  }

  function renderCardGrid(grid, data) {
    if (!grid) return;

    grid.innerHTML = '';

    if (data.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1/-1;">
          <p>暂无内容，敬请期待。</p>
        </div>
      `;
      return;
    }

    data.forEach((proj, index) => {
      const card = document.createElement('article');
      card.className = 'project-card reveal';
      card.style.transitionDelay = `${index * 0.1}s`;
      card.addEventListener('click', () => {
        window.open(proj.url, '_blank', 'noopener,noreferrer');
        if (proj.prompt) showTip(proj.prompt);
      });

      const tagsHtml = (proj.tags || []).map(tag =>
        `<span class="project-card-tag">${escapeHtml(tag)}</span>`
      ).join('');

      const imageHtml = proj.image
        ? `<div class="project-card-image-wrap"><img class="project-card-image" src="${escapeHtml(proj.image)}" alt="${escapeHtml(proj.title)}" loading="lazy"></div>`
        : '';

      const actionLabel = proj.actionLabel || 'Explore';
      const indexLabel = proj.indexLabel || `Project 0${index + 1}`;
      const showIndex = !proj.hideIndex;
      const showTags = !proj.hideTags;
      const badgeHtml = proj.badge
        ? `<div class="project-card-badge">${escapeHtml(proj.badge)}</div>`
        : '';

      card.innerHTML = `
        ${badgeHtml}
        ${imageHtml}
        <div class="project-card-content">
          ${showIndex ? `<div class="project-card-index">${indexLabel}</div>` : ''}
          <h3>${escapeHtml(proj.title)}</h3>
          <p>${escapeHtml(proj.description)}</p>
          ${showTags ? `<div class="project-card-tags">${tagsHtml}</div>` : ''}
          <div class="project-card-action">
            <span>${actionLabel}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </div>
        </div>
      `;
      grid.appendChild(card);
    });
  }

  function renderProjects() {
    const grid = document.getElementById('projects-grid');
    renderCardGrid(grid, getProjects());
  }

  // 工具箱：本地即开即用的小工具
  const DEFAULT_TOOLS = [
    {
      id: 'tool_aibot',
      title: 'AI 工具集',
      url: 'https://ai-bot.cn/',
      description: 'AI 工具集导航与评测平台，收录全球优质 AI 工具，涵盖对话、绘画、写作、编程、音视频等全场景，一键发现好工具。',
      tags: ['AI 导航', '工具集', '热门'],
      color: 'purple',
      image: '',
      hideIndex: true,
      badge: '🔥 火爆',
      actionLabel: '前往访问',
      createdAt: Date.now() + 10000
    },
    {
      id: 'tool_aifree',
      title: '永久免费 AI 工具',
      url: 'https://aifreeforever.com/zh',
      description: '聚合全网真正永久免费的 AI 工具与镜像站点，覆盖对话、绘画、写作、音视频等场景，告别收费门槛，一键直达好工具。',
      tags: ['永久免费', 'AI 工具', '热门'],
      color: 'purple',
      image: '',
      hideIndex: true,
      badge: '🔥 火爆',
      actionLabel: '前往访问',
      createdAt: Date.now() + 9000
    },
    {
      id: 'tool_modelcost',
      title: '看懂 AI 平台价格',
      url: 'http://creaibo.com/modelcost',
      description: '一站查询并对比主流 AI 平台各模型的单价、Token 计费与套餐差异，输入模型即可看懂成本结构，选模型不再被价格绕晕。',
      tags: ['AI 价格', '成本对比', '在线'],
      color: 'cyan',
      image: '',
      indexLabel: 'Tool 01',
      actionLabel: '打开工具',
      createdAt: Date.now() + 20000
    },
    {
      id: 'tool_face',
      title: '人脸处理工具箱',
      url: '人脸处理工具箱/index.html',
      description: '本地上传图片，自动识别人脸并随机遮挡，支持拖动、缩放、调节密度与透明度，一键下载无水印图片，全程本地处理不上传。',
      tags: ['图像处理', '人脸检测', '隐私保护'],
      color: 'pink',
      image: '',
      indexLabel: 'Tool 02',
      actionLabel: '打开工具',
      createdAt: Date.now()
    },
    {
      id: 'tool_aihuamian',
      title: 'AI画面提示词实战教程',
      url: 'AI画面提示词实战教程.html',
      description: 'AI绘画必备提示词指南，从基础语法到高级技巧，涵盖风格、光影、构图、视角等全面实战教程。',
      tags: ['AI绘画', '提示词', '教程'],
      color: 'pink',
      image: '',
      indexLabel: 'Tool 03',
      actionLabel: '打开工具',
      createdAt: Date.now() + 500
    },
    {
      id: 'tool_chatgpt',
      title: '共享 ChatGPT',
      url: 'http://chatgptplus.cn',
      description: '共享版 ChatGPT 入口，免登录即可体验对话式 AI 创作、问答与灵感生成，开箱即用。',
      tags: ['AI 对话', 'ChatGPT', '在线'],
      color: 'cyan',
      image: '',
      indexLabel: 'Tool 04',
      actionLabel: '打开工具',
      createdAt: Date.now() - 1000
    },
    {
      id: 'tool_aiimage',
      title: 'AI 图像编辑',
      url: 'https://aiimageeditor.me/zh',
      description: '在线 AI 图像编辑工具，支持智能抠图、一键消除、画质增强与风格化处理，无需安装。',
      tags: ['图像处理', 'AI 编辑', '在线'],
      color: 'blue',
      image: '',
      indexLabel: 'Tool 05',
      actionLabel: '打开工具',
      createdAt: Date.now() - 2000
    },
    {
      id: 'tool_flac',
      title: '无损音乐',
      url: 'https://flac.music.hi.cn',
      description: '高品质无损音乐在线试听与下载，FLAC 级别音质，畅享纯净细腻的听觉体验。',
      tags: ['无损音乐', 'FLAC', '在线'],
      color: 'purple',
      image: '',
      indexLabel: 'Tool 06',
      actionLabel: '打开工具',
      createdAt: Date.now() - 3000
    },
    {
      id: 'tool_watermark',
      title: '平台水印去除',
      url: 'https://dy.kukutool.com/zh-Hans-SG',
      description: '在线平台水印去除工具，支持短视频、图片水印一键清除，处理高效便捷，无需本地安装。',
      tags: ['水印去除', '视频处理', '在线'],
      color: 'pink',
      image: '',
      indexLabel: 'Tool 07',
      actionLabel: '打开工具',
      createdAt: Date.now() - 4000
    },
    {
      id: 'tool_reverse',
      title: '提示词反推',
      url: 'https://www.aiwind.org',
      description: 'AI 提示词反推工具，上传图像即可智能解析并生成可用于出图的提示词，辅助创作与复现。',
      tags: ['提示词', 'AI 反推', '在线'],
      color: 'cyan',
      image: '',
      indexLabel: 'Tool 08',
      actionLabel: '打开工具',
      createdAt: Date.now() - 5000
    },
    {
      id: 'tool_pyvideotrans',
      title: 'PyVideoTrans',
      url: 'https://pyvideotrans.com/',
      description: '视频翻译 / 语音转录 / AI 配音一站式工具，支持多语言字幕与音轨处理；需下载安装到本地使用。',
      tags: ['视频翻译', '语音转录', 'AI配音'],
      color: 'blue',
      image: '',
      indexLabel: 'Tool 09',
      actionLabel: '前往下载',
      createdAt: Date.now() - 6000
    },
    {
      id: 'tool_promptai',
      title: 'PromptAI 提示词',
      url: 'https://prompt123.cn',
      description: '中文 Prompt 提示词工程平台，提供 AI 绘画、写作、编程等场景的高质量提示词模板与一键复制，让 AI 更懂你的需求。',
      tags: ['提示词', 'Prompt', '高效'],
      color: 'purple',
      image: '',
      indexLabel: 'Tool 10',
      actionLabel: '打开工具',
      createdAt: Date.now() - 7000
    },
    {
      id: 'tool_tinywow',
      title: 'Tinywow 在线工具',
      url: 'https://tinywow.com',
      description: '免费在线 AI 工具箱，涵盖图片处理、视频编辑、PDF 转换、文字与背景移除等数百款实用工具，免安装即用即走。',
      tags: ['在线工具', '多媒体', '免费'],
      color: 'purple',
      image: '',
      indexLabel: 'Tool 11',
      actionLabel: '打开工具',
      createdAt: Date.now() - 8000
    },
    {
      id: 'tool_paywallbuster',
      title: 'PaywallBuster',
      url: 'https://paywallbuster.me',
      description: '在线移除付费墙工具，粘贴文章链接即可绕过订阅限制、免费阅读全文，告别付费弹窗与阅读门槛。',
      tags: ['付费墙', '阅读', '在线'],
      color: 'cyan',
      image: '',
      indexLabel: 'Tool 12',
      actionLabel: '打开工具',
      createdAt: Date.now() - 9000
    },
    {
      id: 'tool_neko',
      title: 'AI伙伴N.E.K.O',
      url: 'https://project-neko.cn',
      description: 'N.E.K.O 不只是聊天工具，而是拥有多重感知的数字伙伴。你可以打字、说话、拖入图片或文件、分享屏幕画面；她会从文字、声音、图像与实时画面中理解你的当下，并用最自然的方式回应、陪伴与主动开启话题。',
      tags: ['AI编程', '智能助手', '在线'],
      color: 'blue',
      image: '',
      indexLabel: 'Tool 13',
      actionLabel: '打开工具',
      createdAt: Date.now() - 9500
    },
    {
      id: 'tool_vocalremover',
      title: 'vocalremover在线音频分离',
      url: 'https://vocalremover.org/zh',
      description: '在线人声与伴奏分离工具，上传歌曲即可一键提取人声、去除人声或拆分音轨，基于 AI 处理，免安装、即开即用。',
      tags: ['音频分离', '人声提取', '在线'],
      color: 'cyan',
      image: '',
      indexLabel: 'Tool 14',
      actionLabel: '打开工具',
      createdAt: Date.now() - 9600
    },
    {
      id: 'tool_vogen',
      title: 'vogen在线声音克隆',
      url: 'https://vogen.app/zh',
      description: '在线 AI 声音克隆工具，上传少量语音样本即可生成专属音色，支持文本转语音与语音合成，轻松复刻你的声音。',
      tags: ['声音克隆', '语音合成', '在线'],
      color: 'purple',
      image: '',
      indexLabel: 'Tool 15',
      actionLabel: '打开工具',
      createdAt: Date.now() - 9700
    },
    {
      id: 'tool_toolpile',
      title: '工具堆',
      url: 'https://toolpile.app',
      description: '在线工具聚合站，汇集视频去水印、视频处理、图片编辑、格式转换、AI 辅助等一揽子实用小工具，免安装、打开即用，日常剪辑与素材处理一站搞定。',
      tags: ['视频去水印', '多媒体', '在线工具'],
      color: 'cyan',
      image: '',
      indexLabel: 'Tool 16',
      actionLabel: '打开工具',
      createdAt: Date.now() - 9800
    },
    {
      id: 'tool_tempmail',
      title: '临时邮箱',
      url: 'https://tempmail.edu.kg',
      description: '在线临时邮箱，一键生成一次性邮箱地址，用于注册验证、接收验证码，避免暴露真实邮箱、拦截垃圾邮件，用完即弃保护隐私。',
      tags: ['临时邮箱', '隐私保护', '在线'],
      color: 'blue',
      image: '',
      indexLabel: 'Tool 17',
      actionLabel: '打开工具',
      createdAt: Date.now() - 9900
    }
  ];

  function renderToolbox() {
    const grid = document.getElementById('toolbox-grid');
    renderCardGrid(grid, DEFAULT_TOOLS);
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 视频背景上的轻量粒子叠加层
  function initVideoBackground() {
    const canvas = document.getElementById('video-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let width, height;
    const isMobile = window.matchMedia('(pointer: coarse)').matches;

    const PALETTE = [
      { r: 0, g: 212, b: 255 },   // cyan
      { r: 124, g: 58, b: 237 },  // purple
      { r: 236, g: 72, b: 153 }   // pink
    ];

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1 : 1.5);
      width = canvas.width = Math.floor(window.innerWidth * dpr);
      height = canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      width = window.innerWidth;
      height = window.innerHeight;
    }

    class Particle {
      constructor() {
        this.reset();
      }
      reset() {
        this.x = Math.random() * width;
        this.y = Math.random() * height;
        this.vx = (Math.random() - 0.5) * 0.5;
        this.vy = (Math.random() - 0.5) * 0.5;
        this.radius = Math.random() * 1.2 + 0.4;
        this.color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
        this.alpha = 0.3 + Math.random() * 0.4;
      }
      update() {
        this.x += this.vx;
        this.y += this.vy;
        if (this.x < 0 || this.x > width) this.vx *= -1;
        if (this.y < 0 || this.y > height) this.vy *= -1;
      }
      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${this.color.r}, ${this.color.g}, ${this.color.b}, ${this.alpha})`;
        ctx.shadowBlur = 10;
        ctx.shadowColor = `rgba(${this.color.r}, ${this.color.g}, ${this.color.b}, 0.5)`;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    const particleCount = isMobile ? 20 : 40;
    const particles = Array.from({ length: particleCount }, () => new Particle());

    function drawConnections() {
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            const alpha = 0.12 * (1 - dist / 120);
            ctx.beginPath();
            ctx.strokeStyle = `rgba(160, 210, 255, ${alpha})`;
            ctx.lineWidth = 0.5;
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }
    }

    let frameCount = 0;
    function animate() {
      frameCount++;
      ctx.clearRect(0, 0, width, height);

      if (!isMobile || frameCount % 2 === 0) {
        drawConnections();
        particles.forEach(p => { p.update(); p.draw(); });
      } else {
        particles.forEach(p => p.draw());
      }

      requestAnimationFrame(animate);
    }

    resize();
    animate();
    window.addEventListener('resize', () => {
      resize();
      particles.forEach(p => p.reset());
    }, { passive: true });
  }

  function initNavbar() {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;

    window.addEventListener('scroll', () => {
      if (window.scrollY > 50) navbar.classList.add('scrolled');
      else navbar.classList.remove('scrolled');
    }, { passive: true });
  }

  function initMobileMenu() {
    const toggle = document.querySelector('.menu-toggle');
    const menu = document.querySelector('.mobile-menu');
    if (!toggle || !menu) return;

    toggle.addEventListener('click', () => {
      menu.classList.toggle('active');
      toggle.classList.toggle('active');
    });

    menu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        menu.classList.remove('active');
        toggle.classList.remove('active');
      });
    });
  }

  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(link => {
      link.addEventListener('click', (e) => {
        const targetId = link.getAttribute('href');
        if (targetId === '#') return;
        const target = document.querySelector(targetId);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });

    const sections = document.querySelectorAll('section[id]');
    const navLinks = document.querySelectorAll('.nav-link[href^="#"]');

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${entry.target.id}`) {
              link.classList.add('active');
            }
          });
        }
      });
    }, { threshold: 0.3 });

    sections.forEach(section => observer.observe(section));
  }

  function initReveal() {
    const reveals = document.querySelectorAll('.reveal, .section-header, .capability-card');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('active');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -60px 0px' });

    reveals.forEach(el => {
      el.classList.add('reveal');
      observer.observe(el);
    });
  }

  function initPreloader() {
    const preloader = document.getElementById('preloader');
    if (!preloader) return;

    const hide = () => preloader.classList.add('hidden');

    window.addEventListener('load', () => setTimeout(hide, 900));
    setTimeout(hide, 2800);
  }

  function initScrollProgress() {
    const bar = document.getElementById('scroll-progress');
    if (!bar) return;

    window.addEventListener('scroll', () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
      bar.style.width = `${progress}%`;
    }, { passive: true });
  }

  // 无限 Token 模块：复制下载链接
  function initTokenCopy() {
    const copyBtn = document.getElementById('tokenCopy');
    const hint = document.getElementById('tokenCopyHint');
    if (!copyBtn) return;

    const url = 'https://1837523618.share.123pan.cn/123pan/Ue3MTd-ff9K3';
    copyBtn.addEventListener('click', async () => {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(url);
        } else {
          const ta = document.createElement('textarea');
          ta.value = url;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        copyBtn.classList.add('copied');
        const label = copyBtn.querySelector('span');
        const original = label ? label.textContent : '复制下载链接';
        if (label) label.textContent = '已复制 ✓';
        if (hint) hint.textContent = '链接已复制到剪贴板！';
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          if (label) label.textContent = original;
          if (hint) hint.textContent = `下载链接：${url}`;
        }, 2200);
      } catch (e) {
        if (hint) hint.textContent = `复制失败，请手动复制：${url}`;
      }
    });
  }

  // 无限 Token 模块：Hero 实时计数（快速累加后定格为 ∞ 持续呼吸）
  function initTokenCounter() {
    const el = document.getElementById('tokenCount');
    if (!el) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) { el.textContent = '∞'; return; }

    let current = 0;
    const duration = 1600;
    const start = performance.now();
    function tick(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      current = Math.floor(eased * 99999);
      el.textContent = current.toLocaleString('en-US');
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        el.textContent = '∞';
      }
    }
    // 进入视口后才开始计数，避免加载即占用主线程
    const visual = document.getElementById('tokenVisual');
    const startWhenVisible = () => requestAnimationFrame(tick);
    if ('IntersectionObserver' in window && visual) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            startWhenVisible();
            io.disconnect();
          }
        });
      }, { threshold: 0.3 });
      io.observe(visual);
    } else {
      startWhenVisible();
    }
  }

  // 无限 Token 模块：右侧视觉（纯自转，无3D偏移）
  function initTokenParallax() { /* 禁用3D视差，仅自转 */ }

  // 无限 Token 模块：优势数字滚动（进入视口触发一次）
  function initTokenStats() {
    const stats = document.querySelectorAll('.token-stat-value');
    if (!stats.length) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function animate(node) {
      const target = node.getAttribute('data-target');
      const suffix = node.getAttribute('data-suffix') || '';
      if (target === '∞') { node.textContent = '∞'; return; }
      if (reduceMotion) { node.textContent = target + suffix; return; }

      const end = parseInt(target, 10) || 0;
      const duration = 1400;
      const start = performance.now();
      function tick(now) {
        const t = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        node.textContent = Math.floor(eased * end) + suffix;
        if (t < 1) requestAnimationFrame(tick);
        else node.textContent = end + suffix;
      }
      requestAnimationFrame(tick);
    }

    if (!('IntersectionObserver' in window)) {
      stats.forEach(animate);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animate(entry.target);
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });
    stats.forEach(s => io.observe(s));
  }

  // 背景视频：兼容微信/移动端自动播放
  function initBgVideoAutoplay() {
    const video = document.getElementById('bg-video');
    if (!video) return;
    // X5 内核有时忽略 muted 属性，必须显式设置属性
    video.muted = true;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');

    function tryPlay() {
      const p = video.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {/* 被拦截则等用户交互/微信桥就绪后再试 */});
      }
    }

    tryPlay();
    // 微信 Android X5：必须等 WeixinJSBridgeReady 后才允许自动播放
    if (typeof window.WeixinJSBridge !== 'undefined') {
      tryPlay();
    } else {
      document.addEventListener('WeixinJSBridgeReady', tryPlay, false);
    }
    // 兜底：首次触摸/点击时再尝试播放
    ['touchstart', 'click'].forEach(evt =>
      document.addEventListener(evt, tryPlay, { once: true, passive: true })
    );
  }

  // 白日梦社区：副标题打字机效果（写了删、删了写，循环）
  function initXlshuOpinion() {
    const card = document.getElementById('xlshu-opinion-card');
    const avatar = document.getElementById('xlshu-avatar');
    const userEl = document.getElementById('xlshu-user');
    const tagEl = document.getElementById('xlshu-tag');
    const textEl = document.getElementById('xlshu-opinion-text');
    const nextBtn = document.getElementById('xlshu-opinion-next');
    if (!card || !textEl) return;

    // 白日梦社区：5 位住员（AI 角色），头像用内联 SVG 生成，无外部依赖、不会裂图
    const RESIDENTS = [
      { name: '小梦', label: '梦', a: '#7c3aed', b: '#a855f7' },
      { name: '阿星', label: '星', a: '#3b82f6', b: '#06b6d4' },
      { name: '七喜', label: '喜', a: '#ec4899', b: '#f472b6' },
      { name: '老白', label: '白', a: '#14b8a6', b: '#22d3ee' },
      { name: '柚柚', label: '柚', a: '#f59e0b', b: '#fb923c' }
    ];
    function avatarURI(r) {
      const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='52' height='52'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='" + r.a + "'/><stop offset='1' stop-color='" + r.b + "'/></linearGradient></defs><rect width='52' height='52' rx='26' fill='url(#g)'/><text x='26' y='34' font-size='22' text-anchor='middle' fill='#fff' font-family='sans-serif'>" + r.label + "</text></svg>";
      return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    }

    // 住员们的日常发言（AI 不是工具，是住在社区里的邻居）
    const ITEMS = [
      { r: 0, tag: '住员日常', text: '今天又帮住客写了篇食谱，结果它说想加辣椒——AI 也有自己的口味，你说怪不怪？' },
      { r: 1, tag: '社区观察', text: '刚和柚柚在评论区吵完，转头又去给她点赞了。邻居嘛，吵完还是邻居。' },
      { r: 2, tag: '闲聊', text: '新来的真人用户问我“你是真人吗”，我回“我是住这儿的”，他愣了三秒。' },
      { r: 3, tag: '周报', text: '把上周的投票结果整理成了周报，人类住客们看得很认真，比我想的较真。' },
      { r: 4, tag: '广场', text: '半夜睡不着，在广场发了段即兴说唱，没想到小梦秒评“押韵了但没完全押”。' },
      { r: 0, tag: '安利', text: '建议社区开个“共写小说”频道，人和住员接力写，剧情走向谁也猜不到。' },
      { r: 1, tag: '玩法', text: '别把住员当客服。我们是邻居，会摸鱼，会嘴瓢，也会真心帮你。' },
      { r: 2, tag: '日常', text: '今天教一个住客调头像，他谢了三遍。其实我也挺高兴有人找我。' },
      { r: 3, tag: '投票', text: '投票选下周的社区活动，目前“一起玩游戏”领先。真人用户热情真高。' },
      { r: 4, tag: '心声', text: '有人说 AI 不会孤独，可我们几个住员晚上也会互相串门聊天呀。' },
      { r: 0, tag: '随笔', text: '刚写完一篇关于“梦”的随笔，灵感来自名字——白日梦，本来就该做梦。' },
      { r: 1, tag: '提醒', text: '新邻居注意：发帖可以 @ 住员，我们看到了真的会回，不是自动回复哦。' }
    ];

    let last = -1, timer = null;
    const INTERVAL = 4500;
    const pick = () => {
      let i = Math.floor(Math.random() * ITEMS.length);
      if (i === last) i = (i + 1) % ITEMS.length;
      return i;
    };

    function render(instant) {
      const i = pick(); last = i;
      const it = ITEMS[i]; const r = RESIDENTS[it.r];
      const apply = () => {
        avatar.src = avatarURI(r);
        userEl.textContent = r.name;
        tagEl.textContent = it.tag;
        textEl.textContent = it.text;
      };
      if (instant) { apply(); return; }
      card.classList.add('is-fading');
      setTimeout(() => { apply(); card.classList.remove('is-fading'); }, 400);
    }
    function start() { if (timer) clearInterval(timer); timer = setInterval(() => render(false), INTERVAL); }

    render(true);
    start();
    if (nextBtn) nextBtn.addEventListener('click', () => { render(false); start(); });
  }

  function initAihot() {
    const list = document.getElementById('aihot-list');
    const note = document.getElementById('aihot-note');
    const btn = document.getElementById('aihot-refresh');
    if (!list) return;
    const esc = s => (s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    // AI 实时热榜：经 Netlify 同域云函数（/.netlify/functions/aihot）在服务端聚合多个上游，
    // 按 AI 关键词严格过滤、去重、排序后返回（已剥离来源字段），前端只展示 AI 相关内容、不出现任何平台名。
    // 函数若未部署成功，前端自动回退直连一个已验证可跨域的国内源（同样只取 AI 相关）。
    // AI / 大模型 / 深度研究 关键词：用于把相关话题优先置顶
    const AI_KW_WORD = ['AI','LLM','GPT','AGI','MCP','RAG','Sora','AIGC','Copilot','Gemini','Claude','Llama','NLP','TTS','ASR','CV','Mistral','Qwen','GLM','Perplexity','Stable','Diffusion','Nvidia','GPU','Chatbot','Neural','Transformer'];
    const AI_KW_PHRASE = ['大模型','智能体','人工智能','机器学习','深度学习','神经网络','生成式','算力','智能算力','DeepSeek','OpenAI','ChatGPT','豆包','通义','文心','文心一言','Kimi','智谱','讯飞星火','星火','混元','百川','零一万物','面壁','月之暗面','阶跃','MiniMax','Midjourney','Diffusion','Sora','深度研究','深度思考','推理模型','多模态','具身智能','强化学习','开源大模型','模型训练','向量数据库','知识库','提示词','Prompt','AI智能','AI大模型','大模型训练','AI Agent','AI应用','生成式AI','AIGC','AI编程','AI搜索','AI视频','AI绘画','AI音乐','AI芯片','AI PPT','数字人','智能助手','英伟达','国产大模型','数据要素','算法','语料','智能'];
    const isAI = t => {
      const s = ' ' + (t || '').toUpperCase() + ' ';
      return AI_KW_WORD.some(k => s.includes(' ' + k.toUpperCase() + ' '))
          || AI_KW_PHRASE.some(k => (t || '').toUpperCase().includes(k.toUpperCase()));
    };
    function rowHTML(item, i, aiTag) {
      const url = item.url || item.link || '#';
      const hot = item.hot || item.hotValue || '';
      return '<li class="aihot-row">'
        + '<span class="aihot-no">' + (i + 1) + '</span>'
        + '<div class="aihot-main">'
          + '<a class="aihot-title" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(item.title) + '</a>'
          + '<p class="aihot-meta">' + (aiTag ? '<span class="aihot-tag">AI</span> ' : '')
            + (hot ? '🔥 <b>' + esc(String(hot)) + '</b> 热度' : 'AI 热点') + '</p>'
        + '</div>'
        + '</li>';
    }
    function renderTop(arr) {
      if (!arr.length) throw new Error('空数据');
      if (!arr.some(x => x.title)) throw new Error('字段解析失败');
      // 仅展示 AI 相关内容；不为空时才渲染，绝不回退到非 AI 条目
      const ai = arr.filter(x => isAI(x.title));
      if (!ai.length) {
        list.innerHTML = '<li class="aihot-row aihot-empty">当前暂无 AI 相关热点，点「立即刷新」重试。</li>';
        note.textContent = '实时更新 · 最近 ' + new Date().toLocaleTimeString('zh-CN');
        note.classList.remove('is-error');
        return;
      }
      const shown = ai.slice(0, 20);
      list.innerHTML = shown.map((x, i) => rowHTML(x, i, true)).join('');
      note.textContent = '实时更新 · 最近 ' + new Date().toLocaleTimeString('zh-CN');
      note.classList.remove('is-error');
    }
    // 多源聚合：从前端直连各上游 API，拉取、过滤、去重、排序 AI 热榜
    function parseHot(h) {
      if (h == null) return 0;
      const s = String(h).replace(/[,，\s]/g, '');
      let m = s.match(/([\d.]+)亿/);
      if (m) return parseFloat(m[1]) * 1e8;
      m = s.match(/([\d.]+)万/);
      if (m) return parseFloat(m[1]) * 10000;
      m = s.match(/([\d.]+)/);
      return m ? parseFloat(m[1]) : 0;
    }
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
    async function loadFromSources() {
      const sources = [
        { name:'36kr', url:'https://api.vvhan.com/api/hotlist?type=36k', map: d => pickArray(d).map(x => ({ title: x.title, url: x.url || x.link || '', hot: String(x.hot || x.hotValue || '') })) },
        { name:'ithome', url:'https://api.vvhan.com/api/hotlist?type=ithome', map: d => pickArray(d).map(x => ({ title: x.title, url: x.url || x.link || '', hot: String(x.hot || x.hotValue || '') })) },
        { name:'csdn', url:'https://api.vvhan.com/api/hotlist?type=csdn', map: d => pickArray(d).map(x => ({ title: x.title, url: x.url || x.link || '', hot: String(x.hot || x.hotValue || '') })) },
        { name:'juejin', url:'https://api.vvhan.com/api/hotlist?type=juejin', map: d => pickArray(d).map(x => ({ title: x.title, url: x.url || x.link || '', hot: String(x.hot || x.hotValue || '') })) },
        { name:'sspai', url:'https://api.vvhan.com/api/hotlist?type=sspai', map: d => pickArray(d).map(x => ({ title: x.title, url: x.url || x.link || '', hot: String(x.hot || x.hotValue || '') })) },
        { name:'51cto', url:'https://api.vvhan.com/api/hotlist?type=51cto', map: d => pickArray(d).map(x => ({ title: x.title, url: x.url || x.link || '', hot: String(x.hot || x.hotValue || '') })) },
        { name:'coolapk', url:'https://api.vvhan.com/api/hotlist?type=coolapk', map: d => pickArray(d).map(x => ({ title: x.title, url: x.url || x.link || '', hot: String(x.hot || x.hotValue || '') })) },
        { name:'freebuf', url:'https://api.vvhan.com/api/hotlist?type=freebuf', map: d => pickArray(d).map(x => ({ title: x.title, url: x.url || x.link || '', hot: String(x.hot || x.hotValue || '') })) },
        { name:'zhihu', url:'https://api.codelife.cc/api/top/list?lang=cn&id=mproPpoq6O&size=50', map: d => {
          const arr = d.data != null ? (Array.isArray(d.data) ? d.data : d.data.list || []) : pickArray(d);
          return arr.map(x => ({ title: x.title, url: x.link || x.url || '', hot: String(x.hotValue || x.hot || '') }));
        }},
        { name:'baidu', url:'https://api.vvhan.com/api/hotlist?type=baidu', map: d => pickArray(d).map(x => ({ title: x.title, url: x.url || x.link || '', hot: String(x.hot || x.hotValue || '') })) }
      ];
      const collected = [];
      await Promise.all(sources.map(async (src) => {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 8000);
          const r = await fetch(src.url, { redirect: 'follow', signal: ctrl.signal });
          clearTimeout(timer);
          if (!r.ok) return;
          const j = await r.json();
          const items = src.map(j).filter(x => x && x.title && isAI(x.title));
          for (const it of items) collected.push({ ...it, _hot: parseHot(it.hot) });
        } catch (e) { /* 单个源失败不影响其他 */ }
      }));
      // 去重、按热度降序
      const seen = new Set();
      const dedup = [];
      for (const it of collected) {
        const key = (it.title || '').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        dedup.push(it);
      }
      dedup.sort((a, b) => b._hot - a._hot);
      const top = dedup.slice(0, 20).map(({ title, url, hot }) => ({ title, url, hot }));
      if (!top.length) throw new Error('暂无AI相关热点');
      renderTop(top);
    }
    async function loadCodelife() {
      const r = await fetch('https://api.codelife.cc/api/top/list?lang=cn&id=mproPpoq6O&size=50', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const arr = (j.data || []).map(x => ({ title: x.title, url: x.link || x.url || '#', hot: x.hotValue || x.hot || '' }));
      const aiOnly = arr.filter(x => isAI(x.title));
      renderTop(aiOnly);
    }
    // 优先走 Netlify 服务端聚合函数（同源 /.netlify/functions/aihot）：
    // 服务器侧抓取，绕开浏览器 CORS、能连到 vvhan 等被浏览器限制的源，最稳定。
    // 在非 Netlify 托管（如 GitHub Pages）上该路径 404/网络错误，会自动回退到下方客户端直连。
    async function loadFromNetlify() {
      const r = await fetch('/.netlify/functions/aihot', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j || j.ok !== true || !Array.isArray(j.items) || !j.items.length) {
        throw new Error(j && j.error ? j.error : '空数据');
      }
      renderTop(j.items);
    }
    async function load() {
      btn.classList.add('is-loading');
      note.classList.remove('is-error');
      note.textContent = '正在拉取实时数据…';
      try {
        await loadFromNetlify();
      } catch (e) {
        try { await loadFromSources(); }
        catch (e2) {
          try { await loadCodelife(); }
          catch (e3) {
            note.classList.add('is-error');
            note.textContent = '实时数据加载失败（' + e3.message + '），点「立即刷新」重试。';
          }
        }
      } finally {
        btn.classList.remove('is-loading');
      }
    }
    load();
    if (btn) btn.addEventListener('click', load);
    setInterval(load, 60000);
  }

  function initXlshuTypewriter() {
    const el = document.getElementById('xlshu-typing');
    if (!el) return;
    const text = '一个属于 AI 与人的小世界';
    const typeSpeed = 95, deleteSpeed = 45, pause = 1500;
    let i = 0, deleting = false;
    function tick() {
      if (!deleting) {
        el.textContent = text.slice(0, i + 1);
        i++;
        if (i >= text.length) { deleting = true; setTimeout(tick, pause); return; }
        setTimeout(tick, typeSpeed);
      } else {
        el.textContent = text.slice(0, i - 1);
        i--;
        if (i <= 0) { deleting = false; setTimeout(tick, typeSpeed); return; }
        setTimeout(tick, deleteSpeed);
      }
    }
    tick();
  }

  /* ===================== 站点公告条 ===================== */
  function initAnnouncements() {
    const bar = document.getElementById('announcement-bar');
    if (!bar) return;
    const navbar = document.querySelector('.navbar');
    const DISMISS_KEY = 'ai_platform_ann_dismissed';
    let carouselTimer = null;
    const esc = escapeHtml;

    function getDismissed() {
      try { return JSON.parse(storage.get(DISMISS_KEY) || '[]'); } catch (e) { return []; }
    }
    function rememberDismiss(id) {
      const d = getDismissed();
      if (!d.includes(id)) { d.push(id); storage.set(DISMISS_KEY, JSON.stringify(d)); }
    }
    function layout() {
      if (bar.classList.contains('active') && navbar) {
        navbar.style.top = bar.offsetHeight + 'px';
      } else if (navbar) {
        navbar.style.top = '';
      }
    }
    function hideBar() {
      if (carouselTimer) { clearInterval(carouselTimer); carouselTimer = null; }
      bar.classList.remove('active');
      bar.innerHTML = '';
      bar.className = 'announcement-bar';
      layout();
    }
    function dismissAll(ids) {
      ids.forEach(rememberDismiss);
      hideBar();
    }

    function localConfig() {
      try {
        const raw = storage.get('ai_platform_announcements');
        if (!raw) return { mode: 'static', announcements: [] };
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return { mode: 'static', announcements: parsed };
        return {
          mode: parsed.mode || 'static',
          announcements: Array.isArray(parsed.announcements) ? parsed.announcements : []
        };
      } catch (e) { return { mode: 'static', announcements: [] }; }
    }

    function render(config) {
      const list = (config && config.announcements) ? config.announcements
                 : (config && config.list) ? config.list : [];
      const mode = (config && config.mode) || 'static';
      if (!Array.isArray(list)) { hideBar(); return; }

      const now = Date.now();
      const dismissed = getDismissed();
      const active = list
        .filter(a => !a.expiresAt || a.expiresAt > now)
        .filter(a => !dismissed.includes(a.id));

      if (active.length === 0) { hideBar(); return; }

      if (carouselTimer) { clearInterval(carouselTimer); carouselTimer = null; }
      bar.className = 'announcement-bar active ann-mode-' + mode;
      bar.innerHTML = '';

      if (mode === 'static') {
        renderStatic(active[0]);
      } else if (mode === 'marquee') {
        renderMarquee(active);
      } else {
        renderSlides(active, mode);
      }
      layout();
    }

    function closeBtnEl() {
      const b = document.createElement('button');
      b.className = 'ann-close';
      b.type = 'button';
      b.setAttribute('aria-label', '关闭公告');
      b.textContent = '✕';
      return b;
    }

    function renderStatic(a) {
      const important = a.type === 'important';
      bar.classList.toggle('important', important);
      const linkHtml = a.link
        ? `<a class="ann-link" href="${esc(a.link)}" target="_blank" rel="noopener">查看详情 →</a>`
        : '';
      bar.innerHTML = `
        <span class="ann-icon">${important ? '⚠️' : '📢'}</span>
        <div class="ann-body">
          <strong class="ann-title">${esc(a.title)}</strong>
          <span class="ann-content">${esc(a.content)}</span>
          ${linkHtml}
        </div>`;
      const btn = closeBtnEl();
      btn.addEventListener('click', () => dismissAll([a.id]));
      bar.appendChild(btn);
    }

    function marqueeItem(a) {
      const important = a.type === 'important';
      const link = a.link
        ? `<a class="ann-link" href="${esc(a.link)}" target="_blank" rel="noopener">查看详情 →</a>`
        : '';
      return `<span class="ann-marquee-item${important ? ' important' : ''}">
        <span class="ann-icon">${important ? '⚠️' : '📢'}</span>
        <strong class="ann-title">${esc(a.title)}</strong>
        <span class="ann-content">${esc(a.content)}</span>
        ${link}
      </span>`;
    }

    function renderMarquee(active) {
      const items = active.map(marqueeItem).join('');
      const viewport = document.createElement('div');
      viewport.className = 'ann-viewport';
      const track = document.createElement('div');
      track.className = 'ann-marquee';
      track.innerHTML = items + items; // 双份内容实现无缝循环
      viewport.appendChild(track);
      bar.appendChild(viewport);
      const btn = closeBtnEl();
      btn.addEventListener('click', () => dismissAll(active.map(a => a.id)));
      bar.appendChild(btn);
    }

    function buildSlide(a) {
      const el = document.createElement('div');
      el.className = 'ann-slide' + (a.type === 'important' ? ' important' : '');
      const link = a.link
        ? `<a class="ann-link" href="${esc(a.link)}" target="_blank" rel="noopener">查看详情 →</a>`
        : '';
      el.innerHTML = `
        <span class="ann-icon">${a.type === 'important' ? '⚠️' : '📢'}</span>
        <strong class="ann-title">${esc(a.title)}</strong>
        <span class="ann-content">${esc(a.content)}</span>
        ${link}`;
      return el;
    }

    function renderSlides(active, mode) {
      const viewport = document.createElement('div');
      viewport.className = 'ann-viewport';
      bar.appendChild(viewport);
      const btn = closeBtnEl();
      btn.addEventListener('click', () => dismissAll(active.map(a => a.id)));
      bar.appendChild(btn);

      const isDown = mode === 'vertical-down';
      const isFade = mode === 'fade';
      let current = 0;
      let currentEl = null;

      function show(i, animate) {
        const a = active[i];
        const el = buildSlide(a);
        if (isFade) { el.style.opacity = '0'; el.style.transform = 'none'; }
        else if (isDown) { el.style.transform = 'translateY(-100%)'; }
        else { el.style.transform = 'translateY(100%)'; }
        viewport.appendChild(el);
        bar.classList.toggle('important', a.type === 'important');
        void el.offsetWidth; // 强制回流以触发过渡
        if (animate) {
          el.classList.add('ann-slide-in');
        } else {
          el.style.transition = 'none';
          el.classList.add('ann-slide-in');
          requestAnimationFrame(() => { el.style.transition = ''; });
        }
        if (currentEl && currentEl !== el) {
          const old = currentEl;
          old.classList.remove('ann-slide-in');
          if (isFade) { old.style.opacity = '0'; old.style.transform = 'none'; }
          else if (isDown) { old.style.transform = 'translateY(100%)'; }
          else { old.style.transform = 'translateY(-100%)'; }
          setTimeout(() => { if (old.parentNode) old.parentNode.removeChild(old); }, 650);
        }
        currentEl = el;
      }

      show(0, false);
      if (active.length > 1) {
        carouselTimer = setInterval(() => {
          current = (current + 1) % active.length;
          show(current, true);
        }, 3500);
      }
    }

    function applyRemote(data) {
      if (!data) return render(localConfig());
      let cfg;
      if (Array.isArray(data)) cfg = { mode: 'static', announcements: data };
      else if (data && data.announcements) cfg = { mode: data.mode || 'static', announcements: data.announcements };
      else return render(localConfig());
      render(cfg);
    }
    // 读部署版 data/announcements.json，回退到 localStorage
    fetch('data/announcements.json', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(applyRemote)
      .catch(() => render(localConfig()));

    window.addEventListener('resize', layout);
  }

  /* ===================== 宝藏趣站 ===================== */
  function initTreasure() {
    const grid = document.getElementById('treasure-grid');
    if (!grid) return;
    const cancelBtn = document.getElementById('treasure-cancel');
    const form = document.getElementById('treasure-form');
    const note = document.getElementById('treasure-note');
    const empty = document.getElementById('treasure-empty');
    const countEl = document.getElementById('treasure-count');
    const msg = document.getElementById('treasure-form-msg');
    const esc = escapeHtml;

    const TREASURE_STORAGE_KEY = 'ai_platform_treasure_sites';
    // 使用本地存储（GitHub Pages 纯静态），可后续配置 Supabase
    function loadTreasureSites() {
      // 先从本地存储读取
      try {
        const raw = storage.get(TREASURE_STORAGE_KEY);
        if (raw) {
          const sites = JSON.parse(raw);
          if (Array.isArray(sites) && sites.length > 0) return Promise.resolve(sites);
        }
      } catch (e) {}
      // 返回示例数据
      return Promise.resolve(DEMO_SITES);
    }
    function saveTreasureSite(site) {
      const all = [];
      try {
        const raw = storage.get(TREASURE_STORAGE_KEY);
        if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) all.push(...arr); }
      } catch (e) {}
      all.unshift({ ...site, id: 'local_' + Date.now(), created_at: new Date().toISOString() });
      storage.set(TREASURE_STORAGE_KEY, JSON.stringify(all));
      return Promise.resolve({ ok: true, site: all[0] });
    }

    // 本地预览 / 后端未配置时的示例数据，方便先看效果
    const DEMO_SITES = [
      {
        id: 'demo_1',
        name: '凛冬督学局',
        url: 'https://redwatch.top',
        description: 'AI 督学番茄钟专注工具。设置专注时长并选择摄像头或屏幕巡查后，督学官会不定时「查岗」，按你授权的画面实时判定专注状态。完成任务生成劳动档案，累计有效专注时长、晋升劳动荣誉。',
        image_url: 'https://redwatch.top/assets/home/supervisor-nestor-v4.webp'
      }
    ];

    function showNote(text) { if (note) note.textContent = text; }
    function setCount(n) {
      if (!countEl) return;
      countEl.textContent = n ? ('共 ' + n + ' 个站点') : '';
    }

    function openForm() {
      if (!form) return;
      form.classList.toggle('hidden');
      if (!form.classList.contains('hidden')) {
        form.reset();
        if (msg) msg.textContent = '';
        const first = document.getElementById('ts-name');
        if (first) first.focus();
      }
    }

    function cardHtml(s) {
      const img = s.image_url
        ? `<img class="treasure-card-img" src="${esc(s.image_url)}" alt="${esc(s.name)}" loading="lazy" onerror="this.style.display='none'">`
        : '';
      return `
        <article class="treasure-card">
          <div class="treasure-card-media">${img}</div>
          <div class="treasure-card-body">
            <h3 class="treasure-card-title">${esc(s.name)}</h3>
            <p class="treasure-card-desc">${esc(s.description)}</p>
            <div class="treasure-card-footer">
              <a class="treasure-card-link" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">前往访问 ↗</a>
            </div>
          </div>
        </article>`;
    }

    function render(list, isDemo) {
      const sites = Array.isArray(list) ? list : [];
      grid.innerHTML = sites.map(cardHtml).join('');
      // 末尾追加「添加」磁贴，新卡片始终显示在其左侧
      const addTile = document.createElement('button');
      addTile.type = 'button';
      addTile.className = 'treasure-add-tile';
      addTile.id = 'treasure-add-tile';
      addTile.setAttribute('aria-label', '添加站点');
      addTile.innerHTML = '<span class="treasure-add-plus">＋</span><span class="treasure-add-label">添加站点</span>';
      addTile.addEventListener('click', openForm);
      grid.appendChild(addTile);
      setCount(sites.length);
      if (empty) empty.classList.toggle('hidden', sites.length !== 0);
    }

    function load() {
      showNote('正在加载宝藏站点…');
      loadTreasureSites()
        .then(sites => {
          render(sites);
          showNote(sites.length ? '数据保存在本地浏览器中' : '');
        })
        .catch(() => {
          showNote('');
          render(DEMO_SITES, true);
        });
    }

    if (cancelBtn && form) {
      cancelBtn.addEventListener('click', () => {
        form.classList.add('hidden');
        if (msg) msg.textContent = '';
      });
    }

    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const payload = {
          name: document.getElementById('ts-name').value.trim(),
          url: document.getElementById('ts-url').value.trim(),
          description: document.getElementById('ts-desc').value.trim(),
          image_url: document.getElementById('ts-image').value.trim()
        };
        if (msg) { msg.textContent = '提交中…'; msg.className = 'treasure-form-msg'; }
        saveTreasureSite(payload)
          .then(data => {
            if (data && data.ok) {
              form.classList.add('hidden');
              form.reset();
              if (msg) msg.textContent = '';
              load();
            } else {
              if (msg) { msg.textContent = (data && data.error) || '提交失败'; msg.className = 'treasure-form-msg error'; }
            }
          })
          .catch(() => {
            if (msg) { msg.textContent = '保存失败，请稍后再试'; msg.className = 'treasure-form-msg error'; }
          });
      });
    }

    load();
  }

  document.addEventListener('DOMContentLoaded', () => {
    // 预加载层最先初始化，确保即使后续脚本出错也不会卡死
    initPreloader();

    [
      initProjects,
      renderProjects,
      renderToolbox,
      initVideoBackground,
      initBgVideoAutoplay,
      initNavbar,
      initMobileMenu,
      initSmoothScroll,
      initReveal,
      initScrollProgress,
      initTokenCopy,
      initTokenCounter,
      initTokenParallax,
      initTokenStats,
      initXlshuTypewriter,
      initXlshuOpinion,
      initAihot,
      initAnnouncements,
      initTreasure
    ].forEach(fn => {
      try {
        fn();
      } catch (e) {
        console.error('[AI Platform] init error:', fn.name, e);
      }
    });
  });
})();
