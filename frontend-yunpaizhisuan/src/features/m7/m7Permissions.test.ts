import { describe, expect, it } from 'vitest';
import { canApproveM7OverIssue, resolveM7ApprovalRoles } from './m7Permissions';

describe('canApproveM7OverIssue', () => {
  it.each(['team-leader', 'factory-director', 'approver', 'system'])(
    'allows the M7 backend approval role %s',
    (role) => {
      expect(canApproveM7OverIssue([role])).toBe(true);
    },
  );

  it('rejects warehouse and shared development roles', () => {
    expect(canApproveM7OverIssue(['warehouse'])).toBe(false);
    expect(canApproveM7OverIssue(['shared_developer', 'reviewer'])).toBe(false);
  });

  it('uses delegated backend roles in real API mode even when a demo role is displayed', () => {
    const roles = resolveM7ApprovalRoles(
      ['shared_developer', 'reviewer'],
      'factory-director',
      false,
    );

    expect(roles).toEqual(['shared_developer', 'reviewer']);
    expect(canApproveM7OverIssue(roles)).toBe(false);
  });

  it('uses the displayed role only in MSW demo mode', () => {
    const roles = resolveM7ApprovalRoles(['shared_developer'], 'team-leader', true);

    expect(roles).toEqual(['team-leader']);
    expect(canApproveM7OverIssue(roles)).toBe(true);
  });
});
