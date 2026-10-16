'use client';
import { useRef,useState } from 'react';
import { post } from '../lib/api';

function complexPassword(){
  const groups=['ABCDEFGHJKLMNPQRSTUVWXYZ','abcdefghijkmnopqrstuvwxyz','23456789','!@#$%*-_+=?'];
  const pick=(alphabet:string)=>{const n=new Uint32Array(1);const limit=2**32-2**32%alphabet.length;do{crypto.getRandomValues(n);}while(n[0]>=limit);return alphabet[n[0]%alphabet.length];};
  const chars=groups.map(pick),all=groups.join('');while(chars.length<20)chars.push(pick(all));
  for(let i=chars.length-1;i>0;i--){const j=Number(pick(Array.from({length:i+1},(_,v)=>String.fromCharCode(65+v)).join('')).charCodeAt(0))-65;[chars[i],chars[j]]=[chars[j],chars[i]];}
  return chars.join('');
}
export function AdminPasswordReset({userId,busy,setBusy,onChanged}:{userId:string;busy:boolean;setBusy:(v:boolean)=>void;onChanged:()=>void}){
  const input=useRef<HTMLInputElement>(null);
  const [password,setPassword]=useState(''),[visible,setVisible]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  async function copy(){try{await navigator.clipboard.writeText(password);setMessage('密码已复制。');setError('');}catch{setVisible(true);input.current?.focus();input.current?.select();setError('无法自动复制，已选中密码，请手动复制。');}}
  async function reset(){
    if(busy||!window.confirm('确认重置此用户的密码？该用户的网页和 App 登录会立即失效。'))return;
    setBusy(true);setMessage('');setError('');
    try{await post(`/api/v1/admin/users/${userId}/reset-password`,{password});setMessage('密码已重置，请复制并通过可信方式交给用户。');onChanged();}
    catch(e){setError((e as {status?:number}).status===401?'管理员登录已失效，请重新登录。':'密码重置未完成，请重试。');}finally{setBusy(false);}
  }
  return <section className="panel"><h3>重置密码</h3><p>自定义 12～128 位密码，或生成 20 位复杂密码。重置后该用户所有设备需要重新登录。</p><div className="field"><label htmlFor="admin-reset-password">新密码</label><input ref={input} id="admin-reset-password" type={visible?'text':'password'} autoComplete="new-password" minLength={12} maxLength={128} value={password} disabled={busy} onChange={e=>{setPassword(e.target.value);setMessage('');setError('');}}/></div><div className="inline-actions"><button className="mini-button" disabled={busy} onClick={()=>{setPassword(complexPassword());setVisible(true);setMessage('已生成复杂密码，点击“确认重置”后生效。');setError('');}}>生成复杂密码</button><button className="mini-button" disabled={busy||!password} onClick={()=>void copy()}>复制密码</button><button className="mini-button" disabled={busy||!password} onClick={()=>setVisible(v=>!v)}>{visible?'隐藏密码':'显示密码'}</button><button className="mini-button danger" disabled={busy||password.length<12||password.length>128} onClick={()=>void reset()}>确认重置</button></div>{message&&<p role="status" className="notice">{message}</p>}{error&&<p role="alert" className="error-text">{error}</p>}</section>;
}
