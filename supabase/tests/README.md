# supabase/tests

数据库测试（pgTAP）。一条命令跑全部：`supabase test db`（本地栈需已启动）。边缘函数的测试不在这里，见 `functions/tests/`。

| 文件 | 覆盖 |
| --- | --- |
| `database/00_smoke.test.sql` | pgTAP 可运行、`public` schema 存在 |
| `database/10_catalog.test.sql` | 目录 5 表：RLS 已启用、未认证可读、未认证与已登录都不可写 |
| `database/20_stores.test.sql` | 门店：RLS 已启用、未认证可读、客户端不可写 |
| `database/30_storage.test.sql` | 图片桶：公开桶、`storage.objects` 零策略、未认证读不到对象、客户端不可写 |
| `database/40_menu_view.test.sql` | `menu` 视图：过滤（下架 / 售罄 / 空分类）、排序、嵌套形状、字段名 |
| `database/50_wechat_identities.test.sql` | 身份映射：RLS 启用且零策略、客户端完全不可达、列集合只有 openid/user_id/时间戳、openid 唯一、user_id 唯一、外键与级联、枚举含 `identity_failed`、`record_wechat_login` 的权限与幂等 |

说明：

- 测试自带数据（事务内清空目录表再插入样例，结束回滚），不依赖种子，也不依赖手工准备的数据——`supabase db reset --no-seed` 后直接跑同样通过。
- 模拟身份只用角色切换（`set local role anon` / `authenticated`），不含 JWT claim 注入；需要按用户身份断言的测试（Epic 5）届时以实现时的官方文档为准。
- 断言描述都带对象名，失败时输出形如 `# Failed test 1: "未认证不能写入 categories"`，可定位到具体策略或对象。
