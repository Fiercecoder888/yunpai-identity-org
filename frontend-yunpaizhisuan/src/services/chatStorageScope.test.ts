import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_ORDER_REGISTRY_KEY, readLocalOrders, rememberLocalOrder } from '../features/business-flow/localOrderRegistry';
import {
  CHAT_STORAGE_KEYS,
  chatStorageKey,
  clearScopedChatStorage,
  getChatStorageScope,
  onChatStorageScopeChange,
  setChatStorageScope,
} from './chatStorageScope';

const CONVERSATIONS_KEY = 'yunpai.local-agent-conversations';
const MESSAGE_SETS_KEY = 'yunpai.local-agent-message-sets';
const LAST_CONVERSATION_KEY = 'yunpai.chat.last-conversation-id';

describe('chatStorageScope', () => {
  afterEach(() => setChatStorageScope(null));

  it('keeps the legacy global keys when there is no signed-in user', () => {
    setChatStorageScope(null);

    expect(getChatStorageScope()).toBeUndefined();
    expect(chatStorageKey(CONVERSATIONS_KEY)).toBe(CONVERSATIONS_KEY);
    expect(chatStorageKey(MESSAGE_SETS_KEY)).toBe(MESSAGE_SETS_KEY);
    expect(chatStorageKey(LAST_CONVERSATION_KEY)).toBe(LAST_CONVERSATION_KEY);
  });

  it('namespaces the three chat keys by tenant and user', () => {
    setChatStorageScope({ tenantId: 'default', userId: 'boss' });

    expect(chatStorageKey(CONVERSATIONS_KEY)).toBe('yunpai.default:boss.local-agent-conversations');
    expect(chatStorageKey(MESSAGE_SETS_KEY)).toBe('yunpai.default:boss.local-agent-message-sets');
    expect(chatStorageKey(LAST_CONVERSATION_KEY)).toBe('yunpai.default:boss.chat.last-conversation-id');
    expect(CHAT_STORAGE_KEYS).toEqual([CONVERSATIONS_KEY, MESSAGE_SETS_KEY, LAST_CONVERSATION_KEY]);
  });

  it('falls back to the default tenant when the tenant id is missing', () => {
    setChatStorageScope({ userId: 'worker001' });

    expect(chatStorageKey(CONVERSATIONS_KEY)).toBe('yunpai.default:worker001.local-agent-conversations');
  });

  it('treats a blank user id as "no user" so demo mode keeps the global keys', () => {
    setChatStorageScope({ tenantId: 'default', userId: '   ' });

    expect(chatStorageKey(CONVERSATIONS_KEY)).toBe(CONVERSATIONS_KEY);
  });

  it('sanitizes separators so ids cannot break the key layout', () => {
    setChatStorageScope({ tenantId: 'tenant a', userId: 'worker:001' });

    expect(chatStorageKey(CONVERSATIONS_KEY)).toBe('yunpai.tenant_a:worker_001.local-agent-conversations');
  });

  it('notifies listeners only when the namespace actually changes', () => {
    const listener = vi.fn();
    const unsubscribe = onChatStorageScopeChange(listener);

    setChatStorageScope({ tenantId: 'default', userId: 'boss' });
    setChatStorageScope({ tenantId: 'default', userId: 'boss' });
    setChatStorageScope({ tenantId: 'default', userId: 'worker001' });
    setChatStorageScope(null);

    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    setChatStorageScope({ tenantId: 'default', userId: 'boss' });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('clears only the current user namespace', () => {
    setChatStorageScope({ tenantId: 'default', userId: 'boss' });
    for (const key of CHAT_STORAGE_KEYS) localStorage.setItem(chatStorageKey(key), 'boss-data');

    setChatStorageScope({ tenantId: 'default', userId: 'worker001' });
    for (const key of CHAT_STORAGE_KEYS) localStorage.setItem(chatStorageKey(key), 'worker-data');
    localStorage.setItem(CONVERSATIONS_KEY, 'legacy-demo-data');

    setChatStorageScope({ tenantId: 'default', userId: 'boss' });
    clearScopedChatStorage();

    for (const key of CHAT_STORAGE_KEYS) {
      expect(localStorage.getItem(chatStorageKey(key))).toBeNull();
    }
    setChatStorageScope({ tenantId: 'default', userId: 'worker001' });
    for (const key of CHAT_STORAGE_KEYS) {
      expect(localStorage.getItem(chatStorageKey(key))).toBe('worker-data');
    }
    // 无用户时的全局键也不属于任何登录用户，不能被顺手清掉。
    expect(localStorage.getItem(CONVERSATIONS_KEY)).toBe('legacy-demo-data');
  });

  it('namespaces the order-management registry so another user cannot see the orders', () => {
    setChatStorageScope({ tenantId: 'default', userId: 'boss' });
    rememberLocalOrder({ orderId: 'PO-20260909-001', filename: '厂长订单.xlsx' });

    expect(localStorage.getItem('yunpai.default:boss.local-agent-orders')).toContain('PO-20260909-001');
    expect(localStorage.getItem(LOCAL_ORDER_REGISTRY_KEY)).toBeNull();

    setChatStorageScope({ tenantId: 'default', userId: 'worker001' });
    expect(readLocalOrders()).toEqual([]);

    setChatStorageScope({ tenantId: 'default', userId: 'boss' });
    expect(readLocalOrders().map((item) => item.orderId)).toEqual(['PO-20260909-001']);
  });
});
