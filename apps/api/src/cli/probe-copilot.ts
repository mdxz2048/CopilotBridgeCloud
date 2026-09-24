import { CopilotClient } from '@github/copilot-sdk';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const explicitToken = process.argv.includes('--token-stdin') ? await new Promise<string>((resolve, reject) => {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { data += chunk; if (data.length > 4096) reject(new Error('TOKEN_TOO_LONG')); });
  process.stdin.on('end', () => resolve(data.trim()));
}) : null;
const baseDirectory = explicitToken ? await mkdtemp(join(tmpdir(), 'bridge-copilot-probe-')) : null;
const client = new CopilotClient(explicitToken
  ? { mode: 'empty', baseDirectory: baseDirectory!, gitHubToken: explicitToken, useLoggedInUser: false, logLevel: 'none' }
  : { logLevel: 'none', useLoggedInUser: true });
try {
  await client.start();
  const auth = await client.getAuthStatus();
  process.stdout.write(`${JSON.stringify({ authentication: { isAuthenticated: auth.isAuthenticated, login: auth.login, authType: auth.authType } })}\n`);
  const models = await client.listModels();
  process.stdout.write(`${JSON.stringify({ discoveredModels: models.map(model => ({ id: model.id, name: model.name, policy: model.policy })) })}\n`);
  const selected = models.find(model => model.id === process.env.COPILOT_PROBE_MODEL) ?? models.find(model => model.id !== 'auto');
  if (!selected) throw new Error('COPILOT_NO_MODELS');
  const session = await client.createSession({ model: selected.id, streaming: true, enableSessionStore: false, availableTools: [],
    onPermissionRequest: async () => ({ kind: 'reject' }) });
  const usage: Array<Record<string, unknown>> = [];
  const deltas: string[] = [];
  session.on('assistant.usage', event => usage.push({ model: event.data.model, inputTokens: event.data.inputTokens,
    outputTokens: event.data.outputTokens, cacheReadTokens: event.data.cacheReadTokens, cacheWriteTokens: event.data.cacheWriteTokens,
    reasoningTokens: event.data.reasoningTokens, cost: event.data.cost, providerCallId: event.data.providerCallId,
    serviceRequestId: event.data.serviceRequestId }));
  session.on('assistant.message_delta', event => { if (event.data.deltaContent) deltas.push(event.data.deltaContent); });
  const response = await session.sendAndWait({ prompt: 'Reply with exactly COPILOT_ENTITLEMENT_OK and nothing else.' }, 60000);
  process.stdout.write(`${JSON.stringify({ model: selected.id, content: response?.data.content, deltaCount: deltas.length, usage })}\n`);
  await session.disconnect();
} finally {
  await client.stop();
  if (baseDirectory) await rm(baseDirectory, { recursive: true, force: true });
}
