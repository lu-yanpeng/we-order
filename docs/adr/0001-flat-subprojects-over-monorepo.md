# 平铺子项目而非 Monorepo

项目由三个子项目组成：mp（微信小程序）、admin（基于 Vben Admin 的后台管理系统）、supabase（后端）。
我们选择将三个子项目平铺在仓库根目录下，各自独立管理工具链，而非将它们组织为 monorepo。

## Considered Options

1. **Monorepo 彻底融合** — 将 Vben Admin 拆解，与其他子项目重新组合成一个统一的 monorepo。
   拒绝原因：耗费精力、对新手不友好，且无法同步 Vben Admin 的上游更新。

2. **Monorepo 套娃隔离** — 在主 monorepo 中通过 `!` 配置强行隔离 Vben Admin。
   拒绝原因：Vben Admin 会失去 monorepo 的 types 同步功能，且容易出现配置冒泡污染。

3. **平铺项目（采纳）** — 三个子项目各自独立，平铺在仓库根目录下。

## Consequences

- Vben Admin 可随时从上游同步更新，不受 monorepo 配置约束。
- 各子项目工具链完全隔离，互不干扰。
- Supabase 的 types 需要手动同步到 mp 和 admin。
- 无法通过一条命令同时启动所有子项目。
