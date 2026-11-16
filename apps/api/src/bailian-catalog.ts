/**
 * Curated Aliyun Bailian (DashScope) catalog.
 *
 * The workspace exposes 180+ upstream models, including image, audio, embedding
 * and rerank models that the desktop Responses bridge cannot use. Keep one
 * current text/agent model per family/tier here instead of importing the whole
 * catalog. Prices are the official Beijing CNY list prices per million tokens
 * (see https://help.aliyun.com/zh/model-studio/model-pricing); tiered models use
 * the base tier, so a long-context request can cost more upstream than the
 * flat rate card records.
 */
export type BailianPriceBand = { input: number; cached: number; output: number };
export type BailianPricePeriod = { id: 'standard' | 'offPeak' | 'peak'; label: string; prices: BailianPriceBand };
export type BailianModelPreset = {
  id: string;
  name: string;
  category: string;
  reasoning: boolean;
  /** Image input verified against the Responses endpoint (data URL accepted). */
  vision: boolean;
  contextWindow: number;
  maxOutputTokens: number;
  sortOrder: number;
  periods: BailianPricePeriod[];
};

const standard = (input: number, cached: number, output: number): BailianPricePeriod[] =>
  [{ id: 'standard', label: '标准（人民币／百万 Token）', prices: { input, cached, output } }];

export const bailianModelPresets: BailianModelPreset[] = [
  {
    id: 'qwen4-max', name: 'Qwen4 Max', category: '千问旗舰', reasoning: true, vision: true,
    contextWindow: 1_000_000, maxOutputTokens: 393_216, sortOrder: 10,
    periods: standard(10, 0.5, 30),
  },
  {
    id: 'qwen3.8-flash', name: 'Qwen3.8 Flash', category: '千问快速', reasoning: true, vision: true,
    contextWindow: 1_000_000, maxOutputTokens: 131_072, sortOrder: 20,
    periods: standard(0.8, 0.1, 2.7),
  },
  {
    id: 'qwen3.7-plus', name: 'Qwen3.7 Plus', category: '千问均衡', reasoning: true, vision: true,
    contextWindow: 1_000_000, maxOutputTokens: 131_072, sortOrder: 30,
    periods: standard(2, 0.4, 8),
  },
  {
    id: 'qwen3.8-27b', name: 'Qwen3.8 27B', category: '千问轻量', reasoning: true, vision: true,
    contextWindow: 1_000_000, maxOutputTokens: 131_072, sortOrder: 40,
    periods: standard(3, 0.6, 12),
  },
  {
    id: 'qwen3-coder-flash', name: 'Qwen3 Coder Flash', category: '代码', reasoning: false, vision: false,
    contextWindow: 1_000_000, maxOutputTokens: 65_536, sortOrder: 50,
    periods: standard(1, 0.2, 4),
  },
  {
    id: 'glm-5.3', name: 'GLM-5.3', category: '智谱', reasoning: false, vision: false,
    contextWindow: 1_000_000, maxOutputTokens: 131_072, sortOrder: 60,
    periods: standard(8, 2, 28),
  },
  {
    id: 'kimi-k3.1-pro', name: 'Kimi K3.1 Pro', category: 'Kimi', reasoning: true, vision: true,
    contextWindow: 1_000_000, maxOutputTokens: 1_048_576, sortOrder: 70,
    periods: standard(13, 1.3, 68),
  },
  {
    id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', category: 'DeepSeek 快速', reasoning: true, vision: true,
    contextWindow: 1_000_000, maxOutputTokens: 393_216, sortOrder: 80,
    periods: [
      { id: 'offPeak', label: '空闲时段', prices: { input: 1, cached: 0.02, output: 4 } },
      { id: 'peak', label: '高峰时段', prices: { input: 2, cached: 0.04, output: 8 } },
    ],
  },
  {
    id: 'deepseek-v4.1-flash-1017', name: 'DeepSeek V4.1 Flash 1017', category: 'DeepSeek 快速（快照）', reasoning: true, vision: true,
    contextWindow: 1_000_000, maxOutputTokens: 393_216, sortOrder: 85,
    periods: [
      { id: 'offPeak', label: '空闲时段', prices: { input: 1, cached: 0.02, output: 4 } },
      { id: 'peak', label: '高峰时段', prices: { input: 2, cached: 0.04, output: 8 } },
    ],
  },
  {
    id: 'deepseek-v4-pro-0813', name: 'DeepSeek V4 Pro', category: 'DeepSeek 旗舰', reasoning: true, vision: true,
    contextWindow: 1_000_000, maxOutputTokens: 393_216, sortOrder: 90,
    periods: [
      { id: 'offPeak', label: '空闲时段', prices: { input: 4.5, cached: 0.45, output: 13.5 } },
      { id: 'peak', label: '高峰时段', prices: { input: 9, cached: 0.9, output: 27 } },
    ],
  },
];

export const bailianModelIds = bailianModelPresets.map(preset => preset.id);
export const bailianReasoningModels = bailianModelPresets.filter(preset => preset.reasoning).map(preset => preset.id);
export const findBailianPreset = (id: string) => bailianModelPresets.find(preset => preset.id === id);
