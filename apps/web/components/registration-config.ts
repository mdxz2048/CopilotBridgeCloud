'use client';
import { useEffect, useState } from 'react';

export type RegistrationConfig = {
  verificationRequired: boolean;
  registrationAvailable: boolean;
  turnstileSiteKey: string | null;
  configurationStatus: 'DISABLED' | 'READY' | 'MISSING_CONFIG';
};

export function useRegistrationConfig() {
  const [capabilities, setCapabilities] = useState<RegistrationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    fetch('/api/v1/auth/registration-config', { credentials: 'include', cache: 'no-store' })
      .then(async response => {
        // A pre-rollout backend has no capability endpoint and still accepts the legacy flow.
        if (response.status === 404) return {
          verificationRequired: false, registrationAvailable: true, turnstileSiteKey: null,
          configurationStatus: 'DISABLED' as const,
        };
        if (!response.ok) throw new Error('Capabilities unavailable');
        return response.json() as Promise<RegistrationConfig>;
      })
      .then(value => {
        if (active && typeof value.verificationRequired === 'boolean' && typeof value.registrationAvailable === 'boolean'
          && ['DISABLED', 'READY', 'MISSING_CONFIG'].includes(value.configurationStatus)) setCapabilities(value);
      })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const unavailable = !loading && (!capabilities || !capabilities.registrationAvailable
    || (capabilities.verificationRequired
      ? capabilities.configurationStatus !== 'READY' || !capabilities.turnstileSiteKey
      : capabilities.configurationStatus === 'READY'));
  return { capabilities, loading, unavailable };
}
