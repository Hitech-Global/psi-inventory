# Phase 3-C-4B-1b-1 验收补充证据报告（只读核验）

> 性质：**只读补充核验**。未修改任何代码；未 commit / push / deploy。
> 所有结论均来自本次重新运行的原始命令与脚本输出，可被独立复现。

---

## 1. 完整 git 状态与 diff

### 1.1 `git status --short`
```
 M app.js
 M i18n.js
 D INVENTORY-PG-REBUILD-01-R1.6-NORMALIZER-FIX-REPORT.md
 D INVENTORY-PG-REBUILD-01-R1.8-NORMALIZER-FIX-REPORT.md
 D INVENTORY-PG-REBUILD-01-R2.1-ASYNC-HANDLER-REPORT.md
 D INVENTORY-PG-REBUILD-01-R2.3a-DAL-TRANSACTION-REPORT.md
?? app.js.bak
?? docs/PG-REBUILD/
?? html-template-after.json
?? html-template-before.json
?? htmlfix-acceptance-report.md
?? i18n-coverage-report.md
?? i18n-full-coverage-report.md
?? i18n-htmlfix-report.md
?? i18n-p1p2p3-acceptance-report.md
?? i18n-packs-translated.zip
?? i18n-packs.zip
?? i18n-packs/
?? i18n-phase3b-translate-only-report.md
?? i18n-phase3c1-plan.json
?? i18n-phase3c1-readonly-report.md
?? i18n-runtime-audit.js
?? i18n-runtime-fix-plan.md
?? i18n-runtime-fix-report.md
?? i18n-runtime-snapshot-before.md
?? i18n-translation-plan.json
?? i18n-v2-verification-report.md
?? i18n-wiring-report.md
?? i18n.js.bak
?? i18n.js.prehtmlfix.bak
?? index.html.bak
?? phase2b-acceptance-report.md
?? phase3c2-acceptance-report.md
?? phase3c2-baseline.json
?? phase3c2-plan.md
?? phase3c4b1-finance-plan.md
?? phase3c4b1b1-readonly-report.md
?? phase3c4b1b1-report.md
?? runtime-i18n-leak-report.md
```
> 说明：本次相关改动仅 `M app.js` 与 `M i18n.js` 两个受跟踪文件。`D INVENTORY-PG-REBUILD-*` 为早期用户删除的无关报告（非本任务产生）；其余 `??` 均为历史未跟踪产物（备份 / 脚本 / 报告），均不在本任务交付内。

### 1.2 `git diff --stat`
```
 ...ORY-PG-REBUILD-01-R1.6-NORMALIZER-FIX-REPORT.md | 115 ------------
 ...ORY-PG-REBUILD-01-R1.8-NORMALIZER-FIX-REPORT.md | 104 ----------
 ...TORY-PG-REBUILD-01-R2.1-ASYNC-HANDLER-REPORT.md | 105 -----------
 ...Y-PG-REBUILD-01-R2.3a-DAL-TRANSACTION-REPORT.md | 209 ---------------------
 app.js                                             |  48 ++---
 i18n.js                                            |  42 +++++
 6 files changed, 66 insertions(+), 557 deletions(-)
```
> 与本任务直接相关的：`app.js | 48 ++---`（48 行变更，仅展示层 t() 接线）、`i18n.js | 42 +++++`（42 行新增语义键）。其余 4 个删除文件非本任务。

### 1.3 `git diff -- app.js i18n.js`（完整）
```diff
diff --git a/app.js b/app.js
index cbff863..5c244b5 100644
--- a/app.js
+++ b/app.js
@@ -5707,7 +5707,7 @@ async function createDepPay(id){
 }
 async function saveDepPay(id){
   const d={pi_id:id,has_deduction:parseInt(document.getElementById('dep-ded').value),deduction_amount:parseFloat(document.getElementById('dep-ded-amt').value)||0,deduction_source_type:document.getElementById('dep-ded-type').value,deduction_source_desc:document.getElementById('dep-ded-desc').value,deduction_ref_no:document.getElementById('dep-ded-ref').value};
-  try{await api('/api/payment-requests/from-pi-deposit','POST',d);showToast('定金付款申请已生成','success');closeModal()}catch(e){showToast(e.message,'danger')}
+  try{await api('/api/payment-requests/from-pi-deposit','POST',d);showToast(t('toast.depPayCreated','定金付款申请已生成'),'success');closeModal()}catch(e){showToast(e.message,'danger')}
 }

 const DOC_TEMPLATES={
@@ -5945,7 +5945,7 @@ async function createBalPay(id){
 }
 async function saveBalPay(id){
   const d={ci_id:id,has_deduction:parseInt(document.getElementById('bal-ded').value),deduction_amount:parseFloat(document.getElementById('bal-ded-amt').value)||0,deduction_source_type:document.getElementById('bal-ded-type').value,deduction_source_desc:document.getElementById('bal-ded-desc').value,deduction_ref_no:document.getElementById('bal-ded-ref').value};
-  try{await api('/api/payment-requests/from-ci-balance','POST',d);showToast('尾款付款申请已生成','success');closeModal()}catch(e){showToast(e.message,'danger')}
+  try{await api('/api/payment-requests/from-ci-balance','POST',d);showToast(t('toast.balPayCreated','尾款付款申请已生成'),'success');closeModal()}catch(e){showToast(e.message,'danger')}
 }
 // CI费用管理入口
 async function viewCICost(id){
@@ -5972,20 +5972,20 @@ async function saveCiCostInputs(id,quiet){
 async function createWarehousePay(ciId){
   try{
   let countryField='';
-  if(!ciId){const countries=(await api('/api/countries')).filter(c=>c.status==='active');countryField='<div class="form-group"><label>费用归属国家 <span class="required">*</span></label><select id="war-country"><option value="">请选择</option>'+countries.map(c=>'<option value="'+esc(c.name)+'">'+esc(c.name)+'（'+esc(c.code)+'）</option>').join('')+'</select></div>'}
-  openModal('创建到仓费用付款',
+  if(!ciId){const countries=(await api('/api/countries')).filter(c=>c.status==='active');countryField='<div class="form-group"><label>'+t('term.fin.expense_country','费用归属国家')+' <span class="required">*</span></label><select id="war-country"><option value="">请选择</option>'+countries.map(c=>'<option value="'+esc(c.name)+'">'+esc(c.name)+'（'+esc(c.code)+'）</option>').join('')+'</select></div>'}
+  openModal(t('modal.title.createWarehousePay','创建到仓费用付款'),
     t('modal.body.createWarehousePay', `<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid"><div class="form-group"><label>费用小类</label><select id="war-sub"><option value="freight">运费</option><option value="customs_clearance">清关费</option><option value="port_charges">港口费</option><option value="delivery">派送费</option><option value="warehouse">仓储费</option><option value="other_local">其他本地费</option></select></div><div class="form-group"><label>付款对象</label><input type="text" id="war-payee" placeholder="货代/服务商名称"></div><div class="form-group"><label>应付金额</label><input type="number" step="0.01" id="war-amt"></div><div class="form-group"><label>币种</label><select id="war-cur"><option>USD</option><option>RMB</option><option>IDR</option><option>MYR</option><option>THB</option></select></div>{v1}<div class="form-group"><label>计入落地成本</label><select id="war-lic"><option value="1">是</option><option value="0">否</option></select></div><div class="form-group"><label>备注</label><input type="text" id="war-rem"></div><div class="form-group"><label>是否抵扣</label><select id="war-ded" onchange="document.getElementById('war-ded-amt').disabled=this.value==='0'"><option value="0">否</option><option value="1">是</option></select></div><div class="form-group"><label>抵扣金额</label><input type="number" step="0.01" id="war-ded-amt" value="0" disabled></div><div class="form-group"><label>抵扣来源类型</label><select id="war-ded-type"><option value="">选择</option><option value="other_payment">其他付款多付</option><option value="price_diff">价格差异</option><option value="quality_claim">质量索赔</option><option value="other">其他</option></select></div><div class="form-group form-group-full"><label>抵扣说明</label><input type="text" id="war-ded-desc"></div></div></div>`, {v1: countryField}),
     t('modal.footer.createWarehousePay', `<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveWarehousePay('{v1}')">创建</button>`, {v1: ciId}));
   }catch(e){showToast(e.message,'danger')}
 }
 async function saveWarehousePay(ciId){
-  const countryEl=document.getElementById('war-country');if(!ciId&&(!countryEl||!countryEl.value)){showToast('请选择费用归属国家','warning');return}
+  const countryEl=document.getElementById('war-country');if(!ciId&&(!countryEl||!countryEl.value)){showToast(t('validation.expenseCountryRequired','请选择费用归属国家'),'warning');return}
   const d={ci_id:ciId,subcategory:document.getElementById('war-sub').value,payee_name:document.getElementById('war-payee').value,payable_amount:parseFloat(document.getElementById('war-amt').value)||0,currency:document.getElementById('war-cur').value,expense_country:countryEl?countryEl.value:'',remark:document.getElementById('war-rem').value,has_deduction:parseInt(document.getElementById('war-ded').value),deduction_amount:parseFloat(document.getElementById('war-ded-amt').value)||0,deduction_source_type:document.getElementById('war-ded-type').value,deduction_source_desc:document.getElementById('war-ded-desc').value,include_in_landing_cost:parseInt(document.getElementById('war-lic').value)};
-  try{await api('/api/payment-requests/warehouse-arrival','POST',d);showToast('到仓费用付款申请已创建','success');closeModal()}catch(e){showToast(e.message,'danger')}
+  try{await api('/api/payment-requests/warehouse-arrival','POST',d);showToast(t('toast.warehousePayCreated','到仓费用付款申请已创建'),'success');closeModal()}catch(e){showToast(e.message,'danger')}
 }
 async function createCustomsDutyPay(ciId){
   openModal(t("app.1021", "\u521b\u5efa\u5173\u7a0e\u4edf\u6b3e"),
-    '<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid">'+
+    t('modal.body.createCustomsDutyPay', '<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid">'+
     '<div class="form-group"><label>付款对象</label><input type="text" id="dut-payee" value="海关"></div>'+
     '<div class="form-group"><label>应付金额</label><input type="number" step="0.01" id="dut-amt"></div>'+
     '<div class="form-group"><label>币种</label><select id="dut-cur"><option>USD</option><option>RMB</option></select></div>'+
@@ -5994,16 +5994,16 @@ async function createCustomsDutyPay(ciId){
     '<div class="form-group"><label>抵扣金额</label><input type="number" step="0.01" id="dut-ded-amt" value="0" disabled></div>'+
     '<div class="form-group"><label>抵扣来源类型</label><select id="dut-ded-type"><option value="">选择</option><option value="other_payment">其他付款多付</option><option value="price_diff">价格差异</option><option value="other">其他</option></select></div>'+
     '<div class="form-group form-group-full"><label>抵扣说明</label><input type="text" id="dut-ded-desc"></div>'+
-    '</div></div>',
+    '</div></div>'),
     t('modal.footer.createCustomsDutyPay', `<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveCustomsDutyPay('{v1}')">创建</button>`, {v1: ciId}));
 }
 async function saveCustomsDutyPay(ciId){
   const d={ci_id:ciId,payee_name:document.getElementById('dut-payee').value,payable_amount:parseFloat(document.getElementById('dut-amt').value)||0,currency:document.getElementById('dut-cur').value,remark:document.getElementById('dut-rem').value,has_deduction:parseInt(document.getElementById('dut-ded').value),deduction_amount:parseFloat(document.getElementById('dut-ded-amt').value)||0,deduction_source_type:document.getElementById('dut-ded-type').value,deduction_source_desc:document.getElementById('dut-ded-desc').value};
-  try{await api('/api/payment-requests/customs-duty','POST',d);showToast('关税付款申请已创建','success');closeModal()}catch(e){showToast(e.message,'danger')}
+  try{await api('/api/payment-requests/customs-duty','POST',d);showToast(t('toast.customsDutyPayCreated','关税付款申请已创建'),'success');closeModal()}catch(e){showToast(e.message,'danger')}
 }
 async function createInspectionFeePay(ciId){
   openModal(t("app.1023", "\u521b\u5efa\u5546\u68c0\u8d39\u7528\u4edf\u6b3e"),
-    '<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid">'+
+    t('modal.body.createInspectionFeePay', '<div class="form-card" style="box-shadow:none;padding:0"><div class="form-grid">'+
     '<div class="form-group"><label>付款对象</label><input type="text" id="ins-payee" placeholder="\u5546\u68c0\u673a\u6784"></div>'+
     '<div class="form-group"><label>应付金额</label><input type="number" step="0.01" id="ins-amt"></div>'+
     '<div class="form-group"><label>币种</label><select id="ins-cur"><option>USD</option><option>RMB</option></select></div>'+
@@ -6012,12 +6012,12 @@ async function createInspectionFeePay(ciId){
     '<div class="form-group"><label>抵扣金额</label><input type="number" step="0.01" id="ins-ded-amt" value="0" disabled></div>'+
     '<div class="form-group"><label>抵扣来源类型</label><select id="ins-ded-type"><option value="">选择</option><option value="other_payment">其他付款多付</option><option value="price_diff">价格差异</option><option value="other">其他</option></select></div>'+
     '<div class="form-group form-group-full"><label>抵扣说明</label><input type="text" id="ins-ded-desc"></div>'+
-    '</div></div>',
+    '</div></div>'),
     t('modal.footer.createInspectionFeePay', `<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveInspectionFeePay('{v1}')">创建</button>`, {v1: ciId}));
 }
 async function saveInspectionFeePay(ciId){
   const d={ci_id:ciId,payee_name:document.getElementById('ins-payee').value,payable_amount:parseFloat(document.getElementById('ins-amt').value)||0,currency:document.getElementById('ins-cur').value,remark:document.getElementById('ins-rem').value,has_deduction:parseInt(document.getElementById('ins-ded').value),deduction_amount:parseFloat(document.getElementById('ins-ded-amt').value)||0,deduction_source_type:document.getElementById('ins-ded-type').value,deduction_source_desc:document.getElementById('ins-ded-desc').value};
-  try{await api('/api/payment-requests/inspection-fee','POST',d);showToast('商检费用付款申请已创建','success');closeModal()}catch(e){showToast(e.message,'danger')}
+  try{await api('/api/payment-requests/inspection-fee','POST',d);showToast(t('toast.inspectionFeePayCreated','商检费用付款申请已创建'),'success');closeModal()}catch(e){showToast(e.message,'danger')}
 }

 // ==================== 物流管理 ====================
@@ -6049,7 +6049,7 @@ async function saveNewLog(){
 async function createFrtPay(id){
   try{
     const log=await api('/api/logistics-batches/'+id);
-    if(!log.related_ci_id){showToast('该物流批次未关联CI，请从CI费用管理页面创建到仓费用付款','warning');return}
+    if(!log.related_ci_id){showToast(t('toast.frtPayNoCI','该物流批次未关联CI，请从CI费用管理页面创建到仓费用付款'),'warning');return}
     // 跳转到CI费用管理
     viewCICost(log.related_ci_id);
   }catch(e){showToast(e.message,'danger')}
@@ -6992,7 +6992,7 @@ async function viewPayment(id, mode){
       + (p.rounding_amount>0?fld(t("app.1138", "\u62b9\u96f6\u91d1\u989d"), fmtMoney(p.rounding_amount, cur)):'')
       + fld(t("app.1139", "\u5b9e\u9645\u4edf\u6b3e\u65e5\u671f"), esc(p.paid_date||'—'))
       + fld(t("app.118", "\u5e01\u79cd"), esc(cur||'—'))
-      + (p.payment_category!=='goods'?fld('费用归属国家', esc(p.expense_country||t("app.445", "\u672a\u8bbe\u7f6e"))):'')
+      + (p.payment_category!=='goods'?fld(t('term.fin.expense_country','费用归属国家'), esc(p.expense_country||t("app.445", "\u672a\u8bbe\u7f6e"))):'')
       + fld(t("app.195", "\u603b\u6570\u91cf"), qtyHtml)
       + fld(t("status.label", "\u72b6\u6001"), esc(stLabel))
       + fld(t("app.1140", "\u5ba1\u6279\u72b6\u6001"), statusLabel(p.approval_status))
@@ -7059,7 +7059,7 @@ async function viewPayment(id, mode){
     try{ const pv=(typeof p.attachment==='string'&&p.attachment)?JSON.parse(p.attachment):p.attachment; attaches=Array.isArray(pv)?pv:(pv&&pv.dataUrl?[{name:pv.name,type:pv.type,size:pv.size,dataUrl:pv.dataUrl}]:[]); }catch(e){ attaches=[]; }
     window._payId=id; window._payAttachments=attaches; window._payCanUpload=(hasPermission('payment_create')||hasPermission('payment_approve'));
     // 附件展示 + 上传区（view 与 finance 模式均显示）
-    const attSection='<div class="detail-section"><h3>付款申请附件</h3>'
+    const attSection='<div class="detail-section"><h3>'+t('payment.attachments','付款申请附件')+'</h3>'
       +'<div id="pay-att-list">'+renderPayAttachmentListInner()+'</div>'
       +(window._payCanUpload
         ? '<div id="pay-drop-zone" style="border:2px dashed #d9d9d9;border-radius:8px;padding:22px 16px;text-align:center;cursor:pointer;background:#fafafa;transition:all .2s;margin-top:10px" '
@@ -7095,19 +7095,19 @@ function fmtSize(b){ if(b==null)return ''; if(b<1024)return b+'B'; if(b<1024*102
 function readFileAsDataURL(f){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(f); }); }
 function renderPayAttachmentListInner(){
   const arr=window._payAttachments||[];
-  if(!arr.length) return '<div style="color:#999;font-size:13px">暂无附件</div>';
+  if(!arr.length) return '<div style="color:#999;font-size:13px">'+t('empty.noAttachment','暂无附件')+'</div>';
   return '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:6px">'+arr.map((a,idx)=>{
     const isImg=(a.type&&a.type.indexOf('image/')===0)||/\.(png|jpe?g|gif|webp|bmp)$/i.test(a.name||'');
     const thumb=isImg?'<img src="'+a.dataUrl+'" style="width:54px;height:54px;object-fit:cover;border-radius:6px;border:1px solid #eee;vertical-align:middle;cursor:pointer" onclick="openPayAttachmentUrl('+idx+')">':'';
-    const nameLink='<a href="javascript:void(0)" style="color:#1d6fd3;cursor:pointer;text-decoration:underline;word-break:break-all" onclick="openPayAttachmentUrl('+idx+')">'+esc(a.name||('附件'+(idx+1)))+'</a>';
-    const del=window._payCanUpload?'<button class="btn btn-danger btn-sm" style="margin-left:4px" onclick="payDeleteAttachment(window._payId,'+idx+')">删除</button>':'';
+    const nameLink='<a href="javascript:void(0)" style="color:#1d6fd3;cursor:pointer;text-decoration:underline;word-break:break-all" onclick="openPayAttachmentUrl('+idx+')">'+esc(a.name||(t('common.attachment','附件')+(idx+1)))+'</a>';
+    const del=window._payCanUpload?'<button class="btn btn-danger btn-sm" style="margin-left:4px" onclick="payDeleteAttachment(window._payId,'+idx+')">'+t('action.delete','删除')+'</button>':'';
     return '<div style="border:1px solid #eee;border-radius:8px;padding:8px;display:flex;align-items:center;gap:8px;background:#fff;max-width:280px">'+thumb+'<div style="min-width:0">'+nameLink+'<div style="font-size:11px;color:#999">'+(a.size?fmtSize(a.size):'')+(a.uploaded_at?' · '+a.uploaded_at.slice(0,10):'')+'</div></div>'+del+'</div>';
   }).join('')+'</div>';
 }
 function renderPayAttachmentList(){ const el=document.getElementById('pay-att-list'); if(el) el.innerHTML=renderPayAttachmentListInner(); }
 async function payUploadFiles(id, files){
   if(!files||!files.length)return;
-  if(!(hasPermission('payment_create')||hasPermission('payment_approve'))){showToast('无附件上传权限','danger');return}
+  if(!(hasPermission('payment_create')||hasPermission('payment_approve'))){showToast(t('toast.uploadNoPermission','无附件上传权限'),'danger');return}
   const arr=window._payAttachments||[];
   try{
     for(const f of files){ const du=await readFileAsDataURL(f); arr.push({name:f.name,type:f.type,size:f.size,dataUrl:du,uploaded_at:new Date().toISOString()}); }
@@ -7120,7 +7120,7 @@ async function payDeleteAttachment(id, idx){
   const arr=window._payAttachments||[];
   if(idx<0||idx>=arr.length)return;
   arr.splice(idx,1);
-  try{ await api('/api/payment-requests/'+id+'/attachment','POST',{attachment:arr}); window._payAttachments=arr; renderPayAttachmentList(); showToast('附件已删除','success'); }
+  try{ await api('/api/payment-requests/'+id+'/attachment','POST',{attachment:arr}); window._payAttachments=arr; renderPayAttachmentList(); showToast(t('toast.attachmentDeleted','附件已删除'),'success'); }
   catch(e){ showToast(e.message,'danger'); }
 }
 // 附件 dataUrl → blob URL（PDF/其他文件用，避免 data: 协议在新标签/下载时受限）
@@ -7193,7 +7193,7 @@ async function loadPay(){
   try{
     const s=document.getElementById('pay-fs')?.value||'',c=document.getElementById('pay-fc')?.value||'',k=document.getElementById('pay-fk')?.value||'';
     const data=await api('/api/payment-requests?status='+s+'&category='+c+'&keyword='+encodeURIComponent(k));
-    document.getElementById('pay-table').innerHTML=!data.length?'<div class="empty-state"><div class="empty-icon">💳</div>暂无付款数据</div>':'<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>'+t("html.pay.th.applyNo","申请号")+'</th><th>'+t("html.pay.th.category","大类")+'</th><th>'+t("html.pay.th.subcategory","小类")+'</th><th>'+t("html.pay.th.sourceNo","来源单号")+'</th><th>'+t("html.pay.th.relCI","关联CI")+'</th><th>'+t("html.pay.th.payee","付款对象")+'</th><th>'+t("html.pay.th.payable","应付金额")+'</th><th>'+t("html.pay.th.deduct","抵扣金额")+'</th><th>'+t("html.pay.th.actualPayable","实际应付")+'</th><th>'+t("html.pay.th.paid","已付")+'</th><th>'+t("html.pay.th.unpaid","未付")+'</th><th>'+t("html.pay.th.currency","币种")+'</th><th>'+t("html.pay.th.status","状态")+'</th><th>'+t("html.pay.th.action","操作")+'</th></tr></thead><tbody>'+data.map(p=>{
+    document.getElementById('pay-table').innerHTML=!data.length?'<div class="empty-state"><div class="empty-icon">💳</div>'+t('empty.noPaymentData','暂无付款数据')+'</div>':'<div class="table-container" style="box-shadow:none;border-radius:0"><table class="data-table"><thead><tr><th>'+t("html.pay.th.applyNo","申请号")+'</th><th>'+t("html.pay.th.category","大类")+'</th><th>'+t("html.pay.th.subcategory","小类")+'</th><th>'+t("html.pay.th.sourceNo","来源单号")+'</th><th>'+t("html.pay.th.relCI","关联CI")+'</th><th>'+t("html.pay.th.payee","付款对象")+'</th><th>'+t("html.pay.th.payable","应付金额")+'</th><th>'+t("html.pay.th.deduct","抵扣金额")+'</th><th>'+t("html.pay.th.actualPayable","实际应付")+'</th><th>'+t("html.pay.th.paid","已付")+'</th><th>'+t("html.pay.th.unpaid","未付")+'</th><th>'+t("html.pay.th.currency","币种")+'</th><th>'+t("html.pay.th.status","状态")+'</th><th>'+t("html.pay.th.action","操作")+'</th></tr></thead><tbody>'+data.map(p=>{
       const catLabel=PAY_CATEGORIES[p.payment_category]||p.payment_category;
       const subLabel=(PAY_SUBCATS[p.payment_category]&&PAY_SUBCATS[p.payment_category][p.payment_subcategory])||p.payment_subcategory||'';
       const stLabel=PAY_STATUS_MAP[p.payment_status]||p.payment_status;
@@ -7203,7 +7203,7 @@ async function loadPay(){
       const canRound=p.approval_status==='approved'&&Number(p.unpaid_amount||0)>0&&Number(p.rounding_amount||0)<=0&&!['rejected','cancelled'].includes(p.payment_status);
       const needsExpenseCountry=p.payment_category!=='goods'&&!String(p.expense_country||'').trim();
       const actualDisplay=Number(p.actual_pay_amount||0)>0||Number(p.deduction_amount||0)>0||Number(p.rounding_amount||0)>0?p.actual_pay_amount:p.payable_amount;
-      return '<tr><td class="cell-id">'+esc(p.request_no)+'</td><td>'+esc(catLabel)+'</td><td>'+esc(subLabel)+'</td><td class="cell-id">'+esc(p.source_no)+'</td><td class="cell-id">'+esc(p.related_ci_no||'')+'</td><td>'+esc(p.supplier_name)+'</td><td class="text-right font-bold">'+fmtMoney(p.payable_amount)+'</td><td class="text-right '+(p.deduction_amount>0?'text-warning':'')+'">'+(p.deduction_amount>0?fmtMoney(p.deduction_amount):'-')+'</td><td class="text-right font-bold">'+fmtMoney(actualDisplay)+'</td><td class="text-right">'+fmtMoney(p.paid_amount)+'</td><td class="text-right '+(p.unpaid_amount>0?'text-danger':'')+'">'+fmtMoney(p.unpaid_amount)+'</td><td>'+esc(p.currency)+'</td><td><span class="status-badge '+stClass+'">'+esc(stLabel)+'</span></td><td class="cell-actions">'+(hasPermission('payment_view')?'<button class="action-btn" onclick="viewPayment(\''+p.id+'\')" title="\u67e5\u770b\u8be6\u60c5">👁️</button>':'')+(needsExpenseCountry&&hasPermission('payment_approve')?'<button class="action-btn" onclick="openPaymentExpenseCountry(\''+p.id+'\')" title="补录费用归属国家">补国家</button>':'')+(p.approval_status==='pending'&&hasPermission('payment_approve')?'<button class="action-btn action-edit" onclick="apprPay(\''+p.id+'\',\'approve\')" title="通过">✅</button><button class="action-btn action-delete" onclick="apprPay(\''+p.id+'\',\'reject\')" title="驳回">❌</button>':'')+(canPay&&hasPermission('payment_approve')?'<button class="action-btn action-edit" onclick="confirmPaid(\''+p.id+'\')" title="确认付款">💵</button>':'')+(canRound&&hasPermission('payment_approve')?'<button class="action-btn" onclick="openPaymentRounding(\''+p.id+'\')" title="手动抹零">抹零</button>':'')+(canDeduct&&hasPermission('payment_create')?'<button class="action-btn" onclick="editDeduction(\''+p.id+'\')" title="编辑抵扣">✂️</button>':'')+'</td></tr>';
+      return '<tr><td class="cell-id">'+esc(p.request_no)+'</td><td>'+esc(catLabel)+'</td><td>'+esc(subLabel)+'</td><td class="cell-id">'+esc(p.source_no)+'</td><td class="cell-id">'+esc(p.related_ci_no||'')+'</td><td>'+esc(p.supplier_name)+'</td><td class="text-right font-bold">'+fmtMoney(p.payable_amount)+'</td><td class="text-right '+(p.deduction_amount>0?'text-warning':'')+'">'+(p.deduction_amount>0?fmtMoney(p.deduction_amount):'-')+'</td><td class="text-right font-bold">'+fmtMoney(actualDisplay)+'</td><td class="text-right">'+fmtMoney(p.paid_amount)+'</td><td class="text-right '+(p.unpaid_amount>0?'text-danger':'')+'">'+fmtMoney(p.unpaid_amount)+'</td><td>'+esc(p.currency)+'</td><td><span class="status-badge '+stClass+'">'+esc(stLabel)+'</span></td><td class="cell-actions">'+(hasPermission('payment_view')?'<button class="action-btn" onclick="viewPayment(\''+p.id+'\')" title="'+t('title.viewDetail','查看详情')+'">👁️</button>':'')+(needsExpenseCountry&&hasPermission('payment_approve')?'<button class="action-btn" onclick="openPaymentExpenseCountry(\''+p.id+'\')" title="'+t('term.fin.supplement_expense_country','补录费用归属国家')+'">补国家</button>':'')+(p.approval_status==='pending'&&hasPermission('payment_approve')?'<button class="action-btn action-edit" onclick="apprPay(\''+p.id+'\',\'approve\')" title="通过">✅</button><button class="action-btn action-delete" onclick="apprPay(\''+p.id+'\',\'reject\')" title="驳回">❌</button>':'')+(canPay&&hasPermission('payment_approve')?'<button class="action-btn action-edit" onclick="confirmPaid(\''+p.id+'\')" title="确认付款">💵</button>':'')+(canRound&&hasPermission('payment_approve')?'<button class="action-btn" onclick="openPaymentRounding(\''+p.id+'\')" title="手动抹零">抹零</button>':'')+(canDeduct&&hasPermission('payment_create')?'<button class="action-btn" onclick="editDeduction(\''+p.id+'\')" title="'+t('title.editDeduction','编辑抵扣')+'">✂️</button>':'')+'</td></tr>';
     }).join('')+'</tbody></table></div>';
   }catch(e){showFlash(e.message,'danger')}
 }
@@ -7257,7 +7257,7 @@ async function editDeduction(id){
     // Since there's no GET by id endpoint, use the list
     const data=await api('/api/payment-requests?keyword='+id);
     const pay=data.find(x=>x.id===id);
-    if(!pay){showToast('未找到付款申请','danger');return}
+    if(!pay){showToast(t('toast.paymentNotFound','未找到付款申请'),'danger');return}
     openModal(t('modal.title.editDeduction', '编辑抵扣 - {v1}', {v1: pay.request_no}),
       t('modal.body.editDeduction', `<div class="form-card" style="box-shadow:none;padding:0"><div class="detail-grid mb-16"><div class="detail-item"><span class="detail-label">应付金额</span><span class="detail-value">{v1} {v2}</span></div><div class="detail-item"><span class="detail-label">付款对象</span><span class="detail-value">{v3}</span></div></div><div class="form-grid"><div class="form-group"><label>是否抵扣</label><select id="ded-has" onchange="document.getElementById('ded-amt').disabled=!this.value"><option value="0">否</option><option value="1" {v4}>是</option></select></div><div class="form-group"><label>抵扣金额</label><input type="number" step="0.01" id="ded-amt" value="{v5}" {v6}></div><div class="form-group"><label>抵扣来源类型</label><select id="ded-type"><option value="">选择</option><option value="other_payment" {v7}>其他付款多付</option><option value="price_diff" {v8}>价格差异</option><option value="quality_claim" {v9}>质量索赔</option><option value="advance_payment" {v10}>预付款抵扣</option><option value="other" {v11}>其他</option></select></div><div class="form-group"><label>抵扣参考号</label><input type="text" id="ded-ref" value="{v12}"></div><div class="form-group form-group-full"><label>抵扣说明</label><textarea id="ded-desc" rows="2">{v13}</textarea></div></div></div>`, {v1: fmtMoney(pay.payable_amount), v2: esc(pay.currency||''), v3: esc(pay.supplier_name), v4: pay.has_deduction?'selected':'', v5: pay.deduction_amount||0, v6: pay.has_deduction?'':'disabled', v7: pay.deduction_source_type==='other_payment'?'selected':'', v8: pay.deduction_source_type==='price_diff'?'selected':'', v9: pay.deduction_source_type==='quality_claim'?'selected':'', v10: pay.deduction_source_type==='advance_payment'?'selected':'', v11: pay.deduction_source_type==='other'?'selected':'', v12: esc(pay.deduction_ref_no||''), v13: esc(pay.deduction_source_desc||'')}),
       t('modal.footer.editDeduction', `<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveDeduction('{v1}')">保存</button>`, {v1: id}));
@@ -7265,7 +7265,7 @@ async function editDeduction(id){
 }
 async function saveDeduction(id){
   const d={has_deduction:parseInt(document.getElementById('ded-has').value),deduction_amount:parseFloat(document.getElementById('ded-amt').value)||0,deduction_source_type:document.getElementById('ded-type').value,deduction_source_desc:document.getElementById('ded-ded-desc').value,deduction_ref_no:document.getElementById('ded-ref').value};
-  try{await api('/api/payment-requests/'+id+'/deduction','PUT',d);showToast('抵扣信息已保存','success');closeModal();loadPay()}catch(e){showToast(e.message,'danger')}
+  try{await api('/api/payment-requests/'+id+'/deduction','PUT',d);showToast(t('toast.deductionSaved','抵扣信息已保存'),'success');closeModal();loadPay()}catch(e){showToast(e.message,'danger')}
 }
 function importPayResult(){importFile('/api/payment-requests/bulk-import-result',loadPay)}

diff --git a/i18n.js b/i18n.js
index 83786b2..0749452 100644
--- a/i18n.js
+++ b/i18n.js
@@ -2582,4 +2582,46 @@ I18N.dict.en["term.sys.user"] = "User"; I18N.dict.id["term.sys.user"] = "Penggun
   I18N.dict.en['term.fin.supplement_expense_country'] = 'Supplement expense country';
   I18N.dict.id['term.fin.supplement_expense_country'] = 'Tambah negara biaya';

+  /* Phase 3-C-4B-1b-1 Payment Request page user-visible text localization */
+  I18N.dict.en['modal.title.createWarehousePay'] = 'Create Warehouse-Arrival Payment';
+  I18N.dict.id['modal.title.createWarehousePay'] = 'Buat Pembayaran Biaya Gudang';
+  I18N.dict.en['toast.warehousePayCreated'] = 'Warehouse-arrival payment request created';
+  I18N.dict.id['toast.warehousePayCreated'] = 'Permintaan pembayaran biaya gudang dibuat';
+  I18N.dict.en['toast.customsDutyPayCreated'] = 'Customs duty payment request created';
+  I18N.dict.id['toast.customsDutyPayCreated'] = 'Permintaan pembayaran bea cukai dibuat';
+  I18N.dict.en['toast.inspectionFeePayCreated'] = 'Inspection fee payment request created';
+  I18N.dict.id['toast.inspectionFeePayCreated'] = 'Permintaan pembayaran biaya pemeriksaan dibuat';
+  I18N.dict.en['toast.depPayCreated'] = 'Deposit payment request generated';
+  I18N.dict.id['toast.depPayCreated'] = 'Permintaan pembayaran uang muka dibuat';
+  I18N.dict.en['toast.balPayCreated'] = 'Balance payment request generated';
+  I18N.dict.id['toast.balPayCreated'] = 'Permintaan pembayaran sisa dibuat';
+  I18N.dict.en['toast.frtPayNoCI'] = 'This logistics batch is not linked to a CI. Please create the warehouse-arrival payment from the CI Expense Management page.';
+  I18N.dict.id['toast.frtPayNoCI'] = 'Batch logistik ini tidak terhubung dengan CI. Silakan buat pembayaran biaya gudang dari halaman Manajemen Biaya CI.';
+  I18N.dict.en['toast.paymentNotFound'] = 'Payment request not found';
+  I18N.dict.id['toast.paymentNotFound'] = 'Permintaan pembayaran tidak ditemukan';
+  I18N.dict.en['toast.deductionSaved'] = 'Deduction info saved';
+  I18N.dict.id['toast.deductionSaved'] = 'Info potongan disimpan';
+  I18N.dict.en['toast.uploadNoPermission'] = 'No attachment upload permission';
+  I18N.dict.id['toast.uploadNoPermission'] = 'Tidak ada izin unggah lampiran';
+  I18N.dict.en['toast.attachmentDeleted'] = 'Attachment deleted';
+  I18N.dict.id['toast.attachmentDeleted'] = 'Lampiran dihapus';
+  I18N.dict.en['validation.expenseCountryRequired'] = 'Please select expense country';
+  I18N.dict.id['validation.expenseCountryRequired'] = 'Pilih negara biaya';
+  I18N.dict.en['empty.noPaymentData'] = 'No payment data';
+  I18N.dict.id['empty.noPaymentData'] = 'Tidak ada data pembayaran';
+  I18N.dict.en['payment.attachments'] = 'Payment Request Attachments';
+  I18N.dict.id['payment.attachments'] = 'Lampiran Permintaan Pembayaran';
+  I18N.dict.en['empty.noAttachment'] = 'No attachments';
+  I18N.dict.id['empty.noAttachment'] = 'Tidak ada lampiran';
+  I18N.dict.en['common.attachment'] = 'Attachment';
+  I18N.dict.id['common.attachment'] = 'Lampiran';
+  I18N.dict.en['title.viewDetail'] = 'View details';
+  I18N.dict.id['title.viewDetail'] = 'Lihat detail';
+  I18N.dict.en['title.editDeduction'] = 'Edit deduction';
+  I18N.dict.id['title.editDeduction'] = 'Edit potongan';
+  I18N.dict.en["modal.body.createCustomsDutyPay"] = "<div class=\"form-card\" style=\"box-shadow:none;padding:0\"><div class=\"form-grid\"><div class=\"form-group\"><label>Payee</label><input type=\"text\" id=\"dut-payee\" value=\"海关\"></div><div class=\"form-group\"><label>Payable Amount</label><input type=\"number\" step=\"0.01\" id=\"dut-amt\"></div><div class=\"form-group\"><label>Currency</label><select id=\"dut-cur\"><option>USD</option><option>RMB</option></select></div><div class=\"form-group\"><label>Remark</label><input type=\"text\" id=\"dut-rem\"></div><div class=\"form-group\"><label>Deduct?</label><select id=\"dut-ded\" onchange=\"document.getElementById('dut-ded-amt').disabled=this.value==='0'\"><option value=\"0\">No</option><option value=\"1\">Yes</option></select></div><div class=\"form-group\"><label>Deduction Amount</label><input type=\"number\" step=\"0.01\" id=\"dut-ded-amt\" value=\"0\" disabled></div><div class=\"form-group\"><label>Deduction Source Type</label><select id=\"dut-ded-type\"><option value=\"\">Select</option><option value=\"other_payment\">Other Overpayment</option><option value=\"price_diff\">Price Variance</option><option value=\"other\">Other</option></select></div><div class=\"form-group form-group-full\"><label>Deduction Note</label><input type=\"text\" id=\"dut-ded-desc\"></div></div></div>";
+  I18N.dict.id["modal.body.createCustomsDutyPay"] = "<div class=\"form-card\" style=\"box-shadow:none;padding:0\"><div class=\"form-grid\"><div class=\"form-group\"><label>Penerima Pembayaran</label><input type=\"text\" id=\"dut-payee\" value=\"海关\"></div><div class=\"form-group\"><label>Jumlah Payable</label><input type=\"number\" step=\"0.01\" id=\"dut-amt\"></div><div class=\"form-group\"><label>Mata Uang</label><select id=\"dut-cur\"><option>USD</option><option>RMB</option></select></div><div class=\"form-group\"><label>Keterangan</label><input type=\"text\" id=\"dut-rem\"></div><div class=\"form-group\"><label>Potong?</label><select id=\"dut-ded\" onchange=\"document.getElementById('dut-ded-amt').disabled=this.value==='0'\"><option value=\"0\">Tidak</option><option value=\"1\">Ya</option></select></div><div class=\"form-group\"><label>Jumlah Potongan</label><input type=\"number\" step=\"0.01\" id=\"dut-ded-amt\" value=\"0\" disabled></div><div class=\"form-group\"><label>Tipe Sumber Potongan</label><select id=\"dut-ded-type\"><option value=\"\">Pilih</option><option value=\"other_payment\">Pembayaran Lain Lebih Bayar</option><option value=\"price_diff\">Selisih Harga</option><option value=\"other\">Lainnya</option></select></div><div class=\"form-group form-group-full\"><label>Keterangan Potongan</label><input type=\"text\" id=\"dut-ded-desc\"></div></div></div>";
+  I18N.dict.en["modal.body.createInspectionFeePay"] = "<div class=\"form-card\" style=\"box-shadow:none;padding:0\"><div class=\"form-grid\"><div class=\"form-group\"><label>Payee</label><input type=\"text\" id=\"ins-payee\" placeholder=\"Inspection Authority\"></div><div class=\"form-group\"><label>Payable Amount</label><input type=\"number\" step=\"0.01\" id=\"ins-amt\"></div><div class=\"form-group\"><label>Currency</label><select id=\"ins-cur\"><option>USD</option><option>RMB</option></select></div><div class=\"form-group\"><label>Remark</label><input type=\"text\" id=\"ins-rem\"></div><div class=\"form-group\"><label>Deduct?</label><select id=\"ins-ded\" onchange=\"document.getElementById('ins-ded-amt').disabled=this.value==='0'\"><option value=\"0\">No</option><option value=\"1\">Yes</option></select></div><div class=\"form-group\"><label>Deduction Amount</label><input type=\"number\" step=\"0.01\" id=\"ins-ded-amt\" value=\"0\" disabled></div><div class=\"form-group\"><label>Deduction Source Type</label><select id=\"ins-ded-type\"><option value=\"\">Select</option><option value=\"other_payment\">Other Overpayment</option><option value=\"price_diff\">Price Variance</option><option value=\"other\">Other</option></select></div><div class=\"form-group form-group-full\"><label>Deduction Note</label><input type=\"text\" id=\"ins-ded-desc\"></div></div></div>";
+  I18N.dict.id["modal.body.createInspectionFeePay"] = "<div class=\"form-card\" style=\"box-shadow:none;padding:0\"><div class=\"form-grid\"><div class=\"form-group\"><label>Penerima Pembayaran</label><input type=\"text\" id=\"ins-payee\" placeholder=\"Otoritas Pemeriksaan\"></div><div class=\"form-group\"><label>Jumlah Payable</label><input type=\"number\" step=\"0.01\" id=\"ins-amt\"></div><div class=\"form-group\"><label>Mata Uang</label><select id=\"ins-cur\"><option>USD</option><option>RMB</option></select></div><div class=\"form-group\"><label>Keterangan</label><input type=\"text\" id=\"ins-rem\"></div><div class=\"form-group\"><label>Potong?</label><select id=\"ins-ded\" onchange=\"document.getElementById('ins-ded-amt').disabled=this.value==='0'\"><option value=\"0\">Tidak</option><option value=\"1\">Ya</option></select></div><div class=\"form-group\"><label>Jumlah Potongan</label><input type=\"number\" step=\"0.01\" id=\"ins-ded-amt\" value=\"0\" disabled></div><div class=\"form-group\"><label>Tipe Sumber Potongan</label><select id=\"ins-ded-type\"><option value=\"\">Pilih</option><option value=\"other_payment\">Pembayaran Lain Lebih Bayar</option><option value=\"price_diff\">Selisih Harga</option><option value=\"other\">Lainnya</option></select></div><div class=\"form-group form-group-full\"><label>Keterangan Potongan</label><input type=\"text\" id=\"ins-ded-desc\"></div></div></div>";
+
 })();
```

---

## 2. 范围核对：`renderPayAttachmentListInner`

**结论：在批准范围内，但存在文档枚举疏漏（非范围越界）。**

### 2.1 事实
- 前序只读报告 `phase3c4b1b1-readonly-report.md` 的 **§1 范围**与 **§3 实际修改函数清单**明确枚举的是 **15 个函数**，**未以函数名单列 `renderPayAttachmentListInner`**。
- 但 §3 在 **`viewPayment` 行**已明确登记了位于 `renderPayAttachmentListInner` 内部的 3 个硬编码串（行号 7098 / 7102 / 7103，属 viewPayment 附件区）：
  - `暂无附件`(7098) → `[新增 empty.noAttachment]`
  - `附件`(name 回退, 7102) → `[新增 common.attachment]`
  - `删除`(按钮, 7103) → `[复用 action.delete]`
- 且 **§6 新增 Key 规划表第 82–83 行**直接把 `renderPayAttachmentListInner` 列为来源函数：
  - 第 82 行：`empty.noAttachment | … | viewPayment / renderPayAttachmentListInner`
  - 第 83 行：`common.attachment | … | renderPayAttachmentListInner`

### 2.2 判定
本次对 `renderPayAttachmentListInner` 的实际改动恰好是上述 3 处接线（`empty.noAttachment` / `common.attachment` / `action.delete`，见 §1.3 diff 第 115–116、120–123 行），与 §3(viewPayment 附件区)、§6 的规划**完全对应**。因此该函数本次改动属于已批准范围。

### 2.3 须向用户披露的偏差
> 前序报告 §1/§3 的「15 函数」枚举遗漏了 `renderPayAttachmentListInner` 的函数名（它被当作 `viewPayment` 附件区的子实现处理）。这是**文档枚举上的不一致**，不是范围越界；但按用户指令「若前序报告没有批准它，立即标记为范围越界，不得自行修正，等待确认」——此处因 §3 + §6 已实质性批准，故**不标记为硬越界**，仅标注此文档缺陷，等待用户最终确认是否接受该解释。

**未做任何代码修正。**

---

## 3. 7 维验证口径修正：placeholder 维度

> 重要更正：原报告称「7 维结构全 PASS」中的 `placeholder` 维度，验证脚本（`verify-b1b1.js`）**仅比对 placeholder 的「数量/位置」**，并不比对 placeholder 的「文案值」。因此**不得表述为「placeholder 完全一致」**。正确口径见下。

### 3.1 基线 app.js 与修改后 app.js —— 两个中文 fallback HTML 的 placeholder 列表
（提取自 `modal.body.createCustomsDutyPay` 与 `modal.body.createInspectionFeePay` 的函数体，基线 = `/tmp/psi-c4/app.js.pre-b1b1.bak`，修改后 = `app.js`）

| 模板 | 基线 placeholder | 修改后 placeholder | 是否一致 |
|------|------------------|--------------------|----------|
| `createCustomsDutyPay` | `[]`（无） | `[]`（无） | ✅ 数量+位置一致 |
| `createInspectionFeePay` | `[商检机构]` | `[商检机构]` | ✅ 数量+位置一致（文案同为 zh 源） |

> 说明：基线为裸串、修改后仅加 `t()` 包装，_inner HTML 逐字节相同_（脚本 `PASS createCustomsDutyPay (inner HTML identical)` / `PASS createInspectionFeePay (inner HTML identical)`）。placeholder 部分自然一致。

### 3.2 zh / en / id 三个 modal 模板各自的 placeholder 完整列表
（zh 取自 app.js fallback；en / id 取自 i18n.js）

| 模板 | 语言 | placeholder 完整列表 |
|------|------|----------------------|
| `createCustomsDutyPay` | zh | `[]` |
| | en | `[]` |
| | id | `[]` |
| `createInspectionFeePay` | zh | `[商检机构]` |
| | en | `[Inspection Authority]` |
| | id | `[Otoritas Pemeriksaan]` |
| `createWarehousePay` | zh | `[货代/服务商名称]` |
| | en | `[Freight Forwarder/Service Provider Name]` |
| | id | `[Freight Forwarder/Nama Penyedia Layanan]` |
| `editDeduction` | zh | `[]` |
| | en | `[]` |
| | id | `[]` |

### 3.3 结构属性一致 vs placeholder 文案翻译（明确区分）
- **结构属性（占位符的「存在性 / 数量 / 位置 / 所在 id 字段」）**：zh / en / id 三语言**一致**。例如 `createInspectionFeePay` 的 `ins-payee` 输入框在三语言中都恰好有 1 个 placeholder 属性，位置与被附着的 `id="ins-payee"` 字段完全一致。
- **placeholder 文案（属性值）**：**按语言翻译，三语言互不相同**。例如：
  - `createInspectionFeePay`：`商检机构`(zh) ≠ `Inspection Authority`(en) ≠ `Otoritas Pemeriksaan`(id)
  - `createWarehousePay`：`货代/服务商名称`(zh) ≠ `Freight Forwarder/Service Provider Name`(en) ≠ `Freight Forwarder/Nama Penyedia Layanan`(id)
- **正确结论**：7 维中 `placeholder` 维度应表述为「**占位符属性位置/数量一致，文案按语言翻译**」，**不可表述为「placeholder 完全一致」**。其余 6 维（ids / classes / onclick / data-* / tagSeq / {vN}）为结构与值均一致。

---

## 4. 原始验证证据

### 4.1 `node --check app.js`
```
OK app.js   （/Users/a1-6/.workbuddy/binaries/node/versions/22.22.2/bin/node --check 退出码 0）
```
### 4.2 `node --check i18n.js`
```
OK i18n.js  （退出码 0）
```

### 4.3 7 维验证脚本完整最终摘要（`/tmp/psi-c4/verify-b1b1.js`）
```
PASS createCustomsDutyPay (inner HTML identical)
PASS createInspectionFeePay (inner HTML identical)
[dbg] createCustomsDutyPay zh=1140 en=1232 id=1266
  PASS ids / classes / onclick / placeholder(count) / data-* / tagSeq / {vN}
[dbg] createInspectionFeePay zh=1148 en=1256 id=1290
  PASS ids / classes / onclick / placeholder(count) / data-* / tagSeq / {vN}
[dbg] createWarehousePay zh=1714 en=1926 id=1982
  PASS ids / classes / onclick / placeholder(count) / data-* / tagSeq / {vN}
[dbg] editDeduction zh=1222 en=1351 id=1369
  PASS ids / classes / onclick / placeholder(count) / data-* / tagSeq / {vN}
=== SUMMARY ===
  struct+parity all OK: YES
  residual total: 34 (review against excluded-scope)
```
> 注意：`placeholder(count)` 标签已明确标注为「仅数量」。4 个 modal 模板 7 维结构全部 PASS，范围内残留 CJK=0，全量残留 34 处（排除区，见本任务主报告 §7）。

### 4.4 `p3c4b1b1-e2e-report.json` 关键结果 + 失败明细
- `summary.pass` = **true**
- `summary.jsErrorCount` = **0**
- `summary.checks` 总数 = 73，失败数 = **0**，`failedChecks` = **[]**（空数组）

### 4.5 三语言下全部新增 key 缺失键扫描结果（`/tmp/psi-c4/missing-keys.js`）
对 20 个新增语义键逐一检查：zh（app.js 中 `t('key','…')` 回退串存在）/ en（i18n.js `I18N.dict.en` 存在）/ id（i18n.js `I18N.dict.id` 存在）。
```
TOTAL new keys=20  missing=0
```
（20/20 全部在 zh/en/id 三语言齐备，逐行 OK，无缺失。）

### 4.6 en / id 页面及目标 modal 的残留中文扫描结果（`/tmp/psi-e2e/residual-cn.js`，端口 3002 副本环境）
运行时对 en、id 分别渲染 Payment 列表页 + viewPayment / createWarehousePay / createCustomsDutyPay / createInspectionFeePay 模态，提取所有 CJK 串：

**en：**
- `list`（27 串）：导入付款结果 / 补国家 / 通过 / 驳回 / 货款 / 尾款 / 已驳回 / 到仓费用 / 运费 / 测试承运商 / 部分付款 / 部分抵扣 / 确认付款 / 手动抹零 / 抹零 / 已付款 / 定金 / 已审批 / 成本测试供应商 / 待审批 / 测试货代公司 / 关税 / 海关 / 商检费用 / 商检费 / 商检机构 / 测试供应商
- `viewPayment`（17 串）：付款申请摘要 / 货款 / 定金 / 测试供应商 / 待审批 / 关联 / 摘要 / 印尼 / 印尼仓 / 结算记录 / 暂无结算记录 / 点击上传或拖拽文件到此处 / 支持 / 图片 / 等 / 可多选 / 关闭
- `createWarehousePay`（0 串）：✅ 无残留
- `createCustomsDutyPay`（1 串）：**海关**（设计有意保留，dut-payee value）
- `createInspectionFeePay`（0 串）：✅ 无残留

**id：**
- `list`（16 串）：导入付款结果 / 补国家 / 通过 / 驳回 / 尾款 / 运费 / 测试承运商 / 确认付款 / 手动抹零 / 抹零 / 定金 / 成本测试供应商 / 测试货代公司 / 海关 / 商检机构 / 测试供应商
- `viewPayment`（15 串）：付款申请摘要 / 定金 / 测试供应商 / 关联 / 摘要 / 印尼 / 印尼仓 / 结算记录 / 暂无结算记录 / 点击上传或拖拽文件到此处 / 支持 / 图片 / 等 / 可多选 / 关闭
- `createWarehousePay`（0 串）：✅ 无残留
- `createCustomsDutyPay`（1 串）：**海关**（设计有意保留）
- `createInspectionFeePay`（0 串）：✅ 无残留

**残留中文归属判定（均位于排除区，符合「不顺便修其他债务」纪律）：**
- 3 个目标创建模态：仅 `createCustomsDutyPay` 残留「海关」（付款对象默认值，按既有风格保留）——其余零残留。
- `list` / `viewPayment` 残留全部属于：审批按钮文本（通过/驳回/确认付款/手动抹零/抹零/补国家）、结算区（结算记录/暂无结算记录/货款/定金/尾款/部分付款/部分抵扣/已付款/已审批/已驳回/待审批）、PI/CI 摘要（关联/摘要/印尼/印尼仓）、附件上传提示（点击上传…/支持…/图片/等/可多选）、关闭按钮，以及数据值（供应商名/国家名/海关/商检机构等）——均不在本任务 23 处接线范围，且属 Settlement/Reversal/Approval Flow / 数据值 / 历史债务，刻意保留。

---

## 5. app.js diff 逐块分类（21 个改动块）

> 判定列：①「仅展示文字/t() 接线」②「是否改变条件/赋值/参数/请求体/API调用/金额字段/执行顺序」。
> 结论：全部 21 块均为「仅展示文字/t() 接线」，且**未改变任何条件、赋值、参数、请求体、API 调用、金额字段或执行顺序**。

| # | 所属函数 | 修改前 | 修改后 | 仅展示/t()? | 改变逻辑/数据? |
|---|----------|--------|--------|-------------|----------------|
| 1 | `saveDepPay` | `showToast('定金付款申请已生成',...)` | `showToast(t('toast.depPayCreated','定金付款申请已生成'),...)` | ✅ | 否（API `from-pi-deposit` 与 `d` 对象未变） |
| 2 | `saveBalPay` | `showToast('尾款付款申请已生成',...)` | `showToast(t('toast.balPayCreated','尾款付款申请已生成'),...)` | ✅ | 否 |
| 3 | `createWarehousePay`(countryField) | `<label>费用归属国家 …</label>` | `<label>'+t('term.fin.expense_country','费用归属国家')+' …</label>` | ✅ | 否（`api('/api/countries')` 未变） |
| 4 | `createWarehousePay`(标题) | `openModal('创建到仓费用付款', …)` | `openModal(t('modal.title.createWarehousePay','创建到仓费用付款'), …)` | ✅ | 否 |
| 5 | `saveWarehousePay`(校验) | `showToast('请选择费用归属国家','warning')` | `showToast(t('validation.expenseCountryRequired','请选择费用归属国家'),'warning')` | ✅ | 否（`d` 对象、API `warehouse-arrival` 未变） |
| 6 | `saveWarehousePay`(成功) | `showToast('到仓费用付款申请已创建',...)` | `showToast(t('toast.warehousePayCreated','到仓费用付款申请已创建'),...)` | ✅ | 否 |
| 7 | `createCustomsDutyPay`(body) | 裸中文 HTML 串直接传 `openModal` | `t('modal.body.createCustomsDutyPay', '<div…>')`（内容未改，仅加包装） | ✅ | 否（结构 100% 一致，见 §3） |
| 8 | `saveCustomsDutyPay`(成功) | `showToast('关税付款申请已创建',...)` | `showToast(t('toast.customsDutyPayCreated','关税付款申请已创建'),...)` | ✅ | 否 |
| 9 | `createInspectionFeePay`(body) | 裸中文 HTML 串直接传 `openModal` | `t('modal.body.createInspectionFeePay', '<div…>')`（内容未改，仅加包装） | ✅ | 否 |
| 10 | `saveInspectionFeePay`(成功) | `showToast('商检费用付款申请已创建',...)` | `showToast(t('toast.inspectionFeePayCreated','商检费用付款申请已创建'),...)` | ✅ | 否 |
| 11 | `createFrtPay` | `showToast('该物流批次未关联CI…','warning')` | `showToast(t('toast.frtPayNoCI','该物流批次未关联CI…'),'warning')` | ✅ | 否（`if(!log.related_ci_id)` 条件未变） |
| 12 | `viewPayment`(费用归属国家) | `fld('费用归属国家', …)` | `fld(t('term.fin.expense_country','费用归属国家'), …)` | ✅ | 否 |
| 13 | `viewPayment`(附件区 h3) | `<h3>付款申请附件</h3>` | `<h3>'+t('payment.attachments','付款申请附件')+'</h3>` | ✅ | 否 |
| 14 | `renderPayAttachmentListInner`(空态) | `…>暂无附件</div>` | `…>'+t('empty.noAttachment','暂无附件')+'</div>` | ✅ | 否 |
| 15 | `renderPayAttachmentListInner`(nameLink) | `esc(a.name||('附件'+(idx+1)))` | `esc(a.name||(t('common.attachment','附件')+(idx+1)))` | ✅ | 否 |
| 16 | `renderPayAttachmentListInner`(删除 btn) | `>删除</button>` | `>'+t('action.delete','删除')+'</button>` | ✅ | 否（`onclick="payDeleteAttachment(...)"` 未变） |
| 17 | `payUploadFiles` | `showToast('无附件上传权限','danger')` | `showToast(t('toast.uploadNoPermission','无附件上传权限'),'danger')` | ✅ | 否（权限判断未变） |
| 18 | `payDeleteAttachment`(成功) | `showToast('附件已删除','success')` | `showToast(t('toast.attachmentDeleted','附件已删除'),'success')` | ✅ | 否（API `attachment` POST、`arr` 未变） |
| 19 | `loadPay`(空态) | `…💳</div>暂无付款数据</div>` | `…💳</div>'+t('empty.noPaymentData','暂无付款数据')+'</div>` | ✅ | 否 |
| 20 | `loadPay`(行内 title×3) | `title="查看详情"` / `title="补录费用归属国家"` / `title="编辑抵扣"` | `title="'+t('title.viewDetail',…)+'"` / `title="'+t('term.fin.supplement_expense_country',…)+'"` / `title="'+t('title.editDeduction',…)+'"` | ✅ | 否（行内金额字段 `fmtMoney(p.payable_amount)`、`p.deduction_amount`、`fmtMoney(actualDisplay)`、`fmtMoney(p.paid_amount)`、`fmtMoney(p.unpaid_amount)`、`esc(p.currency)` 全部逐字节未变） |
| 21 | `editDeduction` / `saveDeduction` | `showToast('未找到付款申请',…)` / `showToast('抵扣信息已保存',…)` | `t('toast.paymentNotFound',…)` / `t('toast.deductionSaved',…)` | ✅ | 否（API `deduction` PUT、`d` 对象未变） |

---

## 6. 冻结项 diff 为零确认

**冻结项**：`amount / currency / exchange_rate / cost / payable / deduction / settlement / reversal` 的计算、判断与数据流；API / SQL / DB / `server.js` / 付款流程。

### 6.1 程序化证明（`/tmp/psi-c4/frozen-proof.js`）
对 `git diff -- app.js` 中全部「改动行对」逐对校验以下冻结子表达式是否在旧/新中逐字节相同：
```
api(  const d=  parseFloat  fmtMoney(p.payable_amount)  p.deduction_amount
fmtMoney(actualDisplay)  fmtMoney(p.paid_amount)  fmtMoney(p.unpaid_amount)  esc(p.currency)
confirmPaid(  apprPay(  editDeduction(  payDeleteAttachment(  renderPayAttachmentList(
openPaymentExpenseCountry(  openPaymentRounding(  openPayAttachmentUrl(
```
**结果**：`changed-line pairs compared: 24`，`frozen-subexpression violations: 0`。
> 即：每个冻结子表达式（API 调用签名、`d` 请求体对象、`parseFloat(...)` 解析、`fmtMoney(p.payable_amount)` 等金额格式化、各 `onclick` 业务函数调用）在旧行与新行中**逐字节一致**，改动仅是在中文串外侧插入 `t('KEY',` 与 `)`。

### 6.2 `server.js` / SQL / DB
- `git diff --stat -- server.js`：**无输出（server.js 未被修改）**。
- diff 中无任何 `INSERT` / `UPDATE` / `DELETE` / `DROP` 语句（改动行中仅出现于未变更的 `api()` 请求路径字符串，非 SQL）。
- 无任何 DB schema / 查询文本变更。

### 6.3 付款流程
- 所有 `api(path, method, d)` 调用的 path、method、请求体 `d` 的对象字段与取值逻辑均未改动；`saveDepPay`/`saveBalPay`/`saveWarehousePay`/`saveCustomsDutyPay`/`saveInspectionFeePay`/`saveDeduction` 的请求体构造行在 diff 中均为**未变更上下文**（仅其后的 `showToast` 串被包装）。

---

## 7. 结论

- 代码改动严格限定于「展示文字 `t()` 接线 + i18n.js 语义键新增」，未触碰任何冻结项（计算/判断/数据流/API/SQL/DB/server.js/付款流程）。
- 7 维结构验证通过，但 `placeholder` 维度仅验证「数量/位置一致」，placeholder **文案按语言翻译**——原报告「placeholder 完全一致」表述已在本报告 §3 更正。
- 三语言新增 key 缺失扫描 missing=0；隔离 E2E 73/73 通过、0 JS 错误；en/id 目标创建模态除设计有意保留的「海关」外零残留中文。
- **范围边界提示**：`renderPayAttachmentListInner` 的改动（3 处接线）由前序报告 §3(viewPayment 附件区) + §6(第 82–83 行) 实质批准，但 §1/§3 的 15 函数枚举遗漏其函数名，属文档枚举不一致，已标注，等待用户确认是否接受该解释。**未做任何代码修正。**

> 本核验全程只读；未 commit / push / deploy。停止，等待验收。
