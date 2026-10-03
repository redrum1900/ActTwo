import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const css = postcss.parse(readFileSync(fileURLToPath(new URL('../apps/web/src/creator/creator.css', import.meta.url)), 'utf8'));

function baseDeclarations(selector: string) {
  const declarations = new Map<string, string>();
  css.walkRules(selector, rule => {
    if (rule.parent?.type !== 'root') return;
    rule.walkDecls(declaration => { declarations.set(declaration.prop, declaration.value); });
  });
  return declarations;
}

function mobileDeclarations(selector: string) {
  const declarations = new Map<string, string>();
  css.walkAtRules('media', media => {
    if (media.params !== '(max-width: 620px)') return;
    media.walkRules(selector, rule => {
      rule.walkDecls(declaration => { declarations.set(declaration.prop, declaration.value); });
    });
  });
  return declarations;
}

test('story editor confines scrolling to its sidebar and main panel', () => {
  const app = baseDeclarations('.creator-app-editing');
  assert.equal(app.get('height'), '100dvh');
  assert.equal(app.get('overflow'), 'hidden');
  assert.equal(app.get('display'), 'flex');
  assert.equal(baseDeclarations('.creator-workspace').get('overflow'), 'hidden');
  assert.equal(baseDeclarations('.creator-workspace').get('min-height'), '0');
  for (const selector of ['.creator-sidebar nav', '.creator-main']) {
    const panel = baseDeclarations(selector);
    assert.equal(panel.get('overflow-y'), 'auto', `${selector} should scroll independently`);
    assert.equal(panel.get('overscroll-behavior-y'), 'contain', `${selector} should not chain scroll to the page`);
    assert.equal(panel.get('min-height'), '0');
  }
  assert.equal(mobileDeclarations('.creator-workspace').get('flex-direction'), 'column');
  assert.ok(mobileDeclarations('.creator-sidebar').get('max-height'));
});

test('story identity stays above a separately scrolling sidebar menu', () => {
  const sidebar = baseDeclarations('.creator-sidebar');
  const intro = baseDeclarations('.creator-sidebar-intro');
  const nav = baseDeclarations('.creator-sidebar nav');
  assert.equal(sidebar.get('display'), 'flex');
  assert.equal(sidebar.get('flex-direction'), 'column');
  assert.equal(sidebar.get('overflow-y'), 'hidden');
  assert.equal(intro.get('flex-shrink'), '0');
  assert.equal(nav.get('overflow-y'), 'auto');
  assert.equal(nav.get('min-height'), '0');
  assert.equal(mobileDeclarations('.creator-sidebar').get('overflow-y'), 'auto');
  const component = readFileSync(fileURLToPath(new URL('../apps/web/src/creator/CreatorApp.tsx', import.meta.url)), 'utf8');
  assert.match(component, /className="creator-sidebar-intro"/);
});

test('creator editing workspace and forms fill available desktop width', () => {
  for (const selector of ['.creator-main', '.creator-special-form', '.creator-player-form']) {
    const declarations = baseDeclarations(selector);
    assert.ok(declarations.size > 0, `${selector} should have a base rule`);
    assert.equal(declarations.get('max-width'), undefined, `${selector} should not cap desktop width`);
  }
  assert.equal(baseDeclarations('.creator-main').get('width'), '100%');
});

test('library and review workspaces keep their distinct page width limits', () => {
  assert.equal(baseDeclarations('.creator-library').get('max-width'), '1240px');
  assert.equal(baseDeclarations('.creator-review-workspace').get('max-width'), '1330px');
});

test('condition comparison controls sit side by side without inheriting full-width rule selects', () => {
  assert.equal(baseDeclarations('.creator-typed-compare').get('display'), 'flex');
  assert.equal(baseDeclarations('.creator-typed-compare').get('flex-wrap'), 'wrap');
  assert.ok(baseDeclarations('.creator-typed-compare').get('gap'));
  assert.equal(baseDeclarations('.creator-story-rule-controls .ant-select').get('width'), undefined);
  assert.equal(baseDeclarations('.creator-story-rule-controls .creator-rule-core > label > .ant-select').get('width'), '100%');
});
