// 数据迁移：从 inventory / purchase_orders / proforma_invoices 扫描 (country, warehouse, brand) 三元组
// 1) 创建一个新仓库记录（如果不存在）匹配 (country_name, warehouse_name)
// 2) 合并 brands 列表到 warehouses.brands

const sqlite = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'data', 'inventory.db');
const d = new sqlite(dbPath);

function uniq(a){return [...new Set(a.filter(Boolean))];}

console.log('=== 1. 扫描 (country, warehouse, brand) 三元组 ===');

// inventory
const invGroups = d.prepare(`
  SELECT i.country, i.warehouse, GROUP_CONCAT(DISTINCT s.brand) as brands
  FROM inventory i
  LEFT JOIN skus s ON i.sku_code = s.sku_code
  WHERE i.country != '' AND i.warehouse != '' AND s.brand IS NOT NULL AND s.brand != ''
  GROUP BY i.country, i.warehouse
`).all();

// po
const poGroups = d.prepare(`
  SELECT country, target_warehouse as warehouse, GROUP_CONCAT(DISTINCT brand) as brands
  FROM purchase_orders
  WHERE country != '' AND target_warehouse != '' AND brand IS NOT NULL AND brand != ''
  GROUP BY country, target_warehouse
`).all();

// pi
const piGroups = d.prepare(`
  SELECT country, target_warehouse as warehouse, GROUP_CONCAT(DISTINCT brand) as brands
  FROM proforma_invoices
  WHERE country != '' AND target_warehouse != '' AND brand IS NOT NULL AND brand != ''
  GROUP BY country, target_warehouse
`).all();

// ci
const ciGroups = d.prepare(`
  SELECT country, target_warehouse as warehouse, GROUP_CONCAT(DISTINCT brand) as brands
  FROM commercial_invoices
  WHERE country != '' AND target_warehouse != '' AND brand IS NOT NULL AND brand != ''
  GROUP BY country, target_warehouse
`).all();

const allGroups = [...invGroups, ...poGroups, ...piGroups, ...ciGroups];
console.log('Found ' + allGroups.length + ' (country, warehouse) groups from existing data');

// 按 (country, warehouse) 聚合 brands
const map = new Map();
for (const g of allGroups) {
  const key = (g.country || '').trim() + '|' + (g.warehouse || '').trim();
  if (!map.has(key)) {
    map.set(key, { country: g.country, warehouse: g.warehouse, brands: [] });
  }
  const brands = String(g.brands || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const b of brands) map.get(key).brands.push(b);
}

// 去重每个 key 的 brands
for (const v of map.values()) v.brands = uniq(v.brands);

console.log('Unique (country, warehouse) keys: ' + map.size);
for (const [k, v] of map.entries()) {
  console.log('  ' + k + ' -> brands=[' + v.brands.join(', ') + ']');
}

console.log('\n=== 2. 更新/插入 warehouses 记录 ===');

const allWarehouses = d.prepare('SELECT * FROM warehouses').all();
console.log('Existing warehouses: ' + allWarehouses.length);

let created = 0, updated = 0;
const tx = d.transaction(() => {
  for (const v of map.values()) {
    // 查找匹配的仓库：(country_name, name)
    const existing = d.prepare(
      'SELECT * FROM warehouses WHERE country_name = ? AND name = ?'
    ).get(v.country, v.warehouse);

    if (existing) {
      // 合并 brands
      const oldBrands = String(existing.brands || '').split(',').map(s => s.trim()).filter(Boolean);
      const newBrands = uniq([...oldBrands, ...v.brands]);
      if (newBrands.length > oldBrands.length) {
        d.prepare('UPDATE warehouses SET brands = ? WHERE id = ?')
          .run(newBrands.join(','), existing.id);
        updated++;
        console.log('  UPDATE ' + existing.name + ' (' + v.country + '): brands=[' + newBrands.join(',') + ']');
      }
    } else {
      // 创建新仓库
      const id = 'wh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      d.prepare(`INSERT INTO warehouses (id, name, country_id, country_name, warehouse_type, address, status, brands, sort_order) 
                 VALUES (?, ?, '', ?, 'self', '', 'active', ?, 99)`)
        .run(id, v.warehouse, v.country, v.brands.join(','));
      created++;
      console.log('  INSERT ' + v.warehouse + ' (' + v.country + '): brands=[' + v.brands.join(',') + ']');
    }
  }
});
tx();

console.log('\n=== 3. 最终结果 ===');
const final = d.prepare('SELECT name, country_name, brands FROM warehouses ORDER BY country_name, name').all();
console.table(final);

console.log('\n=== Migration done. Created: ' + created + ', Updated: ' + updated + ' ===');
