export function roleHome(role: string,reviewOrder?:string|null): string {
  if (role === 'ADMIN') return reviewOrder&&/^[0-9A-Za-z-]{6,64}$/.test(reviewOrder)?`/admin?section=purchases&order=${encodeURIComponent(reviewOrder.toUpperCase())}`:'/admin';
  if (role === 'USER') return '/dashboard';
  throw new Error('UNKNOWN_ACCOUNT_ROLE');
}
