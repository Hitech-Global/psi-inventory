'use strict';

/**
 * PAY-MINOR-BIGINT-HOTFIX
 *
 * IDR is stored in minor units (amount * 100). 39,758,219 IDR becomes
 * 3,975,821,900 minor units, which exceeds PostgreSQL int4. Widen the
 * four payment-flow minor-unit columns to int8 without changing values.
 *
 * The production database is migrated directly; this startup migration keeps
 * rebuilt/new PostgreSQL databases aligned. It is idempotent and no-ops once
 * the columns are already bigint.
 */
const fs = require('node:fs');
const path = require('node:path');

const MARKER = 'PAY-MINOR-BIGINT-HOTFIX: widen payment minor-unit columns';
const INSERT_AFTER = '// PAY-CORE：payable_items 后续新增列迁移。';

const MIGRATION = [
  '        // ' + MARKER,
  '        "DO $$ BEGIN',
  "          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payable_items' AND column_name='payable_amount_minor' AND data_type='integer') THEN",
  '            ALTER TABLE public.payable_items ALTER COLUMN payable_amount_minor TYPE BIGINT USING payable_amount_minor::BIGINT;',
  '          END IF;',
  "          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_request_items' AND column_name='requested_amount_minor' AND data_type='integer') THEN",
  '            ALTER TABLE public.payment_request_items ALTER COLUMN requested_amount_minor TYPE BIGINT USING requested_amount_minor::BIGINT;',
  '          END IF;',
  "          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_transactions' AND column_name='paid_amount_minor' AND data_type='integer') THEN",
  '            ALTER TABLE public.payment_transactions ALTER COLUMN paid_amount_minor TYPE BIGINT USING paid_amount_minor::BIGINT;',
  '          END IF;',
  "          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_allocations' AND column_name='allocated_amount_minor' AND data_type='integer') THEN",
  '            ALTER TABLE public.payment_allocations ALTER COLUMN allocated_amount_minor TYPE BIGINT USING allocated_amount_minor::BIGINT;',
  '          END IF;',
  '        END $$",'
].join('\n');

function patchDbSource(input) {
  if (input.includes(MARKER)) return input;
  const first = input.indexOf(INSERT_AFTER);
  if (first < 0) throw new Error('[PAY-MINOR-BIGINT-HOTFIX] migration insertion marker missing');
  if (input.indexOf(INSERT_AFTER, first + INSERT_AFTER.length) >= 0) {
    throw new Error('[PAY-MINOR-BIGINT-HOTFIX] migration insertion marker duplicated');
  }
  const at = first + INSERT_AFTER.length;
  return input.slice(0, at) + '\n' + MIGRATION + input.slice(at);
}

function applyHotfix() {
  const dbPath = path.resolve(process.cwd(), 'db.js');
  const original = fs.readFileSync(dbPath, 'utf8');
  if (original.includes(MARKER)) {
    console.log('[PAY-MINOR-BIGINT-HOTFIX] already applied; no-op');
    return { changed: false, dbPath };
  }
  const patched = patchDbSource(original);
  fs.writeFileSync(dbPath, patched, 'utf8');
  console.log('[PAY-MINOR-BIGINT-HOTFIX] added idempotent BIGINT migration');
  return { changed: true, dbPath };
}

if (require.main === module) {
  if (process.env.NODE_ENV === 'production' || process.env.RENDER) applyHotfix();
  else console.log('[PAY-MINOR-BIGINT-HOTFIX] non-production install; skipped');
}

module.exports = { MARKER, MIGRATION, patchDbSource, applyHotfix };
