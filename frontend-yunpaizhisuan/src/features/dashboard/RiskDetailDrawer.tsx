import { Button, Descriptions, Drawer, Space, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { RiskBucketItem, RiskSeverity } from './dashboardKpis';

const severityMeta: Record<RiskSeverity, { label: string; color: string }> = {
  critical: { label: '严重', color: '#b91c1c' },
  high: { label: '高', color: '#ef4444' },
  medium: { label: '中', color: '#d97706' },
  low: { label: '低', color: '#1677ff' },
  none: { label: '无', color: '#16a34a' },
};

const moduleRoute: Record<string, string> = {
  M1: '/modules/m0-review',
  M2: '/modules/bom-review',
  M3: '/modules/m3-procurement',
  M4: '/modules/purchase-warnings',
  M5: '/modules/m5-flow',
  M7: '/modules/legal-final-review',
};

type RiskDetailDrawerProps = {
  item: RiskBucketItem | null;
  open: boolean;
  onClose: () => void;
};

export function RiskDetailDrawer({ item, open, onClose }: RiskDetailDrawerProps) {
  const navigate = useNavigate();
  const severity = item?.severity ?? 'none';
  const href = item?.module ? moduleRoute[item.module] : undefined;

  return (
    <Drawer open={open} onClose={onClose} title={item?.title ?? '风险详情'} width={420}>
      {item ? (
        <>
          <Descriptions
            size="small"
            column={1}
            bordered
            items={[
              { key: 'module', label: '模块', children: item.module ?? '—' },
              {
                key: 'severity',
                label: '级别',
                children: <Tag color={severityMeta[severity].color}>{severityMeta[severity].label}</Tag>,
              },
              { key: 'description', label: '说明', children: item.description },
            ]}
          />
          <Space className="dashboard-risk-drawer-actions">
            <Button
              type="primary"
              disabled={!href}
              onClick={() => {
                onClose();
                if (href) {
                  navigate(href);
                }
              }}
            >
              去处理
            </Button>
            <Button onClick={onClose}>关闭</Button>
          </Space>
        </>
      ) : null}
    </Drawer>
  );
}
