import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { AppProviders } from '../app/providers';
import { changePassword } from '../auth/authApi';
import { useAuthStore } from '../auth/useAuthStore';
import { ChangePasswordPage } from './ChangePasswordPage';

const NEW_PASSWORD = 'Worker@2026';

let fetchSpy: MockInstance<typeof fetch> | undefined;

const renderPage = (forced: boolean) =>
  render(
    <AppProviders>
      <ChangePasswordPage forced={forced} />
    </AppProviders>,
  );

describe('ChangePasswordPage', () => {
  const changePasswordMock = vi.fn<(oldPassword: string | undefined, newPassword: string) => Promise<void>>();

  beforeEach(() => {
    changePasswordMock.mockReset();
    changePasswordMock.mockResolvedValue(undefined);
    useAuthStore.setState({ status: 'ready', changePassword: changePasswordMock });
  });

  afterEach(() => {
    // 不要用 vi.restoreAllMocks()：它会把 setup.ts 里 matchMedia/ResizeObserver 的
    // vi.fn 实现一起清空，后续 antd 组件渲染直接崩。
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
  });

  it('首登强制改密不渲染「当前密码」，提交时 old_password 为 undefined', async () => {
    renderPage(true);

    expect(screen.queryByLabelText('当前密码')).not.toBeInTheDocument();
    expect(
      screen.getByText('首次登录无需输入当前密码，直接设置你自己的密码即可。'),
    ).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('新密码'), NEW_PASSWORD);
    await userEvent.type(screen.getByLabelText('确认新密码'), NEW_PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: '保存并继续' }));

    await waitFor(() => expect(changePasswordMock).toHaveBeenCalledTimes(1));
    const [oldPassword, newPassword] = changePasswordMock.mock.calls[0] ?? [];
    expect(oldPassword).toBeUndefined();
    expect(newPassword).toBe(NEW_PASSWORD);
  });

  it('changePassword 省略当前密码时请求体不含 old_password', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await changePassword(undefined, NEW_PASSWORD);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('/api/auth/change-password');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toEqual({ new_password: NEW_PASSWORD });
    expect('old_password' in body).toBe(false);
  });

  it('主动改密仍渲染「当前密码」，留空时不提交', async () => {
    renderPage(false);

    expect(screen.getByLabelText('当前密码')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('新密码'), NEW_PASSWORD);
    await userEvent.type(screen.getByLabelText('确认新密码'), NEW_PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: '保存并继续' }));

    expect(await screen.findByText('请输入当前密码')).toBeInTheDocument();
    expect(changePasswordMock).not.toHaveBeenCalled();
  });

  it('主动改密把当前密码一起提交', async () => {
    renderPage(false);

    await userEvent.type(screen.getByLabelText('当前密码'), 'OldPassw0rd!');
    await userEvent.type(screen.getByLabelText('新密码'), NEW_PASSWORD);
    await userEvent.type(screen.getByLabelText('确认新密码'), NEW_PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: '保存并继续' }));

    await waitFor(() => expect(changePasswordMock).toHaveBeenCalledTimes(1));
    expect(changePasswordMock.mock.calls[0]).toEqual(['OldPassw0rd!', NEW_PASSWORD]);
  });
});
