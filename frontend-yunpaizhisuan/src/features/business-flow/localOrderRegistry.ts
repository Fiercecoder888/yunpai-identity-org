import { chatStorageKey } from '../../services/chatStorageScope';

/** 遗留的全局键名；实际读写都过 `chatStorageKey()` 落到当前登录用户的命名空间。 */
export const LOCAL_ORDER_REGISTRY_KEY = 'yunpai.local-agent-orders';

export type LocalOrderRecord = {
  orderId: string;
  filename?: string;
  productName?: string;
  quantity?: number;
  dueDate?: string;
  conversationId?: string;
  updatedAt: string;
};

const readRaw = (): LocalOrderRecord[] => {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(chatStorageKey(LOCAL_ORDER_REGISTRY_KEY)) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is LocalOrderRecord => Boolean(item && typeof item === 'object' && typeof (item as LocalOrderRecord).orderId === 'string'));
  } catch {
    return [];
  }
};

export const readLocalOrders = () => readRaw();

export const rememberLocalOrder = (record: Omit<LocalOrderRecord, 'updatedAt'>) => {
  const next: LocalOrderRecord = { ...record, updatedAt: new Date().toISOString() };
  const existing = readRaw().filter((item) => item.orderId !== next.orderId);
  try {
    globalThis.localStorage?.setItem(chatStorageKey(LOCAL_ORDER_REGISTRY_KEY), JSON.stringify([next, ...existing].slice(0, 200)));
  } catch {
    // A browser storage failure must not block the Agent request.
  }
  return next;
};

export const removeLocalOrder = (orderId: string) => {
  const existing = readRaw().filter((item) => item.orderId !== orderId);
  try {
    globalThis.localStorage?.setItem(chatStorageKey(LOCAL_ORDER_REGISTRY_KEY), JSON.stringify(existing));
  } catch {
    // Storage failure must not block the UI; the in-memory list refresh still applies.
  }
  return existing;
};
