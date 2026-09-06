import { Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { useMemo } from 'react';
import {
  classifyRiskSeverity,
  type RiskBucket,
  type RiskSeverity,
} from './dashboardKpis';

const severityMeta: Record<RiskSeverity, { label: string; color: string }> = {
  critical: { label: '严重', color: '#b91c1c' },
  high: { label: '高', color: '#ef4444' },
  medium: { label: '中', color: '#d97706' },
  low: { label: '低', color: '#1677ff' },
  none: { label: '无', color: '#16a34a' },
};

const severityOrder: RiskSeverity[] = ['critical', 'high', 'medium', 'low', 'none'];

type RiskModuleRow = {
  key: string;
  module: string;
  counts: Record<RiskSeverity, number>;
  total: number;
};

const emptyCounts = (): Record<RiskSeverity, number> => ({ critical: 0, high: 0, medium: 0, low: 0, none: 0 });

type RiskModuleMatrixProps = {
  buckets: RiskBucket[];
};

export function RiskModuleMatrix({ buckets }: RiskModuleMatrixProps) {
  const rows = useMemo<RiskModuleRow[]>(() => {
    const map = new Map<string, RiskModuleRow>();
    for (const bucket of buckets) {
      for (const item of bucket.items) {
        const module = item.module ?? '其他';
        const severity = item.severity ?? classifyRiskSeverity('none');
        const row = map.get(module) ?? { key: module, module, counts: emptyCounts(), total: 0 };
        row.counts[severity] += 1;
        row.total += 1;
        map.set(module, row);
      }
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [buckets]);

  const columns: TableColumnsType<RiskModuleRow> = [
    {
      title: '模块',
      dataIndex: 'module',
      key: 'module',
      render: (module: string) => <Typography.Text strong>{module}</Typography.Text>,
    },
    ...severityOrder.map((severity) => ({
      title: severityMeta[severity].label,
      key: severity,
      align: 'center' as const,
      render: (_: unknown, row: RiskModuleRow) =>
        row.counts[severity] > 0 ? <Tag color={severityMeta[severity].color}>{row.counts[severity]}</Tag> : <span className="dashboard-risk-matrix-zero">—</span>,
    })),
    {
      title: '合计',
      dataIndex: 'total',
      key: 'total',
      align: 'center',
      render: (total: number) => <Typography.Text strong>{total}</Typography.Text>,
    },
  ];

  if (rows.length === 0) {
    return (
      <Typography.Text type="secondary" className="dashboard-risk-matrix-empty">
        暂无风险明细
      </Typography.Text>
    );
  }

  return (
    <div className="dashboard-risk-matrix">
      <Typography.Text type="secondary" className="dashboard-risk-matrix-title">
        模块 × 风险级别矩阵
      </Typography.Text>
      <Table size="small" pagination={false} rowKey="key" dataSource={rows} columns={columns} />
    </div>
  );
}
