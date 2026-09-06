import { Button } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PermissionGate } from '../components/PermissionGate';
import { CockpitActivityFeed } from '../features/cockpit/CockpitActivityFeed';
import { CockpitAlertsPanel } from '../features/cockpit/CockpitAlertsPanel';
import { CockpitGanttPreview } from '../features/cockpit/CockpitGanttPreview';
import { CockpitKpiPanel } from '../features/cockpit/CockpitKpiPanel';
import { getDashboardSummary } from '../services/dashboardApi';
import '../styles/cockpit.css';

const AUTO_REFRESH_MS = 5000;

export function CockpitPage() {
  return (
    <PermissionGate permission="dashboard:read" auditModule="Dashboard" targetId="cockpit">
      <CockpitContent />
    </PermissionGate>
  );
}

function CockpitContent() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const summaryQuery = useQuery({ queryKey: ['dashboard-summary'], queryFn: getDashboardSummary });
  const [flash, setFlash] = useState(false);
  const prevRiskCount = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void queryClient.invalidateQueries();
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [queryClient]);

  const highRiskCount = summaryQuery.data?.risks.filter((risk) => risk.level === 'high').length ?? 0;

  useEffect(() => {
    if (prevRiskCount.current !== null && highRiskCount > prevRiskCount.current) {
      setFlash(true);
      const timer = window.setTimeout(() => setFlash(false), 2000);
      return () => window.clearTimeout(timer);
    }
    prevRiskCount.current = highRiskCount;
    return undefined;
  }, [highRiskCount]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen?.().catch(() => undefined);
    }
  };

  return (
    <div className="cockpit-page" data-testid="cockpit-page">
      <header className="cockpit-header">
        <div className="cockpit-heading">
          <div className="cockpit-title">云湃智算 · 生产运营驾驶舱</div>
          <div className="cockpit-subtitle">KPI · 排程 · 产能 · 风险 · 活动 一体化监控</div>
        </div>
        <div className="cockpit-header-actions">
          <Button size="small" onClick={toggleFullscreen}>
            全屏
          </Button>
          <Button size="small" type="primary" onClick={() => navigate('/dashboard')} aria-label="返回运营中心">
            返回运营中心
          </Button>
        </div>
      </header>
      <div
        className={flash ? 'cockpit-status-bar cockpit-status-flash' : 'cockpit-status-bar'}
        data-testid="cockpit-status-bar"
      >
        每 5 秒自动刷新 · 高风险 {highRiskCount} 项
      </div>
      <main className="cockpit-grid">
        <section className="cockpit-col">
          <CockpitKpiPanel />
          <CockpitAlertsPanel />
        </section>
        <section className="cockpit-col">
          <CockpitGanttPreview />
        </section>
        <section className="cockpit-col">
          <CockpitActivityFeed />
        </section>
      </main>
    </div>
  );
}
