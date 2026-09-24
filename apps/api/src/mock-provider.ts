import { randomUUID } from 'node:crypto';
import type { CanonicalRequest, CanonicalResult, ProviderAdapter, ResponseInput } from './provider.js';

function inputText(input: ResponseInput): string {
  if (typeof input === 'string') return input;
  return input.map(item => {
    const value = item.content ?? item.output ?? '';
    return typeof value === 'string' ? value : JSON.stringify(value);
  }).join('\n');
}
export class MockProvider implements ProviderAdapter {
  async health() { return { ready: true }; }
  async listModels() { return ['mock-chat']; }
  async createResponse(request: CanonicalRequest, _modelId?: string, _signal?: AbortSignal): Promise<CanonicalResult> {
    const input = inputText(request.input);
    const toolOutputs = Array.isArray(request.input)
      ? request.input.flatMap(item => item.type === 'function_call_output' ? [String(item.output ?? '')] : [])
      : [];
    const nextTool = request.tools?.[toolOutputs.length];
    const output = nextTool
      ? [{ type: 'function_call', call_id: `call_${randomUUID()}`, name: String(nextTool.name ?? 'mock_tool'), arguments: '{}' }]
      : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: toolOutputs.length
        ? `Tool result received:\n${toolOutputs.join('\n')}`
        : `Mock response: ${input}` }] }];
    const inputTokens = Math.ceil(input.length / 4);
    const outputTokens = 8;
    return { output, inputTokens, outputTokens, providerReportedUsage: { input_tokens: inputTokens, output_tokens: outputTokens }, costKind: 'UNKNOWN' };
  }
  async resumeSession(request: CanonicalRequest, modelId: string, _id: string, signal: AbortSignal) { return this.createResponse(request, modelId, signal); }
  async closeSession() {}
}
