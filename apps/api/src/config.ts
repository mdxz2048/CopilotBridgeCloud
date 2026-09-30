import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  ACCESS_SECRET: z.string().min(32),
  REFRESH_TOKEN_PEPPER: z.string().min(32),
  PROVIDER_MASTER_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
  PUBLIC_BASE_URL: z.string().url(),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(2).default(0),
  TRUSTED_PROXY_CIDRS: z.string().default('127.0.0.0/8,::1/128'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  STAGED_EMAIL_REGISTRATION_ENABLED: z.enum(['true', 'false']).default('false'),
  TURNSTILE_SITE_KEY: z.string().optional(),
  TURNSTILE_SECRET_KEY: z.string().optional(),
  TURNSTILE_EXPECTED_HOSTNAME: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.preprocess(value => value === '' ? undefined : value, z.coerce.number().int().min(1).max(65535).optional()),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.preprocess(value => value === '' ? undefined : value, z.email().optional()),
}).superRefine((value, ctx) => {
  if (value.STAGED_EMAIL_REGISTRATION_ENABLED !== 'true') return;
  for (const key of ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY', 'TURNSTILE_EXPECTED_HOSTNAME',
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'] as const) {
    if (!value[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} required when staged registration is enabled` });
  }
  if (value.TURNSTILE_EXPECTED_HOSTNAME !== new URL(value.PUBLIC_BASE_URL).hostname)
    ctx.addIssue({ code: 'custom', path: ['TURNSTILE_EXPECTED_HOSTNAME'], message: 'Must match PUBLIC_BASE_URL hostname' });
});
export const config = schema.parse(process.env);
