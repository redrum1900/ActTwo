import test from 'node:test';
import assert from 'node:assert/strict';
import { requiredDialogValue } from '../apps/web/src/dialog-values.js';

test('dialog input trims a nonempty value before submission', () => {
  assert.equal(requiredDialogValue('  苏念  '), '苏念');
});

test('dialog input keeps the dialog open for whitespace-only values', () => {
  assert.equal(requiredDialogValue('  \n  '), null);
});
