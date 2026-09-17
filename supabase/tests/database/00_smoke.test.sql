-- 冒烟测试：确认 pgTAP 可运行、结构可从零重建。
-- 真正的策略边界测试（未认证不可写、目录可公开读）属 Story 1.8。
begin;

create extension if not exists pgtap with schema extensions;

select plan(1);

select has_schema('public', 'public schema 应存在');

select * from finish();

rollback;
