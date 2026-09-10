import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from 'antd';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithApp } from '../../tests/testUtils';
import { AccountToolArtifacts } from './AccountToolArtifacts';

const CREATED = {
  tenant_id: 'default',
  user_id: 'worker900',
  display_name: '张伟',
  org_id: 'team-asm',
  role_codes: ['worker'],
  initial_password: 'Abc12345xyz',
  must_change_password: true,
};

describe('AccountToolArtifacts', () => {
  it('renders created account with one-time password', () => {
    renderWithApp(<AccountToolArtifacts result={CREATED} />);
    expect(screen.getByTestId('account-created-card')).toBeInTheDocument();
    expect(screen.getByText('worker900')).toBeInTheDocument();
    expect(screen.getByText('张伟')).toBeInTheDocument();
    expect(screen.getByText('工人')).toBeInTheDocument();
    expect(screen.getByTestId('account-initial-password')).toHaveTextContent('Abc12345xyz');
    expect(screen.getByText(/只显示这一次/)).toBeInTheDocument();
  });

  it('renders assigned account card', () => {
    renderWithApp(
      <AccountToolArtifacts
        result={{ user_id: 'worker900', display_name: '张伟', org_id: 'team-asm', role_codes: ['team-leader'] }}
      />,
    );
    expect(screen.getByTestId('account-assigned-card')).toBeInTheDocument();
    expect(screen.getByText('组长')).toBeInTheDocument();
  });

  it('renders account list from users array', () => {
    renderWithApp(<AccountToolArtifacts result={{ total: 1, users: [CREATED] }} />);
    expect(screen.getByTestId('account-list-card')).toBeInTheDocument();
    expect(screen.getByText(/本租户账号/)).toBeInTheDocument();
    expect(screen.getByText('worker900')).toBeInTheDocument();
  });

  it('unwraps data envelope and ignores unrelated tool results', () => {
    renderWithApp(<AccountToolArtifacts result={{ data: CREATED }} />);
    expect(screen.getByTestId('account-created-card')).toBeInTheDocument();

    const { container } = renderWithApp(<AccountToolArtifacts result={{ status: 'ok', rows: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });

  // 失败态由 ChatPanel 负责（失败步骤整条不挂载本组件）；这里只渲染成功结果，
  // 拿不到可渲染的成功数据时必须返回 null，不渲染空卡片、也不把失败当成功。
  describe('失败/空数据一律不渲染', () => {
    const empty = (result: unknown) => {
      const { container } = renderWithApp(<AccountToolArtifacts result={result} />);
      expect(container).toBeEmptyDOMElement();
    };

    it('权限拒绝等失败原因不渲染任何卡片', () => {
      empty({ error: '当前登录账号没有身份管理权限（只有厂长/组织管理员可以建号）。' });
      empty({ success: false, error: 'TOOL_FORBIDDEN' });
      empty({ data: { error: '当前登录账号没有身份管理权限。' } });
      empty('TOOL_FORBIDDEN');
    });

    it('created/users 为空或缺少 user_id 时不渲染空卡片', () => {
      empty({ tenant_id: 'default', created: [] });
      empty({ tenant_id: 'default', users: [] });
      empty({ created: [{}] });
      empty({ users: [{ display_name: '张伟' }] });
      empty({ tenant_id: 'default', total: 0 });
    });
  });

  // 纯 HTTP + 非 localhost（如 http://192.168.x.x:18003）下 navigator.clipboard 不可用，
  // 复制必须退化为 execCommand 兜底；两条路都失败才提示手动复制。
  describe('一次性初始密码复制兜底', () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');

    afterEach(() => {
      // 只还原本文件改过的两个属性；不要用 vi.restoreAllMocks()，
      // 那会清空 setup.ts 里 matchMedia/ResizeObserver 的 vi.fn 实现。
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      else Reflect.deleteProperty(navigator, 'clipboard');
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else Reflect.deleteProperty(document, 'execCommand');
    });

    it('navigator.clipboard 缺失时用 execCommand 兜底复制', async () => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, writable: true, value: undefined });
      const execCommand = vi.fn().mockReturnValue(true);
      Object.defineProperty(document, 'execCommand', { configurable: true, writable: true, value: execCommand });

      renderWithApp(
        <App>
          <AccountToolArtifacts result={CREATED} />
        </App>,
      );
      await userEvent.click(screen.getByRole('button', { name: /复制/ }));

      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(await screen.findByText('初始密码已复制')).toBeInTheDocument();
    });

    it('两种方式都失败时提示手动复制且密码仍可见', async () => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, writable: true, value: undefined });
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        writable: true,
        value: vi.fn().mockImplementation(() => {
          throw new Error('execCommand not supported');
        }),
      });

      renderWithApp(
        <App>
          <AccountToolArtifacts result={CREATED} />
        </App>,
      );
      await userEvent.click(screen.getByRole('button', { name: /复制/ }));

      expect(
        await screen.findByText('浏览器不允许自动复制，请手动选中页面上的密码复制'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('account-initial-password')).toHaveTextContent('Abc12345xyz');
    });
  });
});
