'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../lib/api';
import { roleHome } from '../lib/role-home';

export function useAuthRedirect() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [identityError, setIdentityError] = useState(false);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    api<{ user: { role: string } }>('/api/v1/auth/me', { signal: controller.signal })
      .then(({ user }) => { if (active) router.replace(roleHome(user.role)); })
      .catch(error => {
        if (!active) return;
        const authError = error as { code?: string; status?: number };
        setIdentityError(authError.status !== 401 && authError.code !== 'UNAUTHORIZED' && authError.code !== 'TOKEN_EXPIRED');
        setChecking(false);
      })
      .finally(() => window.clearTimeout(timeout));
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [router]);
  return { checking, identityError };
}
