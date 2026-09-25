import { describe, expect, it } from 'vitest';
import { accessFor, canEditRow, canManageSharing } from './access';
import type { Profile, ShareRow } from './types';

const me = (over: Partial<Profile> = {}) => ({ id: 'u1', role: 'editor' as const, team: 'marketing' as const, is_active: true, ...over });
const row = (over: Partial<{ id: string; owner_id: string | null; team: Profile['team']; is_template: boolean }> = {}) =>
  ({ id: 'a1', owner_id: 'u9', team: 'sales_ae' as Profile['team'], is_template: false, ...over });
const share = (permission: ShareRow['permission']) => [{ assessment_id: 'a1', user_id: 'u1', permission }];

describe('accessFor', () => {
  it('admins and owners get owner access', () => {
    expect(accessFor(row(), me({ role: 'admin' }))).toBe('owner');
    expect(accessFor(row({ owner_id: 'u1' }), me())).toBe('owner');
  });
  it('teammates and legacy (no team) rows get edit, capped at view for viewers', () => {
    expect(accessFor(row({ team: 'marketing' }), me())).toBe('edit');
    expect(accessFor(row({ team: null }), me())).toBe('edit');
    expect(accessFor(row({ team: 'marketing' }), me({ role: 'viewer' }))).toBe('view');
  });
  it('shares grant their permission', () => {
    expect(accessFor(row(), me(), share('view'))).toBe('view');
    expect(accessFor(row(), me(), share('edit'))).toBe('edit');
    expect(accessFor(row(), me({ role: 'viewer' }), share('edit'))).toBe('view');
  });
  it('templates are viewable; everything else is hidden', () => {
    expect(accessFor(row({ is_template: true }), me())).toBe('view');
    expect(accessFor(row(), me())).toBeNull();
    expect(accessFor(row({ team: null }), me({ is_active: false }))).toBeNull();
  });
});

describe('permissions', () => {
  it('only owner/edit with an editing role can edit', () => {
    expect(canEditRow('edit', me())).toBe(true);
    expect(canEditRow('view', me())).toBe(false);
    expect(canEditRow('owner', me({ role: 'viewer' }))).toBe(false);
  });
  it('owner, admin and teammates manage sharing; share recipients do not', () => {
    expect(canManageSharing(row({ owner_id: 'u1' }), me())).toBe(true);
    expect(canManageSharing(row(), me({ role: 'admin' }))).toBe(true);
    expect(canManageSharing(row({ team: 'marketing' }), me())).toBe(true);
    expect(canManageSharing(row(), me())).toBe(false);
    expect(canManageSharing(row({ team: null }), me())).toBe(false);
  });
});
