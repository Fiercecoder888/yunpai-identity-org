import { Card, Col, Row, Space, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { PermissionCode } from '../../services/permissionApi';
import { filterQuickNavItems, roleQuickNavs, type RoleQuickNav } from './quickNavConfig';

export function QuickNavGrid({
  roleId,
  permissions,
}: {
  roleId: string | undefined;
  permissions: PermissionCode[] | undefined;
}) {
  const navigate = useNavigate();

  const renderNav = (nav: RoleQuickNav) => {
    const items = filterQuickNavItems(nav.items, permissions);
    const isCurrent = nav.roleId === roleId;
    return (
      <Card
        key={nav.roleId}
        size="small"
        className={isCurrent ? 'quick-nav-card is-current' : 'quick-nav-card'}
        title={
          <Space size={8}>
            <span>{nav.roleName}</span>
            {isCurrent ? <Tag color="blue">当前角色</Tag> : null}
          </Space>
        }
      >
        <div className="quick-nav-description">{nav.description}</div>
        <Row gutter={[8, 8]}>
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Col xs={12} lg={6} key={item.key}>
                <Card
                  size="small"
                  className="quick-nav-item"
                  role="link"
                  tabIndex={0}
                  aria-label={`进入 ${item.title}`}
                  onClick={() => navigate(item.path)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      navigate(item.path);
                    }
                  }}
                >
                  <Space direction="vertical" size={4}>
                    <Space size={6}>
                      <Icon />
                      <Typography.Text strong>{item.title}</Typography.Text>
                    </Space>
                    <Typography.Text type="secondary" className="quick-nav-item-desc">
                      {item.description}
                    </Typography.Text>
                  </Space>
                </Card>
              </Col>
            );
          })}
        </Row>
      </Card>
    );
  };

  return (
    <div className="quick-nav-grid" data-testid="quick-nav-grid">
      <Space direction="vertical" size={12} className="page-stack">
        {roleQuickNavs.map(renderNav)}
      </Space>
    </div>
  );
}
