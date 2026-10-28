const questions = [
  ['怎么回到自己的 ChatGPT 账号？', '关闭 Bridge 的 Cloud 开关，确认切换成功后，保存工作并按提示重新打开 ChatGPT。原账号配置、会话和工作区会保留，无需重启或注销 Windows。'],
  ['需要一直开着 Bridge 吗？', '使用 Cloud 时需要保持 Bridge 运行。开启“关闭后留在托盘”可以在后台继续运行；退出 Bridge 后，Cloud 连接将无法继续转发请求。'],
  ['余额与模型权限在哪里查看？', '在 Bridge 的“账户”或网站用户中心查看。模型目录、设备上限和余额以服务端实际配置为准；余额不足会暂停新的模型请求，充值审核到账后可继续使用。'],
  ['支持哪些模型？切换后要做什么？', 'Bridge 展示账号已开通且可用的模型。选择模型与思考方式后，请在官方客户端中新建会话。供应商能力、权限和服务状态仍可能影响具体功能。'],
];

export function HelpFaq({ standalone = false }: { standalone?: boolean }) {
  const Heading = standalone ? 'h1' : 'h2';
  return <div className="help-faq-layout"><div><span className="eyebrow">GOOD TO KNOW</span><Heading>开始前，<br/>你可能想知道。</Heading></div>
    <div className="help-faq-items">{questions.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div>
  </div>;
}
