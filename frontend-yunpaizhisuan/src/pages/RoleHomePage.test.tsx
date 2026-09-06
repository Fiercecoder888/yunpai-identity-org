import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithApp } from '../tests/testUtils';
import { server } from '../mocks/server';
import { RoleHomePage } from './RoleHomePage';

const renderRoleHome = () =>
  renderWithApp(
    <MemoryRouter initialEntries={['/home']}>
      <RoleHomePage />
    </MemoryRouter>,
  );

describe('RoleHomePage', () => {
  afterEach(() => {
    window.localStorage.removeItem('mockRoleId');
  });

  it('lands the default demo role (factory director) on the KPI overview', async () => {
    renderRoleHome();

    expect(await screen.findByRole('heading', { name: '厂长驾驶舱' })).toBeInTheDocument();
    expect(await screen.findByText(/当前角色：厂长/)).toBeInTheDocument();
    expect(await screen.findByText('模块总数')).toBeInTheDocument();
    expect(screen.getByText('待办概览')).toBeInTheDocument();
  });

  it('lands the team leader on today tasks and dispatch entries', async () => {
    window.localStorage.setItem('mockRoleId', 'team-leader');
    renderRoleHome();

    expect(await screen.findByRole('heading', { name: '小组长工作台' })).toBeInTheDocument();
    expect(await screen.findByText('今日任务概览')).toBeInTheDocument();
    expect(await screen.findByText('排程与派工入口')).toBeInTheDocument();
    expect(await screen.findByText('组长职责范围')).toBeInTheDocument();
  });

  it('lands the worker on my orders and reporting', async () => {
    window.localStorage.setItem('mockRoleId', 'worker');
    renderRoleHome();

    expect(await screen.findByRole('heading', { name: '我的工作台' })).toBeInTheDocument();
    // WorkerSection 卡片与快捷导航各有一处「我的订单与报工」
    expect((await screen.findAllByText('我的订单与报工')).length).toBeGreaterThan(0);
    expect(await screen.findByText('请先选择你的测试工号，才能查看已派发工序并报工。')).toBeInTheDocument();
  });

  it('shows the shared todo overview for the factory director', async () => {
    renderRoleHome();

    expect(await screen.findByText('M0 解析待审')).toBeInTheDocument();
    expect(screen.getByText('M3 缺料')).toBeInTheDocument();
    expect(screen.getByText('M4 逾期')).toBeInTheDocument();
    expect(screen.getByText('M5 需处理')).toBeInTheDocument();
  });

  it('does not issue order-scoped readiness from the role home without an order', async () => {
    let readinessCalls = 0;
    server.use(
      http.get('/api/m3/material-readiness', () => {
        readinessCalls += 1;
        return HttpResponse.json({ success: true, data: { lines: [] }, errors: [] });
      }),
    );

    renderRoleHome();

    expect(await screen.findByRole('heading', { name: '厂长驾驶舱' })).toBeInTheDocument();
    expect(readinessCalls).toBe(0);
  });
});
