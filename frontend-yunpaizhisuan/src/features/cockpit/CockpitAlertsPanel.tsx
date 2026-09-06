import { useDashboardKpis } from '../dashboard/useDashboardKpis';
import type { RiskBucket } from '../dashboard/dashboardKpis';

const ALERT_LIMIT = 8;

type CockpitAlertsPanelProps = {
  buckets?: RiskBucket[];
};

export function CockpitAlertsPanel({ buckets: bucketsProp }: CockpitAlertsPanelProps) {
  const data = useDashboardKpis();
  const buckets = bucketsProp ?? data.buckets;
  const danger = buckets.find((bucket) => bucket.key === 'danger')?.items ?? [];
  const warning = buckets.find((bucket) => bucket.key === 'warning')?.items ?? [];
  const dangerIds = new Set(danger.map((item) => item.id));
  const items = [...danger, ...warning].slice(0, ALERT_LIMIT);

  return (
    <section className="cockpit-panel" data-testid="cockpit-alerts-panel">
      <div className="cockpit-panel-title">风险预警 TopN</div>
      {items.length === 0 ? (
        <div className="cockpit-empty">暂无风险预警</div>
      ) : (
        <ul className="cockpit-alert-list">
          {items.map((item) => (
            <li key={item.id} className="cockpit-alert-item">
              <span className={`cockpit-alert-dot${dangerIds.has(item.id) ? ' cockpit-alert-dot-danger' : ' cockpit-alert-dot-warning'}`} />
              <span className="cockpit-alert-body">
                <span className="cockpit-alert-title">{item.title}</span>
                <span className="cockpit-alert-desc">{item.description}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
