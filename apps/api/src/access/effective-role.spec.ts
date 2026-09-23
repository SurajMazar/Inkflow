import { describe, expect, it } from 'vitest';
import { computeEffectiveRole, workspaceDerivedRole } from './effective-role';

const none = {
  isOwner: false,
  memberRole: null,
  workspaceRole: null,
  workspaceAccess: 'EDITOR',
  linkRole: null,
} as const;

describe('effective board role', () => {
  it('has no access without any grant', () => {
    expect(computeEffectiveRole(none)).toEqual({ role: null, ownRole: null, viaShareLink: false });
  });

  it('makes the owner and workspace admins OWNER', () => {
    expect(computeEffectiveRole({ ...none, isOwner: true }).role).toBe('OWNER');
    expect(
      computeEffectiveRole({ ...none, workspaceRole: 'ADMIN', workspaceAccess: 'NONE' }).role,
    ).toBe('OWNER');
    expect(
      computeEffectiveRole({ ...none, workspaceRole: 'OWNER', workspaceAccess: 'NONE' }).role,
    ).toBe('OWNER');
  });

  it('maps workspace members through workspaceAccess', () => {
    expect(workspaceDerivedRole('MEMBER', 'EDITOR')).toBe('EDITOR');
    expect(workspaceDerivedRole('MEMBER', 'VIEWER')).toBe('VIEWER');
    expect(workspaceDerivedRole('MEMBER', 'NONE')).toBeNull();
    expect(workspaceDerivedRole(null, 'EDITOR')).toBeNull();
  });

  it('takes the maximum of member role, workspace role and share link', () => {
    expect(
      computeEffectiveRole({
        ...none,
        memberRole: 'VIEWER',
        workspaceRole: 'MEMBER',
        workspaceAccess: 'EDITOR',
      }).role,
    ).toBe('EDITOR');
    expect(
      computeEffectiveRole({
        ...none,
        memberRole: 'EDITOR',
        workspaceRole: 'MEMBER',
        workspaceAccess: 'VIEWER',
      }).role,
    ).toBe('EDITOR');
    const viaLink = computeEffectiveRole({ ...none, memberRole: 'VIEWER', linkRole: 'EDITOR' });
    expect(viaLink).toEqual({ role: 'EDITOR', ownRole: 'VIEWER', viaShareLink: true });
    const linkNotNeeded = computeEffectiveRole({
      ...none,
      memberRole: 'EDITOR',
      linkRole: 'VIEWER',
    });
    expect(linkNotNeeded).toEqual({ role: 'EDITOR', ownRole: 'EDITOR', viaShareLink: false });
    expect(computeEffectiveRole({ ...none, linkRole: 'VIEWER' })).toEqual({
      role: 'VIEWER',
      ownRole: null,
      viaShareLink: true,
    });
  });
});
