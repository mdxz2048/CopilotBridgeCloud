import { createMockServer } from './mock.js';
import { z } from 'zod';

const positive = z.coerce.number().int().min(1).max(120);
const app = await createMockServer({
  accountRpm: positive.parse(process.env.MOCK_AI_ACCOUNT_RPM ?? 2),
  deviceRpm: positive.parse(process.env.MOCK_AI_DEVICE_RPM ?? 1),
});
const port = Number(process.env.MOCK_API_PORT ?? 3001);
await app.listen({ host: '127.0.0.1', port });
process.stdout.write(`Mock Desktop API ready on http://127.0.0.1:${port}\n`);
