-- 目录读取形状：视图 menu，一行 = 一个分类，分类下嵌套商品、规格组与选项（Story 1.6；AD-22）
-- 过滤规则：下架商品不返回；售罄商品保留并返回 availability；分类下没有任何「非下架」商品时不返回。
-- 排序由视图保证：分类 / 商品 / 规格组 / 选项各自的 sort_order，客户端不再排序。
-- 字段名与库中列名一致（snake_case），Phase 3 由前端向生成类型对齐。

create view public.menu
with (security_invoker = true)
as
select
  c.id,
  c.name,
  jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'description', p.description,
      'price', p.price,
      'tags', p.tags,
      'sales', p.sales,
      'availability', p.availability,
      'image_path', p.image_path,
      'spec_groups', (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'id', g.id,
              'title', g.title,
              'multi', g.multi,
              'options', (
                select coalesce(
                  jsonb_agg(
                    jsonb_build_object('id', o.id, 'label', o.label, 'price_extra', o.price_extra)
                    order by o.sort_order, o.label
                  ),
                  '[]'::jsonb
                )
                from public.spec_options o
                where o.group_id = g.id
              )
            )
            order by psg.sort_order
          ),
          '[]'::jsonb
        )
        from public.product_spec_groups psg
        join public.spec_groups g on g.id = psg.group_id
        where psg.product_id = p.id
      )
    )
    order by p.sort_order, p.name
  ) as products
from public.categories c
join public.products p
  on p.category_id = c.id
 and p.availability <> 'delisted'
group by c.id, c.name, c.sort_order
order by c.sort_order, c.name;

comment on view public.menu is '目录读取形状的唯一产出点（Story 1.6）：下架商品已过滤，售罄商品保留并带 availability';

revoke all on public.menu from anon, authenticated;
grant select on public.menu to anon, authenticated;
