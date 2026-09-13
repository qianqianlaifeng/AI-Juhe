-- ============================================================
-- 宝藏趣站 · 数据表初始化
-- 在 Supabase 后台「SQL Editor」中粘贴执行本文件即可。
-- 说明：Netlify 函数使用 SERVICE_ROLE_KEY 访问，service_role 会自动绕过 RLS，
--       因此无需为匿名/认证角色配置策略；此处顺手关闭该表的 RLS 以免任何歧义。
-- ============================================================

-- 1) 建表
create table if not exists public.treasure_sites (
  id           uuid primary key default gen_random_uuid(),
  name         text        not null,
  url          text        not null,
  description  text        not null,
  image_url    text        not null default '',
  created_at   timestamptz not null default now()
);

-- 2) 关闭 RLS（service_role 本就绕过；关闭仅为消除歧义）
alter table public.treasure_sites disable row level security;

-- 3) 常用排序索引
create index if not exists treasure_sites_created_at_idx
  on public.treasure_sites (created_at desc);

-- 4) 初始收录：凛冬督学局
--    介绍文案依据官网真实内容撰写（AI 督学番茄钟专注工具）。
insert into public.treasure_sites (name, url, description, image_url)
select '凛冬督学局',
       'https://redwatch.top',
       'AI 督学番茄钟专注工具。设置专注时长并选择摄像头或屏幕巡查后，督学官会不定时「查岗」，按你授权的画面实时判定专注状态。完成任务生成劳动档案，累计有效专注时长、晋升劳动荣誉——把「随时可能被巡查」变成你的专注力。',
       'https://redwatch.top/assets/home/supervisor-nestor-v4.webp'
where not exists (
  select 1 from public.treasure_sites where url = 'https://redwatch.top'
);
