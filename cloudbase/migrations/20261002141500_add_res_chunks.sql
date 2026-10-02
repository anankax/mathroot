-- 数根的「资源库」：把孔老师的材料切成块存在这儿，云函数检索用。
--
-- 为什么要有这张表：语料原来待在 gate 的代码包里（cloudfunctions/gate/kb.js），
-- 检索是通的，但**每加一份素材都要重新生成 + 重新部署**。放进 PG，加素材就只是插行。
--
-- ★ 隐私口径：RLS **开**、策略**一条不给**。
--   anon / authenticated（也就是浏览器那边能拿到的身份）读不到任何一行；
--   能读的只有两条路——云函数里的**平台临时凭证**（走管控面 executePGSql），
--   和**服务端 API Key**（service_role，只在我本机的一次性灌数据脚本里用，用完就删）。
--   这跟"把语料公开出去"是两件事：表在云上 ≠ 表对谁都开。

CREATE TABLE IF NOT EXISTS public.res_chunks (
  id       bigserial PRIMARY KEY,
  doc      text        NOT NULL,          -- 来源文件（相对路径，人能读）
  shelf    text        NOT NULL,          -- 顶层文件夹：宜兴东氿中学 / 中考试卷 / 胡小群_md …
  ext      text        NOT NULL,          -- .md / .txt / .docx
  page     integer,                       -- 页号（原文有就填，没有就是 NULL）
  ord      integer     NOT NULL,          -- 这一份文件里的第几块
  title    text        NOT NULL,          -- 检索器认的条目标题（`### ` 后面那一行）
  body     text        NOT NULL,          -- 正文
  added_at timestamptz NOT NULL DEFAULT now()
);

-- 按书架的过滤会用到（比如"只从学科网素材里找"）
CREATE INDEX IF NOT EXISTS res_chunks_shelf_idx ON public.res_chunks (shelf);

-- 同一份文件的同一块，重灌时按这个认，避免灌两遍变成两份
CREATE UNIQUE INDEX IF NOT EXISTS res_chunks_doc_ord_idx ON public.res_chunks (doc, ord);

ALTER TABLE public.res_chunks ENABLE ROW LEVEL SECURITY;
-- ★ 故意不加任何 POLICY：默认拒绝。
