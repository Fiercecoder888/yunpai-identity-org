import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createChatConversation,
  deleteChatConversation,
  listChatConversations,
  saveLocalConversationSummary,
} from './chatApi';
import { chatStorageKey, setChatStorageScope } from './chatStorageScope';

const CONVERSATIONS_KEY = 'yunpai.local-agent-conversations';

/**
 * 本地（VITE_LOCAL_LANGGRAPH）模式下会话列表存在浏览器里：
 * 同一台电脑换账号登录时，每个用户只能看到自己的会话。
 */
describe('local conversation storage isolation', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_LOCAL_LANGGRAPH', 'true');
    localStorage.clear();
  });

  afterEach(() => {
    setChatStorageScope(null);
    vi.unstubAllEnvs();
  });

  it('keeps each user conversations in their own namespace', async () => {
    setChatStorageScope({ tenantId: 'default', userId: 'boss' });
    const bossConversation = await createChatConversation('厂长的会话');

    expect((await listChatConversations()).items.map((item) => item.id)).toEqual([bossConversation.id]);
    expect(localStorage.getItem(chatStorageKey(CONVERSATIONS_KEY))).toContain(bossConversation.id);
    // 没有用户命名空间时不得写入全局键（否则换账号又会串号）。
    expect(localStorage.getItem(CONVERSATIONS_KEY)).toBeNull();

    setChatStorageScope({ tenantId: 'default', userId: 'worker001' });
    expect((await listChatConversations()).items).toEqual([]);
    const workerConversation = await createChatConversation('工人的会话');
    expect((await listChatConversations()).items.map((item) => item.id)).toEqual([workerConversation.id]);

    // 切回厂长：自己的会话还在，别人的不在（数据没有被删也没有被合并）。
    setChatStorageScope({ tenantId: 'default', userId: 'boss' });
    expect((await listChatConversations()).items.map((item) => item.id)).toEqual([bossConversation.id]);

    setChatStorageScope({ tenantId: 'default', userId: 'worker001' });
    expect((await listChatConversations()).items.map((item) => item.id)).toEqual([workerConversation.id]);
  });

  it('scopes rename summaries and deletes to the current user', async () => {
    setChatStorageScope({ tenantId: 'default', userId: 'boss' });
    const bossConversation = await createChatConversation('新对话');
    expect(saveLocalConversationSummary(bossConversation.id, '厂长改的标题')?.title).toBe('厂长改的标题');

    setChatStorageScope({ tenantId: 'default', userId: 'worker001' });
    // 工人删不掉、也改不动厂长命名空间里的会话。
    expect(saveLocalConversationSummary(bossConversation.id, '工人改的标题')).toBeUndefined();
    await deleteChatConversation(bossConversation.id, 1);

    setChatStorageScope({ tenantId: 'default', userId: 'boss' });
    expect((await listChatConversations()).items).toMatchObject([{ id: bossConversation.id, title: '厂长改的标题' }]);
  });

  it('falls back to the global keys without a signed-in user', async () => {
    setChatStorageScope(null);
    const conversation = await createChatConversation('演示会话');

    expect((await listChatConversations()).items.map((item) => item.id)).toEqual([conversation.id]);
    expect(localStorage.getItem(CONVERSATIONS_KEY)).toContain(conversation.id);
  });
});
