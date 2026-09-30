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
});
export const config = schema.parse(process.env);
