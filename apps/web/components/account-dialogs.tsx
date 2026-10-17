'use client';
import {PurchaseTopup} from './purchase-topup';
import {api} from '../lib/api';
import type{PurchaseClient}from'../purchase-types';
import { useEffect, useId, useRef, useState } from 'react';

export function AccountDialog({ title, busy = false, onClose, children }: { title: string; busy?: boolean; onClose: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  return <dialog ref={dialog} className="account-dialog" aria-labelledby={titleId} onClose={onClose}
    onCancel={event => { if (busy) event.preventDefault(); }}>
    <div className="account-dialog-title"><h2 id={titleId}>{title}</h2><button type="button" className="mini-button" aria-label="关闭弹窗" disabled={busy} onClick={onClose}>×</button></div>
    {children}
  </dialog>;
}

const purchaseClient:PurchaseClient={create:()=>api('/api/v1/me/purchase-tickets',{method:'POST',body:'{}'}),list:(page,status)=>api(`/api/v1/me/purchase-claims?page=${page}&status=${status}`),status:id=>api(`/api/v1/me/purchase-tickets/${id}`)};
export function TopupDialog({onClose}:{email:string;onClose:()=>void}){
 return <AccountDialog title="充值" onClose={onClose}><PurchaseTopup client={purchaseClient} qrSource="/xianyu-profile.jpg" mobileDirect onCredited={()=>window.dispatchEvent(new Event('bridge:wallet-changed'))}/></AccountDialog>;
}
