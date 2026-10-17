export type PurchaseClaim={id:string;orderNo:string;status:'PENDING'|'APPROVED'|'REJECTED';createdAt:string;submittedAt:string;deadlineAt:string;reviewedAt:string|null;creditedRmb:number|null;reason:string|null;attempt:number};
export type PurchaseTicket={id:string;url:string;expiresAt:string;maskedAccount:string};
export type PurchaseList={data:PurchaseClaim[];total:number;page:number;pageSize:number};
export type PurchaseClient={create:()=>Promise<PurchaseTicket>;list:(page:number,status:string)=>Promise<PurchaseList>;status:(id:string)=>Promise<{state:'WAITING'|'SUBMITTED'|'EXPIRED';claim:PurchaseClaim|null}>};
