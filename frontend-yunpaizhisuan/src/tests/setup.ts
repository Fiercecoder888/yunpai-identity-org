import '@testing-library/jest-dom/vitest';
import React, { type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { resetMockAuditLogs, resetMockBusinessFlows, resetMockM4State, resetMockNotifications, resetMockTaskState } from '../mocks/handlers';
import { resetServerMockScenario, server } from '../mocks/server';
import { useChatStore } from '../store/useChatStore';
import { useWorkbenchStore } from '../store/useWorkbenchStore';
import { useNotificationStore } from '../features/notifications/useNotificationStore';
import { setChatStorageScope } from '../services/chatStorageScope';

type BubbleListItem = {
  key: string;
  content?: ReactNode;
  loading?: boolean;
};

type SenderMockProps = {
  className?: string;
  value?: string;
  loading?: boolean;
  placeholder?: string;
  prefix?: ReactNode;
  onChange?: (value: string, event?: ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit?: (value: string) => void;
};

type ConversationItem = {
  key: string;
  label?: ReactNode;
};

type ConversationsMockProps = {
  items?: ConversationItem[];
  activeKey?: string;
  onActiveChange?: (key: string) => void;
};

vi.mock('@ant-design/x/lib', () => {
  const Bubble = Object.assign(
    ({ content, loading }: { content?: ReactNode; loading?: boolean }) => React.createElement('div', null, loading ? '生成中...' : content),
    {
      List: ({ items = [] }: { items?: BubbleListItem[] }) =>
        React.createElement(
          'div',
          null,
          items.map((item) => React.createElement('div', { key: item.key }, item.loading ? '生成中...' : item.content)),
        ),
    },
  );

  const Conversations = ({ items = [], activeKey, onActiveChange }: ConversationsMockProps) =>
    React.createElement(
      'ul',
      null,
      items.map((item) =>
        React.createElement(
          'li',
          { key: item.key },
          React.createElement(
            'button',
            {
              type: 'button',
              'aria-pressed': activeKey === item.key,
              onClick: () => onActiveChange?.(item.key),
            },
            item.label,
          ),
        ),
      ),
    );

  const Sender = ({ className, value = '', loading, placeholder, prefix, onChange, onSubmit }: SenderMockProps) =>
    React.createElement(
      'div',
      className ? { className } : null,
      prefix ? React.createElement('div', { className: 'ant-sender-prefix' }, prefix) : null,
      React.createElement('textarea', {
        value,
        placeholder,
        onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onChange?.(event.target.value, event),
        onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onSubmit?.(value);
          }
        },
      }),
      React.createElement(
        'button',
        {
          type: 'button',
          disabled: loading,
          onClick: () => onSubmit?.(value),
        },
        '发送',
      ),
    );

  return { Bubble, Conversations, Sender };
});

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  resetServerMockScenario();
  resetMockAuditLogs();
  resetMockM4State();
  resetMockBusinessFlows();
  resetMockNotifications();
  resetMockTaskState();
  useChatStore.getState().resetChat();
  // 聊天本地存储命名空间跟着登录身份走；用例之间必须复位，避免串号。
  setChatStorageScope(null);
  useWorkbenchStore.getState().resetWorkbench();
  useNotificationStore.getState().resetNotifications();
  window.localStorage.clear();
});
afterAll(() => server.close());

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: ResizeObserverMock,
});

Object.defineProperty(globalThis, 'ResizeObserver', {
  writable: true,
  value: ResizeObserverMock,
});

const originalGetComputedStyle = window.getComputedStyle.bind(window);

Object.defineProperty(window, 'getComputedStyle', {
  writable: true,
  value: ((element: Element) => originalGetComputedStyle(element)) as typeof window.getComputedStyle,
});

// jsdom 无真实 canvas 2d 上下文；静默返回 null，避免 ECharts/zrender
// 触发 "Not implemented" 的 stderr 噪音，图表组件据此降级为空容器。
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  writable: true,
  value: () => null,
});
