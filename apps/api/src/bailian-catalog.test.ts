import {describe,expect,it} from 'vitest';
import {bailianModelIds,bailianModelPresets,bailianReasoningModels,findBailianPreset} from './bailian-catalog.js';
import {defaultMoneyPolicy} from './money-pricing.js';
import {modelPriceReference,referenceRates} from './model-price-reference.js';

describe('curated Aliyun Bailian catalog',()=>{
  it('keeps one reviewed model per category with unique upstream ids',()=>{
    const categories=bailianModelPresets.map(preset=>preset.category);
    expect(new Set(bailianModelIds).size).toBe(bailianModelIds.length);
    expect(new Set(categories).size).toBe(categories.length);
    expect(bailianModelIds).toContain('qwen4-max');
    expect(bailianModelIds).toContain('deepseek-v4.1-flash-1017');
    expect(bailianModelPresets).toHaveLength(10);
  });
  it('declares reasoning only for models verified to emit reasoning output',()=>{
    expect(bailianReasoningModels).toContain('qwen4-max');
    expect(bailianReasoningModels).toContain('deepseek-v4-pro-0813');
    expect(bailianReasoningModels).not.toContain('glm-5.3');
    expect(bailianReasoningModels).not.toContain('qwen3-coder-flash');
  });
  it('prices Bailian from the official CNY list with the requested multiplier',()=>{
    const ref=modelPriceReference('bailian','qwen4-max',defaultMoneyPolicy.prices)!;
    expect(ref.source).toBe('OFFICIAL_BAILIAN');
    expect(referenceRates(ref,1,[])).toMatchObject({inputRate:'100.000000',cachedInputRate:'5.000000',outputRate:'300.000000'});
    expect(referenceRates(ref,.1,[])).toMatchObject({inputRate:'10.000000',cachedInputRate:'0.500000',outputRate:'30.000000'});
  });
  it('applies peak and off-peak rates to DeepSeek models sold through Bailian',()=>{
    const ref=modelPriceReference('bailian','deepseek-v4.1-flash',defaultMoneyPolicy.prices)!;
    expect(referenceRates(ref,1,[],new Date('2026-10-15T02:00:00Z'))).toMatchObject({inputRate:'20.000000',cachedInputRate:'0.400000',outputRate:'80.000000'});
    expect(referenceRates(ref,1,[],new Date('2026-10-15T14:00:00Z'))).toMatchObject({inputRate:'10.000000',cachedInputRate:'0.200000',outputRate:'40.000000'});
  });
  it('does not invent prices for unknown Bailian models',()=>{
    expect(findBailianPreset('qwen-imaginary')).toBeUndefined();
    expect(modelPriceReference('bailian','qwen-imaginary',defaultMoneyPolicy.prices)).toBeNull();
  });
});
