'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';

export function TestActivationQr() {
  const [informationUrl, setInformationUrl] = useState('');
  useEffect(() => { setInformationUrl(new URL('/pricing', window.location.origin).href); }, []);
  return <section className="test-activation-qr" aria-label="人工开通说明">
    <div className="test-activation-code" role="img" aria-label="测试占位二维码，扫码仅打开人工开通说明页">
      {informationUrl ? <QRCodeSVG value={informationUrl} size={144} marginSize={2}/> : <span>说明页二维码准备中…</span>}
    </div>
    <div><h2>测试占位二维码 · 非支付二维码</h2>
      <p>扫码仅打开本站的人工开通说明页；不产生真实收款、订单或自动开通，也不会触发邀请奖励。</p>
      <p>请先在网页登录查看账号状态，再联系管理员核实测试资格并由管理员手工开通。开通后才能首次绑定 Desktop 设备。当前测试用量并非实际扣费。</p>
      <Link className="button button-small" href="/dashboard">登录后查看账号状态</Link>
    </div>
  </section>;
}
