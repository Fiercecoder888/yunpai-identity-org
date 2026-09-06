import { isMswDemoMode } from '../../app/runtimeMode';
import { HttpClientError, requestJson } from '../../services/httpClient';
import type { AppNotification } from './useNotificationStore';

const notImplementedError = () =>
  new HttpClientError({
    code: 'not_implemented',
    message: '通知服务未交付，真实后端模式不可用',
    detail: { module: 'notifications' },
  });

const isNotification = (value: unknown): value is AppNotification => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.title === 'string' && typeof record.createdAt === 'string';
};

export async function getNotifications(): Promise<AppNotification[]> {
  if (!isMswDemoMode()) {
    return Promise.reject(notImplementedError());
  }
  const payload = await requestJson<unknown>('/notifications');
  if (!Array.isArray(payload)) {
    throw new HttpClientError({
      code: 'parse_error',
      message: '通知接口返回格式错误：应为通知数组',
      status: 200,
      detail: payload,
    });
  }
  return payload.filter(isNotification);
}
