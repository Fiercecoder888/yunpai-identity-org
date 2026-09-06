import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../auth/useAuthStore';
import { currentRoleQueryKey, getCurrentRole } from '../../services/permissionApi';

export function useCurrentRole() {
  const authStatus = useAuthStore((state) => state.status);
  const authError = useAuthStore((state) => state.error ?? null);
  const principalId = useAuthStore((state) => state.me?.principal_id ?? null);
  const tenantId = useAuthStore((state) => state.me?.tenant.id ?? null);
  const sessionId = useAuthStore((state) => state.me?.session.id ?? null);
  const roles = useAuthStore((state) => state.me?.roles ?? null);
  const permissions = useAuthStore((state) => state.me?.permissions ?? null);
  const query = useQuery({
    queryKey: [...currentRoleQueryKey, principalId, tenantId, sessionId, roles, permissions],
    queryFn: getCurrentRole,
    staleTime: Infinity,
  });
  const authFailed = authStatus === 'error' || authError !== null;
  const permissionError = query.error !== null || authFailed;
  const permissionUnavailable = query.isPending || query.isFetching || permissionError;
  const permissionContextKey = JSON.stringify([
    principalId,
    tenantId,
    sessionId,
    roles,
    permissions,
    authStatus,
    authError,
  ]);

  return {
    ...query,
    data: permissionUnavailable ? undefined : query.data,
    permissionContextKey,
    permissionError,
    permissionUnavailable,
  };
}
