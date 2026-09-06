import { Card, Col, Collapse, List, Row, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { RiskBucket, RiskBucketItem, RiskBucketKey } from './dashboardKpis';

const bucketTheme: Record<RiskBucketKey, { title: string; color: string; soft: string; description: string }> = {
  danger: {
    title: '高风险 · 逾期/缺料',
    color: '#ef4444',
    soft: '#fff1f0',
    description: '逾期采购与高缺料物料，需优先处理',
  },
  warning: {
    title: '中风险 · 临期/关注',
    color: '#d97706',
    soft: '#fffbe6',
    description: '3 天内到期待跟进，或存在待处理排程',
  },
  success: {
    title: '正常 · 稳定运行',
    color: '#16a34a',
    soft: '#f0fdf4',
    description: '无异常项，模块与计划状态正常',
  },
};

const groupByModule = (items: RiskBucketItem[]): Array<[string, number]> => {
  const map = new Map<string, number>();
  for (const item of items) {
    const module = item.module ?? '其他';
    map.set(module, (map.get(module) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
};

type RiskSummaryCardsProps = {
  buckets: RiskBucket[];
  onItemClick?: (item: RiskBucketItem) => void;
};

export function RiskSummaryCards({ buckets, onItemClick }: RiskSummaryCardsProps) {
  const navigate = useNavigate();

  return (
    <Row gutter={[12, 12]} className="dashboard-risk-row">
      {buckets.map((bucket) => {
        const theme = bucketTheme[bucket.key];
        const open = () => navigate(bucket.href);
        const moduleGroups = groupByModule(bucket.items);
        const itemsByModule = (module: string) => bucket.items.filter((item) => (item.module ?? '其他') === module);

        return (
          <Col key={bucket.key} xs={24} md={8}>
            <Card
              size="small"
              className="dashboard-risk-card"
              style={{ borderLeft: `4px solid ${theme.color}`, background: theme.soft }}
            >
              <div
                role="link"
                tabIndex={0}
                aria-label={`风险卡：${theme.title}，共 ${bucket.count} 项`}
                className="dashboard-risk-card-header-link"
                onClick={open}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    open();
                  }
                }}
              >
                <div className="dashboard-risk-head">
                  <div>
                    <Typography.Text strong style={{ color: theme.color }}>
                      {theme.title}
                    </Typography.Text>
                    <div className="dashboard-risk-description">{theme.description}</div>
                  </div>
                  <div className="dashboard-risk-count" style={{ color: theme.color }}>
                    {bucket.count}
                  </div>
                </div>
              </div>
              {moduleGroups.length > 0 ? (
                <div className="dashboard-risk-module-tags">
                  {moduleGroups.map(([module, count]) => (
                    <Tag key={module} color={bucket.key === 'danger' ? 'red' : bucket.key === 'warning' ? 'gold' : 'green'}>
                      {module} ×{count}
                    </Tag>
                  ))}
                </div>
              ) : null}
              {bucket.items.length > 0 ? (
                <Collapse
                  size="small"
                  ghost
                  className="dashboard-risk-collapse"
                  items={moduleGroups.map(([module, count]) => ({
                    key: module,
                    label: `${module}（${count}）`,
                    children: (
                      <List
                        size="small"
                        className="dashboard-risk-list"
                        dataSource={itemsByModule(module)}
                        renderItem={(item) => (
                          <List.Item
                            role="button"
                            tabIndex={0}
                            aria-label={`风险条目：${item.title}`}
                            className="dashboard-risk-item-row"
                            onClick={(event) => {
                              event.stopPropagation();
                              onItemClick?.(item);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                event.stopPropagation();
                                onItemClick?.(item);
                              }
                            }}
                          >
                            <div>
                              <div className="dashboard-risk-item-title">{item.title}</div>
                              <div className="dashboard-risk-item-description">{item.description}</div>
                            </div>
                          </List.Item>
                        )}
                      />
                    ),
                  }))}
                />
              ) : (
                <Typography.Text type="secondary" className="dashboard-risk-empty">
                  {bucket.key === 'success' ? '一切正常' : '暂无待处理项'}
                </Typography.Text>
              )}
            </Card>
          </Col>
        );
      })}
    </Row>
  );
}
