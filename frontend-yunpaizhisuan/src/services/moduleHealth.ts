import { requestJson } from './httpClient';

export const moduleHealthTargets = [
  { id: 'm1', name: 'M0 订单解析', path: '/m0/parser-compat/health' },
  { id: 'm2', name: 'M2 BOM/SOP', path: '/m2/health' },
  { id: 'm3', name: 'M3 物料计划', path: '/m3/health' },
  { id: 'm4', name: 'M4 采购追踪', path: '/m4/health' },
  { id: 'm5', name: 'M5 PMC 排程', path: '/m5/health' },
] as const;

export type ModuleHealthCheck = {
  target: (typeof moduleHealthTargets)[number];
  status: string;
  reachable: boolean;
};

const healthyStatuses = new Set(['ok', 'ready', 'healthy', 'available', 'up']);

export const readModuleHealthStatus = (payload: unknown) => {
  const record = payload as { status?: string; health?: { status?: string } };
  return String(record.health?.status ?? record.status ?? 'unknown').toLowerCase();
};

export const isHealthyModuleStatus = (status: string) => healthyStatuses.has(status.toLowerCase());

export async function getModuleHealthChecks(): Promise<ModuleHealthCheck[]> {
  return Promise.all(
    moduleHealthTargets.map(async (target) => {
      try {
        const payload = await requestJson<unknown>(target.path);
        return { target, status: readModuleHealthStatus(payload), reachable: true };
      } catch {
        return { target, status: 'unavailable', reachable: false };
      }
    }),
  );
}
