# Shopee Analytics V1

Isolated, read-only foundation for the Shopee operations analytics system. It is intentionally kept outside the existing inventory runtime so current production modules remain untouched until an explicit integration gate.

## V1 decision flow

1. Ad-group order volume first.
2. Actual ROAS vs target ROAS and break-even ROAS.
3. Funnel: impressions → clicks → CTR → conversion → orders.
4. Item race: spend share, direct GMV share, direct order share, Broad vs Direct.
5. Classify evidence: core candidate / exploration keep / insufficient exploration / product optimization / high-risk zero-order.
6. Separate Double-Day and 25th-payday event performance from ordinary-day baseline.
7. Only after ad-group validation can an item become a single-item-ad candidate.

`25 conversions/week` is stored as a volume / maturity reference and ROAS Protection-related signal; it is **not** encoded as an official "learning complete" rule.

## Confirmed API families

The endpoint catalog in `src/catalog.js` covers the audited Open Platform APIs:

- Ads: campaign IDs/settings, GMS campaign/item performance, daily/hourly performance, recommended ROI, deleted GMS items.
- Product: item list/base info/models/promotion.
- Orders: list/detail.
- Voucher + Discount.
- Returns.
- Shop info.
- Brand Portal shop sales performance.
- BusinessInsights marketing hot listing (supplemental only, not a replacement for Product Card).

Product Card item-level funnel data remains import-capable through `shopee_product_card_daily` until a complete item-level BI API is verified.

## Security / deployment boundary

- No Shopee partner key, access token, refresh token, or production secret belongs in Git.
- App credentials must come from environment variables / secret storage.
- No write endpoint is invoked by V1.
- `schema.sql` is not wired into existing inventory startup migrations.
- This branch does not deploy or modify production data.

## Core files

- `schema.sql` — PostgreSQL model for raw snapshots, normalized facts, history, event calendar, analysis cycles and diagnosis output.
- `src/shopee-client.js` — shop-scoped signed request client.
- `src/catalog.js` — audited endpoints and sync cadence policy.
- `src/metrics.js` — Broad/Direct metrics, shares, target CPA and exploration-cost calculations.
- `src/diagnosis.js` — first-pass 7-day diagnosis engine following the agreed order of operations.
- `test/diagnosis.test.cjs` — pure regression tests.

## Local test

```bash
node shopee-analytics/test/diagnosis.test.cjs
```
