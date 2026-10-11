import {describe,expect,it} from 'vitest';
import {minimumRmbToPoints,rateDraftPayload,ratePointsToRmb,rmbToRatePoints} from './rate-money';
describe('RMB administration rate conversions',()=>{
  it('converts RMB per million tokens to points per thousand exactly',()=>{
    expect(rmbToRatePoints('1')).toBe('10');expect(rmbToRatePoints('0.0000001')).toBe('0.000001');
    expect(ratePointsToRmb('12.345678')).toBe('1.2345678');
    for(const value of ['0','0.1','1.2345678','100'])expect(ratePointsToRmb(rmbToRatePoints(value))).toBe(value);
  });
  it('converts image/tool amounts and integer minimum points without rounding',()=>{
    expect(rmbToRatePoints('0.003','item')).toBe('30');expect(ratePointsToRmb('30','item')).toBe('0.003');
    expect(minimumRmbToPoints('0.0001')).toBe(1);expect(minimumRmbToPoints('100')).toBe(1_000_000);
    expect(()=>minimumRmbToPoints('0.00001')).toThrow();expect(()=>minimumRmbToPoints('100.0001')).toThrow();
    expect(()=>rmbToRatePoints('0.00000001')).toThrow();
  });
  it('requires positive commercial input/output and sends explicit optional zero rates as a draft',()=>{
    expect(()=>rateDraftPayload({})).toThrow();expect(()=>rateDraftPayload({inputRate:'0',outputRate:'1'})).toThrow();
    expect(()=>rateDraftPayload({inputRate:'-1',outputRate:'2'})).toThrow();
    expect(rateDraftPayload({inputRate:'2',outputRate:'8',toolRate:'0.001',minimumCharge:'0.0002'})).toEqual({inputRate:'20',outputRate:'80',cachedInputRate:'0',reasoningRate:'0',imageInputRate:'0',imageOutputRate:'0',toolRate:'10',minimumCharge:2,effectiveFrom:null});
  });
});
