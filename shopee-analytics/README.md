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


## Current onboarding flow

The production connection is intentionally the last step:

1. Apply `schema.sql` to the dedicated analytics PostgreSQL database with the explicit schema gate.
2. Put Partner ID / Partner Key and the initial access + refresh tokens in server environment variables.
3. Generate a 32-byte master key, base64 encode it, and set `SHOPEE_TOKEN_MASTER_KEY`.
4. Run `scripts/bootstrap-tokens.cjs` once with `SHOPEE_ANALYTICS_BOOTSTRAP_TOKENS=YES`.
5. Remove the plaintext access/refresh-token bootstrap environment variables after verification. Partner ID/Key remain server secrets.
6. Runtime sync reads the encrypted token bundle from PostgreSQL and refreshes the Shopee access token automatically before expiry.
7. Run the read-only sync commands and compare the first real campaign against Seller Centre before enabling recurring sync.

No secret should be pasted into chat or committed to Git.

## Product Card bridge

The item-level Product Card funnel export is supported as a period import while a complete official item-level BI API is not yet verified.

```bash
SHOPEE_ANALYTICS_IMPORT_PRODUCT_CARD=YES \
SHOPEE_PRODUCT_CARD_FILE=/secure/path/Product_Card.20260801_20260812.xlsx \
node shopee-analytics/scripts/import-product-card.cjs
```

The importer can infer `start_date/end_date` from filenames containing `YYYYMMDD_YYYYMMDD`; explicit date env values override inference. It maps common English/Chinese Shopee headers, preserves the raw row JSON, and upserts by shop + period + item.

## Read-only V1 UI

`src/standalone-server.js` exposes only read endpoints:

- Campaign overview
- Campaign diagnostic detail
- Ordinary-day vs Double-Day/25th-event baseline
- SKU race table with Direct/Broad metrics and Product Card funnel context
- Recommended ROI context
- Next-step validation actions
- SKU event timeline (voucher, discount, return/refund, recommended ROAS and operation history)

The standalone server binds to loopback by default. It is not yet integrated into the existing inventory navigation/auth stack.


## Multi-country / multi-brand / multi-shop

The analytics layer is shop-scoped end to end. Every operational fact keeps `shop_id`, and the shop directory adds the business dimensions that Shopee API data does not reliably provide:

- country / marketplace
- brand
- display name
- local currency
- IANA timezone
- Brand Portal timezone
- active / sort order

Configure shops with the gated script:

```bash
SHOPEE_ANALYTICS_CONFIGURE_SHOPS=YES \
SHOPEE_SHOP_PROFILES_FILE=/secure/path/shops.json \
node shopee-analytics/scripts/configure-shops.cjs
```

See `config/shops.example.json` for the shape.

The frontend is built around the same hierarchy:

`Country → Brand → Shop → Campaign → SKU`

The portfolio page supports all shops or filtered subsets. Monetary values are **never summed across different currencies**. Cross-shop order/unit counts can be totaled, while GMV, ad spend, refunds and ROAS are grouped by currency until a dedicated reporting-FX layer is explicitly added.

For recurring sync across all active shops:

```bash
SHOPEE_ANALYTICS_ENABLE_SYNC_ALL_SHOPS=YES \
node shopee-analytics/scripts/sync-all-shops.cjs hourly

SHOPEE_ANALYTICS_ENABLE_SYNC_ALL_SHOPS=YES \
node shopee-analytics/scripts/sync-all-shops.cjs daily
```

Optional scheduler filters can limit a run to one country, brand, or set of shop IDs. Each shop keeps its own encrypted token bundle and timezone.
