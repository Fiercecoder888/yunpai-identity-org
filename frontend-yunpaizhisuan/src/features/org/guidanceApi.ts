import { requestJson } from '../../services/httpClient';

/**
 * 引导 AI 契约（PR #6 `/api/guidance/*`：模型定内容、代码做模板）。
 *
 * 用途：厂长注册完成后的「组织架构推荐」步骤（可跳过），以及会话内补充调整。
 * 红线：只有用户明确点「就这样，落地」后端才会写库。
 */
export type GuidanceOption = { value: string; label: string };

export type GuidanceAssignment = {
  name: string;
  dept?: string;
  manager?: string;
  roles: string[];
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
  scale_departments?: Record<string, string[]>;
  role_names?: Record<string, string>;
  state: unknown;
  done: boolean;
  applied: GuidanceApplied | null;
};

export const listGuidancePresets = () =>
  requestJson<{ presets: GuidanceOption[] }>('/guidance/presets');

export const sendGuidanceMessage = (payload: { message: string; state?: unknown }) =>
  requestJson<GuidanceResponse>('/guidance/chat', { method: 'POST', body: payload });

/** 注册完成后是否还需要展示「组织架构推荐」步骤（跨整页跳转，用 localStorage 传递）。 */
export const ORG_GUIDE_PENDING_KEY = 'yunpai.org-guide.pending';

export const markOrgGuidePending = () => {
  try {
    window.localStorage.setItem(ORG_GUIDE_PENDING_KEY, '1');
  } catch {
    /* 隐私模式忽略 */
  }
};

export const clearOrgGuidePending = () => {
  try {
    window.localStorage.removeItem(ORG_GUIDE_PENDING_KEY);
  } catch {
    /* 隐私模式忽略 */
  }
};

export const isOrgGuidePending = () => {
  try {
    return window.localStorage.getItem(ORG_GUIDE_PENDING_KEY) === '1';
  } catch {
    return false;
  }
};
