-- 错误类别：追加 unknown（P3 Story 1.2；FR-P3-18；AD-6）
-- 用途：客户端归一表把「未知服务端类别」收敛到 order.unknown，避免未知类别导致白屏：
-- RPC 的 P0001 message 不在类别域、42501（权限拒绝）、pay-order 返回未知 code 都走兜底。
-- 服务端内部故障也可显式使用该类别；类别是稳定契约、文案不是（AD-12）。
-- 取值集合仍只有这一处来源；客户端文案由 utils/error-copy.ts 按域穷尽翻译。
-- 备注：原生计划随 Story 3.1 的权限迁移落地，经裁定提前到 Story 1.2（客户端错误归一的前置）。

alter type public.order_error_code add value if not exists 'unknown';

comment on type public.order_error_code is
  '下单与订单操作的失败类别；类别是稳定契约、文案不是（AD-12）；invalid_transition = 不存在的状态迁移；order_not_found = 订单不存在或不属于调用者（两种情况的同一结果，不泄露存在性）；invalid_status = 本人的单但当前状态不允许该操作；unknown = 未归类的失败（客户端兜底）';
