# AGENTS.md

## 项目概览

We-Order 微信点餐小程序，由三个子项目平铺组成（非 monorepo）：
- `mp/` — Uniapp + Vue 3 + TypeScript 微信小程序
- `admin/` — Vben Admin 后台管理系统
- `supabase/` — Supabase 后端

四阶段计划：Phase 1（静态页面 Mock 数据）→ Phase 2（Supabase 后端）→ Phase 3（对接真实 API）→ Phase 4（B 端后台）。

## 子项目组织（AD-1）

三个子项目平铺在仓库根目录，各自独立工具链（详见 `docs/adr/0001-flat-subprojects-over-monorepo.md`）：
- **不要**当作 monorepo 处理，无需统一的 package.json、tsconfig、lint-staged
- Supabase 的 types 需手动同步到 mp 和 admin
- 子项目具体约束请从子项目内的AGENTS.md获取

## 关键文档

- `docs/brief.md` — 产品简报
- `docs/phase-1/prd.md` — Phase 1 功能需求（FR-1 至 FR-14）
- `docs/phase-1/ARCHITECTURE-SPINE.md` — 架构约定与不变式（AD-1 至 AD-8）
- `docs/adr/0001-flat-subprojects-over-monorepo.md` — 子项目组织决策
