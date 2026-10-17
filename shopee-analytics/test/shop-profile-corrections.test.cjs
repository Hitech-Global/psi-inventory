'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '..', 'schema-shop-profile-corrections.sql'), 'utf8');

for (const token of [
  '1770037299',
  "country_code = 'MY'",
  "country_name = 'Malaysia'",
  "brand_code = 'REDRAGON'",
  "brand_name = 'Redragon'",
  "currency = 'MYR'",
  "timezone = 'Asia/Kuala_Lumpur'",
  "marketplace_region = 'MY'",
  "data_source_capability = 'API_AND_MANUAL'",
]) {
  assert(sql.includes(token), `3PF shop correction must include ${token}`);
}

console.log('Malaysia Redragon 3PF profile correction contract: ok');
