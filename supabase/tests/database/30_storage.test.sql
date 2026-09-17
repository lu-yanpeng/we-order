-- 商品图片桶：公开读靠桶标记、对象级不加任何策略、写默认拒绝（Story 1.4；AD-20）
begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

select ok(
  exists (select 1 from storage.buckets where id = 'product-images' and public),
  'product-images 桶存在且为公开桶（未登录直读的唯一机制）'
);

select is(
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'),
  0::bigint,
  'storage.objects 上不存在任何策略（否则客户端可列举桶内文件）'
);

-- 造一行对象元数据，用于验证未认证读不到它
insert into storage.objects (bucket_id, name) values ('product-images', 'hidden-check.png');

set local role anon;

select is(
  (select count(*) from storage.objects where bucket_id = 'product-images'),
  0::bigint,
  '未认证读不到桶内已存在的对象'
);

select throws_ok(
  'insert into storage.objects (bucket_id, name) values (''product-images'', ''x.png'')',
  '42501', null, '未认证不能写入 storage.objects'
);

set local role authenticated;

select throws_ok(
  'insert into storage.objects (bucket_id, name) values (''product-images'', ''x.png'')',
  '42501', null, '已登录身份不能写入 storage.objects'
);

reset role;

select * from finish();

rollback;
