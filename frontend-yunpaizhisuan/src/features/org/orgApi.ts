import { requestJson } from '../../services/httpClient';

/** 组织节点（PR #6 org_nodes：company 根 / dept 部门 / team 班组）。 */
export type OrgNode = {
  org_id: string;
  parent_id: string | null;
  name: string;
  org_type: 'company' | 'dept' | 'team' | string;
  source: string;
};

export type IdentityUser = {
  user_id: string;
  display_name?: string | null;
  org_id?: string | null;
  status: 'active' | 'disabled' | string;
  must_change_password: boolean;
  role_codes: string[];
  skill?: string | null;
  created_at?: string;
};

export type IdentityRole = {
  role_code: string;
  name: string;
  permissions: string[];
};

export type PermissionEntry = {
  code: string;
  label: string;
  gate?: string;
  scopes?: string[];
};

export type IdentityCatalog = {
  permissions: PermissionEntry[];
  roles: IdentityRole[];
  note?: string;
};

export const ORG_TYPE_LABEL: Record<string, string> = {
  company: '公司',
  dept: '部门',
  team: '班组',
};

export const listOrgTree = () => requestJson<{ org: OrgNode[] }>('/identity/org');

export const upsertOrgNode = (payload: {
  org_id: string;
  name: string;
  parent_id?: string | null;
  org_type?: string;
}) => requestJson<OrgNode>('/identity/org', { method: 'POST', body: payload });

export const deleteOrgNode = (orgId: string) =>
  requestJson<{ deleted: boolean }>(`/identity/org/${encodeURIComponent(orgId)}`, { method: 'DELETE' });

export const listUsers = () => requestJson<{ users: IdentityUser[] }>('/identity/users');

export const createUser = (payload: {
  user_id: string;
  display_name?: string;
  password?: string;
  role_codes?: string[];
  org_id?: string | null;
}) =>
  requestJson<IdentityUser & { initial_password: string; password_returned_once: boolean }>(
    '/identity/users',
    { method: 'POST', body: payload },
  );

export const updateUser = (
  userId: string,
  payload: {
    display_name?: string;
    org_id?: string | null;
    status?: 'active' | 'disabled';
    role_codes?: string[];
  },
) =>
  requestJson<IdentityUser>(`/identity/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: payload,
  });

export const resetUserPassword = (userId: string) =>
  requestJson<{ initial_password: string; password_returned_once: boolean }>(
    `/identity/users/${encodeURIComponent(userId)}/reset-password`,
    { method: 'POST', body: {} },
  );

export const deleteUser = (userId: string) =>
  requestJson<{ deleted: boolean }>(`/identity/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });

export const getIdentityCatalog = () => requestJson<IdentityCatalog>('/identity/catalog');

export const listRoles = () => requestJson<{ roles: IdentityRole[] }>('/identity/roles');

/** 扁平节点 → antd Tree 结构（按 parent_id 挂载，根为 parent_id 为空者）。 */
export type OrgTreeNode = {
  key: string;
  title: string;
  orgType: string;
  source: string;
  children: OrgTreeNode[];
};

export const buildOrgTree = (nodes: readonly OrgNode[]): OrgTreeNode[] => {
  const byId = new Map<string, OrgTreeNode>();
  for (const node of nodes) {
    byId.set(node.org_id, {
      key: node.org_id,
      title: node.name,
      orgType: node.org_type,
      source: node.source,
      children: [],
    });
  }
  const roots: OrgTreeNode[] = [];
  for (const node of nodes) {
    const self = byId.get(node.org_id);
    if (!self) continue;
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
    if (parent) parent.children.push(self);
    else roots.push(self);
  }
  return roots;
};

/** 组织节点路径文案：公司 / 部门 / 班组。 */
export const orgPathLabel = (nodes: readonly OrgNode[], orgId?: string | null): string => {
  if (!orgId) return '未分配';
  const byId = new Map(nodes.map((node) => [node.org_id, node]));
  const parts: string[] = [];
  let current = orgId;
  let guard = 0;
  while (current && byId.has(current) && guard < 16) {
    parts.unshift(byId.get(current)!.name);
    current = byId.get(current)!.parent_id ?? '';
    guard += 1;
  }
  return parts.length ? parts.join(' / ') : orgId;
};
