-- 商品图片桶：公开读、写默认拒绝（Story 1.4；AD-17、AD-20）
-- 桶由迁移声明，本地 db reset 与云端 db push 由同一批声明产生，不依赖控制台操作。
-- 公开读只靠桶的 public 标记：公开桶的直读 URL 不需要对象级策略，
-- 而一条宽泛的 SELECT 策略会让客户端可以列出桶内全部文件。
-- 图片对象本阶段手工上传，自动灌入留待后续。

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true);
