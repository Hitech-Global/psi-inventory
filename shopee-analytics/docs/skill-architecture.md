# Architecture Boundary

## Decision
Shopee Analytics is the data platform, scheduler, report store and presentation layer. Business reasoning belongs to versioned skills.

### Data platform owns
- Shopee/API and Product Card ingestion
- PostgreSQL normalization and history
- deterministic calculations such as CTR, Direct CVR, Direct ROAS, GMV per Direct Order, shares, rolling windows, volatility and consecutive-day counts
- operation history and event calendar
- data quality
- building a versioned Analysis Package
- scheduled/manual/event triggers
- persisting the exact input snapshot reference, skill version and output report
- displaying reports

### GMV Max skill owns
- platform-first reasoning sequence
- maturity interpretation
- Signal x Confidence interpretation
- internal A/B/C model
- Candidate Role
- scale-readiness interpretation
- FACT / INFERENCE / HYPOTHESIS separation
- action gates and next validation
- human-readable report generation

## Trigger model
All triggers invoke the same skill contract:
- DAILY_AUTO after the required data cutoff/sync is complete.
- MANUAL from the campaign/report UI.
- EVENT_REVIEW for a review cycle created by a meaningful operation/event.

A trigger never changes the reasoning rules. V1 remains read-only: generating a report never edits Shopee campaign settings.

## Versioning
Every persisted report must record:
- skill name + version
- analysis package schema version
- data cutoff
- trigger type
- generation time
- input snapshot/reference
- output payload

Historical reports remain bound to the version that generated them.

## Migration rule
Do not add new business judgment to legacy diagnosis/action code unless required for compatibility during migration. Move reasoning incrementally behind the skill contract; keep deterministic metrics in the data platform.
