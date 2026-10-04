-- 演示参数：扫描周期 15 秒 → 3 秒（Story 4.4；FR-P3-13；AR-P3-21 / AD-16）
--
-- 两条参数、两类载体（AD-16）：门店行管「出餐节奏」——推进 15s / 催单提前 3s / 自动完成 30s
-- （默认值见 20260921193022_create_order.sql 与 20260923030954_complete_order_auto_complete.sql），
-- cron 声明管「多久巡一遍库」。本轮只调整后者：由 15s 调小为 3s，兑现催单后 3~6 秒的状态推进
-- （客户端轮询另有读时推进；订阅路径的事件延迟由本周期决定，Epic 5）。
--
-- 同名替换（AD-17）：cron.schedule 对已存在的任务名是「更新」而不是「新增」，
-- 干净重建（db reset 重放全部迁移）与既有环境（migration up）都不会留下第二个扫描任务；
-- 任务命令与机制不动（advance_due_orders + complete_due_orders 一条语句两个机制，AD-6/AD-13）。
--
-- 注意：migration squash 会丢弃 cron 任务，使用前须知会丢什么（AR-6）。

select cron.schedule(
  'order-sweep',
  '3 seconds',
  'select public.advance_due_orders(), public.complete_due_orders()'
);
