const { Client } = require('pg');
const fs = require('fs');
const SKUS = ['P103B-TEST-SKU-001', 'P103B-TEST-SKU-003', 'P103B-TEST-SKU-004'];
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const out = {};
  const tables = ['inventory', 'inventory_imports', 'original_inventory_imports', 'replenishment_suggestions', 'outbound_records', 'inventory_adjustments'];
  let total = 0;
  for (const t of tables) {
    const r = await c.query('SELECT * FROM ' + t + ' WHERE sku_code = ANY($1)', [SKUS]);
    out[t] = r.rows;
    total += r.rows.length;
    console.log(t + ': ' + r.rows.length + ' 行待删除 (id 例: ' + (r.rows[0] ? r.rows[0].id : '-') + ')');
  }
  if (total === 0) console.log('[幂等] 目标测试行已不存在，导出为空（重复运行安全，未做修改）。');
  console.log('--- 关联校验: inventory_id 是否指向非测试 inventory ---');
  for (const t of tables) {
    const cols = (await c.query('SELECT column_name FROM information_schema.columns WHERE table_name=$1', [t])).rows.map(x => x.column_name);
    if (cols.includes('inventory_id')) {
      const r = await c.query(
        'SELECT COUNT(*)::int AS n FROM ' + t + ' WHERE inventory_id IS NOT NULL AND inventory_id NOT IN (SELECT id FROM inventory WHERE sku_code = ANY($1))',
        [SKUS]
      );
      console.log(t + '.inventory_id 指向非测试 inventory: ' + r.rows[0].n);
    } else {
      console.log(t + ': 无 inventory_id 列');
    }
  }
  fs.writeFileSync('release-backups/2026-07-31-P1/delete-export.json', JSON.stringify(out, null, 2));
  console.log('EXPORT -> release-backups/2026-07-31-P1/delete-export.json');
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
