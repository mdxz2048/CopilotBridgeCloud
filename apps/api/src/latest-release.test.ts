import { expect, it } from 'vitest';
import { latestWindowsRelease,requireCurrentClient } from './latest-release.js';
const row = (version: string, extra = {}) => ({ version, published: true, channel: 'stable', platform: 'windows', arch: 'x64', createdAt: new Date(), ...extra });
it('selects the highest stable Windows version even if an older version was published later', () => {
  expect(latestWindowsRelease([row('0.2.6'), row('0.2.5'), row('0.2.10')])?.version).toBe('0.2.10');
});
it('excludes drafts, beta, other platforms and invalid version strings', () => {
  expect(latestWindowsRelease([row('0.3.0', {published: false}), row('0.4.0', {channel: 'beta'}), row('0.5.0', {platform: 'macos'}), row('latest'), row('0.6.0', {arch: 'arm64'})])).toBeNull();
});
it('keeps compatible clients working after a newer release while rejecting incompatible clients',()=>{
  expect(()=>requireCurrentClient('0.3.27','0.3.29')).toThrow('0.3.28');
  expect(()=>requireCurrentClient('invalid','0.3.29')).toThrow();
  expect(()=>requireCurrentClient('0.3.28','0.3.29')).not.toThrow();
  expect(()=>requireCurrentClient('0.3.29','0.3.29')).not.toThrow();
  expect(()=>requireCurrentClient('0.4.0','0.3.29')).not.toThrow();
  expect(()=>requireCurrentClient('0.3.100','0.3.29')).not.toThrow();
  expect(()=>requireCurrentClient('0.3.0',undefined)).not.toThrow();
});
