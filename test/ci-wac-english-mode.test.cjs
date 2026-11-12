'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const ci=fs.readFileSync(path.join(root,'ci-list-inline-logistics.js'),'utf8');
const detail=fs.readFileSync(path.join(root,'assets','ci-wac-integration.js'),'utf8');
const cc=fs.readFileSync(path.join(root,'wac-notification-ui.js'),'utf8');

test('CI logistics WAC column shows translated header and no-ready reason',()=>{
  assert.match(ci,/status: \{ zh: 'WAC 状态', en: 'WAC Status'/);
  assert.match(ci,/notReadyReason: \{ zh: .*en: 'This batch is not yet eligible/);
  assert.match(ci,/esc\(wacUiText\('status'\)\)/);
  assert.match(ci,/wacUiText\('notReadyReason'\)/);
});

test('WAC logistics detail and skip/restore actions offer English modal text',()=>{
  assert.match(detail,/function localizeCiWacModal\(/);
  assert.match(detail,/function openLocalizedCiWacModal\(/);
  assert.match(detail,/var CI_WAC_EN/);
  assert.match(detail,/Not Ready for WAC/);
  assert.match(detail,/Logistics Cost Overview/);
  assert.match(detail,/No Calculation Required/);
  assert.match(detail,/localizeCiWacModal\(\)/);
});

test('WAC CC modal localizes recipients and group options without changing API payloads',()=>{
  assert.match(cc,/function ccEnglishMode\(/);
  assert.match(cc,/function localizeWacCc\(/);
  assert.match(cc,/Send CC/);
  assert.match(cc,/Feishu Groups/);
  assert.match(cc,/localizeWacCc\(modal\)/);
  assert.match(cc,/cc_group_keys: groupKeys/);
});
