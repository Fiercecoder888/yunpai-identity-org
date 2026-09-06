import { useQuery } from '@tanstack/react-query';
import { getDashboardSummary } from '../../services/dashboardApi';
import type { AgentActivity } from '../../types/api';

type CockpitActivityFeedProps = {
  activities?: AgentActivity[];
};

export function CockpitActivityFeed({ activities: activitiesProp }: CockpitActivityFeedProps) {
  const query = useQuery({ queryKey: ['dashboard-summary'], queryFn: getDashboardSummary });
  const activities = activitiesProp ?? query.data?.activities ?? [];

  return (
    <section className="cockpit-panel" data-testid="cockpit-activity-feed">
      <div className="cockpit-panel-title">最近 Agent 活动</div>
      {activities.length === 0 ? (
        <div className="cockpit-empty">暂无活动</div>
      ) : (
        <ul className="cockpit-activity-list">
          {activities.map((activity) => (
            <li key={activity.id} className="cockpit-activity-item">
              <span className={`cockpit-activity-dot cockpit-activity-${activity.status}`} />
              <span className="cockpit-activity-time">{activity.time}</span>
              <span className="cockpit-activity-text">
                {activity.module} · {activity.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
