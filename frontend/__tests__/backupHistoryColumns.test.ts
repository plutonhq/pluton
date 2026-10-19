import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(new URL('../package.json', import.meta.url));
const compile = (path: string) =>
   require('postcss').parse(require('sass-embedded').compile(fileURLToPath(new URL(`../src/${path}`, import.meta.url))).css);
const css = compile('components/Plan/Backups/Backups.module.scss');
const rules: any[] = [];
css.walkRules((rule: any) => rules.push(rule));
const declaration = (rule: any, property: string) => rule.nodes.find((node: any) => node.prop === property)?.value;
const grids = rules.filter((rule) => declaration(rule, 'grid-template-columns'));
const tracks = (rule: any) => declaration(rule, 'grid-template-columns').match(/minmax\([^)]*\)|\d+px/g) as string[];
const min = (track: string) => Number(track.match(/\d+/)![0]);
const max = (track: string) => Number(track.match(/\d+/g)!.at(-1));

test('every column distribution is shared by header and all rows, never sized by the individual row content', () => {
   assert.equal(grids.length, 3, 'desktop, constrained container, mobile');
   for (const rule of grids) {
      assert.match(rule.selector, /\.backupsTable \.backupsTableHead/);
      assert.match(rule.selector, /\.backupsTable \.backupsTableContent \.backupsTableRow/);
      assert.equal(tracks(rule).length, 7);
      assert.doesNotMatch(declaration(rule, 'grid-template-columns'), /(?:auto|max-content|min-content|fr)/);
   }
});

test('desktop retains compact data tracks and gives reclaimed action space to the centered Date column', () => {
   const desktop = grids[0];
   assert.deepEqual(tracks(desktop).map(max), [220, 156, 80, 104, 124, 260, 56]);
   assert.deepEqual(tracks(desktop).map(min), [180, 148, 80, 90, 124, 180, 56]);
   assert.equal(declaration(desktop, 'justify-content'), 'space-between');
   assert.equal(declaration(desktop, 'column-gap'), '4px');
   assert.equal(declaration(desktop, 'padding-inline'), '8px');
   assert.equal(declaration(desktop, 'box-sizing'), 'border-box');
   const width = 1046.8;
   const maxTracks = tracks(desktop)
      .map(max)
      .reduce((sum, n) => sum + n, 0);
   const gap = (width - 16 - maxTracks) / 6;
   assert.ok(gap >= 4 && gap < 6, 'spare room is not assigned to one oversized data track');
   const buttonInset = 8 + (56 - 38) / 2;
   assert.equal(buttonInset, 17, 'full 38px action target sits near the right edge, without excessive reserved space');
});

test('container threshold and scroll minima include all seven tracks plus horizontal padding, without overflowing the document', () => {
   const desktopMinimum =
      tracks(grids[0])
         .map(min)
         .reduce((sum, n) => sum + n, 0) +
      16 +
      6 * 4;
   assert.equal(desktopMinimum, 898);
   assert.match(grids[1].parent.params, /backup-rows \(max-width: 897px\)/);
   const compactMinimum =
      tracks(grids[1])
         .map(min)
         .reduce((sum, n) => sum + n, 0) + 16;
   const mobileMinimum =
      tracks(grids[2])
         .map(min)
         .reduce((sum, n) => sum + n, 0) + 16;
   assert.equal(compactMinimum, 830);
   assert.equal(mobileMinimum, 834);
   assert.equal(declaration(grids[1], 'padding-inline'), '8px');
   assert.equal(declaration(grids[1], 'column-gap'), '0');
   assert.equal(declaration(grids[2], 'grid-template-columns').endsWith('60px'), true);
   for (const minimum of ['830px', '834px']) {
      const rule = rules.find((rule) => declaration(rule, 'min-width') === minimum);
      assert.ok(rule);
      assert.match(rule.selector, /backupsTableHead/);
      assert.match(rule.selector, /backupsTableContent/);
   }
   const table = rules.find((rule) => rule.selector === '.backupsTable' && declaration(rule, 'container'));
   assert.equal(declaration(table, 'overflow-x'), 'auto');
   assert.equal(declaration(table, 'max-width'), '100%');
   assert.equal(declaration(table, 'box-sizing'), 'border-box');
});

test('header/value text anchors match: ID/status left, numeric columns right, Date and actions centered', () => {
   const aligned = rules.find((rule) => declaration(rule, 'text-align') === 'left' && declaration(rule, 'overflow-wrap') === 'anywhere');
   assert.match(aligned.selector, /backupsTableHead > div/);
   assert.match(aligned.selector, /backupsTableRow > div/);
   const numeric = rules.find((rule) => declaration(rule, 'text-align') === 'right');
   for (const group of ['backupsTableHead', 'backupsTableRow'])
      for (const index of [3, 4, 5]) assert.ok(numeric.selector.includes(`.${group} > div:nth-child(${index})`));
   const date = rules.find((rule) => declaration(rule, 'text-align') === 'center' && rule.selector.includes(':nth-child(6)'));
   for (const group of ['backupsTableHead', 'backupsTableRow']) assert.ok(date.selector.includes(`.${group} > div:nth-child(6)`));
   const changes = rules.filter((rule) => rule.selector.endsWith('.changes') && declaration(rule, 'justify-content')).at(-1);
   assert.equal(declaration(changes, 'justify-content'), 'flex-end');
   const action = rules.find((rule) => declaration(rule, 'padding') === '8px' && declaration(rule, 'justify-content') === 'center');
   assert.match(action.selector, /backupsTableHead/);
   assert.match(action.selector, /backupsTableRow/);
   assert.ok(rules.some((rule) => rule.selector.endsWith(' time') && declaration(rule, 'text-align') === 'inherit'));
});

test('horizontal refinement retains vertical density, the old header envelope, and wrapping instead of ID truncation', () => {
   for (const grid of grids) {
      assert.equal(declaration(grid, 'padding'), undefined, 'only horizontal grid padding may change');
      for (const property of ['height', 'min-height', 'max-height', 'line-height', 'font-size']) assert.equal(declaration(grid, property), undefined);
   }
   const heading = rules.find((rule) => declaration(rule, 'min-height') === 'calc(3em + 24px)');
   assert.equal(heading.selector, '.backupsTable .backupsTableHead > div');
   assert.equal(declaration(heading, 'align-content'), 'center');
   const cell = rules.find((rule) => declaration(rule, 'overflow-wrap') === 'anywhere');
   assert.equal(declaration(cell, 'padding'), '12px 10px');
   assert.equal(declaration(cell, 'text-overflow'), undefined);
   assert.equal(declaration(cell, 'overflow'), undefined);
   assert.equal(declaration(cell, 'white-space'), undefined);
});

test('38px/44px action targets, 1200px shell and filter/pagination controls keep their approved presentation contracts', () => {
   const buttonCss = compile('components/Plan/Backups/BackupRowMenu.module.scss');
   const triggerRules: any[] = [];
   buttonCss.walkRules((rule: any) => {
      if (rule.selector === '.trigger') triggerRules.push(rule);
   });
   assert.equal(declaration(triggerRules[0], 'width'), '38px');
   assert.equal(declaration(triggerRules[0], 'height'), '38px');
   assert.equal(declaration(triggerRules[1], 'width'), '44px');
   assert.equal(declaration(triggerRules[1], 'height'), '44px');
   const global = compile('styles/global.scss');
   assert.ok(global.toString().includes('--container-width: 1200px'));
   const filter = compile('components/Plan/Backups/BackupHistory.module.scss').toString();
   assert.match(filter, /container: backup-history-filter\s*\/\s*inline-size/);
   assert.match(filter, /height: 36px/);
   assert.match(filter, /height: 42px/);
});
