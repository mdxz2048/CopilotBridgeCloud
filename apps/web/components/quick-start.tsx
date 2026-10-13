import { Download, Laptop2, ToggleRight } from 'lucide-react';
import styles from '../app/marketing.module.css';

export function QuickStart() {
  return <><ol className={styles.steps}>
    <li><Download size={23}/><span className={styles.stepNumber}>01</span><h3>下载 Bridge</h3><p>下载安装 Windows 版 Bridge，用分配给你的账号登录。</p></li>
    <li><Laptop2 size={23}/><span className={styles.stepNumber}>02</span><h3>安装 ChatGPT</h3><p>跟随 Bridge 提示安装官方 ChatGPT 客户端，已经安装的可以跳过。</p></li>
    <li><ToggleRight size={23}/><span className={styles.stepNumber}>03</span><h3>开启 Cloud</h3><p>在 Bridge 中选择可用模型并开启 Cloud，按提示重新打开 ChatGPT，即可开始使用。</p></li>
  </ol><p className={styles.stepNote}>使用期间保持 Bridge 运行。更换模型后新开会话；标记“待开通”的模型暂时不能使用。</p></>;
}
