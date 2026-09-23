import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import argon2 from 'argon2';
import { config } from './config.js';

const accessKey = new TextEncoder().encode(config.ACCESS_SECRET);
export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id });
export const verifyPassword = (hash: string, password: string) => argon2.verify(hash, password);
export const hashRefresh = (token: string) => createHmac('sha256', config.REFRESH_TOKEN_PEPPER).update(token).digest('hex');
export const newRefresh = () => randomBytes(48).toString('base64url');
export async function issueAccess(userId: string, deviceId?: string, role = 'USER') {
  return new SignJWT({ deviceId, role }).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuedAt().setExpirationTime('30m').sign(accessKey);
}
export async function readAccess(token: string) {
  const { payload } = await jwtVerify(token, accessKey, { algorithms: ['HS256'] });
  if (!payload.sub) throw new Error('Missing subject');
  return { userId: payload.sub, deviceId: payload.deviceId as string | undefined, role: payload.role as string };
}
const masterKey = Buffer.from(config.PROVIDER_MASTER_KEY, 'hex');
export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}
export function decryptSecret(value: { ciphertext: string; iv: string; tag: string }) {
  const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}
export const safeId = () => createHash('sha256').update(randomBytes(32)).digest('hex').slice(0, 24);
