const { Client } = require('pg');
const SKUS = ['P103B-TEST-SKU-001', 'P103B-TEST-SKU-003', 'P103B-TEST-SKU-004'];
const TABLES = ['inventory', 'inventory_imports', 'original_inventory_imports', 'replenishment_suggestions', 'outbound_records', 'inventory_adjustments'];

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  // 基线：真实 inventory 总行数 & 真实 sku 数量（用于"未被误伤"复核）
  const baseInv = await c.query('SELECT COUNT(*)::int AS n FROM inventory');
  const baseDistinctSku = await c.query('SELECT COUNT(DISTINCT sku_code)::int AS n FROM inventory');
  console.log('BASELINE inventory 总行数=' + baseInv.rows[0].n + ' 真实 distinct sku_code=' + baseDistinctSku.rows[0].n);

  // 幂等校验：若 3 个测试 SKU 在所有目标表中均已不存在，安全退出（不开启事务、不做任何修改）
  let totalTarget = 0;
  for (const t of TABLES) {
    const r = await c.query('SELECT COUNT(*)::int AS n FROM ' + t + ' WHERE sku_code = ANY($1)', [SKUS]);
    totalTarget += r.rows[0].n;
  }
  if (totalTarget === 0) {
    console.log('[幂等] P1 测试 SKU 数据清理已应用，目标行数=0，安全退出，未做任何修改。');
    await c.end();
    process.exit(0);
  }
  console.log('[幂等] 检测到待清理目标行数=' + totalTarget + '，继续执行删除。');

  // 单事务删除
  await c.query('BEGIN');
  let deleted = {};
  try {
    for (const t of TABLES) {
      const r = await c.query('DELETE FROM ' + t + ' WHERE sku_code = ANY($1)', [SKUS]);
      deleted[t] = r.rowCount;
      console.log('DELETE ' + t + ': ' + r.rowCount + ' 行');
    }
    await c.query('COMMIT');
    console.log('--- COMMIT OK ---');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('ROLLBACK due to:', e.message);
    await c.end();
    process.exit(1);
  }

  // 复核断言
  console.log('=== POST-DELETE 复核 ===');
  let fail = false;
  for (const t of TABLES) {
    const r = await c.query('SELECT COUNT(*)::int AS n FROM ' + t + ' WHERE sku_code = ANY($1)', [SKUS]);
    const n = r.rows[0].n;
    if (n !== 0) { console.log('  [FAIL] ' + t + ' 残留=' + n); fail = true; }
    else console.log('  [OK] ' + t + ' 残留=0');
  }
  // inventory 国家只保留真实业务值
  const cc = await c.query("SELECT DISTINCT country FROM inventory WHERE country IS NOT NULL AND country != '' ORDER BY country");
  console.log('inventory.country distinct 现在:', JSON.stringify(cc.rows.map(r => r.country)));
  const badCountry = cc.rows.filter(r => ['Indonesia','Thailand','Vietnam'].includes(r.country));
  if (badCountry.length) { console.log('  [FAIL] 仍存在脏国家:', JSON.stringify(badCountry)); fail = true; }
  else console.log('  [OK] 脏国家已清除');
  const ww = await c.query("SELECT DISTINCT warehouse FROM inventory WHERE warehouse IS NOT NULL AND warehouse != '' ORDER BY warehouse");
  const badWh = ww.rows.filter(r => ['Jakarta-WH','Bangkok-WH','Hanoi-WH'].includes(r.warehouse));
  if (badWh.length) { console.log('  [FAIL] 仍存在脏仓库:', JSON.stringify(badWh.map(r=>r.warehouse))); fail = true; }
  else console.log('  [OK] 脏仓库已清除');
  // 真实库存未被误伤
  const afterInv = await c.query('SELECT COUNT(*)::int AS n FROM inventory');
  if (afterInv.rows[0].n !== baseInv.rows[0].n - 3) { console.log('  [FAIL] inventory 行数变化异常: ' + afterInv.rows[0].n); fail = true; }
  else console.log('  [OK] inventory 减少恰好 3 行 (真实 ' + (baseInv.rows[0].n - 3) + ' 行保留)');

  await c.end();
  console.log(fail ? '>>> 复核存在 FAIL，请人工检查' : '>>> 全部复核通过');
  process.exit(fail ? 2 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
