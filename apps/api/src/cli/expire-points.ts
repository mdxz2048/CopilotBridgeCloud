import { expireDueWalletLotsForAll } from '../wallet.js';
import { pool } from '@bridge/db';

try {
  let total = 0;
  for (;;) {
    const count = await expireDueWalletLotsForAll();
    total += count;
    if (count < 200) break;
  }
  process.stdout.write(`Expired point lots for ${total} wallets\n`);
} finally {
  await pool.end();
}
