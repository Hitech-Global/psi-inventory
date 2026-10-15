'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const begin=app.indexOf('async function openSharedLogisticsFeeModal(ciId){'),end=app.indexOf('async function loadCILogistics(ciId){',begin);
a(begin>0&&end>begin,'actual shared fee modal/submit functions exist');
const source=app.slice(begin,end);
const batches=[
 {id:'b1',batch_no:'SZIS0013407',forwarder_id:'ff-fn',forwarder_name:'丰年',transport_mode:'sea',pls:[{total_cbm:4.47}]},
 {id:'b2',batch_no:'SZIS0013408',forwarder_id:'ff-fn',forwarder_name:'丰年',transport_mode:'sea',pls:[{total_cbm:2.76}]},
 {id:'b3',batch_no:'OTH001',forwarder_id:'ff-other',forwarder_name:'别的货代',transport_mode:'air',pls:[]}
];
function harness(options={}){
 const calls=[],pending=[],toast=[],fetches=[];
 const spinner={isConnected:true,textContent:'',innerHTML:''};
 const title={textContent:''},body={innerHTML:''},footer={innerHTML:''};
 const overlay={classList:{contains:x=>x==='show'}};
 const payee={value:''},hint={textContent:''},mixed={style:{display:'none'}};
 const elements={'sfee-loading':spinner,'modal-overlay':overlay,'modal-content':{querySelector:s=>({' .modal-title':title})[s]||({'.modal-title':title,'.modal-body':body,'.modal-footer':footer})[s]},'sfee-payee':payee,'sfee-payee-hint':hint,'sfee-mixed':mixed,
   'sfee-cur':{value:'IDR'},'sfee-amt':{value:'100000'},'sfee-rem':{value:'test'},
   'sfee-submit':{disabled:false,textContent:'创建并提交付款审批'}};
 const checkboxes=batches.map(x=>({value:x.id,checked:false,disabled:false,dataset:{mode:x.transport_mode},closest:()=>({style:{}})}));
 const win={confirm:()=>true};
 const ctx={window:win,document:{
    getElementById:id=>elements[id]||null,
    querySelectorAll:sel=>sel==='.sfee-batch'?checkboxes:sel==='.sfee-batch:checked'?checkboxes.filter(x=>x.checked):[]
 },api:(url,method,payload)=>{fetches.push({url,method,payload});if(method==='POST')return Promise.resolve({auto_submitted:true});return new Promise(resolve=>pending.push(resolve));},
   openModal:(...args)=>calls.push(args),closeModal:()=>{},showToast:(msg,type)=>toast.push([msg,type]),
   esc:s=>String(s),viewCI:async()=>{},invalidateCILogistics:()=>{}};
 const fns=vm.runInNewContext(source+'\n({openSharedLogisticsFeeModal,getSharedFeeSelectedForwarder,updateSharedFeeModeFields,submitSharedLogisticsFee})',ctx);
 return {ctx,fns,win,spinner,title,body,footer,checkboxes,toast,calls,pending,fetches,payee,hint,mixed};
}
test('Modal shows its loading shell synchronously before all three network calls finish',async()=>{
 const h=harness();
 const running=h.fns.openSharedLogisticsFeeModal('ci-id');
 a.equal(h.calls.length,1,'modal should be visible immediately');
 a.match(h.calls[0][1],/正在加载物流批次及币种/);
 a.equal(h.fetches.length,3);
 h.pending[0]({ci_no:'HIT20260901-1C'});
 h.pending[1](batches);
 h.pending[2]({currency_options:['RMB','IDR','THB']});
 await running;
 a.match(h.body.innerHTML,/付款对象（自动匹配货代）/);
 a.match(h.body.innerHTML,/id="sfee-payee" readonly/);
 a.doesNotMatch(h.body.innerHTML,/id="sfee-bill"/);
 a.match(h.body.innerHTML,/货代：丰年/);
 a.match(h.footer.innerHTML,/创建并提交付款审批/);
 a.match(h.title.textContent,/HIT20260901-1C/);
});
test('Fast selection auto-fills the forwarder and disables batches of a different forwarder',()=>{
 const h=harness();
 h.win._sharedFeeBatchList=batches;
 h.checkboxes[0].checked=true;
 h.fns.updateSharedFeeModeFields(h.checkboxes[0]);
 a.equal(h.payee.value,'丰年');
 a.equal(h.checkboxes[1].disabled,false);
 a.equal(h.checkboxes[2].disabled,true);
 h.checkboxes[1].checked=true;
 h.fns.updateSharedFeeModeFields(h.checkboxes[1]);
 a.equal(h.payee.value,'丰年');
 a.match(h.hint.textContent,/已匹配货代/);
 a.equal(h.mixed.style.display,'none');
 h.checkboxes[2].checked=true;
 h.fns.updateSharedFeeModeFields(h.checkboxes[2]);
 a.equal(h.checkboxes[2].checked,false,'different forwarder is rejected immediately');
 a.match(h.toast.at(-1)[0],/不同货代/);
});
test('Submit does not send bill number or self-declared payee; request key guards retries',async()=>{
 const h=harness();
 h.win._sharedFeeBatchList=batches;
 h.win._sharedFeeRequestKey='shf-fixed-unique-key-123';
 h.checkboxes[0].checked=true;
 h.checkboxes[1].checked=true;
 await h.fns.submitSharedLogisticsFee('ci-id');
 const req=h.fetches.find(x=>x.method==='POST');
 a(req);
 a.equal(req.payload.request_key,'shf-fixed-unique-key-123');
 a.equal(req.payload.currency,'IDR');
 a.equal(req.payload.amount,'100000');
 a.equal(req.payload.batch_ids.length,2);
 a.equal(Object.hasOwn(req.payload,'bill_no'),false);
 a.equal(Object.hasOwn(req.payload,'payee_name'),false);
 a.match(h.toast.at(-1)[0],/已创建合并派送费/);
});
test('Stale modal loads never overwrite a closed/replaced modal',async()=>{
 const h=harness();
 const running=h.fns.openSharedLogisticsFeeModal('ci-id');
 h.win._sharedFeeLoadKey='other-modal';
 h.pending[0]({ci_no:'abc'});
 h.pending[1](batches);
 h.pending[2]({currency_options:['IDR']});
 await running;
 a.equal(h.body.innerHTML,'');
});
