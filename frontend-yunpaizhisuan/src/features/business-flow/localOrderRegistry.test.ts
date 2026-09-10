import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LOCAL_ORDER_REGISTRY_KEY, readLocalOrders, rememberLocalOrder, removeLocalOrder } from './localOrderRegistry';
import { chatStorageKey, setChatStorageScope } from '../../services/chatStorageScope';

const ORDER_A = { orderId: 'PO-20260909-001', filename: '厂长订单.xlsx', productName: 'W-H915', quantity: 10 };
const ORDER_B = { orderId: 'PO-20260909-002', filename: '工人订单.xlsx', productName: 'W-H915', quantity: 3 };

/**
 * 「订单管理」面板的本地订单记录也必须按用户隔离：
 * 同一台电脑换账号后，工人不能看到厂长的订单。
 */
describe('localOrderRegistry per-user isolation', () => {
  beforeEach(() => {
    localStorage.clear();
    setChatStorageScope(null);
  });

  afterEach(() => setChatStorageScope(null));

  it('keeps each user orders in their own namespace', () => {
    setChatStorageScope({ tenantId: 'default', userId: 'boss' });
    rememberLocalOrder(ORDER_A);

    expect(readLocalOrders().map((item) => item.orderId)).toEqual([ORDER_A.orderId]);
    expect(localStorage.getItem(chatStorageKey(LOCAL_ORDER_REGISTRY_KEY))).toContain(ORDER_A.orderId);
    // 没有用户命名空间时不得写入全局键（否则换账号又会串号）。
    expect(localStorage.getItem(LOCAL_ORDER_REGISTRY_KEY)).toBeNull();

    setChatStorageScope({ tenantId: 'default', userId: 'worker001' });
    expect(readLocalOrders()).toEqual([]);
    rememberLocalOrder(ORDER_B);
    expect(readLocalOrders().map((item) => item.orderId)).toEqual([ORDER_B.orderId]);

    // 切回厂长：自己的订单还在，别人的不在（数据没有被删也没有被合并）。
    setChatStorageScope({ tenantId: 'default', userId: 'boss' });
    expect(readLocalOrders().map((item) => item.orderId)).toEqual([ORDER_A.orderId]);

    setChatStorageScope({ tenantId: 'default', userId: 'worker001' });
    expect(readLocalOrders().map((item) => item.orderId)).toEqual([ORDER_B.orderId]);
  });

  it('does not let another user delete or overwrite an order', () => {
    setChatStorageScope({ tenantId: 'default', userId: 'boss' });
    rememberLocalOrder(ORDER_A);

    setChatStorageScope({ tenantId: 'default', userId: 'worker001' });
    expect(removeLocalOrder(ORDER_A.orderId)).toEqual([]);
    rememberLocalOrder({ ...ORDER_A, quantity: 999 });

    setChatStorageScope({ tenantId: 'default', userId: 'boss' });
    expect(readLocalOrders()).toEqual([expect.objectContaining({ orderId: ORDER_A.orderId, quantity: 10 })]);
  });

  it('falls back to the global key without a signed-in user', () => {
    setChatStorageScope(null);
    rememberLocalOrder(ORDER_A);

    expect(readLocalOrders().map((item) => item.orderId)).toEqual([ORDER_A.orderId]);
    expect(localStorage.getItem(LOCAL_ORDER_REGISTRY_KEY)).toContain(ORDER_A.orderId);
  });
});
