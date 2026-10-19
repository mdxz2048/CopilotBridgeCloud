import { gunzipSync } from 'node:zlib';
import { ApiError } from './errors.js';

export const blockmapLimit = 2 * 1024 * 1024;
/** Builder v2 maps describe compressed installer bytes, not installed files. */
export function validateBlockmap(bytes: Buffer, installerSize: number) {
  try {
    if (!bytes.length || bytes.length > blockmapLimit) throw new Error();
    const map = JSON.parse(gunzipSync(bytes, { maxOutputLength: 16 * 1024 * 1024 }).toString('utf8'));
    if (map.version !== '2' || !Array.isArray(map.files) || map.files.length !== 1 || !Number.isSafeInteger(installerSize) || installerSize < 2 || installerSize > 512 * 1024 * 1024) throw new Error();
    let end = 0, blocks = 0;
    for (const file of map.files) {
      if (file.name !== 'file' || file.offset !== 0 || !Array.isArray(file.sizes) || !file.sizes.length || !Array.isArray(file.checksums) || file.sizes.length !== file.checksums.length) throw new Error();
      for (let i = 0; i < file.sizes.length; i++) {
        const size = file.sizes[i], checksum = file.checksums[i];
        if (!Number.isSafeInteger(size) || size <= 0 || typeof checksum !== 'string' || !/^[A-Za-z0-9+/]{24}$/.test(checksum) || ++blocks > 100000) throw new Error();
        end += size;
        if (!Number.isSafeInteger(end) || end > installerSize) throw new Error();
      }
    }
    if (end !== installerSize) throw new Error();
    return { blocks, installerSize };
  } catch { throw new ApiError(400, 'INVALID_RELEASE_BLOCKMAP'); }
}

/** null means a full response; false is an unsatisfiable/unsupported range. */
export function installerRange(range: string | undefined, ifRange: string | undefined, etag: string, size: number): { start: number; end: number } | null | false {
  if (!range || (ifRange !== undefined && ifRange !== etag)) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return false;
  let start: number, end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) return false;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}
