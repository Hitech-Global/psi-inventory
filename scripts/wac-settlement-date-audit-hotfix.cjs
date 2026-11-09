'use strict';

// Keep the WAC settlement/audit date separate from the logistics inbound date.
// The actual inbound date is stored in last_inbound_date; freight FX date is
// stored in fx_rate_date. This patch is intentionally narrow and fail-closed.
const fs = require('node:fs');
const path = require('node:path');

const MARKER = 'WAC-SETTLEMENT-DATE-AUDIT: preserve settlement date separately';

function patchWacSettlementDateSource(input) {
  if (input.includes(MARKER)) return input;
  const needle = 'settlement_date: inboundDate || today,';
  const matches = input.split(needle).length - 1;
  if (matches !== 2) {
    throw new Error('[WAC-SETTLEMENT-DATE-AUDIT] expected exactly 2 settlement-date assignments, found ' + matches);
  }
  return input.split(needle).join('settlement_date: today, // ' + MARKER);
}

function applyHotfix() {
  const serverPath = path.resolve(process.cwd(), 'server.js');
  const original = fs.readFileSync(serverPath, 'utf8');
  if (original.includes(MARKER)) {
    console.log('[WAC-SETTLEMENT-DATE-AUDIT] already applied; no-op');
    return { changed: false, serverPath };
  }
  const patched = patchWacSettlementDateSource(original);
  fs.writeFileSync(serverPath, patched, 'utf8');
  console.log('[WAC-SETTLEMENT-DATE-AUDIT] applied');
  return { changed: true, serverPath };
}

if (require.main === module) {
  if (process.env.NODE_ENV === 'production' || process.env.RENDER) applyHotfix();
  else console.log('[WAC-SETTLEMENT-DATE-AUDIT] non-production install; skipped');
}

module.exports = { MARKER, patchWacSettlementDateSource, applyHotfix };
