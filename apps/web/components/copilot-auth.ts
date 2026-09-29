export type CopilotAuthStatus =
  | 'NOT_CONFIGURED'
  | 'NOT_AUTHENTICATED'
  | 'PENDING'
  | 'VERIFYING'
  | 'AUTHENTICATED'
  | 'ERROR';

export type CopilotAuthResponse = {
  status: CopilotAuthStatus;
  login?: string;
  userCode?: string;
  verificationUri?: string;
  expiresAt?: string;
  message?: string;
};

export const githubDeviceVerificationPage = 'https://github.com/login/device';

export function githubVerificationUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com'
      || url.port || url.username || url.password
      || !['/login/device', '/login/device/'].includes(url.pathname)
      || url.search || url.hash) return null;
    return githubDeviceVerificationPage;
  } catch {
    return null;
  }
}

type PopupOutcome = 'opened' | 'manual' | 'unsafe' | 'not-started';

function closeBlankTab(tab: Window | null) {
  if (!tab) return;
  try {
    if (!tab.closed && tab.location.href === 'about:blank') tab.close();
  } catch {
    // A tab navigated by the user is no longer ours to close.
  }
}

export async function startCopilotAuthorization(
  initiate: () => Promise<CopilotAuthResponse>,
  open: () => Window | null,
  signal?: AbortSignal,
): Promise<{ auth: CopilotAuthResponse; popup: PopupOutcome }> {
  let tab: Window | null = null;
  try {
    // A noopener window.open feature can return no navigable handle; sever the opener before any navigation instead.
    tab = open();
    if (tab) tab.opener = null;
  } catch {
    closeBlankTab(tab);
    tab = null;
  }

  try {
    const auth = await initiate();
    if (signal?.aborted || auth.status !== 'PENDING' || !auth.userCode) {
      closeBlankTab(tab);
      return { auth, popup: 'not-started' };
    }
    const safeUrl = githubVerificationUrl(auth.verificationUri);
    if (!safeUrl) {
      closeBlankTab(tab);
      return { auth, popup: auth.verificationUri ? 'unsafe' : 'manual' };
    }
    if (!tab || tab.closed) return { auth, popup: 'manual' };
    try {
      tab.location.replace(safeUrl);
      return { auth, popup: 'opened' };
    } catch {
      closeBlankTab(tab);
      return { auth, popup: 'manual' };
    }
  } catch (error) {
    closeBlankTab(tab);
    throw error;
  }
}

export function isCopilotCodeExpired(expiresAt?: string, now = Date.now()): boolean {
  if (!expiresAt) return false;
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && expiry <= now;
}

export function copilotAuthErrorMessage(code?: string): string {
  switch (code) {
    case 'EXPIRED': return '设备码已过期，请重新开始认证。';
    case 'ACCESS_DENIED': return 'GitHub 授权已拒绝，可重新开始认证。';
    case 'COPILOT_NOT_ENTITLED': return '账号未检测到可用的 Copilot 模型权限，请检查订阅后重新认证。';
    default: return '认证未完成，请重新开始认证。';
  }
}

export function copilotAuthLabel(status: CopilotAuthStatus): string {
  switch (status) {
    case 'NOT_CONFIGURED': return '尚未配置';
    case 'NOT_AUTHENTICATED': return '尚未认证';
    case 'PENDING': return '等待 GitHub 授权';
    case 'VERIFYING': return '正在验证模型权限';
    case 'AUTHENTICATED': return '认证已通过';
    case 'ERROR': return '认证未完成';
  }
}
