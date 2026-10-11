export type RateUnit='token'|'item';
// Decimal shifts preserve the API's six-decimal point precision without floating-point rounding.
function shift(value:string,power:number):string {
  if(!/^\d+(?:\.\d+)?$/.test(value.trim()))throw Error('金额必须为非负十进制数。');
  const [integer,fraction='']=value.trim().split('.');
  const digits=integer+fraction;const position=integer.length+power;
  const shifted=position<=0?'0.'+'0'.repeat(-position)+digits:position>=digits.length?digits+'0'.repeat(position-digits.length):digits.slice(0,position)+'.'+digits.slice(position);
  const [whole,part='']=shifted.split('.');const trimmed=part.replace(/0+$/,'');
  return (whole.replace(/^0+(?=\d)/,'')||'0')+(trimmed?'.'+trimmed:'');
}
export function rmbToRatePoints(value:string,unit:RateUnit='token'):string {
  const result=shift(value,unit==='token'?1:4);
  if((result.split('.')[1]?.length??0)>6)throw Error('金额精度超过服务端支持范围，请减少小数位。');
  return result;
}
export function ratePointsToRmb(value:unknown,unit:RateUnit='token'):string {return shift(String(value??'0'),unit==='token'?-1:-4);}
export function minimumRmbToPoints(value:string):number {
  const result=rmbToRatePoints(value,'item');
  if(result.includes('.')||BigInt(result)>1_000_000n)throw Error('最低消费需为 ¥0.0001 的整数倍，且不超过 ¥100。');
  return Number(result);
}
export function rateDraftPayload(form:Record<string,string>) {
  if(!form.inputRate?.trim()||!form.outputRate?.trim())throw Error('请填写输入和输出售价；草稿不会自动发布。');
  const inputRate=rmbToRatePoints(form.inputRate),outputRate=rmbToRatePoints(form.outputRate);
  if(Number(inputRate)<=0||Number(outputRate)<=0)throw Error('输入和输出售价必须大于 0，避免误发布免费商业费率。');
  return {inputRate,outputRate,cachedInputRate:rmbToRatePoints(form.cachedInputRate?.trim()||'0'),reasoningRate:rmbToRatePoints(form.reasoningRate?.trim()||'0'),
    imageInputRate:rmbToRatePoints(form.imageInputRate?.trim()||'0','item'),imageOutputRate:rmbToRatePoints(form.imageOutputRate?.trim()||'0','item'),
    toolRate:rmbToRatePoints(form.toolRate?.trim()||'0','item'),minimumCharge:minimumRmbToPoints(form.minimumCharge?.trim()||'0'),effectiveFrom:null};
}
