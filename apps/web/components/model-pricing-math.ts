export function estimatedMarginPercent(saleMultiplier:number,costMultiplier?:number):number|null {
 if(!Number.isFinite(saleMultiplier)||saleMultiplier<=0||costMultiplier===undefined||!Number.isFinite(costMultiplier)||costMultiplier<0)return null;
 return (1-costMultiplier/saleMultiplier)*100;
}
