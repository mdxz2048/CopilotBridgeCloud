import { createMockServer } from './mock.js';

const app = await createMockServer();
const port = Number(process.env.MOCK_API_PORT ?? 3001);
await app.listen({ host: '127.0.0.1', port });
process.stdout.write(`Mock Desktop API ready on http://127.0.0.1:${port}\n`);
