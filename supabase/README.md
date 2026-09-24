# supabase

We-Order 的 Supabase 子项目：数据库结构（迁移）、目录种子、微信登录边缘函数、数据库测试与本地链路验证脚本。

**Phase 2 全程在本地 Docker 栈运行，不部署云端**（原「本地与云端一致」的验收改为「同一批声明在两次从零重建上一致」；图片对象入仓不在本阶段交付）。两项范围偏移的事实与证据见 `tests/README.md` 的 Story 5.4 验收记录。

## 目录

| 路径 | 用途 |
| --- | --- |
| `config.toml` | 本地栈配置（端口、Postgres 大版本、关闭登录函数的前置 JWT 校验） |
| `migrations/` | 全部结构变更：表、策略、函数、桶、`cron.schedule`（AD-17） |
| `seed.sql` | 目录种子数据（门店、分类、商品、规格）；不含订单 |
| `functions/wechat-login/` | 唯一边缘函数：code2Session → 身份映射 → 签发平台会话 |
| `functions/tests/` | 边缘函数的离线单元测试与本地链路验证说明 |
| `scripts/` | 重建脚本与跨事务/并发的人工验证脚本 |
| `tests/` | pgTAP 数据库测试与各 Story 验收记录 |
| `types/` | 由数据库结构生成的 TypeScript 类型（唯一一份，不手工编辑） |

## 前置条件

- **Docker**：本地栈与数据库测试的前提（AR-3、AR-19）。
- **Supabase CLI**（跟随最新）：`start` / `db reset` / `test db` / `gen types`。
- **Deno**：只给本地链路验证脚本（`deno task verify:*`）用，跑数据库测试不需要。

## 常用命令

```bash
cd supabase

supabase start          # 启动本地栈（首次启动自动应用迁移 + 种子）
supabase status         # 查看 API URL 与密钥
supabase stop           # 停止（保留数据卷）

supabase db reset       # 重建数据库：重放全部迁移 + 重新灌种子；会清空本地数据
supabase test db        # 一条命令跑全部数据库测试（pgTAP）

supabase gen types typescript --local > types/database.types.ts   # 重新生成类型
```

## 干净重建（一条命令）

```bash
cd supabase
bash scripts/rebuild.sh
```

脚本按四步执行：删除全部数据卷（真·干净环境）→ 启动本地栈 → `db reset`（迁移 + 种子）→ `test db`。
之后跑重建后端到端验证（需要 Deno）：

```bash
deno task verify:login      # 登录链路：并发首登收敛、重登复用、续期、单次消费
deno task verify:rebuild    # 重建现场：匿名读目录/门店 → 登录 → 下单 → 列表与详情 → 他人不可见
```

等价的纯手动步骤（不跑脚本时）：

```bash
supabase stop --no-backup   # 删除全部数据卷
supabase start
supabase db reset
supabase test db
```

## 本地链路验证脚本

并发与跨事务的时间行为进不了 pgTAP（事务里 `now()` 固定），按 FR-P2-19 以「实现方式说明 + 人工验证记录」为证据：

| task | 覆盖 |
| --- | --- |
| `deno task verify:login` | 并发首登收敛、重登复用、映射丢失自愈、平台会话与续期、一次性令牌单次消费 |
| `deno task verify:rebuild` | Story 5.4：干净重建后匿名读目录/门店、登录、下单、订单列表与详情、他人不可见 |
| `deno task verify:two-identities` | Story 5.5：真机登录出来的两个真实身份互相看不到对方的订单（需先在真机登录并传入两个用户 id） |
| `deno task verify:idempotency` | 同一幂等标识的并发重复提交只落一张订单 |
| `deno task verify:sweep` | 无人读取时订单被周期兜底扫描推进 |
| `deno task verify:urge` | 催单提前推进时刻、min 语义、并发重复催单幂等 |
| `deno task verify:pickup-codes` | 并发下单拿到互不相同的取杯号 |
| `deno task verify:complete` | 确认取杯与超时自动完成、并发确认完成时间只写一次 |
| `deno task verify:state-machine` | 催单/确认/兜底与推进的真并发竞态 |

各脚本的覆盖细节与历史验证记录见 `tests/README.md`。

## 已知范围偏移（Phase 2）

- **不上云**：本阶段没有任何云端实例。登录函数、Storage、Cron 兜底扫描都在本地栈运行；真机联调走同一局域网直连本地栈（`mp/.env.local`）。将来上云时同一批声明可直接推送，结构一致性以迁移列表对照为证据。
- **图片对象入仓不交付**：公开读桶与读取策略已交付并测试（`tests/database/30_storage.test.sql`）；图片对象入仓经 ly 裁定不在本阶段交付，商品 `image_path` 保持为空，上传路径留待 Phase 4。此前的手动上传验证由 ly 人工完成，仓库内没有可复现证据。

## 坑

- `migration squash` 会**丢弃 cron 任务与桶**：使用前须知会丢什么，重建后要确认 `order-sweep` 任务与 `product-images` 桶回来了（AR-6）。
- 密钥不入仓：`functions/.env` 从 `functions/.env.example` 复制后填写（已被 gitignore）；仓库内不得出现 AppSecret 与服务端密钥。
- 不要手工删除 `pickup_code_counters` 的行：它是「下一个取杯号」的唯一来源，删掉会让之后每一次发号都撞上已存在的号（见 `tests/README.md`）。
- `supabase stop`（不带 `--no-backup`）保留数据卷；只有 `--no-backup` 才是从零重建。
