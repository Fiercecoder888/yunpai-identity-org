import { requestJson } from '../../services/httpClient';

/** 引导 AI 契约（PR #6 `/api/guidance/*`：模型定内容、代码做模板）。 */
export type GuidanceOption = { value: string; label: string };

export type GuidanceAssignment = {
  name: string;
  roles: string[];
  dept: string;
  /** 直接上级姓名（仅用于组织架构图渲染，不入库）。 */
  manager: string;
};

export type GuidancePlan = {
  departments: string[];
  assignments: GuidanceAssignment[];
  role_names?: Record<string, string>;
};

export type GuidanceApplied = {
  departments: number;
  bindings: number;
  departments_list: string[];
};

export type GuidanceResponse = {
  tenant_id?: string;
  reply: string;
  options: GuidanceOption[];
  plan: GuidancePlan | null;
  scale_departments: Record<string, string[]>;
  state: unknown;
  done: boolean;
  applied: GuidanceApplied | null;
  role_names?: Record<string, string>;
};

export const listGuidancePresets = () =>
  requestJson<{ presets: GuidanceOption[] }>('/guidance/presets');

export const sendGuidanceMessage = (payload: { message: string; state?: unknown }) =>
  requestJson<GuidanceResponse>('/guidance/chat', { method: 'POST', body: payload });
