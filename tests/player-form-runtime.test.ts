import test from 'node:test';
import assert from 'node:assert/strict';
import * as app from '../apps/api/src/app.js';
import type { FieldDefinition, GameState } from '../packages/contracts/src/index.js';

const readPlayer = (app as typeof app & { readPlayer?: (fields: readonly FieldDefinition[], input: unknown) => GameState['player'] }).readPlayer;

test('empty opening form accepts an empty player and skips questions', () => {
  assert.ok(readPlayer, 'opening player parser should be reusable');
  assert.deepEqual(readPlayer([], {}), {});
});

test('opening form rejects nonexistent calendar dates and accepts long textarea answers', () => {
  assert.ok(readPlayer, 'opening player parser should be reusable');
  const fields = [
    { id: 'birthday', label: '生日', type: 'date' as const, required: true },
    { id: 'bio', label: '简介', type: 'textarea' as const },
  ];
  assert.throws(() => readPlayer(fields, { birthday: '2026-02-30', bio: 'A'.repeat(200) }), /日期无效/);
  assert.equal(readPlayer(fields, { birthday: '2026-02-28', bio: 'A'.repeat(200) }).bio.length, 200);
});

test('every configured opening question requires a value even when legacy required is false or absent', () => {
  assert.ok(readPlayer);
  const fields: FieldDefinition[] = [
    { id: 'name', label: '姓名', type: 'input', required: false },
    { id: 'birthday', label: '生日', type: 'date' },
    { id: 'hobbies', label: '兴趣', type: 'checkbox', options: [{ value: 'game', label: '游戏' }] },
  ];
  assert.throws(() => readPlayer(fields, { name: '', birthday: '2026-10-01', hobbies: ['game'] }), /请正确填写姓名/);
  assert.throws(() => readPlayer(fields, { name: '阿言', birthday: '', hobbies: ['game'] }), /请正确填写生日/);
  assert.throws(() => readPlayer(fields, { name: '阿言', birthday: '2026-10-01', hobbies: [] }), /请填写兴趣/);
  assert.deepEqual(readPlayer(fields, { name: '阿言', birthday: '2026-10-01', hobbies: ['game'] }),
    { name: '阿言', birthday: '2026-10-01', hobbies: ['game'] });
});
