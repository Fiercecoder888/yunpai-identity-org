import { BellOutlined, MenuOutlined, UserOutlined } from '@ant-design/icons';
import { Badge, Breadcrumb, Button, Drawer, Dropdown, Layout } from 'antd';
import type { BreadcrumbProps } from 'antd';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { isAppPath, routeMeta } from '../app/router';
import { useTabsStore } from '../store/useTabsStore';
import { useRecentVisitsStore } from '../store/useRecentVisitsStore';
import { ModuleTabs } from './ModuleTabs';
import { SideNav } from './SideNav';
import { CommandPalette } from '../components/CommandPalette';
import { DatabaseTenantSwitcher } from '../components/DatabaseTenantSwitcher';
import { VersionBadge } from '../components/VersionBadge';
import { RoleSwitcher } from '../features/roles/RoleSwitcher';
import { useCurrentRole } from '../features/roles/useCurrentRole';
import { sidebarGroups } from '../features/roles/sidebarConfig';
import { WorkbenchBell } from '../features/notifications/WorkbenchBell';
import { TodoCenterDrawer } from '../features/todos/TodoCenterDrawer';
import { useTodoCenter } from '../features/todos/useTodoCenter';

const { Content, Header, Sider } = Layout;

const groupTitles = new Map(sidebarGroups.map((group) => [group.key, group.title]));

const userMenuItems = [
  { key: 'role', label: '角色：运营管理员（占位）', disabled: true },
  { key: 'audit', label: '操作留痕：审计已启用（占位）', disabled: true },
];

export function WorkbenchLayout() {
  const location = useLocation();
  const openTab = useTabsStore((state) => state.openTab);
  const recordVisit = useRecentVisitsStore((state) => state.recordVisit);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [todoOpen, setTodoOpen] = useState(false);
  const roleQuery = useCurrentRole();
  const todo = useTodoCenter(roleQuery.data?.permissions);

  useEffect(() => {
    if (isAppPath(location.pathname)) {
      const meta = routeMeta[location.pathname];
      openTab({ path: location.pathname, title: meta.title, closable: meta.closable });
      recordVisit(location.pathname, meta.title);
    }
  }, [location.pathname, openTab, recordVisit]);

  const breadcrumbItems: BreadcrumbProps['items'] = useMemo(() => {
    if (!isAppPath(location.pathname)) {
      return [];
    }
    const meta = routeMeta[location.pathname];
    const groupTitle = meta.groupKey ? groupTitles.get(meta.groupKey) : undefined;
    const items: NonNullable<BreadcrumbProps['items']> = [{ title: <Link to="/home">首页</Link> }];
    if (groupTitle) {
      items.push({ title: groupTitle });
    }
    items.push({ title: meta.breadcrumb ?? meta.navTitle });
    return items;
  }, [location.pathname]);

  return (
    <Layout className="workbench-shell">
      <Sider width={220} className="workbench-sider">
        <div className="workbench-brand">
          <span className="brand-title">云湃智算</span>
          <span className="brand-subtitle">工业智造 Agent</span>
        </div>
        <SideNav />
      </Sider>
      <Layout>
        <Header className="workbench-header">
          <Button
            className="mobile-nav-trigger"
            type="text"
            icon={<MenuOutlined />}
            aria-label="打开导航"
            onClick={() => setMobileNavOpen(true)}
          />
          <div className="workbench-header-copy">
            <div className="header-title">云湃智造运营中心</div>
            <div className="header-subtitle">订单识别·任务协同·生产排程·操作留痕</div>
          </div>
          <div className="workbench-header-meta">
            <RoleSwitcher />
            <WorkbenchBell />
            <Badge count={todo.total} size="small" overflowCount={99}>
              <Button type="text" icon={<BellOutlined />} aria-label="我的待办" onClick={() => setTodoOpen(true)} />
            </Badge>
            <VersionBadge />
          </div>
          <div className="workbench-header-actions">
            <DatabaseTenantSwitcher />
            <Dropdown menu={{ items: userMenuItems }} trigger={['click']}>
              <Button type="text" icon={<UserOutlined />} aria-label="用户菜单">
                运营用户
              </Button>
            </Dropdown>
          </div>
        </Header>
        <ModuleTabs />
        <Content className="workbench-content">
          {breadcrumbItems.length > 0 ? <Breadcrumb className="workbench-breadcrumb" items={breadcrumbItems} /> : null}
          <Outlet />
        </Content>
      </Layout>
      <TodoCenterDrawer open={todoOpen} onClose={() => setTodoOpen(false)} />
      <CommandPalette />
      <Drawer
        className="mobile-nav-drawer"
        title="云湃智算导航"
        placement="left"
        width={240}
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      >
        <SideNav onNavigate={() => setMobileNavOpen(false)} />
      </Drawer>
    </Layout>
  );
}
