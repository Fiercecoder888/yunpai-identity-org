import { useDashboardKpis } from '../dashboard/useDashboardKpis';
import type { DashboardKpiCard, KpiTone } from '../dashboard/dashboardKpis';

const toneHex: Record<KpiTone, string> = {
  good: '#34d399',
  warning: '#fbbf24',
  danger: '#f87171',
};

const statusLabel = (status: DashboardKpiCard['status']) =>
  status === 'error' ? '加载失败' : status === 'loading' ? '加载中' : status === 'empty' ? '暂无数据' : '正常';

type CockpitKpiPanelProps = {
  kpis?: DashboardKpiCard[];
  loading?: boolean;
};

export function CockpitKpiPanel({ kpis: kpisProp, loading: loadingProp }: CockpitKpiPanelProps) {
  const data = useDashboardKpis();
  const kpis = kpisProp ?? data.kpis;
  const loading = loadingProp ?? data.loading;

  return (
    <section className="cockpit-panel" data-testid="cockpit-kpi-panel">
      <div className="cockpit-panel-title">经营 KPI</div>
      {loading ? (
        <div className="cockpit-loading">正在加载 KPI…</div>
      ) : (
        <div className="cockpit-kpi-grid">
          {kpis.map((kpi) => (
            <div className="cockpit-kpi-card" key={kpi.key} data-testid={`cockpit-kpi-${kpi.key}`}>
              <div className="cockpit-kpi-label">
                {kpi.label}
                <span className="cockpit-kpi-status">{statusLabel(kpi.status)}</span>
              </div>
              <div className="cockpit-kpi-value" style={{ color: toneHex[kpi.tone] }}>
                {kpi.display}
              </div>
              <div className="cockpit-kpi-delta">{kpi.delta ?? '--'}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
