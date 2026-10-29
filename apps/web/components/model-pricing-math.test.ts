import {describe,it,expect} from 'vitest';
import {estimatedMarginPercent} from './model-pricing-math';
describe('estimated margin with supplier discounts',()=>{
 it('shows the same margin for GateAI and DeepSeek at 30% markup',()=>{
  expect(estimatedMarginPercent(.13,.1)).toBeCloseTo(23.076923);
  expect(estimatedMarginPercent(1.3,1)).toBeCloseTo(23.076923);
 });
 it('shows a loss only below supplier cost',()=>{expect(estimatedMarginPercent(.05,.1)).toBe(-100);});
 it('does not invent unknown costs or divide by invalid prices',()=>{
  expect(estimatedMarginPercent(.2)).toBeNull();expect(estimatedMarginPercent(0,.1)).toBeNull();expect(estimatedMarginPercent(NaN,.1)).toBeNull();
 });
});
