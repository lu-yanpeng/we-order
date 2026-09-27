# Phase 3 验收记录 · Epic 2（打开就是真菜单）

## Story 2.1 目录读取切到真实数据

- 日期：2026-09-27
- 环境：本地 Supabase 栈（CLI 2.117.0 / Postgres 17，迁移 + 种子已应用）；mp 侧 `pnpm type-check`（vue-tsc 3.3.6）、`pnpm lint`、`pnpm test`（vitest 3.2.7）、`pnpm build:mp-weixin`
- 范围：客户端目录 / 门店切换真实后端（`menu` 视图 + `stores` 行，REST、`anonymous`）；商品图片由 `image_path` 构造对象存储 URL + 缺图色块占位；**后端零改动、无迁移**；旧 `api/products.ts` / `api/store.ts` 与 `src/mock/**` 保留（Story 2.3 删除）
- 裁定记录（Ly）：① 图片 URL 拼接落 `api/catalog.ts`、`core/transport` 只导出既有 `supabaseUrl`（1A）；② 目录方法直接返回 alova Method，不用 async 包装（2A）；③ `fetchStore()` 无行返回 `null`（3A）；④ 验收准备一张真实图片验证图片链路（4A）；⑤ 旧 Mock 实现按 epic 切分保留到 Story 2.3（5A）；⑥ 确认订单页门店读取失败静默兜底（6A，超 AC 字面的必要处理）；⑦ 手动验收由演示者执行（7）

### 交付物

| 类别 | 内容 |
| --- | --- |
| 新增（客户端） | `src/api/catalog.ts`：`fetchCategories()`（`public.menu`，REST、anonymous，返回 alova Method）、`fetchStore()`（`public.stores` 只取四列、固定顺序取第一行、无行返回 null）、`productImageUrl()`（`image_path` → 对象存储公开读 URL，缺图返回空串） |
| 修改（客户端） | `core/transport/index.ts` 多导出 `supabaseUrl`（构建变量唯一读取点仍是 `config.ts`，不产生请求）；`core/transport/README.md` 同步（prettier 顺带重排表格对齐） |
| 修改（客户端） | `pages/home/composables/use-products.ts`：改调 `api/catalog`；分类锚点引出 `anchorId()`（`cat-` 前缀，见下）；导出 `anchorId` / `productImageUrl` 供页面注入组件 |
| 修改（客户端） | `pages/home/index.vue`：分类区块 `:id="anchorId(cat.id)"`；`ProductCard` 多传 `image-url` |
| 修改（客户端） | `pages/home/components/product-card/index.vue`：容器仍是色块，内部新增 `<image>`（`mode="aspectFill"`、`lazy-load`、`binderror` 回退）；组件保持纯展示（不 import api/，URL 由页面经 composable 注入） |
| 修改（客户端） | `sub-order-confirm/composables/use-order-confirm.ts`：改调 `api/catalog`；`initStore` 失败静默兜底（门店区留空，不产生未捕获异常） |
| 未改动 | `api/products.ts`、`api/store.ts`、`src/mock/**`、`api/orders.ts`、页面结构与交互、结算栏分包相关文件；后端零改动 |

### 关键实现点

1. **分类锚点 `cat-` 前缀（真实数据暴露的坑）**：分类 id 是 UUID（数字开头），微信规定 `scroll-into-view` 与 `#` 选择器指向的 id 不能以数字开头，直接使用会静默失去双栏联动。处理：DOM 锚点统一 `cat-<uuid>`，`scrollIntoViewId` 与 `createSelectorQuery` 共用 `anchorId()`；数据层（`activeCategory` 比较、`:key`）仍用原始 UUID。
2. **图片 URL**：`<项目地址>/storage/v1/object/public/product-images/<image_path>`；`image_path` 为相对路径（种子里全为 NULL），空串或加载失败都退回容器色块，不阻塞列表渲染。
3. **anonymous 身份**：目录 / 门店方法显式声明 `meta.auth = 'anonymous'`，transport 请求前不调用 `ensureSession()`，只带 `apikey`、不带 `Authorization`（响应头构造逻辑未变，Story 1.2 已单测）。
4. **组件分层**：`product-card` 不 import `api/`，图片地址由 `use-products` 从 `api/catalog` 取出后经页面注入，维持 P1 AD-3「组件纯展示」。

### 验收点与证据

| Story 2.1 验收点 | 证据 |
| --- | --- |
| 分类 / 商品 / 规格 / 门店来自后端；下架不返回、售罄保留带 availability；排序由视图保证 | anonymous `curl` 抽查：`/rest/v1/menu` 返回 **16 分类 / 50 商品**；「周边好物」不返回（唯一商品已下架整类过滤）；「提拉米苏」保留且 `availability=sold_out`；「城市随行杯」不返回；「推荐今日咖啡」为首分类、首商品价 28（JSON 数字）；`/rest/v1/stores?select=id,name,address,phone&order=id.asc&limit=1` 返回唯一门店四列 |
| 目录 / 门店均 `anonymous`，不等待会话、登录失败不阻塞 | `api/catalog.ts` 两个方法均 `meta: { auth: 'anonymous' }`；transport 的 anonymous 分支不调用 `ensureSession`（Story 1.2 单测已断言 anonymous 无 `Authorization`）；运行时证据见手动 #3 |
| 目录形状按 `types/api-contracts.ts` 消费，类型化而非 any | `fetchCategories()` 泛型 `MenuCategory[]`，调用方 `categories.value = await fetchCategories()` 经 `pnpm type-check` 0 错误；新增代码无 `any` |
| 旧 `api/products.ts` / `api/store.ts` 不再被调用 | `grep -rn "@/api/products\|@/api/store" mp/src` 无结果；`api/catalog` 调用方仅 `use-products.ts` 与 `use-order-confirm.ts` |
| Mock 数据不再进包 | 构建产物 `dist/build/mp-weixin` 检索 Mock 特征串（`section-coffee` / `prod-001`）**0 命中**；`dist/build/mp-weixin/api/catalog.js` 含 `/rest/v1/menu`、`/rest/v1/stores`、`product-images` |
| 图片由 `image_path` 构造对象存储 URL；缺图 / 失败色块占位、不阻塞渲染 | `product-card/index.wxml`：色块容器 + `<image wx:if mode="aspectFill" lazy-load binderror>`；`imageUrl` 空串或 `imageFailed` 时不渲染 image、保留色块；真实 URL 显示见手动 #7 |
| 双栏联动 / 规格定制 / 实时计价与 P1 一致；展示价与计价同源 | 交互代码未改（仅数据来源与锚点前缀）；构建产物 `use-products.js`：`handleSidebarClick` 与 `createSelectorQuery` 均经 `cat-${id}`，`index.js` 的 id 绑定为 `anchorId(cat.id)`；计价仍用 `utils/price.ts` 消费同一份 `price` / `price_extra`；运行时复验见手动 #4 / #5 |
| 新增文件落位符合 P1 AD-9；结算栏分包按需加载不回归 | 新增 `api/catalog.ts` 在主包目录树（被主包 `use-products` 使用）；结算栏相关文件零改动（`git diff --stat`：6 改 1 增）；冒烟见手动 #9，六分支完整复验留验证矩阵 #9 |
| 客户端全量编译与构建 | `pnpm type-check` 0 错误；`pnpm lint` 0 错误 / 0 警告；`pnpm format` 无待格式化项（本 story 首次运行重排了 `README.md` 表格对齐）；`pnpm build:mp-weixin` → `Build complete.` |
| 单元测试全绿（既有不回归） | `pnpm test`：5 个文件 62 项全过（未新增测试） |

### 手动验证结果（2026-09-27 演示者执行）

前置：本地栈在跑（`supabase start`）、`mp/.env.local` 指向本地栈、开发者工具已勾选「不校验合法域名」；建议先「清缓存并重启」。

| # | 操作 | 预期 | 结果 |
| --- | --- | --- | --- |
| 1 | 打开点餐 tab，对照数据库看分类与商品 | 分类为库中数据（16 个：推荐今日咖啡 → 茶饮 → … → 蛋糕专区 → 瓶装饮品，无「周边好物」）；「提拉米苏」在、「城市随行杯」不在；「美式咖啡」¥28 | 通过 |
| 2 | 网络面板查看目录请求 | `/rest/v1/menu` 200，请求头只有 `apikey`、无 `Authorization`、无 `Bearer` | 通过 |
| 3 | 清掉 `weorder_session` → 重启 | `/rest/v1/menu` 不等 `wechat-login` 完成、只带 `apikey`；登录无弹窗、无全局提示（预期修正：见下注） | 通过（预期修正） |
| 4 | 点侧边栏「甜品」「烘焙」等分类；再手动缓慢滚回顶部 | 右侧滚动到对应区块；滚动时高亮随区块变化、回顶部高亮回「推荐今日咖啡」（锚点修复复验） | 通过 |
| 5 | 打开「美式咖啡」规格弹窗，切换杯型 / 加料；再看「卡布奇诺」 | 实时计价随规格加价变化（大杯 Grande +3 → ¥31；加料多选叠加）；无规格商品只显示数量步进器 | 通过 |
| 6 | 观察商品图片区（`image_path` 尚未填写时） | 全部为色块占位；列表滚动顺畅、无阻塞、无报错 | 通过 |
| 7 | Studio（`http://127.0.0.1:54323`）→ Storage → `product-images` 上传一张图；`update public.products set image_path='<对象路径>' where id='00000000-0000-4000-8000-000000000201';` → 重启 | 「美式咖啡」显示该图片 | 通过（演示者已准备真实图片，渲染正常） |
| 8 | 加购后进确认订单页 | 门店名称 / 地址 / 电话来自库（星巴克 啡快自提店 / 北京市朝阳区创意产业园 A 座 1 层 / 010-88888888） | 通过 |
| 9 | 结算栏分包回归：清缓存重启（空购物车）→ 再首次加购 | 冷启动不下载结算栏分包、不出现结算栏；首次加购触发分包下载并从底部滑入；展开 / 收起 / 数量步进正常 | 通过 |

> 2026-09-27 由演示者在微信开发者工具按上表执行，9 项全部通过（含真实图片渲染、双栏联动锚点修复、结算栏分包回归）。
>
> **#3 预期修正**：当前 `pages.json` 首页仍是 `pages/auth-check`（Phase 2 验证入口，Story 2.3 才删除并把首页切换为 `pages/home/index`），重启后只执行静默登录、不进入点餐页，menu 请求要手动进入点餐页才发生——原始预期「重启即同时观察 menu 与 login 并发」在 2.3 之前无法在自然路径上复现。实际观察：进入点餐页后 `/rest/v1/menu` 只带 `apikey`、不等待登录结果，目录正常渲染，`anonymous` 语义成立；Story 2.3 首页切换后可在自然路径复验一次（已记入遗留）。
>
> **#7 补充**：真实图片验证了 URL 拼接与渲染；「`image_path` 改成不存在路径 → 回退色块」未单独复验（与缺图占位同归色块呈现分支）。

### 有意偏差与遗留

1. **失败态留给 Story 2.2**：目录加载失败时当前仍是「空列表 + 已置位的 error 状态」，无失败文案 / 重试入口（本 story AC 不含）；Story 2.2 按 `utils/error-copy.ts` 收口（含 REST 域暂用 `order.unknown` 兜底文案的 1.2 遗留）。
2. **旧实现与 Mock 保留到 Story 2.3**：`api/products.ts` / `api/store.ts` 已成为无调用方的死代码；`src/mock/**` 仍在仓库但已不进包（证据见上）。
3. **`mock/orders.ts` 仍引用 `mock/store.ts`**：Story 2.3 删除 `mock/store.ts` 前需先把该引用解耦（内联门店快照或改用文本常量），否则订单侧 Mock 构建报错——记录给 Story 2.3。
4. **图片对象未入仓**：演示图片由 Ly 自行准备（本阶段不做上传）；本次已用一张真实图片（美式咖啡）验证「URL 拼接 + 渲染」，「加载失败回退」未单独复验。
5. **订单侧仍是 Mock**：结算页门店信息已真实，但订单快照仍由本地 `buildOrder` 造（Epic 3 换 `pay-order`、Epic 4 换真实读取）；本 story 不改变该行为。
6. **`lazy-load` 为新增实现细节**：图片进入视口才加载；若真机上希望首屏全载可去掉该属性（不影响验收点）。
7. **`#3` 的自然路径复验**：首页仍为 `pages/auth-check`；Story 2.3 把首页切到 `pages/home/index` 后，重启即可在自然路径观察「登录与目录请求并行、互不阻塞」，届时顺手复验一次。

## Story 2.2 目录加载失败态与重试

- 日期：2026-09-27
- 环境：本地 Supabase 栈（CLI 2.117.0 / Postgres 17）；mp 侧 `pnpm type-check`（vue-tsc 3.3.6）、`pnpm lint`、`pnpm test`（vitest 3.2.7）、`pnpm build:mp-weixin`
- 范围：点餐 tab 首屏目录加载失败的页面内失败态（文案 + 「重试」）与防重复；**后端零改动**；`utils/error-copy.ts` 与 `core/transport` 零改动（REST 失败归一链路 1.2 已就绪）
- 裁定记录（Ly）：① 失败态做成页面局部组件 `pages/home/components/load-failure/`（1A，P1 AD-5「先放页面目录」）；② 文案只显示 `errorCopy` 结果、不加场景前缀（2A）；③ 首次加载等待期不加 loading 占位（3A，严格最小 UI 规范）

### 交付物

| 类别 | 内容 |
| --- | --- |
| 新增（客户端） | `pages/home/components/load-failure/index.vue`：纯展示失败态（`message` / `loading` props + `retry` 事件）；形态 = 文案 + 「重试」按钮（loading + 禁用） |
| 修改（客户端） | `pages/home/composables/use-products.ts`：失败时经 `isAppError` + `errorCopy` 产出文案（全客户端唯一翻译）；`loading` in-flight 守卫；「清错误」从加载开始移到成功分支（重试期间失败态常驻、按钮呈 loading）；空文案 / 未知异常兜底 |
| 修改（客户端） | `pages/home/index.vue`：点餐区条件渲染——`productsError && categories 为空` → 失败态，否则双栏目录；重试复用 `init()`（成功后重算双栏位置与底部留白） |
| 未改动 | `utils/error-copy.ts`、`core/transport`、`api/catalog.ts`、后端；订单 tab、结算栏分包、确认订单页 |

### 行为设计落点

- **失败**：错误经 transport 归一 → Composable 用 `isAppError` + `errorCopy` 翻译 → `error` 置文案、分类保持空 → 页面渲染失败态；不渲染半截目录、不弹 toast、不写存储。
- **重试**：失败态保持可见（错误不清）、按钮 loading/禁用；`loadCategories` 内 in-flight 守卫再兜一层，不产生并发请求。
- **成功**：清 `error` → 完整目录挂载 → `init()` 的延时测量重算双栏位置。
- **类别 → 文案**（均由既有链路产出，未新增映射）：网络不可达 → `client.network_unreachable`「网络不可用，请检查网络后重试」；超时 → `client.timeout`「请求超时，请重试」；5xx → `order.unknown`「操作失败，请稍后重试」（REST 无独立域，1.2 裁定）。
- **兜底**：空文案（`request_cancelled` 不展示）与非 `AppError` 异常用「加载失败，请重试」，保证失败态始终可渲染；目录请求当前没有取消入口，属防御分支。

### 验收点与证据

| Story 2.2 验收点 | 证据 |
| --- | --- |
| 失败态：文案来自 `utils/error-copy.ts`（按类别）+「重试」入口；不白屏、不渲染半截目录、不写本地缓存 | `use-products.ts` 失败分支：`isAppError(err) ? errorCopy(err) : ''`（第 53 行）→ 失败文案入 `error`；`grep -rn "errorCopy(" src`：目录链路唯一调用点即此处（另有 `auth-check` 临时页）。页面 wxml：`load-failure wx:if="{{e}}" bindretry="{{f}}"` + 目录区 `wx:else`（失败时不渲染目录）。目录链路（`use-products.ts` / `api/catalog.ts` / `core/transport` / 组件）`grep "showToast\|setStorageSync"` 无命中——不弹提示、不写缓存 |
| 重试成功后恢复完整目录 | 重试按钮绑定页面 `initProducts`（`use-products.init()`）→ 成功后清 `error`、分类整体渲染并重算双栏位置；运行时复验见手动 #3 |
| 重试进行中按钮禁用 / loading，防重复提交 | `load-failure` 的 `t-button :loading="loading" :disabled="loading"`；`loadCategories` 开头 `if (loading.value) return`；成功才清错误 → 重试期间失败态与 loading 同时可见（不会闪回空目录）；运行时复验见手动 #2 |
| 失败文案不含内部堆栈 / 数据库细节 / 密钥；同一失败只提示一次 | 文案全部出自 `error-copy.ts` 的域表（1.2 已单测断言无敏感信息），兜底串为固定文案；页面级失败态为持续呈现、不经 toast，单次失败只出现一处提示 |
| 客户端全量编译与构建 | `pnpm type-check` 0 错误；`pnpm lint` 0 错误 / 0 警告；`pnpm format` 仅格式化新增组件；`pnpm build:mp-weixin` → `Build complete.`；产物含 `pages/home/components/load-failure/*`，`use-products.js` 含 `errorCopy` / `isAppError` / 兜底串 |
| 单元测试全绿（既有不回归） | `pnpm test`：5 个文件 62 项全过；REST 5xx → `order.unknown` 由既有 `normalize.test.ts` 覆盖（未新增测试） |

### 手动验证结果（2026-09-27 演示者执行）

前置：本地栈在跑（`supabase start`）、`mp/.env.local` 指向本地栈、开发者工具已勾选「不校验合法域名」；建议先「清缓存并重启」。

| # | 操作 | 预期 | 结果 |
| --- | --- | --- | --- |
| 1 | `supabase stop` → 清缓存重启 → 进点餐 tab | 出现失败态：「网络不可用，请检查网络后重试」+「重试」；不白屏、无全局提示；顶部 tab 正常，订单 tab 仍可用 | 通过 |
| 2 | 停栈状态下点「重试」 | 按钮 loading 且不可点；网络面板每次重试只发一条 `/rest/v1/menu`，无并发重复请求 | 通过 |
| 3 | `supabase start` → 点「重试」 | 失败态消失、完整目录回来（16 分类）；双栏联动与 2.1 验收一致 | 通过 |
| 4 | 超时文案：停栈后运行 `node -e "require('net').createServer(()=>{}).listen(54321)"` → 重启 | 约 10 秒后出现「请求超时，请重试」；验证后关掉该 node 进程 | 通过 |
| 5 | 回归：正常后端下完整走一遍点餐主流程（分类 / 规格 / 计价 / 加购 / 结算栏） | 与 Story 2.1 验收一致，无新增异常 | 通过 |

> 2026-09-27 由演示者在微信开发者工具按上表执行，5 项全部通过（含超时文案）。

### 有意偏差与遗留

1. **首次加载等待期不加 loading 占位**（3A）：后端超时场景需等约 10 秒才出失败态，期间目录区为空；属最小 UI 规范之外的界面增量，后续需要再评估。
2. **兜底文案「加载失败，请重试」**：用于空文案（`request_cancelled`）与非 `AppError` 异常两个防御分支；目录请求当前没有取消入口，正常路径不会出现。
3. **确认订单页门店读取失败**仍是 2.1 的静默兜底（失败态收口在 Epic 4；确认订单页不在本 story 场景清单内）。
4. **订单 tab 的失败态与空态**属 Epic 4（Story 4.1）；`load-failure` 组件先放页面目录，届时同页（订单 tab）可直接复用。
5. **REST 5xx 文案沿用订单域 `unknown`**（「操作失败，请稍后重试」），若演示体验不合适再评估（与 2.1 遗留一致）。

> 2026-09-27 范围修订：加载态（骨架 / 全屏遮罩）经 Ly 裁定纳入 Phase 3 界面增量（见 spine 修订记录）；本段遗留第 1 条（首次加载不加 loading 占位）由此关闭——目录骨架随 Story 4.1、确认订单页遮罩随 Story 3.5、订单详情遮罩随 Story 4.2 落地，Story 4.8 矩阵补复验项。

## Story 2.3 存量清理收口（目录侧）

- 日期：2026-09-27
- 环境：本地 Supabase 栈（CLI 2.117.0 / Postgres 17）；mp 侧 `pnpm type-check`（vue-tsc 3.3.6）、`pnpm lint`、`pnpm test`（vitest 3.2.7）、`pnpm build:mp-weixin`
- 范围：Mock 目录 / 门店数据源与旧目录实现彻底删除、Phase 2 验证入口移除、`pages.json` 首页切换；客户端零新增功能、后端零改动（仅 seed 注释）；订单侧 Mock（`api/orders.ts` / `mock/orders.ts`）按 AC 保留给 Epic 4
- 裁定记录（Ly）：① 数据库重建跑完整 `rebuild.sh`（接受本地库与 Storage 卷清空、演示图片重建后重传；顺带关闭 1.1 遗留的 test db 环境失败）（1A）；② `mock/orders.ts` 门店快照内联常量解耦（2A）；③ `core/session/README.md` 手动验证表改写为首页启动自然路径、并发单飞与文案自检两行退役（3A）；④ 「全仓无 Mock 引用」按代码 + 活文档口径（历史验收 / 审计 / 规划文档保留原文）（4A）；⑤ 重建后「会话不受影响」按全清客户端缓存后的冷启动观察，`weorder_session` 保留性由 1.4 手动 #1 承担（5A）

### 交付物

| 类别 | 内容 |
| --- | --- |
| 删除（客户端） | `src/mock/products.ts`、`src/mock/store.ts`、`src/api/products.ts`、`src/api/store.ts`、`src/pages/auth-check/`（页面 + composable 共 2 文件） |
| 修改（客户端） | `pages.json`：移除验证页声明；`pages/home/index` 提为第一项（启动页） |
| 修改（客户端） | `mock/orders.ts`：门店快照内联常量（不再引用门店 Mock 模块）、注释去掉已删文件引用 |
| 修改（注释） | `api/catalog.ts`（数据源唯一性）、`api/auth.ts`（去掉验证页）、`sub-order-detail/order-detail/index.vue`（门店信息来自订单快照） |
| 修改（文档） | `core/session/README.md` 手动验证表：入口改首页启动自然路径；步骤 4 / 11 退役（单测 + Story 4.8 矩阵 #3 复验） |
| 修改（supabase） | `seed.sql` 来源注释；`scripts/verify-two-identities.ts` 前置注释 / USAGE / 报错文案（user id 改从 Studio → Authentication → Users 获取） |
| 未改动 | `api/orders.ts`、`mock/orders.ts` 本体（Epic 4 收口）、`core/**`、`utils/error-copy.ts`、后端代码与迁移；目录链路零依赖订单侧 Mock |

### 验收点与证据

| Story 2.3 验收点 | 证据 |
| --- | --- |
| 删除清单完成、`pages.json` 首页切换 | `git status`：4 个文件 + 1 个页面目录删除；`pages.json` 的 `pages` 唯一项 `pages/home/index`；构建产物 `app.json` 的 `pages[0]` = `pages/home/index`、`pages/` 目录仅 `home` |
| 全仓无 Mock 目录 / 门店数据引用；无并存开关 / 回退路径 | `grep -rn "mock/products\|mock/store\|api/products\|api/store" mp/src supabase/scripts supabase/seed.sql` → 0；`grep -rn "useMock\|mockEnabled\|isMock" mp/src` → 0；`grep -rn "@/mock/" mp/src` → 仅 `api/orders.ts`（Epic 4 保留项，目录链路不引用）；全仓（排除历史文档）残留 → 0 |
| `pages/auth-check/` 移除且不可达 | `grep -rn "auth-check" mp/src supabase/scripts` → 0；构建产物 `pages/` 仅 `home`、特征串「身份链路验证」0 命中 |
| 旧实现不再进包 | 产物 `api/` 仅 `auth/cart/catalog/orders/storage`；`mock/` 仅 `orders.js`；Mock 目录特征串（`section-coffee` / `prod-001`）0 命中；`api/catalog.js` 含 `/rest/v1/menu`、`/rest/v1/stores`、`product-images` |
| 订单侧 Mock 保留且目录不依赖 | `api/orders.ts` 仍 import `@/mock/orders`（未改动）；`api/catalog.ts` 零 Mock 依赖；订单 tab 行为见手动 #3 |
| 本地库可整体清空并由迁移 + seed 重建；重建后目录立即可读 | `bash scripts/rebuild.sh` 四步全部成功（停栈删卷 → 启动自动应用迁移 + seed → `db reset` 再应用 20 个迁移 + seed → `test db`）；重建后 `supabase test db` = 19 文件 / 623 项 PASS（关闭 1.1 遗留的 `40_menu_view` 环境失败）；匿名 curl `/rest/v1/menu` 16 分类 / 50 商品（含 `sold_out`）、`/rest/v1/stores` 1 行，均只带 `apikey`；`deno task verify:rebuild` 24 项断言 PASS（匿名目录与门店 → 登录 → 下单 202609272252115028 → 列表 / 详情 → 他人不可见）；`deno task verify:login` 通过（重建后登录 / 续期 / 自愈链路可用） |
| 「会话不受影响」观察口径 | 按 5A：全清客户端缓存后冷启动，以「静默登录重建身份 + 目录匿名可读」为现场证据（手动 #1）；`weorder_session` 的存储保留性由 1.4 手动 #1 承担（本 story 不重复观察，见遗留 #2） |
| 新增 / 移动文件满足 P1 AD-9 | 本 story 无新增文件；删除均在主包目录树（`src/mock`、`src/api`、`src/pages/auth-check`）；`pages.json` 仅主包页面调整，分包声明未动 |
| 客户端全量编译与构建 | `pnpm type-check` 0 错误；`pnpm lint` 0 错误 / 0 警告；`pnpm format` 仅重排本次改动文件；`pnpm build:mp-weixin` → `Build complete.` |
| 单元测试全绿（既有不回归） | `pnpm test`：5 个文件 62 项全过（未新增 / 删除测试） |

### 手动验证结果（2026-09-27 演示者执行）

前置：本地栈在跑（已完成重建）、`mp/.env.local` 指向本地栈、开发者工具勾选「不校验合法域名」、用最新代码编译；按惯例清空全部缓存（含 `weorder_session`）。

| # | 操作 | 预期 | 结果 |
| --- | --- | --- | --- |
| 1 | 清全部缓存 → 重新编译冷启动 | 直接落点餐首页；`wechat-login` 与 `/rest/v1/menu` 并行，menu 只带 `apikey`、不等待登录；无授权弹窗、无全局提示（关闭 2.1 遗留 #7 的自然路径复验） | 通过 |
| 2 | 侧边栏切分类、规格弹窗改选项、加购；首次加购看结算栏 | 双栏联动 / 实时计价 / 分包按需加载与 2.1 验收一致（重建后图片为色块，预期） | 通过 |
| 3 | 切到订单 tab，打开一张 Mock 订单详情 | 5 条预置单三态展示、可进详情，行为与之前一致（Epic 4 前预期） | 通过 |
| 4 | 确认无「身份链路验证」入口 | 编译产物只有点餐页，无验证页入口 | 通过 |
| 5（可选） | Storage 预置三键哨兵 + `weorder_schema_version=2` → 重启 | 三键被清（`weorder_orders` 随即被订单 Mock 回填，预期）、`version=3`、`weorder_session` 保留；跳过时以 1.4 记录为准 | 通过 |

> 2026-09-27 由演示者在微信开发者工具按上表执行，5 项全部通过（冷启动落首页且登录与目录并行、目录交互与结算栏回归、订单 Mock 行为不变、验证页入口消失、存量清理 gate 复验）。

### 有意偏差与遗留

1. **`weorder_orders` 的 Mock 回填提前到冷启动**：home 成为启动页后，首页 `onShow` 的 `initOrders()` 会在每次冷启动即写入 5 条 Mock 订单（原行为是进入订单 tab 才写）。属订单侧 Mock 的既知行为（1.4 遗留 #2 的触发点变化），Epic 4 切换真实订单后消失；存量清理 gate 仍先于页面执行（1.4 已验）。
2. **`weorder_session` 保留性不在本 story 重复观察**（5A）：全清客户端缓存后冷启动以「静默登录重建身份 + 目录匿名可读」为现场证据；存储保留性由 1.4 手动 #1 承担。
3. **演示图片随 Storage 卷清空**：重建后需重新上传并回填 `products.image_path`（图片素材不属本 story 交付，见 2.1 遗留 #4）。
4. **并发单飞 / 文案自检入口退役**：原验证页按钮随页面删除，端到端复验定位到 Story 4.8 矩阵 #3 与 `session.test.ts` / `error-copy.test.ts` 单测。
