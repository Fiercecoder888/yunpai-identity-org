const M7_OVER_ISSUE_APPROVAL_ROLES = new Set([
  'team-leader',
  'factory-director',
  'approver',
  'system',
]);

export function canApproveM7OverIssue(roles: readonly string[]): boolean {
  return roles.some((role) => M7_OVER_ISSUE_APPROVAL_ROLES.has(role));
}

export function resolveM7ApprovalRoles(
  delegatedRoles: readonly string[],
  displayedRole: string | undefined,
  mswDemoMode: boolean,
): readonly string[] {
  if (!mswDemoMode) return delegatedRoles;
  return displayedRole ? [displayedRole] : [];
}
