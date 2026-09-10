/**
 * 本地聊天存储的「租户 + 用户」命名空间。
 *
 * 背景：会话列表 / 消息体 / 最后会话 id 原先都写在浏览器 localStorage 的全局键里
 * （`yunpai.local-agent-conversations`、`yunpai.local-agent-message-sets`、
 * `yunpai.chat.last-conversation-id`），同一台电脑换账号登录（厂长 → 工人）时
 * 仍然能看到上一个人的会话与消息。
 *
 * 这里把这三个键改成按当前登录用户命名空间：
 *
 *   已登录用户：`yunpai.<tenant_id>:<user_id>.local-agent-conversations`
 *   没有用户  ：`yunpai.local-agent-conversations`  ← 未登录 / MSW 演示 / 本地 demo 回退
 *
 * 同一台电脑换账号后「订单管理」面板的本地订单记录（`yunpai.local-agent-orders`，
 * 见 `features/business-flow/localOrderRegistry.ts`）也走同一套命名空间。
 * 注意：订单记录**不**属于会话历史，`clearScopedChatStorage()` 只清 CHAT_STORAGE_KEYS，
 * 不会连带清掉订单（与既有「清空会话历史」语义一致）。
 *
 * 作用域由 `useAuthStore`（bootstrap / 登录成功 / refreshMe / logout）统一设置，
 * 其它模块只在读写时调用 `chatStorageKey(base)`，不要各自去读 auth store。
 * 无用户时 `chatStorageKey()` 原样返回传入的键，既有 demo 与测试不受影响。
 */

export type ChatStorageScope = { tenantId?: string | null; userId?: string | null };
export type ResolvedChatStorageScope = { tenantId: string; userId: string };

/** 没有 tenant_id 时的兜底租户（与后端 YUNPAI_DEFAULT_TENANT 一致）。 */
export const DEFAULT_CHAT_STORAGE_TENANT = 'default';

/** 会话相关的本地键（清空历史时只清这些，且只清当前命名空间）。 */
export const CHAT_STORAGE_KEYS = [
  'yunpai.local-agent-conversations',
  'yunpai.local-agent-message-sets',
  'yunpai.chat.last-conversation-id',
] as const;

const PREFIX = 'yunpai.';

let resolvedScope: ResolvedChatStorageScope | undefined;
const listeners = new Set<() => void>();

/** 用户 id / 租户 id 里的空白与 `:` 会破坏键结构，统一折成 `_`。 */
const normalize = (value?: string | null): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.replace(/[\s:]+/g, '_') : undefined;
};

const scopeKey = (scope: ResolvedChatStorageScope) => `${scope.tenantId}:${scope.userId}`;
const currentKey = () => (resolvedScope ? scopeKey(resolvedScope) : undefined);

/**
 * 设置（或清空）聊天本地存储的作用域。
 *
 * - `null` / 空 `userId` → 回退全局键（未登录、MSW 演示模式、本地 demo）。
 * - 命名空间发生变化时通知监听者（`useChatStore` 借此清掉内存里的上个账号会话）。
 */
export const setChatStorageScope = (scope: ChatStorageScope | null): void => {
  const userId = normalize(scope?.userId);
  const next = userId
    ? { tenantId: normalize(scope?.tenantId) ?? DEFAULT_CHAT_STORAGE_TENANT, userId }
    : undefined;
  const previous = currentKey();
  resolvedScope = next;
  if (previous === currentKey()) return;
  for (const listener of [...listeners]) listener();
};

export const getChatStorageScope = (): ResolvedChatStorageScope | undefined => resolvedScope;

/** 把遗留的全局键映射成当前用户的命名空间键；无用户时原样返回。 */
export const chatStorageKey = (base: string): string => {
  if (!resolvedScope) return base;
  const suffix = base.startsWith(PREFIX) ? base.slice(PREFIX.length) : base;
  return `${PREFIX}${scopeKey(resolvedScope)}.${suffix}`;
};

/** 订阅命名空间变化；返回取消订阅函数。 */
export const onChatStorageScopeChange = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * 只清当前用户命名空间里的会话数据（无用户时清全局键）。
 * 其它用户的命名空间保持不变——「清空会话历史」不能顺手清别人的。
 */
export const clearScopedChatStorage = (): void => {
  for (const base of CHAT_STORAGE_KEYS) globalThis.localStorage?.removeItem(chatStorageKey(base));
};
