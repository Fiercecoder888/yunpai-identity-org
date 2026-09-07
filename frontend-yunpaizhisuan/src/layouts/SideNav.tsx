import {
  ApartmentOutlined,
  AuditOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  FileSearchOutlined,
  FormOutlined,
  FundProjectionScreenOutlined,
  InboxOutlined,
  SafetyCertificateOutlined,
  ScheduleOutlined,
  ShoppingCartOutlined,
  SwapOutlined,
  ToolOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { Menu, Tag } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { AppPath } from '../app/router';
import { isMswDemoMode } from '../app/runtimeMode';
import { filterSidebarGroups } from '../features/roles/sidebarConfig';
import { useCurrentRole } from '../features/roles/useCurrentRole';

const navIcons: Partial<Record<AppPath, ReactNode>> = {
  '/dashboard': <DashboardOutlined />,
  '/tasks': <ApartmentOutlined />,
  '/modules/m0-review': <FileSearchOutlined />,
  '/modules/bom-review': <FormOutlined />,
  '/modules/sop': <ToolOutlined />,
  '/modules/m3-procurement': <ShoppingCartOutlined />,
  '/modules/purchase-warnings': <WarningOutlined />,
  '/modules/schedule': <ScheduleOutlined />,
  '/modules/m5-flow': <FundProjectionScreenOutlined />,
  '/modules/qc': <SafetyCertificateOutlined />,
  '/modules/trace-workbench': <DatabaseOutlined />,
  '/modules/finished-goods': <InboxOutlined />,
  '/modules/warehouse-reconcile': <SwapOutlined />,
  '/modules/legal-final-review': <FundProjectionScreenOutlined />,
  '/modules/data-construction': <ExperimentOutlined />,
  '/audit': <AuditOutlined />,
};

export function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const demoMode = isMswDemoMode();
  const roleQuery = useCurrentRole();
  const groups = roleQuery.data ? filterSidebarGroups(roleQuery.data) : [];

  const items = groups.map((group) => ({
    type: 'group' as const,
    label: group.title,
    children: group.items.map((item) => ({
      key: item.key,
      icon: navIcons[item.key],
      label: item.legal ? (
        <span className="side-nav-label">
          <span>法务终审</span>
          <Tag className="side-nav-status" color={demoMode ? 'gold' : 'default'}>
            {demoMode ? '演示' : '未交付'}
          </Tag>
        </span>
      ) : (
        item.label
      ),
    })),
  }));

  return (
    <Menu
      className="side-nav"
      mode="inline"
      theme="dark"
      selectedKeys={[location.pathname]}
      items={items}
      onClick={({ key }) => {
        navigate(key);
        onNavigate?.();
      }}
    />
  );
}
