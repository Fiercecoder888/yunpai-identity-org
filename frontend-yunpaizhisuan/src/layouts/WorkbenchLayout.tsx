import { BellOutlined } from '@ant-design/icons';
import { Badge, Breadcrumb, Button, Layout } from 'antd';
import type { BreadcrumbProps } from 'antd';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { isAppPath, routeMeta } from '../app/router';
import { isDemoRoleEnabled } from '../app/runtimeMode';
import { useTabsStore } from '../store/useTabsStore';
import { useRecentVisitsStore } from '../store/useRecentVisitsStore';
import { ModuleTabs } from './ModuleTabs';
import { CommandPalette } from '../components/CommandPalette';
import { DatabaseTenantSwitcher } from '../components/DatabaseTenantSwitcher';
import { VersionBadge } from '../components/VersionBadge';
import { RoleSwitcher } from '../features/roles/RoleSwitcher';
import { UserMenu } from '../features/roles/UserMenu';
import { useCurrentRole } from '../features/roles/useCurrentRole';
import { sidebarGroups } from '../features/roles/sidebarConfig';
import { WorkbenchBell } from '../features/notifications/WorkbenchBell';
import { TodoCenterDrawer } from '../features/todos/TodoCenterDrawer';
import { useTodoCenter } from '../features/todos/useTodoCenter';

const { Content, Header } = Layout;

const groupTitles = new Map(sidebarGroups.map((group) => [group.key, group.title]));

/**
 * 工作台外壳。
 *
 * 左侧深色模块导航（云湃智算 / 我的工作台 / 各模块页）已按用户要求移除（废稿）：
 * 组织架构 / 账号管理 / 角色与权限 从对话页顶部的「管理」下拉进入（AdminNavMenu）。
 * 此处仅保留页头、模块标签页与内容区。
 */
export function WorkbenchLayout() {
  const location = useLocation();
  const openTab = useTabsStore((state) => state.openTab);
  const recordVisit = useRecentVisitsStore((state) => state.recordVisit);
  const [todoOpen, setTodoOpen] = useState(false);
  const roleQuery = useCurrentRole();
  const todo = useTodoCenter(roleQuery.data?.permissions);
  // 演示模式才显示角色切换；真实鉴权下身份由服务端会话决定。
  const demoRoles = isDemoRoleEnabled();

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
    const items: NonNullable<BreadcrumbProps['items']> = [{ title: <Link to="/">首页</Link> }];
    if (groupTitle) {
      items.push({ title: groupTitle });
    }
    items.push({ title: meta.breadcrumb ?? meta.navTitle });
    return items;
  }, [location.pathname]);

  return (
    <Layout className="workbench-shell">
      <Layout>
        <Header className="workbench-header">
          <div className="workbench-header-copy">
            <div className="header-title">云湃智造运营中心</div>
            <div className="header-subtitle">订单识别·任务协同·生产排程·操作留痕</div>
          </div>
          <div className="workbench-header-meta">
            {demoRoles ? <RoleSwitcher /> : <UserMenu />}
            <WorkbenchBell />
            <Badge count={todo.total} size="small" overflowCount={99}>
              <Button type="text" icon={<BellOutlined />} aria-label="我的待办" onClick={() => setTodoOpen(true)} />
            </Badge>
            <VersionBadge />
          </div>
          <div className="workbench-header-actions">
            <DatabaseTenantSwitcher />
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
    </Layout>
  );
}
