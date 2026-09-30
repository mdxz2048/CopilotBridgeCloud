import { describe, expect, it } from 'vitest';
import { roleHome } from './role-home';

describe('role home', () => {
  it('keeps users and administrators in separate consoles', () => {
    expect(roleHome('USER')).toBe('/dashboard');
    expect(roleHome('ADMIN')).toBe('/admin');
    expect(() => roleHome('UNKNOWN')).toThrow('UNKNOWN_ACCOUNT_ROLE');
  });
});
