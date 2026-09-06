import { DatabaseOutlined } from '@ant-design/icons';
import { Button, Dropdown, Modal } from 'antd';
import type { ButtonProps } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuthStore } from '../auth/useAuthStore';

type DatabaseTenantSwitcherProps = {
  size?: ButtonProps['size'];
  reloadPage?: () => void;
};

export function DatabaseTenantSwitcher({ size = 'small', reloadPage }: DatabaseTenantSwitcherProps) {
  const config = useAuthStore((state) => state.config);
  const me = useAuthStore((state) => state.me);
  const switchTenant = useAuthStore((state) => state.switchTenant);
  const [switching, setSwitching] = useState(false);
  const [modal, modalContextHolder] = Modal.useModal();
  const queryClient = useQueryClient();
  const tenants = config?.tenants ?? [];

  if (!me || tenants.length === 0) return null;

  const currentTenantName = tenants.find((tenant) => tenant.id === me.tenant.id)?.name ?? me.tenant.name;

  const requestSwitch = (tenantId: string) => {
    if (tenantId === me.tenant.id) return;
    const targetName = tenants.find((tenant) => tenant.id === tenantId)?.name ?? tenantId;

    modal.confirm({
      title: '切换数据库版本',
      content: `切换到「${targetName}」？切换后清空本地缓存并刷新页面。`,
      okText: '切换',
      cancelText: '取消',
      onOk: async () => {
        setSwitching(true);
        try {
          await switchTenant(tenantId);
          queryClient.clear();
          (reloadPage ?? (() => window.location.reload()))();
        } finally {
          setSwitching(false);
        }
      },
    });
  };

  return (
    <>
      {modalContextHolder}
      <Dropdown
        trigger={['click']}
        disabled={switching}
        menu={{
          selectedKeys: [me.tenant.id],
          items: tenants.map((tenant) => ({ key: tenant.id, label: tenant.name })),
          onClick: ({ key }) => requestSwitch(key),
        }}
      >
        <Button
          className="database-tenant-switcher"
          size={size}
          aria-label={`当前数据库：${currentTenantName}`}
          icon={<DatabaseOutlined />}
          loading={switching}
        >
          {currentTenantName}
        </Button>
      </Dropdown>
    </>
  );
}
