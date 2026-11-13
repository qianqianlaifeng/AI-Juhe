// 数据来源：https://share.s17t9.my/p/261aa1ae
// 由 scripts/sync.mjs 自动生成，请勿手工修改。
// 本站补充渠道维护在 data/extra-sites.json。

const sites = [
  {
    "name": "Leonardo",
    "url": "https://app.leonardo.ai/generate",
    "daily": 18,
    "quota": "150积分",
    "validity": "当日有效\n08:00 刷新积分",
    "cost": "1K低：8积分\n",
    "pros": "Image2.5质量明显更好了",
    "cons": "总感觉他的2.0生图质量低\n网站无中文\n最近不时出现UI上的错误",
    "watermark": "无",
    "chars": "无限制",
    "network": "需工具",
    "cost25": "1K低：8积分\n2K中：80积分\nFlare/Sunburst相同"
  },
  {
    "name": "Genspark",
    "url": "https://www.genspark.ai/ai_image",
    "daily": 16,
    "quota": "100积分",
    "validity": "当日有效\n08:00 刷新积分",
    "cost": "1K低：约6积分\n2K中：约40积分",
    "pros": "之前严重高估积分消耗\n生图有自己的理解和风格",
    "cons": "按Token计费，聊天也扣积分\n2K的分辨率只有1536*1536\n3K的分辨率只有1920*1920",
    "watermark": "小",
    "chars": "无限制",
    "network": "需工具",
    "cost25": "1K低：约6积分\n2K中：约10积分\nFlare/Sunburst接近"
  },
  {
    "name": "摄图网",
    "url": "https://ai.699pic.com/front/ai/assistant",
    "daily": 5,
    "quota": "30积分/日",
    "validity": "当日有效\n00:00 刷新积分",
    "cost": "1K低：6积分\n2K中：12积分",
    "pros": "邀请注册链接 可+30积分\n4K高也只要6积分（8.18起失效）\n全能模型就是GPT-Image2",
    "prosLinks": [
      {
        "line": "邀请注册链接 可+30积分",
        "label": "邀请注册链接",
        "url": "https://ai.699pic.com/front/invite?code=Y9JUGH"
      }
    ],
    "prosRedText": "4K高也只要6积分（8.18起失效）",
    "prosRedStrike": "4K高也只要6积分",
    "cons": "分辨率/画质/风格都不稳定\n无法推断模型来源正规性\n8.18起每日60积分下降为30\n4K高疑似低质超分放大而来\n生图质量选项好像没有作用\n1K分辨率有时1024有时1254",
    "consRedNotes": [
      "分辨率/画质/风格都不稳定",
      "无法推断模型来源正规性",
      "8.18起每日60积分下降为30"
    ],
    "watermark": "无",
    "chars": "2,000",
    "network": "可直连",
    "cost25": "1K低：6积分\n2K中：12积分\n全能模型Flash/Pro\n像素/画质不稳定",
    "image25Status": "confirmed"
  },
  {
    "name": "Heytop",
    "url": "https://www.heytop.ai/zh/app/imagen/",
    "daily": 10.8,
    "quota": "10次免费生图\n5积分",
    "validity": "生图次数当日有效\n积分长期有效\n08:00 刷新积分",
    "cost": "1K低：6积分",
    "pros": "我觉得免费版就是Image2.5\n免费版无额外限制（有水印）\nImage2的1K分辨率是1254",
    "cons": "Image2.5的1K分辨率是1024\nImage2.5啥参数也没有\nImage2.5积分消耗增加\n从8月17日起图片有水印\n积分版也没有完整调节选项",
    "watermark": "有",
    "chars": "2,000",
    "network": "可直连",
    "consRedNote": "从8月17日起图片有水印",
    "cost25": "1K低：10积分\n不分Flare/Sunburst\n"
  },
  {
    "name": "绿叶AI",
    "url": "https://lyaiapp.com/",
    "daily": 6.4,
    "quota": "5次免费生图\n1~50积分",
    "validity": "生图次数当日有效\n积分3天有效\n00:00 刷新积分",
    "cost": "基本被弃用",
    "pros": "邀请注册链接 可+10积分\n免费版无额外限制",
    "cons": "生图时间大幅增加\n我感觉会不时降质\n没有质量选项\n标明稳定的分组也一定不稳定\n8.9起积分有效期从长期降为3天",
    "watermark": "无",
    "chars": "10,000",
    "network": "可直连",
    "prosLinks": [
      {
        "line": "邀请注册链接 可+10积分",
        "label": "邀请注册链接",
        "url": "https://lyaiapp.com/signup?ref=43WP4QZC"
      }
    ],
    "consRedNote": "8.9起积分有效期从长期降为3天",
    "cost25": "Flare：2.5积分起\nSunburst：3积分起\n生图质量有些不稳定\n让人怀疑是否真的2.5",
    "consRedNotes": [
      "生图时间大幅增加",
      "我感觉会不时降质",
      "8.9起积分有效期从长期降为3天"
    ]
  },
  {
    "name": "ChatGPT",
    "url": "https://chatgpt.com/",
    "daily": 5,
    "quota": "5次生图",
    "validity": "当日有效\n动态刷新",
    "cost": "已升级为2.5",
    "pros": "有上下文记忆\n生图质量较高",
    "cons": "触发上限会直接关闭对话",
    "watermark": "无",
    "chars": "无限制",
    "network": "需工具",
    "cost25": "动态分配"
  },
  {
    "name": "Lovart",
    "url": "https://www.lovart.ai/",
    "daily": 26,
    "quota": "70积分",
    "validity": "当日有效\n08:00 刷新积分",
    "cost": "1K低：1积分\n2K中：12积分",
    "pros": "Image2.5没有次数限制\n新手福利期生图额度充足\n界面设计美观，交互流畅",
    "cons": "Image2.5 1K生图消耗增加\n新手期后，热门模型每日限5次\n提示词审核变严了",
    "watermark": "无",
    "chars": "无限制",
    "network": "需工具",
    "cost25": "1K低：3积分\n2K中：12积分\nFlare/Sunburst相同\n",
    "dailyTrend": "up",
    "prosGreenText": "Image2.5没有次数限制"
  },
  {
    "name": "Firefly",
    "url": "https://firefly.adobe.com/generate/image",
    "daily": 3,
    "quota": "3次免费生图/日",
    "validity": "当日有效\n08:00 刷新次数",
    "cost": "—",
    "pros": "Image2免费生图质量中等\nImage2取消了字符上限",
    "cons": "Image2.5又恢复了1000字限制\n不能选像素尺寸\n分辨率有时1024有时1254\n8.15起生图数从5次降为3次/日",
    "watermark": "无",
    "chars": "1,000",
    "network": "需工具",
    "consRedNote": "8.15起生图数从5次降为3次/日",
    "cost25": "Flare可以免费使用\nSunburst需订阅"
  },
  {
    "name": "SeaArt",
    "url": "https://www.seaart.me/create/image?model_ver_no=dceac00f-a299-4293-8202-d633fc0b8aa5",
    "daily": 3,
    "quota": "130积分/天",
    "validity": "当天有效\n08:00 刷新积分",
    "cost": "1K低：39积分\n2K中：98积分",
    "pros": "有一套花里胡哨的任务系统\n任务签到偶尔可以生图数+1",
    "cons": "提高了Image2.5 1K的积分\n2K分辨率只有1440x1440",
    "watermark": "无",
    "chars": "5,000",
    "network": "需工具",
    "cost25": "Flare：\n1K低：48积分\n2K中：88积分\nSunburst：\n1K低：52积分\n2K中：97积分"
  },
  {
    "name": "Skywork",
    "url": "https://skywork.ai/",
    "daily": 2,
    "quota": "120积分",
    "validity": "当日有效\n00:00 刷新积分",
    "cost": "1K低：约50积分",
    "pros": "积分不多也可继续生图（失效）",
    "cons": "没有直观的生图界面\n按Token计费，聊天也扣积分",
    "watermark": "无",
    "chars": "无限制",
    "network": "需工具",
    "cost25": "未更新Image2.5",
    "prosStrikeText": "积分不多也可继续生图"
  },
  {
    "name": "MXAI",
    "url": "https://www.mxai.cn/home/#/ai/gpt-image",
    "daily": 2.5,
    "quota": "10积分",
    "validity": "3天有效\n00:00 刷新积分",
    "cost": "1K：4积分\n2K：8积分",
    "pros": "邀请注册链接 可领1天会员\nImage2.5有完整选项\n会员就是生图消耗50%off",
    "cons": "Image2没有质量选项",
    "watermark": "无",
    "chars": "16,000",
    "network": "可直连",
    "prosLinks": [
      {
        "line": "邀请注册链接 可领1天会员",
        "label": "邀请注册链接",
        "url": "https://100177911.share.mxai.cn/home/?from=invite&invite_id=100177911"
      }
    ],
    "cost25": "1K低：4积分\n2K中：8积分\nFlare/Sunburst相同"
  },
  {
    "name": "DeepSider",
    "url": "https://chromewebstore.google.com/detail/ai-sidebar-deepseek-gemin/dfbnddndcmilnhdfmmaolepiaefacnpo",
    "daily": 3,
    "quota": "200积分/天",
    "validity": "当日有效\n08:00 刷新积分",
    "cost": "1K：100积分",
    "pros": "Image2.5积分消耗降低",
    "cons": "Image2.5画质差\n没有质量选项\n免费用户不能使用网页端\n免费用户只能使用侧边栏",
    "watermark": "无",
    "chars": "无限制",
    "network": "可直连",
    "cost25": "1K：60积分\n画质表现差",
    "dailyTrend": "up",
    "consRedNotes": [
      "Image2.5画质差"
    ]
  },
  {
    "name": "Heydream",
    "url": "https://heydream.im/zh/text-to-image/",
    "daily": 2,
    "quota": "20积分",
    "validity": "长期有效\n00:00 刷新积分",
    "cost": "1K低：10积分\n2K中：120积分",
    "pros": "签到地址\n水印限制可规避（右键另存）",
    "cons": "积分签到位置比较隐蔽\n免费版失败概率高",
    "watermark": "可绕过",
    "chars": "2,000",
    "network": "可直连",
    "prosLinks": [
      {
        "line": "签到地址",
        "label": "签到地址",
        "url": "https://heydream.im/zh/pricing/"
      }
    ],
    "cost25": "1K低：10积分\n2K中：40积分\nFlare/Sunburst相同"
  },
  {
    "name": "ListenHub",
    "url": "https://listenhub.ai/zh/app/ai-image",
    "daily": 2,
    "quota": "5积分/日\n90积分/月",
    "validity": "日积分7天有效\n月积分30天有效",
    "cost": "1K低：4积分\n2K中：15积分",
    "pros": "每月比Labnana额外多90积分\n所以收藏ListenHub就行了",
    "cons": "Image2.5无质量选项\n只能右键另存压缩格式\n和Labnana共享签到积分",
    "watermark": "无",
    "chars": "无限制",
    "network": "需工具",
    "dailyPrefix": "折合",
    "cost25": "1K：4积分\n2K：6积分\nFlare/Sunburst相同"
  },
  {
    "name": "NoteGPT",
    "url": "https://notegpt.io/cn/ai-image-generator",
    "daily": 0,
    "quota": "2次免费生图/日",
    "quotaUnderlineTexts": [
      "2次免费生图/日"
    ],
    "validity": "生图次数当日有效\n00:00 刷新次数",
    "cost": "—",
    "pros": "—",
    "cons": "9.19起无法免费生图\n没有质量调节选项",
    "consRedNotes": [
      "9.19起无法免费生图"
    ],
    "watermark": "无",
    "chars": "2,000",
    "network": "可直连",
    "cost25": "已更新Image2.5",
    "isOut": true
  },
  {
    "name": "GPTimage",
    "url": "https://gptimage.com/generate",
    "daily": 2,
    "quota": "2次免费生图",
    "validity": "生图次数当日有效\n08:00 刷新次数",
    "cost": "—",
    "pros": "—",
    "cons": "生图质量极不稳定\n无质量/尺寸调节选项\n只有前2张正常，后续会胡乱生成\n网站无中文",
    "watermark": "无",
    "chars": "2,000",
    "network": "可直连",
    "cost25": "未更新Image2.5",
    "consRedNotes": [
      "生图质量极不稳定"
    ]
  },
  {
    "name": "Mindvideo",
    "url": "https://www.mindvideo.ai/zh/text-to-image/",
    "daily": 6,
    "quota": "2积分/日\n4次免费生图/日",
    "validity": "生图次数当日有效\n积分90天有效\n08:00 刷新积分",
    "cost": "1K低：1积分",
    "pros": "Image2.5也有免费版\n有个免费版\n水印可绕过",
    "cons": "Image2.5积分需求增加\nImage2.5不能调像素\n绕过水印有一定难度",
    "watermark": "可绕过",
    "chars": "2,000",
    "network": "可直连",
    "cost25": "1K低：2积分\nFlare/Sunburst相同"
  },
  {
    "name": "EaseMate",
    "url": "https://www.easemate.ai/tw/text-to-image-generator",
    "daily": 1.85,
    "dailyPrefix": "平均",
    "quota": "平均18.5积分/天",
    "validity": "签到积分7天有效\n00:00 刷新积分",
    "cost": "1K：10积分\n2K：15积分",
    "pros": "邀请注册链接 可+10积分",
    "prosLinks": [
      {
        "line": "邀请注册链接 可+10积分",
        "label": "邀请注册链接",
        "url": "https://www.easemate.ai/tw/invitation-landing?invite_code=944287684661248"
      }
    ],
    "cons": "Image2.5积分消耗增加\n没有质量选项\n一天5张生图上限",
    "watermark": "无",
    "chars": "无限制",
    "network": "需工具",
    "cost25": "1K：15积分\n2K：20积分\nFlare/Sunburst相同"
  },
  {
    "name": "Picai",
    "url": "https://picai.com/app/ai-image-generator",
    "daily": 1,
    "quota": "5积分",
    "validity": "当日有效\n08:00 刷新积分",
    "cost": "1K：3积分",
    "pros": "—",
    "cons": "无法调节分辨率和图片质量\n网站无中文",
    "watermark": "无",
    "chars": "无限制",
    "network": "可直连",
    "cost25": "未更新Image2.5"
  },
  {
    "name": "Lovino",
    "url": "https://lovino.ai/dashboard/studio",
    "daily": 1,
    "quota": "3积分",
    "validity": "当日有效\n08:00 刷新积分",
    "cost": "1K低：3积分",
    "pros": "—",
    "cons": "生图质量不稳定\n水印还比较大\n没有像素选项\n比例选项极少\n生图容易失败\n网站无中文",
    "watermark": "有",
    "chars": "1,500",
    "network": "可直连",
    "cost25": "未更新Image2.5",
    "consRedNotes": [
      "生图质量不稳定",
      "水印还比较大"
    ]
  },
  {
    "name": "Media.io",
    "url": "https://www.media.io/ai/zh/text-to-image",
    "daily": 1,
    "quota": "3积分",
    "validity": "当天有效\n08:00 刷新积分",
    "cost": "1K低：3积分\n2K高：10积分",
    "pros": "水印限制可规避（右键另存）",
    "cons": "质量选择没有中\nImage2.5不分Flare/Sunburst",
    "watermark": "可绕过",
    "chars": "2,000",
    "network": "需工具",
    "consRedNote": "积分要签到，还只有一天有效",
    "cost25": "1K低非1比1：1积分\n1K低1比1：2积分\n2K低：3积分\n1K非1比1：3积分\n1K 1比1：4积分\n不分Flare/Sunburst",
    "cost25StrikeTexts": [
      "1K低非1比1：1积分",
      "1K低1比1：2积分",
      "2K低：3积分"
    ],
    "dailyTrend": "down"
  },
  {
    "name": "GPTimage2",
    "url": "https://gptimage2.org/zh",
    "daily": 1.04,
    "quota": "5-23积分/日\n40积分/月",
    "validity": "长期有效\n00:00 刷新积分",
    "cost": "1K低：10积分\n2K中：20积分",
    "pros": "—",
    "cons": "增加了Image2.5积分消耗\n又一个叫GPT Image2的网站\n生图有概率失败、无质量选项\n免费用户生图前需强制验证",
    "watermark": "无",
    "chars": "无限制",
    "network": "可直连",
    "dailyPrefix": "平均",
    "cost25": "1K：20积分\n2K：30积分\nFlare/Sunburst相同"
  },
  {
    "name": "JoyPix",
    "url": "https://www.joypix.ai/app/text-to-image/",
    "daily": 0.67,
    "quota": "2积分/天",
    "validity": "长期有效\n08:00 刷新积分",
    "cost": "1K：3积分\n2K：5积分",
    "pros": "—",
    "cons": "没有质量选项",
    "watermark": "无",
    "chars": "8,000",
    "network": "可直连",
    "cost25": "未更新Image2.5"
  },
  {
    "name": "EzRemove",
    "url": "https://ezremove.ai/zh/image-to-image/",
    "daily": 5,
    "quota": "10积分/日",
    "validity": "当日有效\n08:00 刷新积分",
    "cost": "1K低：2积分",
    "pros": "签到可以获取额外积分\n签到七天可获得长期有效积分",
    "prosBoldText": "长期有效",
    "cons": "签到不是循环任务，只有7次\n签到需等45分钟才能获取积分\n免费用户只能选质量低\n无法调节分辨率（1024级别）\n限制敏感词较多。",
    "watermark": "无",
    "chars": "1,000",
    "network": "可直连",
    "cost25": "未更新Image2.5"
  },
  {
    "name": "Liblib.art",
    "url": "https://www.liblib.art/ai-tool/image-generator",
    "daily": 10,
    "quota": "20积分/日",
    "validity": "当日有效\n00:00 刷新积分",
    "cost": "1K低：2积分\n2K中：18积分",
    "pros": "智能图片V2就是GPT Image2\n点击去liblib.tv可绕开水印",
    "cons": "—",
    "watermark": "可绕过",
    "chars": "2,000",
    "network": "可直连",
    "cost25": "未更新Image2.5"
  },
  {
    "name": "Creen",
    "url": "https://www.creen.ai/zh-Hant",
    "daily": 10,
    "quota": "100积分/日",
    "validity": "当日有效\n15:00 刷新积分",
    "cost": "1K低：10积分\n2K中：160积分",
    "pros": "—",
    "cons": "—",
    "watermark": "无",
    "chars": "5,000",
    "network": "需工具",
    "cost25": "1K低：10积分\n2K中：40积分\nFlare/Sunburst相同"
  },
  {
    "name": "PhotoEditor",
    "url": "https://photoeditorai.io/zh/ai-image-generator/",
    "daily": 5,
    "quota": "10积分/日",
    "validity": "当日有效\n08:00 刷新积分",
    "cost": "1K低：2积分",
    "pros": "—",
    "cons": "免费用户只能选质量低\n无法调节分辨率（1024级别）",
    "watermark": "无",
    "chars": "1,000",
    "network": "可直连",
    "cost25": "未更新Image2.5"
  },
  {
    "name": "Synthesia",
    "url": "https://app.synthesia.io/",
    "daily": 3.93,
    "dailyPrefix": "折合",
    "quota": "1300积分/月",
    "validity": "当月有效\n下月重置",
    "cost": "1K：11积分\n1K：9积分",
    "pros": "一次性把一个月的积分给用户\n可以多任务并行",
    "cons": "9.12起积分消耗+2\n免费用户只能选质量低\n无法调节分辨率和质量\n翻墙时有可能无法生图\n生图时间非常非常久\n网站无中文",
    "consRedNote": "生图时间非常非常久",
    "watermark": "无",
    "chars": "无限制",
    "network": "可直连",
    "cost25": "未更新Image2.5",
    "dailyTrend": "down",
    "consRedNotes": [
      "9.12起积分消耗+2"
    ],
    "costStrikeTexts": [
      "1K：9积分"
    ]
  },
  {
    "name": "Clipfly",
    "url": "https://www.clipfly.ai/aitools/ai-media-generator-v2?state=textToImage",
    "daily": 2.03,
    "dailyPrefix": "平均",
    "quota": "签到1-10积分/天\n任务3积分/天",
    "validity": "90天有效\n00:00 刷新积分",
    "cost": "1K低：10积分",
    "pros": "Image2.5积分消耗大幅下降\n积分时效较长（90天）",
    "cons": "每日积分获得少\n还得签到+做任务才能获得\n没有像素选项（1024级别）",
    "watermark": "无",
    "chars": "3,000",
    "network": "需工具",
    "cost25": "Flare：\n1K低：3积分\nSunburst：\n1K低：4积分",
    "dailyTrend": "up"
  },
  {
    "name": "Fotor",
    "url": "https://www.fotor.com/images/create/",
    "daily": 2.07,
    "dailyPrefix": "平均",
    "quota": "签到2-5积分/日\n任务6积分/日",
    "validity": "24小时有效\n00:00 刷新积分",
    "cost": "1K低：5积分",
    "pros": "Image2.5积分消耗略微下降\n可以利用24小时有效期凑积分\n（其实也没多大用）",
    "cons": "文字审核更严\n没有像素选项（1024级别）",
    "watermark": "无",
    "chars": "10,000",
    "network": "需工具",
    "cost25": "1K低：4积分\n1K中：8积分\nFlare/Sunburst相同",
    "dailyTrend": "up"
  },
  {
    "name": "幻境Forge",
    "url": "https://forge-ai.vip/image",
    "daily": 4,
    "dailyPrefix": "平均",
    "quota": "3–5次免费生图/日",
    "validity": "长期有效\n00:00 刷新积分",
    "cost": "—",
    "pros": "邀请注册链接 可+3次数\n生图次数可以长期积累\n9月4日起随机3-5次生图/天",
    "prosBoldText": "",
    "prosLinks": [
      {
        "line": "邀请注册链接 可+3次数",
        "label": "邀请注册链接",
        "url": "https://forge-ai.vip/login?invite=FORGE-9EBC53F1"
      }
    ],
    "cons": "随机到3次的概率明显更大",
    "watermark": "无",
    "chars": "无限制",
    "network": "可直连",
    "cost25": "只更新Flare\n未更新Sunburst"
  },
  {
    "name": "Promeai",
    "url": "https://www.promeai.pro/canvas/zh-CN/projects",
    "daily": 4,
    "dailyPrefix": "平均",
    "quota": "1-7积分/日",
    "validity": "90天有效\n08:00 刷新积分",
    "cost": "1K低：1积分\n2K中：16积分",
    "pros": "用画布模式可以一次只生图1张",
    "cons": "AI图片生成会强制一次生图3张",
    "watermark": "无",
    "chars": "无限制",
    "network": "需工具",
    "cost25": "1K低：1.2积分\n2K中：19.2积分\nFlare/Sunburst相同"
  },
  {
    "name": "志设",
    "url": "https://www.zs9.com/ai/draw",
    "daily": 0,
    "quota": "0积分/天\n50积分/天",
    "validity": "当日有效\n00:00 刷新积分",
    "cost": "1K低：26积分\n2K低：40积分",
    "pros": "—",
    "cons": "9.12起不再提供每日积分\nImage2.5无质量选项\n1K低故意设计为26积分",
    "watermark": "无",
    "chars": "无限制",
    "network": "可直连",
    "isNew": true,
    "cost25": "1K：26积分\n2K：40积分\n极速/高质量相同",
    "isOut": true,
    "consRedNotes": [
      "9.12起不再提供每日积分"
    ],
    "quotaStrikeTexts": [
      "50积分/日"
    ]
  },
  {
    "name": "Imggpt2",
    "url": "https://imagegpt2.com/zh_TW",
    "daily": 2,
    "quota": "4积分/天",
    "validity": "当日有效\n08:00 刷新积分",
    "cost": "1K：2积分\n2K：4积分",
    "pros": "1K为1254x1254（+50%）",
    "cons": "生图质量不稳定\n又一个叫GPT Image2的网站\n没有质量选项\n生图时间非常长",
    "watermark": "无",
    "chars": "5,000",
    "network": "需工具",
    "isNew": true,
    "cost25": "1K：2积分\n2K：4积分\nFlare/Sunburst相同\n生图质量不稳定",
    "cost25RedTexts": [
      "生图质量不稳定"
    ],
    "image25CompactNote": "生图质量不稳定",
    "consRedNotes": [
      "生图质量不稳定",
      "生图时间非常长"
    ]
  },
  {
    "name": "Imgcrtor",
    "url": "https://imgcreatorai.io/zh_TW",
    "daily": 2,
    "quota": "4积分/天",
    "validity": "当日有效\n08:00 刷新积分",
    "cost": "1K：2积分\n2K：4积分",
    "pros": "1K为1254x1254（+50%）",
    "cons": "生图质量不稳定\n生图时间非常长\n又一个叫GPT Image2的网站\n没有质量选项",
    "watermark": "无",
    "chars": "5,000",
    "network": "需工具",
    "isNew": true,
    "cost25": "1K：2积分\n2K：4积分\nFlare/Sunburst相同\n生图质量不稳定",
    "cost25RedTexts": [
      "生图质量不稳定"
    ],
    "image25CompactNote": "生图质量不稳定",
    "consRedNotes": [
      "生图质量不稳定",
      "生图时间非常长"
    ]
  },
  {
    "name": "豆绘AI",
    "url": "https://www.douhuiai.com/ai-image/txt2img",
    "daily": 2,
    "dailyPrefix": "约",
    "sortPriority": 1,
    "quota": "10积分/天\n福袋5-20积分/日",
    "validity": "当日有效\n00:00 刷新积分",
    "cost": "1K：10积分\n2K：15积分",
    "pros": "9月起增加额外的福袋积分\n自定义4K分辨率只要2K积分",
    "prosDarkText": "9月起增加额外的福袋积分",
    "cons": "质量略不稳定\nSunburst积分消耗更高\nImage2/2.5都无质量选项\n生图后要手动刷新",
    "watermark": "无",
    "chars": "4,000",
    "network": "可直连",
    "isNew": true,
    "cost25": "Flare：\n1K：10积分\n2K：15积分\nSunburst：\n1K：15积分\n2K：20积分",
    "consRedNotes": [
      "质量略不稳定"
    ]
  },
  {
    "name": "椒图AI",
    "url": "https://jiaotu.top/",
    "daily": 3,
    "quota": "15积分/日\n20积分/月",
    "validity": "登录积分当日有效\n00:00 刷新积分\n月积分30天有效",
    "cost": "1K低：4积分\n2K中：15积分",
    "pros": "邀请注册链接 可+100积分",
    "cons": "—",
    "watermark": "无",
    "chars": "无限制",
    "network": "可直连",
    "isNew": true,
    "cost25": "1K低：4积分\n2K中：6积分\nFlare/Sunburst相同",
    "prosLinks": [
      {
        "line": "邀请注册链接 可+100积分",
        "label": "邀请注册链接",
        "url": "https://jiaotu.top/?invite=7RT7B"
      }
    ]
  },
  {
    "name": "GPTimg",
    "url": "https://gpt-image2.art/zh/generator/text-to-image",
    "daily": 1,
    "quota": "2积分/天",
    "validity": "30天有效\n08:00 刷新积分",
    "cost": "1K低：2积分\n2K低：2积分\n2K中：16积分",
    "pros": "2K低也只要2积分",
    "cons": "又一个叫GPT Image2的网站",
    "watermark": "无",
    "chars": "无限制",
    "network": "需工具",
    "isNew": true,
    "cost25": "1K低：2积分\n2K低：2积分\n2K中：16积分\nFlare/Sunburst相同",
    "costBoldTexts": [
      "2K低：2积分"
    ],
    "cost25BoldTexts": [
      "2K低：2积分"
    ]
  },
  {
    "name": "Img2.im",
    "url": "https://image2.im/zh/gpt-image-2-5",
    "daily": 1.5,
    "quota": "3积分/日",
    "validity": "长期有效\n08:00 刷新积分",
    "validityWarnText": "待验证",
    "cost": "1K：2积分\n2K：2积分",
    "pros": "2K和1K积分一样",
    "cons": "没有质量选项",
    "watermark": "无",
    "chars": "无限制",
    "network": "需工具",
    "isNew": true,
    "cost25": "1K：2积分\n2K：2积分\nFlare/Sunburst相同",
    "costBoldTexts": [
      "2K：2积分"
    ],
    "cost25BoldTexts": [
      "2K：2积分"
    ]
  },
  {
    "name": "Coldesen",
    "url": "https://pai.zaiduyu.top/",
    "daily": 5.1,
    "quota": "500-600积分/天",
    "validity": "24小时有效\n00:00 刷新积分",
    "cost": "1K：100积分",
    "pros": "9.21起Image2.5积分下降\n邀请注册链接 可+5000积分\n5000积分只有2天有效期\n1K像素为1254x1254（+50%）",
    "cons": "本站2.5实测质量差\nImage2.5大幅增加积分消耗\n最近生图不时出问题\n没必要用贵的Image2.5\n参数条件无意义，只能输出1K",
    "watermark": "无",
    "chars": "无限制",
    "network": "可直连",
    "isNew": true,
    "cost25": "1K：150积分\n1K：300积分\nFlare/Sunburst相同\n本站2.5实测质量差",
    "cost25StrikeTexts": [
      "1K：300积分"
    ],
    "prosLinks": [
      {
        "line": "邀请注册链接 可+5000积分",
        "label": "邀请注册链接",
        "url": "https://pai.zaiduyu.top/#/auth?ref=4AC94074C78A"
      }
    ],
    "prosRedText": "5000积分只有2天有效期",
    "consRedNotes": [
      "本站2.5实测质量差",
      "Image2.5大幅增加积分消耗"
    ]
  },
  {
    "name": "Img2-ai",
    "url": "https://image2-ai.com/zh",
    "daily": 0.28,
    "dailyPrefix": "平均",
    "quota": "平均14.28积分/天",
    "validity": "30天有效",
    "cost": "1K：50积分\n2K：100积分",
    "pros": "—",
    "cons": "没有质量选项\n签到积分也太少了\n强制间隔24小时才能签到\n完全没有收藏的价值",
    "consRedNotes": [
      "签到积分也太少了",
      "强制间隔24小时才能签到",
      "完全没有收藏的价值"
    ],
    "watermark": "无",
    "chars": "20,000",
    "network": "需工具",
    "isNew": true,
    "cost25": "1K：100积分\n2K：150积分\nFlare/Sunburst相同"
  },
  {
    "name": "OiiOii",
    "url": "https://www.oiioii.tv/",
    "daily": 2.5,
    "quota": "10积分/日\n20积分/日",
    "validity": "3天有效\n08:00 刷新积分",
    "cost": "1K低：4积分\n2K中：14积分",
    "pros": "注册前7天每日可得60积分\n可以绕过水印\n1K有1254x1254（+50%）",
    "cons": "9.12起每日积分降低为10\n绕过水印有些复杂",
    "watermark": "可绕过",
    "chars": "无限制",
    "network": "可直连",
    "isNew": true,
    "cost25": "1K低：4积分\n2K中：14积分\nFlare/Sunburst相同",
    "quotaStrikeTexts": [
      "20积分/日"
    ],
    "consRedNotes": [
      "9.12起每日积分降低为10"
    ],
    "dailyTrend": "down"
  },
  {
    "name": "Flyne",
    "url": "https://flyne.ai/cn/ai-image-generator/",
    "daily": 2,
    "quota": "20积分/天",
    "validity": "100天有效\n00:00 刷新积分",
    "cost": "1K低：10积分\n2K中：120积分",
    "pros": "水印限制可规避（右键另存）\n1K分辨率有1280x1280（+56%）\n免费版也有1254x1254",
    "prosLinks": [
      {
        "line": "有个免费生图地址",
        "label": "有个免费生图地址",
        "url": "https://flyne.ai/cn/free-gpt-image-2/"
      }
    ],
    "cons": "9月起下载图片有水印\nImage2.5 分辨率下降到1024\n免费版非常难用",
    "watermark": "可绕过",
    "chars": "2,000",
    "network": "可直连",
    "isNew": true,
    "cost25": "1K低：10积分\n2K中：120积分\nFlare/Sunburst相同",
    "consRedNotes": [
      "9月起下载图片有水印"
    ]
  },
  {
    "name": "咖图AI",
    "url": "https://www.katuai.cn/",
    "daily": 2,
    "quota": "2积分/日\n需连续签到3天",
    "validity": "长期有效\n00:00 刷新积分",
    "cost": "1K：1积分\n2K：2积分\n2K：6积分",
    "pros": "邀请注册链接 可+50积分\n1K为1254x1254（+50%）\nImage2的2K积分消耗下降\n额外赠送了0.5元API余额\n如何调用API可以问AI",
    "cons": "没有质量选项",
    "watermark": "无",
    "chars": "无限制",
    "network": "可直连",
    "isNew": true,
    "cost25": "Flare：\n1K：1积分\n2K：6积分\nSunburst：\n1K：1积分\n2K：5积分",
    "prosLinks": [
      {
        "line": "邀请注册链接 可+50积分",
        "label": "邀请注册链接",
        "url": "https://www.katuai.cn/?iv=jvdb"
      }
    ],
    "costStrikeTexts": [
      "2K：6积分"
    ]
  },
  {
    "name": "Pollo",
    "url": "https://pollo.ai/zh/ai-image-generator",
    "daily": 3.57,
    "dailyPrefix": "平均",
    "quota": "签到2-10积分/日\n5次免费生图",
    "validity": "长期有效\n00:00 刷新积分",
    "validityWarnText": "待验证",
    "cost": "1K低：1积分\n2K中：3积分",
    "pros": "邀请注册链接 可+50积分\nImage2的2K积分消耗和1K一样\n1K可以绕过水印\n它这个耀斑和旭日翻译有点意思\n耀斑=Flare，旭日=Sunburst",
    "cons": "9.12起不再提供额外5积分/日\n2K分辨率无法绕过水印",
    "watermark": "半绕过",
    "chars": "2,000",
    "network": "需工具",
    "isNew": true,
    "cost25": "1K低：1积分\n1K中：1积分\n2K低：1积分\n2K中：2积分\n耀斑和旭日消耗相同",
    "prosLinks": [
      {
        "line": "邀请注册链接 可+50积分",
        "label": "邀请注册链接",
        "url": "https://redirect.inviteurl.app/zh/invitation-landing?invite_code=DXEB8x"
      }
    ]
  },
  {
    "name": "Krene",
    "url": "https://www.krene.com/",
    "daily": 5,
    "quota": "50积分/天",
    "validity": "约4天有效\n00:00 刷新积分",
    "cost": "1K低：10积分\n2K低：10积分\n2K中：60积分",
    "pros": "邀请注册链接 可+25积分\n水印可绕过\n2K低积分和1K低一样\n可以多任务并行",
    "cons": "水印绕过有点复杂\n不要用降噪，磨皮感太重",
    "watermark": "可绕过",
    "chars": "无限制",
    "network": "可直连",
    "isNew": true,
    "cost25": "1K低：10积分\n2K低：10积分\n2K中：18积分\nFlare/Sunburst相同\n",
    "prosLinks": [
      {
        "line": "邀请注册链接 可+25积分",
        "label": "邀请注册链接",
        "url": "https://www.krene.com/?invitationCode=8IVCM9M4"
      }
    ],
    "costBoldTexts": [
      "2K低：10积分"
    ],
    "cost25BoldTexts": [
      "2K低：10积分"
    ]
  },
  {
    "name": "咔作画布",
    "url": "https://www.kaworkai.com/",
    "daily": 400,
    "dailyPrefix": "上限",
    "sortRank": 3,
    "quota": "0 积分免费版\n2.5 每日 300 张\n2.6 每日 100 张",
    "validity": "免费次数按日重置\n赠送算力 30 天有效",
    "cost": "1K：2积分\n2K：3积分\n4K：4积分",
    "pros": "国内可直连\n2.5 与 2.6 各有 0 积分免费版\n新用户绑定手机送 50 算力\n支持透明底导出\n电商详情页与多图工作流齐全",
    "cons": "免费版仅 1K、每次 1 张\n免费版有每日次数上限\n需注册并绑定手机号\n仅会员标注无水印导出",
    "watermark": "—",
    "chars": "—",
    "network": "可直连",
    "cost25": "2.5 免费版：0积分\n1K，每日 300 张\n2.5 高质量：1K 2积分\n2K 3积分\n4K 4积分",
    "cost26": "2.6 免费版：0积分\n1K，每日 100 张\n2.6 高质量：1K 2积分\n2K 3积分\n4K 4积分",
    "image25Status": "confirmed",
    "isNew": true,
    "extra": true,
    "verifiedAt": "2026-11-14"
  },
  {
    "name": "MONA",
    "url": "https://monastudiopro.com/",
    "daily": 0,
    "dailyText": "不限",
    "unlimited": true,
    "sortRank": 2,
    "quota": "限时免费\n无限制",
    "validity": "限时活动\n结束时间以站内为准",
    "cost": "2.0：限时免费",
    "pros": "国内可直连\n画布式工作台，可连续改图\n支持 Image2.0 与 Image2.6\n限时免费，不限次数",
    "cons": "限时活动，随时可能结束\n结束时间以站内公告为准\n水印与字符上限待实测",
    "watermark": "—",
    "chars": "—",
    "network": "可直连",
    "cost25": "",
    "cost26": "2.6：限时免费\n不限次数",
    "image25Status": "none",
    "isNew": true,
    "extra": true,
    "verifiedAt": "2026-11-14"
  },
  {
    "name": "Duck.ai",
    "url": "https://duck.ai/",
    "daily": 0,
    "dailyText": "未公布",
    "sortRank": 1,
    "quota": "每日免费生图\n官方未公布上限",
    "validity": "每日刷新\n以站内提示为准",
    "cost": "免费\n0 积分",
    "pros": "无需注册、不用登录\n国内可直连\n会话记录只存本地\n支持 Image2.0 与 Image2.6",
    "cons": "只出 1K 图\n免费额度未公开，偶有限流\n高峰期可能排队\n额度以站内提示为准",
    "watermark": "—",
    "chars": "—",
    "network": "可直连",
    "cost25": "",
    "cost26": "2.6：免费\n1K 输出\n暂无可调参数",
    "image25Status": "none",
    "isNew": true,
    "extra": true,
    "verifiedAt": "2026-11-14"
  }
];
