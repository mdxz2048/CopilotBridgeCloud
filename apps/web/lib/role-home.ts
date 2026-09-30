export function roleHome(role: string): '/admin' | '/dashboard' {
  if (role === 'ADMIN') return '/admin';
  if (role === 'USER') return '/dashboard';
  throw new Error('UNKNOWN_ACCOUNT_ROLE');
}
