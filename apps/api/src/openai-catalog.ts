/** Official API IDs and declared capabilities; these are not generation-check evidence. */
export const openAIModelPresets = [
  {id:'gpt-6.1-sol',name:'GPT-6.1 Sol',reasoning:true,normal:false},
  {id:'gpt-6-astra',name:'GPT-6 Astra',reasoning:true,normal:false},
  {id:'gpt-6-luna',name:'GPT-6 Luna',reasoning:true,normal:true},
];
export function declaredOpenAICapabilities(modelId:string,reasoning:boolean) {
  const preset=openAIModelPresets.find(model=>model.id===modelId);
  const canThink=preset?.reasoning??reasoning;
  return {tools:true,streaming:true,vision:!!preset,reasoning:canThink,
    reasoningModes:canThink?(preset?.normal===false?['thinking','auto']:['normal','thinking','auto']):['normal'],
    defaultReasoningMode:canThink?'auto':'normal',responsesProfile:'openai',
    evidence:preset?'openai-official-documentation':'administrator-declaration',generationVerified:false};
}
