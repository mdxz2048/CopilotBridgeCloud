import { describe, expect, it, vi } from 'vitest';
import { copilotAuthErrorMessage, copilotAuthLabel, githubVerificationUrl, isCopilotCodeExpired, startCopilotAuthorization, type CopilotAuthResponse } from './copilot-auth';

function blankTab() {
  const tab = {
    opener: { name: 'admin' },
    closed: false,
    location: { href: 'about:blank', replace: vi.fn() },
    close: vi.fn(),
  };
  return tab;
}

const deviceResponse: CopilotAuthResponse = {
  status: 'PENDING',
  userCode: 'ABCD-EFGH',
  verificationUri: 'https://github.com/login/device',
};

describe('GitHub verification link', () => {
  it('allows only the fixed HTTPS device authorization page', () => {
    expect(githubVerificationUrl('https://github.com/login/device')).toBe('https://github.com/login/device');
    expect(githubVerificationUrl('https://github.com/login/device/')).toBe('https://github.com/login/device');
    for (const url of [
      undefined,
      'http://github.com/login/device',
      'https://github.com.evil.test/login/device',
      'https://github.com@evil.test/login/device',
      'https://user@github.com/login/device',
      'https://github.com/login/device?redirect=https://evil.test',
      'https://github.com/login/device#unexpected',
      'https://github.com:8443/login/device',
      'javascript:alert(1)',
    ]) expect(githubVerificationUrl(url)).toBeNull();
  });

  it('distinguishes incomplete, verifying and approved status', () => {
    expect(copilotAuthLabel('NOT_CONFIGURED')).toBe('尚未配置');
    expect(copilotAuthLabel('PENDING')).toBe('等待 GitHub 授权');
    expect(copilotAuthLabel('VERIFYING')).toBe('正在验证模型权限');
    expect(copilotAuthLabel('AUTHENTICATED')).toBe('认证已通过');
    expect(copilotAuthLabel('ERROR')).toBe('认证未完成');
  });

  it('offers another attempt once a device code expires', () => {
    const now = Date.parse('2026-09-29T02:00:00Z');
    expect(isCopilotCodeExpired('2026-09-29T01:59:59Z', now)).toBe(true);
    expect(isCopilotCodeExpired('2026-09-29T02:00:01Z', now)).toBe(false);
    expect(isCopilotCodeExpired(undefined, now)).toBe(false);
  });

  it('explains safe error codes without rendering unexpected server text', () => {
    expect(copilotAuthErrorMessage('EXPIRED')).toContain('设备码已过期');
    expect(copilotAuthErrorMessage('ACCESS_DENIED')).toContain('授权已拒绝');
    expect(copilotAuthErrorMessage('COPILOT_NOT_ENTITLED')).toContain('模型权限');
    expect(copilotAuthErrorMessage('token=secret')).not.toContain('secret');
  });

  it('opens a tab synchronously, severs opener, then navigates only after POST resolves', async () => {
    const tab = blankTab();
    let resolve!: (value: CopilotAuthResponse) => void;
    const request = new Promise<CopilotAuthResponse>(done => { resolve = done; });
    const flow = startCopilotAuthorization(() => request, () => tab as unknown as Window);
    expect(tab.opener).toBeNull();
    expect(tab.location.replace).not.toHaveBeenCalled();
    resolve(deviceResponse);
    expect((await flow).popup).toBe('opened');
    expect(tab.location.replace).toHaveBeenCalledWith('https://github.com/login/device');
    expect(tab.close).not.toHaveBeenCalled();
  });

  it('provides a manual path when the browser blocks the popup', async () => {
    const result = await startCopilotAuthorization(async () => deviceResponse, () => null);
    expect(result.popup).toBe('manual');
    expect(result.auth.userCode).toBe('ABCD-EFGH');
  });

  it('closes unused tabs on failed requests or missing configuration', async () => {
    const failedTab = blankTab();
    await expect(startCopilotAuthorization(
      async () => { throw new Error('failed'); },
      () => failedTab as unknown as Window,
    )).rejects.toThrow('failed');
    expect(failedTab.close).toHaveBeenCalledOnce();
    const unconfiguredTab = blankTab();
    const result = await startCopilotAuthorization(
      async () => ({ status: 'NOT_CONFIGURED' }),
      () => unconfiguredTab as unknown as Window,
    );
    expect(result.popup).toBe('not-started');
    expect(unconfiguredTab.close).toHaveBeenCalledOnce();
  });

  it('never navigates to an untrusted verification URI', async () => {
    const tab = blankTab();
    const result = await startCopilotAuthorization(
      async () => ({ ...deviceResponse, verificationUri: 'https://github.com.evil.test/login/device' }),
      () => tab as unknown as Window,
    );
    expect(result.popup).toBe('unsafe');
    expect(tab.location.replace).not.toHaveBeenCalled();
    expect(tab.close).toHaveBeenCalledOnce();
  });
});
