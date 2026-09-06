import type { DashboardSummary } from '../types/api';
import { getModuleHealthChecks, isHealthyModuleStatus } from './moduleHealth';

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const checks = await getModuleHealthChecks();

  const modules = checks.map(({ target, status, reachable }) => {
    const normal = reachable && isHealthyModuleStatus(status);
    return {
      id: target.id,
      name: target.name,
      status: normal ? 'normal' as const : reachable ? 'warning' as const : 'error' as const,
      metric: reachable ? 1 : 0,
      riskLevel: normal ? 'none' as const : reachable ? 'medium' as const : 'high' as const,
    };
  });

  return {
    modules,
    activities: checks.map(({ target, status, reachable }) => ({
      id: `${target.id}-health`,
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      module: target.name,
      message: reachable ? `健康检查：${status}` : '健康检查不可达',
      status: reachable && isHealthyModuleStatus(status) ? 'success' as const : 'warning' as const,
    })),
    risks: checks
      .filter(({ status, reachable }) => !reachable || !isHealthyModuleStatus(status))
      .map(({ target, status, reachable }) => ({
        id: `${target.id}-health-risk`,
        title: `${target.name}需要关注`,
        module: target.id.toUpperCase(),
        level: reachable ? 'medium' as const : 'high' as const,
        description: reachable ? `后端返回状态：${status}` : '网关无法连接模块服务。',
      })),
  };
}
