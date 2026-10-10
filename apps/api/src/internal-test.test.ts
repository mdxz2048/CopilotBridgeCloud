import { expect, test } from 'vitest';
import { internalTestAllowed } from './logic.js';
test('internal test grants are scoped to exact IDs and never apply to enforced billing', () => {
  expect(internalTestAllowed('SHADOW', 'user-1', ['user-1'])).toBe(true);
  expect(internalTestAllowed('SHADOW', 'user-2', ['user-1'])).toBe(false);
  expect(internalTestAllowed('ENFORCED', 'user-1', ['user-1'])).toBe(false);
  expect(internalTestAllowed('OFF', 'user-1', ['user-1'])).toBe(false);
  expect(internalTestAllowed('SHADOW', 'user-1', { all: true })).toBe(false);
  expect(internalTestAllowed('SHADOW', 'user-1', ['user-1', null])).toBe(false);
});
