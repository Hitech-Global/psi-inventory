// 只读检查：统计 payment_category 为空的数据
const Database = require('better-sqlite3');
const dbPath = process.argv[2] || 'data/inventory.db';
const db = new Database(dbPath, { readonly: true });
const total = db.prepare('SELECT COUNT(*) c FROM payment_requests').get().c;
console.log('DB:', dbPath);
console.log('payment_requests 总数:', total);
const empties = db.prepare(
  "SELECT id,request_no,payment_mode,payment_category,payment_subcategory,currency,payable_amount,payment_status,approval_status,expense_country FROM payment_requests WHERE payment_category IS NULL OR payment_category = ''"
).all();
console.log('\npayment_category 为空的数据 (' + empties.length + ' 条):');
empties.forEach(r => console.log(JSON.stringify(r)));
const target = db.prepare('SELECT id,request_no,payment_mode,payment_category,payment_subcategory,currency,payable_amount,paid_amount,deduction_amount,rounding_amount,payment_status,approval_status,expense_country,paid_date FROM payment_requests WHERE request_no = ?').get('PAY-MULTI-2026-409982');
console.log('\n目标单 PAY-MULTI-2026-409982:');
console.log(target ? JSON.stringify(target, null, 2) : 'NOT FOUND (不在本库，应在运行/部署环境)');
db.close();
