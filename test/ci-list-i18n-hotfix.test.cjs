'use strict';
const assert = require('node:assert/strict');
const { APP_MARKER, I18N_MARKER, patchAppSource, patchI18nSource } = require('../scripts/ci-list-i18n-hotfix.cjs');

const appFixture = `
function ciClearanceLabel(v){return v==='formal'?'正清':v==='non_formal'?'非正清':'未设置';}
async function renderCI(){
  const ciFilterControls = '<div class="filter-group"><label>'+t('logistics.detail.logistics_status','物流状态')+'</label><select id="ci-logistics-fs"><option value="">'+t('common.all','全部')+'</option>'+logisticsFilterOptions('')+'</select></div><div class="filter-group"><label>清关方式</label><select id="ci-clearance-filter" onchange="onCIFilterChange()"><option value="">全部</option><option value="formal">正清</option><option value="non_formal">非正清</option><option value="unset">未设置</option></select></div>';
}
function renderUnifiedCITable(operationalData,historicalData){
  var columns=[
    ['CI号','ci.no'],['CI类型','ci.col.type'],['品牌','field.brand'],['国家','field.country'],
    ['仓库','field.target_warehouse'],['清关方式','ci.clearance_type'],['CI日期','field.ci_date'],
    ['CI金额','ci.amount'],['总运费','ci.col.total_freight'],
    ['运费占比','ci.col.freight_ratio'],['已付金额','ci.paid_amount'],['未结金额','ci.unpaid_amount'],
    ['付款状态','ci.payment_status'],['物流状态','ci.col.logistics_status'],
    ['入库状态','ci.col.inbound_status'],['到期日','field.due_date'],['操作','common.actions']
  ];
  function addOpRow(srcTable,sourceRow,c){
    tr.appendChild(moneyCell(c.balance_unpaid_amount));
    tr.appendChild(cell(srcTable,sourceRow,['尾款状态','付款状态','Balance Payment Status','Payment Status']));
    tr.appendChild(cell(srcTable,sourceRow,['物流状态','Logistics Status']));
    tr.appendChild(cell(srcTable,sourceRow,['入库状态','Inbound Status']));
    tr.appendChild(cell(srcTable,sourceRow,['到期日','Due Date'],fmtDate(c.due_date)));
  }
  function addHistoricalRow(srcTable,sourceRow,h){
    tr.appendChild(moneyCell(h.unpaid_amount));
    tr.appendChild(cell(srcTable,sourceRow,['付款状态','Payment Status']));
    tr.appendChild(textCell('—'));
    tr.appendChild(textCell('—'));
    tr.appendChild(cell(srcTable,sourceRow,['到期日','Due Date']));
    var items=[
      ['导入历史已付',h.historical_paid_amount],['后续已付',h.subsequent_paid_amount],
      ['抵扣',h.deduction_amount],['抹零',h.rounding_amount]
    ];
  }
}
`;
const patched = patchAppSource(appFixture);
assert.ok(patched.includes(APP_MARKER));
assert.ok(patched.includes("t('ci.clearance.formal','正清')"));
assert.ok(patched.includes("t('ci.clearance.filter','清关方式')"));
assert.ok(patched.includes("['尾款到期日','ci.final_balance_due_date']"));
assert.ok(patched.indexOf("['未结金额','ci.unpaid_amount']") < patched.indexOf("['尾款到期日','ci.final_balance_due_date']"));
assert.ok(!patched.includes("['入库状态','ci.col.inbound_status']"), 'inbound status column must be removed');
assert.ok(!patched.includes("['入库状态','Inbound Status']"), 'operational inbound cell must be removed');
assert.ok(patched.includes("['尾款到期日','到期日','Due Date']"), 'operational due date cell must follow outstanding amount');
assert.ok(patched.includes("['尾款到期日','到期日','Due Date']"), 'historical due date cell must follow outstanding amount');
assert.ok(patched.includes('ciPaymentStatusLabel(c.balance_payment_status)'));
assert.ok(patched.includes('ciPaymentStatusLabel(h.payment_status)'));
assert.ok(patched.includes("t('ci.historical_paid','导入历史已付')"));
assert.equal(patchAppSource(patched), patched, 'app patch must be idempotent');

const i18nFixture = '(function(){\n  var I18N={dict:{zh:{},en:{},id:{}}};\n})();';
const i18nPatched = patchI18nSource(i18nFixture);
assert.ok(i18nPatched.includes(I18N_MARKER));
assert.ok(i18nPatched.includes('Final Balance Due Date'));
assert.ok(i18nPatched.includes('Clearance Method'));
assert.ok(i18nPatched.includes('Related Logistics Batch'));
assert.ok(i18nPatched.includes('I18N.dict.en["gen.L5761.2"] = ciSourceHeader'));
assert.ok(i18nPatched.includes('CI Operasional'));
assert.ok(i18nPatched.includes('Outstanding Amount'));
assert.equal(patchI18nSource(i18nPatched), i18nPatched, 'i18n patch must be idempotent');

console.log('CI/PL complete i18n hotfix: PASS');
