'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const i18n = fs.readFileSync(path.join(__dirname, '..', 'i18n.js'), 'utf8');

function between(source, startText, endText) {
  const start = source.indexOf(startText);
  assert.notEqual(start, -1, 'start marker exists: ' + startText);
  const end = source.indexOf(endText, start);
  assert.notEqual(end, -1, 'end marker exists: ' + endText);
  return source.slice(start, end);
}

test('CI list uses the same five logistics-status options as the Logistics page', () => {
  const options = between(app, 'function logisticsFilterOptions(selected) {', '// 物流编辑下拉');
  for (const status of ['pending_shipment', 'in_transit', 'customs_clearing', 'awaiting_delivery', 'warehouse_arrived']) {
    assert.match(options, new RegExp("val: '" + status + "'"));
  }
  const render = between(app, 'async function renderCI(){', 'function onCISourceModeChange()');
  assert.match(render, /id="ci-logistics-fs"/);
  assert.match(render, /logisticsFilterOptions\(''\)/);
  assert.match(render, /logistics\.detail\.logistics_status/);
  assert.doesNotMatch(render, /ci-inbound-fs|入库状态/);
});

test('CI list sends logistics display status and preserves mode-specific disabling and cache signature', () => {
  const mode = between(app, 'function onCISourceModeChange(){', 'async function refreshCIFilterOptions()');
  assert.match(mode, /ci-logistics-fs/);
  assert.match(mode, /fs\.disabled=mode==='historical'/);
  const load = between(app, 'async function loadCI(){', 'async function createHistoricalCI()');
  assert.match(load, /ci-logistics-fs/);
  assert.match(load, /logistics_display_status=/);
  assert.match(load, /JSON\.stringify\(\[mode,opQ,histQ\]\)/);
  assert.doesNotMatch(load, /inbound_status=/);
});

test('CI API filters by the same highest logistics stage displayed in each CI row', () => {
  const route = between(server, "app.get('/api/commercial-invoices',", '// P2-LOGISTICS-CLOSED-LOOP');
  assert.match(route, /const \{ inbound_status, logistics_display_status,/);
  assert.match(route, /r\.ci_logistics_display_status !== logistics_display_status/);
  assert.match(route, /lbInfo\.logistics_statuses/);
  assert.match(route, /maxRank >= 0 \? STAGE_KEYS\[maxRank\]/);
  assert.match(route, /inboundDerived !== inbound_status/);
});

test('CI inbound-status data column remains separate from the new logistics-status filter', () => {
  assert.match(app, /ci\.col\.inbound_status/);
  assert.match(app, /ciInboundStatusLabel\(c\.inbound_derived_status\)/);
});

test('English and Indonesian CI page templates expose the shared localized filter controls', () => {
  const enStart = i18n.lastIndexOf('I18N.dict.en["html.renderCI"] =');
  const idStart = i18n.lastIndexOf('I18N.dict.id["html.renderCI"] =');
  assert.notEqual(enStart, -1);
  assert.notEqual(idStart, -1);
  const en = i18n.slice(enStart, i18n.indexOf(';', enStart));
  const id = i18n.slice(idStart, i18n.indexOf(';', idStart));
  for (const template of [en, id]) {
    assert.match(template, /\{v3\}/);
    assert.doesNotMatch(template, /ci-inbound-fs|Inbound Status/);
  }
  assert.match(id, /Jenis Dokumen/);
});
