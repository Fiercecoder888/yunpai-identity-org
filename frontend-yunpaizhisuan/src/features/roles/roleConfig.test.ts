import { describe, expect, it } from 'vitest';
import { defaultRoleLanding, landingKindForRoleId, roleLandingConfigById } from './roleConfig';

describe('roleConfig', () => {
  it('maps the four demo roles to their landing kinds', () => {
    expect(landingKindForRoleId('factory-director').kind).toBe('factory-director');
    expect(landingKindForRoleId('quality-assurance').kind).toBe('quality-assurance');
    expect(landingKindForRoleId('team-leader').kind).toBe('team-leader');
    expect(landingKindForRoleId('worker').kind).toBe('worker');
  });

  it('falls back to the default landing for unknown or missing roles', () => {
    expect(landingKindForRoleId(undefined)).toBe(defaultRoleLanding);
    expect(landingKindForRoleId('unknown-role')).toBe(defaultRoleLanding);
    // 已收敛的多余角色同样回退默认
    expect(landingKindForRoleId('pmc-planner')).toBe(defaultRoleLanding);
    expect(landingKindForRoleId('purchaser')).toBe(defaultRoleLanding);
    expect(landingKindForRoleId('quality')).toBe(defaultRoleLanding);
  });

  it('covers exactly the four configured role landings', () => {
    expect(Object.values(roleLandingConfigById).map((config) => config.kind).sort()).toEqual([
      'factory-director',
      'quality-assurance',
      'team-leader',
      'worker',
    ]);
  });

  it('maps every role to a concrete landing path', () => {
    expect(landingKindForRoleId('factory-director').landingPath).toBe('/');
    expect(landingKindForRoleId('quality-assurance').landingPath).toBe('/');
    expect(landingKindForRoleId('team-leader').landingPath).toBe('/leader');
    expect(landingKindForRoleId('worker').landingPath).toBe('/worker');
    expect(defaultRoleLanding.landingPath).toBe('/home');
  });

  it('defines role-specific metric keys without sharing an empty default', () => {
    for (const config of Object.values(roleLandingConfigById)) {
      expect(config.metrics.length).toBeGreaterThan(0);
    }
    expect(defaultRoleLanding.metrics).toEqual([]);
  });
});
