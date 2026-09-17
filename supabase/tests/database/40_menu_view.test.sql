-- 目录读取视图：形状、过滤与排序（Story 1.6；AD-22）
-- 事务内清空目录数据后用自造数据断言，不依赖种子（种子数据可能被人为改动）。
begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

delete from public.products;
delete from public.spec_groups;
delete from public.categories;

-- A：在售 + 售罄（含规格组）；B：只有下架（不应出现）；C：只有售罄（应出现）
insert into public.categories (id, name, sort_order) values
  ('00000000-0000-4000-8000-00000000aa01', '测试分类A', 1),
  ('00000000-0000-4000-8000-00000000aa02', '测试分类B', 2),
  ('00000000-0000-4000-8000-00000000aa03', '测试分类C', 3);

insert into public.products (id, category_id, name, description, price, tags, sales, availability, sort_order) values
  ('00000000-0000-4000-8000-00000000bb01', '00000000-0000-4000-8000-00000000aa01', '测试商品A1', '测试描述', 10.00, '{新品}', 1, 'on_sale', 1),
  ('00000000-0000-4000-8000-00000000bb02', '00000000-0000-4000-8000-00000000aa01', '测试商品A2', '测试描述', 20.00, '{}', 2, 'sold_out', 2),
  ('00000000-0000-4000-8000-00000000bb03', '00000000-0000-4000-8000-00000000aa02', '测试商品B1', '测试描述', 30.00, '{}', 3, 'delisted', 1),
  ('00000000-0000-4000-8000-00000000bb04', '00000000-0000-4000-8000-00000000aa03', '测试商品C1', '测试描述', 40.00, '{}', 4, 'sold_out', 1);

insert into public.spec_groups (id, title, multi) values
  ('00000000-0000-4000-8000-00000000cc01', '测试规格组', false);

-- 故意按倒序插入，验证视图按 sort_order 排序而不是按插入顺序
insert into public.spec_options (id, group_id, label, price_extra, sort_order) values
  ('00000000-0000-4000-8000-00000000dd02', '00000000-0000-4000-8000-00000000cc01', '测试选项二', 3.00, 2),
  ('00000000-0000-4000-8000-00000000dd01', '00000000-0000-4000-8000-00000000cc01', '测试选项一', 1.00, 1);

insert into public.product_spec_groups (product_id, group_id, sort_order) values
  ('00000000-0000-4000-8000-00000000bb01', '00000000-0000-4000-8000-00000000cc01', 1);

set local role anon;

select is(
  (select count(*) from public.menu),
  2::bigint,
  '只返回含「非下架」商品的分类：A 与 C 出现，B（只有下架商品）不出现'
);

select is(
  (select array_agg(name)::text from public.menu),
  '{测试分类A,测试分类C}',
  '分类按 sort_order 排序'
);

select is(
  (select sum(jsonb_array_length(products)) from public.menu),
  3::bigint,
  '下架商品不出现在任何分类下（A 两件 + C 一件）'
);

select is(
  (select products -> 0 ->> 'name' from public.menu where name = '测试分类A'),
  '测试商品A1',
  '商品按 sort_order 排序'
);

select is(
  (select products -> 1 ->> 'availability' from public.menu where name = '测试分类A'),
  'sold_out',
  '售罄商品保留在结果中并返回 availability'
);

select is(
  (select products -> 0 -> 'spec_groups' -> 0 -> 'options' -> 0 ->> 'label' from public.menu where name = '测试分类A'),
  '测试选项一',
  '规格组与选项已嵌套，且选项按 sort_order 排序'
);

with prod as (
  select products -> 0 as p from public.menu where name = '测试分类A'
)
select ok(
  (select p ? 'description' from prod) and not (select p ? 'desc' from prod),
  '商品字段用库中列名 description，不是 Phase 1 的 desc'
);

reset role;

select * from finish();

rollback;
