const Database = require('./node_modules/better-sqlite3');
const db = new Database('./data/inventory.db');

console.log('清理旧测试数据...');
db.exec(`DELETE FROM outbound_records WHERE sku_code LIKE 'DEMO%'`);
db.exec(`DELETE FROM inventory WHERE sku_code LIKE 'DEMO%'`);
db.exec(`DELETE FROM skus WHERE sku_code LIKE 'DEMO%'`);
db.exec(`DELETE FROM replenishment_suggestions WHERE sku_code LIKE 'DEMO%'`);

const skus = [
  {
    sku_code: 'DEMO-K001',
    product_name: '机械键盘 K001 红色轴',
    category: 'Keyboard',
    brand: 'Redragon',
    model: 'K001-R',
    lifecycle_status: 'active',
    is_new_product: 0,
    avail: 80, in_transit: 0, po_unconfirmed: 0,
    sales: [400, 450, 500, 550]
  },
  {
    sku_code: 'DEMO-K002',
    product_name: '机械键盘 K002 青色轴',
    category: 'Keyboard',
    brand: 'Redragon',
    model: 'K002-B',
    lifecycle_status: 'active',
    is_new_product: 0,
    avail: 800, in_transit: 200, po_unconfirmed: 300,
    sales: [300, 320, 310, 330]
  },
  {
    sku_code: 'DEMO-M001',
    product_name: '游戏鼠标 M001 黑色',
    category: 'Mouse',
    brand: 'Redragon',
    model: 'M001-BK',
    lifecycle_status: 'active',
    is_new_product: 0,
    avail: 2000, in_transit: 500, po_unconfirmed: 0,
    sales: [100, 90, 80, 70]
  },
  {
    sku_code: 'DEMO-M002',
    product_name: '游戏鼠标 M002 白色',
    category: 'Mouse',
    brand: 'Redragon',
    model: 'M002-WT',
    lifecycle_status: 'new',
    is_new_product: 1,
    avail: 300, in_transit: 0, po_unconfirmed: 0,
    sales: [0, 0, 50, 120]
  },
  {
    sku_code: 'DEMO-H001',
    product_name: '游戏耳机 H001 黑白',
    category: 'Headset',
    brand: 'Redragon',
    model: 'H001-BW',
    lifecycle_status: 'clearance',
    is_new_product: 0,
    avail: 600, in_transit: 0, po_unconfirmed: 0,
    sales: [80, 60, 40, 30]
  },
  {
    sku_code: 'DEMO-K003',
    product_name: '机械键盘 K003 茶色轴',
    category: 'Keyboard',
    brand: 'Redragon',
    model: 'K003-BR',
    lifecycle_status: 'active',
    is_new_product: 0,
    avail: 1200, in_transit: 0, po_unconfirmed: 0,
    sales: [280, 300, 290, 310]
  },
  {
    sku_code: 'DEMO-M003',
    product_name: '游戏鼠标 M003 粉色',
    category: 'Mouse',
    brand: 'Redragon',
    model: 'M003-PK',
    lifecycle_status: 'active',
    is_new_product: 0,
    avail: 50, in_transit: 0, po_unconfirmed: 0,
    sales: [200, 210, 220, 230]
  },
  {
    sku_code: 'DEMO-H002',
    product_name: '游戏耳机 H002 RGB',
    category: 'Headset',
    brand: 'Redragon',
    model: 'H002-RGB',
    lifecycle_status: 'active',
    is_new_product: 0,
    avail: 300, in_transit: 100, po_unconfirmed: 200,
    sales: [150, 200, 300, 500]
  }
];

const months = ['2026-04', '2026-05', '2026-06', '2026-07'];

console.log('\n插入 SKU...');
const insertSku = db.prepare(`INSERT INTO skus (
  id, sku_code, product_name, category, brand, model,
  is_new_product, lifecycle_status, status, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))`);

for (const s of skus) {
  insertSku.run('sku_' + s.sku_code, s.sku_code, s.product_name, s.category, s.brand, s.model, s.is_new_product, s.lifecycle_status);
  console.log(`  ✓ ${s.sku_code}`);
}

console.log('\n插入库存...');
const insertInv = db.prepare(`INSERT INTO inventory (
  id, sku_code, country, warehouse,
  available_qty, in_transit_qty, po_unconfirmed_pi_qty,
  weighted_avg_cost, inventory_value,
  updated_at
) VALUES (?, ?, '印尼', '印尼仓', ?, ?, ?, 0, 0, datetime('now'))`);

for (const s of skus) {
  insertInv.run('inv_' + s.sku_code, s.sku_code, s.avail, s.in_transit, s.po_unconfirmed);
}

console.log('\n插入出库记录...');
const insertOb = db.prepare(`INSERT INTO outbound_records (
  id, outbound_no, outbound_date, country, warehouse, sku_code,
  quantity, outbound_type, count_for_forecast, created_at
) VALUES (?, ?, ?, '印尼', '印尼仓', ?, ?, 'sale', 1, datetime('now'))`);

for (const s of skus) {
  for (let i = 0; i < 4; i++) {
    const qtyPerMonth = s.sales[i];
    const qtyPerDay = Math.max(1, Math.round(qtyPerMonth / 5));
    for (let d = 5; d <= 25; d += 5) {
      const date = months[i] + '-' + String(d).padStart(2, '0');
      const obNo = 'OB-' + s.sku_code + '-' + months[i] + '-' + d;
      try {
        insertOb.run('ob_' + obNo, obNo, date, s.sku_code, qtyPerDay);
      } catch (e) {}
    }
  }
}

console.log('\n✅ 数据插入完成！\n');
console.log('各 SKU 预期计算结果：');
for (const s of skus) {
  const avg = s.sales.reduce((a, b) => a + b, 0) / 4;
  const totalPool = s.avail + s.in_transit + s.po_unconfirmed;
  const turnover = avg > 0 ? (totalPool / avg).toFixed(1) : '∞';
  const suggested = Math.max(0, Math.ceil(avg * 4 - totalPool));
  let scenario = '';
  if (s.lifecycle_status === 'clearance') scenario = '→ 清仓，不建议补货';
  else if (turnover < 1) scenario = '→ ⚠️ 严重缺货风险';
  else if (turnover < 2) scenario = '→ ⚠️ 缺货风险';
  else if (turnover > 6) scenario = '→ 库存偏高';
  else if (suggested > 0) scenario = '→ 建议补货 ' + suggested + ' 件';
  else scenario = '→ 库存充足，无需补货';
  console.log(`  ${s.sku_code} | 月均:${avg.toFixed(0)} | 库存池:${totalPool} | 当前周转:${turnover}月 | ${scenario}`);
}

db.close();
