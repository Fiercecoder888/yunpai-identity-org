import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../../mocks/server';
import { parseNotificationEvent } from './notificationEvents';
import { useNotificationTransport } from './useNotificationTransport';

describe('notification transport', () => {
  it('parses reserved notification event schema', () => {
    expect(
      parseNotificationEvent({ type: 'business', id: 'n-1', title: 't', message: 'm', severity: 'warning' }),
    ).toMatchObject({ type: 'business', id: 'n-1', severity: 'warning' });
    expect(parseNotificationEvent({ type: 'run_status', id: 'n-2', status: 'blocked', message: 'm' })).toMatchObject({
      type: 'run_status',
      status: 'blocked',
    });
    expect(parseNotificationEvent({ type: 'unknown', id: 'x' })).toBeNull();
    expect(parseNotificationEvent(null)).toBeNull();
  });

  it('degrades to poll transport and receives mock notifications', async () => {
    server.use(
      http.get('/api/notifications', () =>
        HttpResponse.json({
          items: [
            { type: 'business', id: 'ntf-mock-1', title: '缺料预警', message: 'MAT-001 供应商确认', module: 'm3', severity: 'warning', createdAt: '2026-08-10T00:00:00Z' },
          ],
        }),
      ),
    );
    const { result } = renderHook(() =>
      useNotificationTransport({ eventUrl: '/api/notifications/events', pollUrl: '/api/notifications', pollIntervalMs: 1000, enabled: true }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe('polling');
    });
    await waitFor(() => {
      expect(result.current.events.length).toBeGreaterThan(0);
    });
    expect(result.current.events[0]).toMatchObject({ type: 'business', id: 'ntf-mock-1', module: 'm3' });
  });

  it('does not subscribe when disabled', () => {
    const { result } = renderHook(() => useNotificationTransport({ enabled: false }));
    expect(result.current.status).toBe('connecting');
    expect(result.current.events).toEqual([]);
  });
});
