const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { diagnoseCampaign } = require('../src/diagnosis');

const result = diagnoseCampaign({
  campaign: { impressions: 100, clicks: 10, expense: 20, broad_gmv: 200, broad_order: 2 },
  items: [],
  targetRoas: null,
  breakEvenRoas: 0,
  days: 1,
});
assert.strictEqual(result.campaign.targetRoas, null, 'missing Target ROAS must remain null');
assert.strictEqual(result.campaign.roasState, 'TARGET_UNKNOWN');

const router = fs.readFileSync(path.join(__dirname, '..', 'src', 'http-router.js'), 'utf8');
assert(!router.includes('Number(latest && latest.targetRoas || 0)'), 'router must not coerce missing Target ROAS to zero');
assert(router.includes('Number(latest.targetRoas) > 0 ? Number(latest.targetRoas) : null'));

const ui = fs.readFileSync(path.join(__dirname, '..', 'web', 'product-card-ui-v2.js'), 'utf8');
assert(ui.includes("p.targetRoas == null ? '—' : fixed2(p.targetRoas)"), 'GMS Target ROAS must render missing value as dash');
console.log('GMS missing Target ROAS null contract: ok');
