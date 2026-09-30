import { createHash } from 'node:crypto';
import type { CanonicalRequest, CanonicalResult } from './provider.js';

const MAX_CONTINUATIONS = 8;
const CONTINUATION_WINDOW_MS = 5 * 60_000;

export type ContinuationState = {
  pendingCallIds: string[];
  remaining: number;
  expiresAt: number;
  transcriptHash: string;
  transcriptLength: number;
  satisfiedCallIds: string[];
};

function transcript(input: CanonicalRequest['input']) {
  return typeof input === 'string' ? [{ role: 'user', content: input }] : input;
}

function fingerprint(input: Array<Record<string, unknown>>) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export function pendingContinuation(value: Record<string, unknown>, request: CanonicalRequest, now: number): ContinuationState | null {
  const pending = value.pendingCallIds;
  const remaining = value.remaining;
  const expiresAt = value.expiresAt;
  const transcriptHash = value.transcriptHash;
  const transcriptLength = value.transcriptLength;
  if (!Array.isArray(pending) || !pending.length || !pending.every(id => typeof id === 'string')
    || !Number.isInteger(remaining) || typeof remaining !== 'number' || remaining < 1 || remaining > MAX_CONTINUATIONS
    || typeof expiresAt !== 'number' || expiresAt <= now || expiresAt > now + CONTINUATION_WINDOW_MS
    || typeof transcriptHash !== 'string' || !/^[a-f0-9]{64}$/.test(transcriptHash)
    || typeof transcriptLength !== 'number' || !Number.isSafeInteger(transcriptLength) || transcriptLength < 1
    || !Array.isArray(request.input) || !request.input.length) return null;
  const outputOnly = request.input.every(item => item.type === 'function_call_output');
  const prefixLength = outputOnly ? 0 : transcriptLength;
  if (!outputOnly && (request.input.length <= prefixLength
    || fingerprint(request.input.slice(0, prefixLength)) !== transcriptHash)) return null;
  const suffix = request.input.slice(prefixLength);
  if (!suffix.length || suffix.some(item => item.type !== 'function_call_output')) return null;
  const outputs = suffix.map(item => item.call_id);
  const satisfiedCallIds = pending.filter(id => outputs.includes(id));
  if (!satisfiedCallIds.length || satisfiedCallIds.some(id => outputs.filter(output => output === id).length !== 1)) return null;
  return { pendingCallIds: pending, remaining, expiresAt, transcriptHash, transcriptLength, satisfiedCallIds };
}

export function nextContinuationState(request: CanonicalRequest, result: CanonicalResult, prior: ContinuationState | null, now: number): Record<string, unknown> {
  const remaining = prior ? prior.remaining - 1 : MAX_CONTINUATIONS;
  const calls = result.output.filter(item => item.type === 'function_call' && typeof item.call_id === 'string')
    .map(item => ({ type: 'function_call', call_id: item.call_id, name: item.name, arguments: item.arguments }));
  const outstanding = prior?.pendingCallIds.filter(id => !prior.satisfiedCallIds.includes(id)) ?? [];
  if ((!calls.length && !outstanding.length) || remaining < 1) return {};
  const expiresAt = prior?.expiresAt ?? now + CONTINUATION_WINDOW_MS;
  const history = [...transcript(request.input), ...calls];
  return expiresAt > now
    ? { pendingCallIds: [...outstanding, ...calls.map(call => call.call_id)], remaining, expiresAt,
      transcriptHash: fingerprint(history), transcriptLength: history.length }
    : {};
}
