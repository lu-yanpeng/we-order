-- 目录种子数据（分类、商品、规格组与选项、门店、商品图片引用）
-- 种子数据不含任何订单。
-- 门店属 Story 1.3；分类、商品、规格组与选项属 Story 1.5。

insert into public.stores (id, name, address, phone, timezone)
values (
  '00000000-0000-4000-8000-000000000001',
  '星巴克 啡快自提店',
  '北京市朝阳区创意产业园 A 座 1 层',
  '010-88888888',
  'Asia/Shanghai'
);
