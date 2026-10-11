export type ManagedProviderKind = 'DEEPSEEK' | 'OPENAI';
export function managedProviderKind(code: string): ManagedProviderKind | null {
  if (/^DEEPSEEK(?:_|$)/.test(code)) return 'DEEPSEEK';
  if (/^OPENAI(?:_|$)/.test(code)) return 'OPENAI';
  return null;
}
export function providerMatchesLogicalModel(publicId: string, code: string): boolean {
  const kind = managedProviderKind(code);
  return kind === 'OPENAI' ? publicId.startsWith('openai/')
    : kind === 'DEEPSEEK' && /^deepseek(?:\/|_|-)/.test(publicId);
}
export function providerCanPriceModel(
  model:{id:string;providerId:string;providerModelId:string;publicId:string},
  provider:{id:string;code:string},
  instances:Array<{modelId:string;providerId:string;providerModelId:string}>,
):boolean {
  if(!providerMatchesLogicalModel(model.publicId,provider.code))return false;
  return model.providerId===provider.id||instances.some(instance=>instance.modelId===model.id
    &&instance.providerId===provider.id&&instance.providerModelId===model.providerModelId);
}
