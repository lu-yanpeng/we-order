# supabase/types

`database.types.ts` 由数据库结构生成，**不要手工编辑**（下次生成会覆盖）。

- 重新生成：`supabase gen types typescript --local`（云端用 `--linked`）
- 生成器只能把嵌套 JSON 标成 `Json`：当前 `menu.products`（菜单嵌套形状）与 `order_items.selections`（规格选择快照，形状为「规格组 id → 选项 id 或选项 id 数组」，AD-22）的精确形状需要手工类型覆盖；`orders` 与 `order_items` 的其他列是普通列，生成类型是精确的
- 下游（Phase 3 的小程序、边缘函数）用 `import type` 引用本文件；类型导入在编译时被擦除，不进小程序包
