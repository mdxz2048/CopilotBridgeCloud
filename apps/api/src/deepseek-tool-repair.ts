import { z } from 'zod';
import type { CanonicalRequest, CanonicalResult } from './provider.js';
import type { ResponsesProfile } from './instance-router.js';
import { nativeToolBoundary } from './native-responses.js';
import { ApiError } from './errors.js';

type Item = Record<string, unknown>;
type Event = { type: string; event: Item };
type Pending = { added: Item; item: Item; raw: string; emitted?: Item };
const LIMIT = 1024 * 1024;
const command = z.strictObject({
  cmd: z.string().min(1), justification: z.string().optional(), login: z.boolean().optional(),
  max_output_tokens: z.number().optional(), prefix_rule: z.array(z.string()).optional(),
  sandbox_permissions: z.enum(['use_default', 'require_escalated']).optional(), shell: z.string().optional(),
  tty: z.boolean().optional(), workdir: z.string().optional(), yield_time_ms: z.number().optional(),
});
const wrapperArguments = z.strictObject({ input: z.string().min(1) });
// A versioned recognition guard, not permission to expose methods found in history.
const signature = `cmd:string;justification?:string;login?:boolean;max_output_tokens?:number;prefix_rule?:Array<string>;sandbox_permissions?:"use_default"|"require_escalated";shell?:string;tty?:boolean;workdir?:string;yield_time_ms?:number;`;
const invalid = () => new ApiError(502, 'PROTOCOL_INVALID', '模型返回的内部命令工具调用无法安全转换，请重试本轮请求。');

/** Repair a known misplaced method or wrapper name. Never executes tools or retries a POST. */
export class DeepSeekToolRepair {
  private readonly enabled: boolean;
  private readonly pending = new Map<string, Pending>();
  private readonly calls = new Set<Pending>();
  private readonly repaired = new Map<string, { canonical: string; item: Item }>();
  private sequence = 0;
  constructor(request: CanonicalRequest, profile: ResponsesProfile, private readonly audit: (data: Item) => void = () => {}) {
    const tools = nativeToolBoundary(request, profile).tools;
    const wrappers = tools?.filter(t => t.name === 'functions__exec') ?? [];
    const declaration = String(wrappers[0]?.description ?? '').match(/declare const tools: \{ exec_command\(args: \{([\s\S]*?)\}\): Promise</)?.[1];
    const compact = declaration?.replace(/\/\/[^\r\n]*/g, '').replace(/\s/g, '');
    const declared = (request.tools ?? []).filter(t => t.type === 'function' || t.type === 'custom');
    this.enabled = profile === 'deepseek' && wrappers.length === 1 && compact === signature &&
      !declared.some(t => t.name === 'exec_command' || String(t.name).endsWith('__exec_command'));
  }
  candidate(item: Item) { return this.enabled && item.type === 'function_call' && item.name === 'exec_command'; }
  // Buffering can reorder call events relative to text and can change their count.
  // Number the relayed stream (including its terminal), never reuse upstream numbers.
  relay(event: Item): Item { return this.enabled ? { ...event, sequence_number: this.sequence++ } : event; }
  private rewrite(item: Item): Item {
    if (!this.candidate(item)) return item;
    if (typeof item.call_id !== 'string' || !item.call_id || typeof item.arguments !== 'string' || Buffer.byteLength(item.arguments) > LIMIT) throw invalid();
    let args: unknown;
    try { args = JSON.parse(item.arguments); } catch { throw invalid(); }
    const isWrapper = wrapperArguments.safeParse(args).success;
    if (!isWrapper && !command.safeParse(args).success) throw invalid();
    const canonical = JSON.stringify(args), cached = this.repaired.get(item.call_id);
    if (cached) {
      if (cached.canonical !== canonical || cached.item.id !== item.id) throw invalid();
      return { ...item, name: cached.item.name, arguments: cached.item.arguments };
    }
    // JSON.parse of a string literal preserves JSON keys (including __proto__) and
    // prevents shell text, backticks or ${...} from becoming JavaScript source.
    // Some responses already contain the declared wrapper's exact {input} shape
    // but carry the nested method's name. Preserve that source verbatim; wrapping
    // it again would pass JavaScript as shell arguments instead of restoring it.
    const input = `text(await tools.exec_command(JSON.parse(${JSON.stringify(canonical)})));`;
    const output = { ...item, name: 'functions__exec', arguments: isWrapper ? item.arguments : JSON.stringify({ input }) };
    this.repaired.set(item.call_id, { canonical, item: output });
    this.audit({ from: 'exec_command', to: 'functions__exec', mode: isWrapper ? 'wrapper_name' : 'nested_command', callId: item.call_id, itemId: item.id, argumentKeys: Object.keys(args as object) });
    return output;
  }
  private keys(event: Item) {
    const item = event.item as Item | undefined;
    return [event.item_id ?? item?.id, event.output_index === undefined ? undefined : `index:${event.output_index}`].filter(v => v !== undefined).map(String);
  }
  private finish(state: Pending, raw: unknown): Event[] {
    if (typeof raw !== 'string') throw invalid();
    const item = this.rewrite({ ...state.item, arguments: raw });
    if (state.emitted) return []; // rewrite above also verifies repeated/final arguments.
    state.emitted = item;
    const common: Item = { ...state.added, item_id: item.id }; delete common.item;
    return [
      { type: 'response.output_item.added', event: { ...state.added, item: { ...item, arguments: '' } } },
      { type: 'response.function_call_arguments.delta', event: { ...common, type: 'response.function_call_arguments.delta', delta: item.arguments } },
      { type: 'response.function_call_arguments.done', event: { ...common, type: 'response.function_call_arguments.done', arguments: item.arguments } },
    ];
  }
  events(type: string, event: Item): Event[] {
    const item = event.item as Item | undefined;
    if (type === 'response.output_item.added' && item && this.candidate(item)) {
      const keys = this.keys(event);
      if (!keys.length || keys.some(k => this.pending.has(k))) throw invalid();
      const state: Pending = { added: event, item, raw: String(item.arguments ?? '') };
      if (Buffer.byteLength(state.raw) > LIMIT) throw invalid();
      for (const key of keys) this.pending.set(key, state);
      this.calls.add(state);
      return [];
    }
    const state = this.keys(event).map(k => this.pending.get(k)).find(Boolean);
    if (state && type === 'response.function_call_arguments.delta') {
      if (state.emitted || typeof event.delta !== 'string') throw invalid();
      state.raw += event.delta;
      if (Buffer.byteLength(state.raw) > LIMIT) throw invalid();
      return [];
    }
    if (state && type === 'response.function_call_arguments.done') return this.finish(state, event.arguments ?? state.raw);
    if (type === 'response.output_item.done' && item && this.candidate(item)) {
      if (!state || item.call_id !== state.item.call_id || item.id !== state.item.id) throw invalid();
      return [...this.finish(state, item.arguments), { type, event: { ...event, item: this.rewrite(item) } }];
    }
    return [{ type, event }];
  }
  result(result: CanonicalResult): CanonicalResult {
    const output = result.output.map(item => this.rewrite(item));
    if (result.status === 'completed') for (const state of this.calls) {
      if (!state.emitted || !output.some(item => item.call_id === state.item.call_id)) throw invalid();
    }
    return { ...result, output, ...(result.nativeResponse ? { nativeResponse: { ...result.nativeResponse, output } } : {}) };
  }
}
