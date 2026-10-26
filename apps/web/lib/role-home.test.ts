import { describe, expect, it } from 'vitest';
import { roleHome } from './role-home';

describe('role home', () => {
  it('keeps users and administrators in separate consoles', () => {
    expect(roleHome('USER')).toBe('/dashboard');
    expect(roleHome('ADMIN')).toBe('/admin');
    expect(() => roleHome('UNKNOWN')).toThrow('UNKNOWN_ACCOUNT_ROLE');
  });
  it('only permits a validated order lookup after administrator login',()=>{
    expect(roleHome('ADMIN','order-123456')).toBe('/admin?section=purchases&order=ORDER-123456');
    expect(roleHome('USER','ORDER-123456')).toBe('/dashboard');
    for(const value of ['https://evil.test','//evil.test','javascript:alert(1)','<script>','x'.repeat(65)])expect(roleHome('ADMIN',value)).toBe('/admin');
  });
});
