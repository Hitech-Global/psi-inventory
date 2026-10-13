'use strict';
const {test}=require('node:test');
const a=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {minor,allocateSharedFee,splitConvertedMinor}=require('../shared-logistics-fee-core');
const sea=[
{id:'a',batch_no:'SZIS0013407',transport_mode:'sea',cbm:4.47},
{id:'b',batch_no:'SZIS0013408',transport_mode:'sea',cbm:2.76},
{id:'c',batch_no:'SZIS0013406',transport_mode:'sea',cbm:3.07}
];
test('three sea batches retain exact original charge and independent CBM allocation',()=>{
 const x=allocateSharedFee({currency:'IDR',amount:100000.01},sea);
 a.equal(x.amount_minor,10000001);
 a.equal(x.allocations.length,3);
 a.equal(x.allocations.reduce((s,r)=>s+r.amount_minor,0),10000001);
 a.deepEqual(x.allocations.map(r=>r.basis),['cbm','cbm','cbm']);
 a(x.allocations[0].amount_minor>x.allocations[2].amount_minor);
 a(x.allocations[2].amount_minor>x.allocations[1].amount_minor);
 const converted=splitConvertedMinor(617,x.allocations);
 a.equal(converted.reduce((s,r)=>s+r.amount_minor,0),617);
});
test('air transport uses actual gross KG, not CBM',()=>{
 const x=allocateSharedFee({currency:'USD',amount:200},[
 {id:'a',transport_mode:'air',gross_weight:70,cbm:1},
 {id:'b',transport_mode:'air',gross_weight:30,cbm:90}
 ]);
 a.equal(x.allocations[0].amount_minor,14000);
 a.equal(x.allocations[1].amount_minor,6000);
 a.equal(x.allocations[0].basis,'gross_weight');
});
test('mixed sea/air requires explicit mode totals, then conserves one payable',()=>{
 const mix=[sea[0],sea[1],{id:'air',transport_mode:'air',gross_weight:25}];
 a.throws(()=>allocateSharedFee({currency:'RMB',amount:100},mix),/需分别明确/);
 a.throws(()=>allocateSharedFee({currency:'RMB',amount:100,mode_amounts:{sea:70,air:20}},mix),/必须等于/);
 const x=allocateSharedFee({currency:'RMB',amount:100,mode_amounts:{sea:70,air:30}},mix);
 a.equal(x.allocations.reduce((s,r)=>s+r.amount_minor,0),10000);
 a.equal(x.allocations.find(v=>v.mode==='air').amount_minor,3000);
 a.equal(x.allocations.filter(v=>v.mode==='sea').reduce((s,v)=>s+v.amount_minor,0),7000);
});
test('invalid amounts, duplicate batch, missing weights reject closed',()=>{
 a.throws(()=>minor(0),/正数/);
 a.throws(()=>minor(-4),/正数/);
 a.throws(()=>minor(0.001),/两位/);
 a.throws(()=>allocateSharedFee({currency:'INVALID',amount:30},sea),/ISO/);
 a.throws(()=>allocateSharedFee({currency:'IDR',amount:100},[sea[0],sea[0]]),/重复/);
 a.throws(()=>allocateSharedFee({currency:'IDR',amount:100},[{...sea[0],cbm:0},sea[1]]),/缺少有效/);
 a.throws(()=>allocateSharedFee({currency:'IDR',amount:100},[{...sea[0],transport_mode:'rail'},sea[1]]),/暂只支持/);
});
test('static integration: no shared fee INSERT into ci_cost_items; one PR, no extra WAC category',()=>{
 const read=x=>fs.readFileSync(path.join(__dirname,'..',x),'utf8');
 const srv=read('shared-logistics-fee-server.js');
 const core=read('shared-logistics-fee-core.js');
 const app=read('app.js');
 const server=read('server.js');
 const wac=read('wac-calculator.js');
 a(srv.includes("source_type,source_id,source_no"),'single PR');
 a(!srv.includes('INSERT INTO ci_cost_items'),'shared fee must not double count legacy cost items');
 a(srv.includes('sharedWacParts'),'WAC shared adapter exists');
 a(server.includes('inputs.sharedFees.forEach'),'CI allocator consumes shared facts');
 a(wac.includes('shared_freight_breakdown'),'WAC computed shared fee');
 a(app.includes('openSharedLogisticsFeeModal'),'UI input entry exists');
 a(core.includes("MODES = Object.freeze({ sea:'cbm', air:'gross_weight' })"));
});
