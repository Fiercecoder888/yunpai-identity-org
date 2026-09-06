import { useEffect, useRef, useState } from 'react';
import { requestJson } from '../../services/httpClient';
import { parseNotificationEvent, type NotificationEvent } from './notificationEvents';

export type NotificationTransportStatus = 'connecting' | 'connected' | 'polling' | 'error';

export type NotificationTransportOptions = {
  /** SSE 端点（后端未交付时 EventSource 尝试失败后自动降级轮询）。 */
  eventUrl?: string;
  /** 轮询端点。 */
  pollUrl?: string;
  pollIntervalMs?: number;
  enabled?: boolean;
};

export type NotificationTransportState = {
  events: NotificationEvent[];
  status: NotificationTransportStatus;
};

/**
 * 通知传输抽象：优先 EventSource，不可用/失败时降级为轮询。
 *
 * 契约说明：SSE 后端 not run；nginx 网关 server 级已配置 proxy_buffering off
 * 且 /api/orchestrator 带 X-Accel-Buffering "no"，前端 /api/ location 亦
 * proxy_buffering off，SSE 事件无需额外 nginx 改动即可流式透传。
 */
export function useNotificationTransport(
  options: NotificationTransportOptions = {},
): NotificationTransportState {
  const {
    eventUrl = '/api/notifications/events',
    pollUrl = '/api/notifications',
    pollIntervalMs = 15_000,
    enabled = true,
  } = options;
  const [state, setState] = useState<NotificationTransportState>({ events: [], status: 'connecting' });
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;

    const startPolling = async () => {
      setState((prev) => ({ ...prev, status: 'polling' }));
      const poll = async () => {
        try {
          const payload = await requestJson<unknown>(pollUrl);
          const record = payload as { items?: unknown[] };
          const items = Array.isArray(payload) ? payload : Array.isArray(record.items) ? record.items : [];
          const parsed = items
            .map(parseNotificationEvent)
            .filter((event): event is NotificationEvent => event !== null);
          if (!cancelled && parsed.length > 0) {
            setState((prev) => ({ events: [...prev.events, ...parsed], status: 'polling' }));
          } else if (!cancelled) {
            setState((prev) => ({ ...prev, status: 'polling' }));
          }
        } catch {
          if (!cancelled) {
            setState((prev) => ({ ...prev, status: 'error' }));
          }
        }
      };
      await poll();
      if (cancelled) {
        return;
      }
      pollTimerRef.current = setInterval(() => {
        void poll();
      }, pollIntervalMs);
    };

    if (typeof EventSource !== 'undefined') {
      try {
        const source = new EventSource(eventUrl);
        eventSourceRef.current = source;
        source.onopen = () => {
          if (!cancelled) {
            setState((prev) => ({ ...prev, status: 'connected' }));
          }
        };
        source.onmessage = (event) => {
          if (cancelled) {
            return;
          }
          try {
            const parsed = parseNotificationEvent(JSON.parse(event.data) as unknown);
            if (parsed) {
              setState((prev) => ({ events: [...prev.events, parsed], status: 'connected' }));
            }
          } catch {
            // 忽略非标准事件，保持连接
          }
        };
        source.onerror = () => {
          source.close();
          eventSourceRef.current = null;
          if (!cancelled) {
            void startPolling();
          }
        };
      } catch {
        eventSourceRef.current = null;
        if (!cancelled) {
          void startPolling();
        }
      }
    } else {
      void startPolling();
    }

    return () => {
      cancelled = true;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [eventUrl, pollUrl, pollIntervalMs, enabled]);

  return state;
}
