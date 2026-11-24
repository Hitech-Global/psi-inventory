'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ui = fs.readFileSync(path.join(__dirname, '..', 'assets', 'price-system.js'), 'utf8');
const forecast = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

test('price system uses the same default-descending-ascending-default cycle as order forecast', () => {
  assert.match(forecast, /function initRpTableSort\(container\)/);
  assert.match(forecast, /\?\s*'desc'\s*:\s*\(state\.dir==='desc'\s*\?\s*'asc'\s*:\s*'none'\)/);
  assert.match(ui, /function initPriceSystemTableSort\(container\)/);
  assert.match(ui, /\?\s*'desc'\s*:\s*\(state\.dir==='desc'\s*\?\s*'asc'\s*:\s*'none'\)/);
  assert.match(ui, /indicator\.textContent=next==='desc'\?'▼':\(next==='asc'\?'▲':'↕'\)/);
});

test('price system sorting is client-side, stable, and can restore the original row order', () => {
  assert.match(ui, /function psApplyTableSort\(table,colIndex,dir\)/);
  assert.match(ui, /tbody\.querySelectorAll\(':scope > tr'\)/);
  assert.match(ui, /data\.psOriginalOrder==null/);
  assert.match(ui, /if\(dir==='none'\)return Number\(a\.dataset\.psOriginalOrder\)-Number\(b\.dataset\.psOriginalOrder\)/);
  assert.match(ui, /initPriceSystemTableSort\(el\)/);
  const sortBody = ui.slice(ui.indexOf('function psApplyTableSort'), ui.indexOf('function initPriceSystemTableSort'));
  assert.doesNotMatch(sortBody, /\bapi\s*\(/);
});

test('numeric columns and editable inputs expose raw values for accurate sorting', () => {
  assert.match(ui, /function psSortValueAttr\(value\)/);
  assert.match(ui, /querySelector&&td\.querySelector\('input\.ps-input'\)/);
  assert.match(ui, /data-sort-value/);
  assert.match(ui, /psSortValueAttr\(forecastAvg\)/);
  assert.match(ui, /psSortValueAttr\(Number\(r\.stock_qty\|\|0\)\)/);
  assert.match(ui, /psSortValueAttr\(availableTurnover\)/);
  assert.match(ui, /psSortValueAttr\(v\)/);
  assert.match(ui, /psSortValueAttr\(shown\)/);
});

test('sort indicators have accessible sort state and localized hints', () => {
  assert.match(ui, /th\.setAttribute\('aria-sort','none'\)/);
  assert.match(ui, /th\.setAttribute\('aria-sort',next==='desc'\?'descending':\(next==='asc'\?'ascending':'none'\)\)/);
  assert.match(ui, /sortHint:'点击排序：降序 \/ 升序 \/ 默认'/);
  assert.match(ui, /sortHint:'Click to sort: descending \/ ascending \/ default'/);
  assert.match(ui, /sortHint:'Klik untuk mengurutkan: menurun \/ menaik \/ default'/);
});
