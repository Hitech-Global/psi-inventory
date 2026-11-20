'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const quotation = fs.readFileSync(path.join(root, 'quotation-management.js'), 'utf8');

function procurementItemIds() {
  const moduleStart = app.indexOf("{id:'procurement'");
  assert.notEqual(moduleStart, -1, 'procurement module must exist');
  const itemsStart = app.indexOf('items:[', moduleStart) + 'items:['.length;
  const itemsEnd = app.indexOf('  ]},', itemsStart);
  assert.ok(itemsStart >= 'items:['.length && itemsEnd > itemsStart, 'procurement item list must be parseable');
  return Array.from(app.slice(itemsStart, itemsEnd).matchAll(/\{id:'([^']+)'/g), match => match[1]);
}

test('price system remains the final built-in procurement sidebar item', () => {
  assert.deepEqual(procurementItemIds(), [
    'po', 'pi', 'ci', 'inbound', 'wac-history', 'logistics-decision', 'price-system'
  ]);
  assert.match(app, /^\s*\{id:'price-system',key:'nav\.price_system',[^\n]*perm:'ci_amount_view'\},?$/m,
    'price-system permission must remain unchanged');
  assert.ok(app.includes("'price-system':(typeof renderPriceSystem==='function'?renderPriceSystem:function(){})"),
    'price-system page route must remain registered');
});

test('quotation management is inserted immediately before price system', () => {
  assert.ok(quotation.includes("e.setAttribute('data-page','quotation-management')"),
    'quotation-management page identity must remain unchanged');
  assert.ok(quotation.includes("e.onclick=show;const priceSystemItem=n.querySelector('[data-page=\"price-system\"]');if(priceSystemItem)n.insertBefore(e,priceSystemItem);else n.appendChild(e);"),
    'quotation nav must be inserted before price-system, with append fallback');
});
