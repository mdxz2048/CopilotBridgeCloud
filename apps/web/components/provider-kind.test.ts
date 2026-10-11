import {describe,expect,it} from 'vitest';
import {managedProviderKind,providerCanPriceModel,providerMatchesLogicalModel} from './provider-kind';
describe('managed connection types and model bindings',()=>{
  it('recognizes canonical and multiple-key connections without classifying unrelated providers',()=>{
    expect(managedProviderKind('OPENAI')).toBe('OPENAI');
    expect(managedProviderKind('OPENAI_ABC123')).toBe('OPENAI');
    expect(managedProviderKind('DEEPSEEK_ABC123')).toBe('DEEPSEEK');
    for(const code of ['MOCK','COPILOT','OPENAIOTHER','DEEPSEEKOTHER'])expect(managedProviderKind(code)).toBeNull();
  });
  it('blocks cross-provider instance bindings while preserving legacy DeepSeek namespaces',()=>{
    expect(providerMatchesLogicalModel('openai/gpt-fixture','OPENAI_ABC')).toBe(true);
    expect(providerMatchesLogicalModel('deepseek/deepseek-flash','DEEPSEEK_ABC')).toBe(true);
    expect(providerMatchesLogicalModel('deepseek_legacy/deepseek-flash','DEEPSEEK_ABC')).toBe(true);
    expect(providerMatchesLogicalModel('openai/gpt-fixture','DEEPSEEK_ABC')).toBe(false);
    expect(providerMatchesLogicalModel('deepseek/deepseek-flash','OPENAI_ABC')).toBe(false);
    expect(providerMatchesLogicalModel('mock/echo','OPENAI_ABC')).toBe(false);
  });
  it('allows another same-family key only when its exact instance binding exists',()=>{
    const model={id:'m',providerId:'primary',providerModelId:'gpt-fixture',publicId:'openai/gpt-fixture'};
    const alternate={id:'secondary',code:'OPENAI_KEY2'};
    expect(providerCanPriceModel(model,alternate,[])).toBe(false);
    expect(providerCanPriceModel(model,alternate,[{modelId:'m',providerId:'secondary',providerModelId:'gpt-fixture'}])).toBe(true);
    expect(providerCanPriceModel(model,alternate,[{modelId:'m',providerId:'secondary',providerModelId:'other-model'}])).toBe(false);
    expect(providerCanPriceModel(model,{id:'secondary',code:'DEEPSEEK_KEY2'},[{modelId:'m',providerId:'secondary',providerModelId:'gpt-fixture'}])).toBe(false);
    expect(providerCanPriceModel(model,{id:'primary',code:'OPENAI'},[])).toBe(true);
  });
});
