import { BlockList, isIP } from 'node:net';

export function trustedProxy(hops: number, cidrs: string) {
  if (hops === 0) return false as const;
  const addresses = new BlockList();
  for (const entry of cidrs.split(',')) {
    const [address, prefixText, ...rest] = entry.trim().split('/');
    const family = isIP(address);
    const maxPrefix = family === 4 ? 32 : 128;
    const prefix = Number(prefixText);
    if (rest.length || !family || !Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix)
      throw new Error('INVALID_TRUSTED_PROXY_CIDRS');
    addresses.addSubnet(address, prefix, family === 4 ? 'ipv4' : 'ipv6');
  }
  return (address: string, hop: number) => hop < hops && addresses.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4');
}
