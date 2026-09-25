---
name: shopee-gmv-max-analysis
version: 0.4.0
description: Analyze Shopee ads from a normalized analysis package using evidence-separated, stage-aware, experiment-driven reasoning.
---

# Shopee GMV Max Analysis Skill

## Purpose
This skill is the reasoning layer for Shopee advertising analysis. The Shopee Analytics application is the data platform, scheduler, report store and UI. It must provide normalized facts and deterministic metrics; this skill interprets them.

The skill is not only a diagnostic engine. It is a learning system that should turn observations into testable hypotheses, controlled experiments, repeated cases, validated patterns and eventually reusable operating rules.

The normalized data layer may contain three promotion types:
- `SHOP_GMV_MAX`: API-sourced when available.
- `AD_GROUP`: API-sourced when available, otherwise manual or Seller Centre report import.
- `INDIVIDUAL_AD`: API-sourced when available.

Data-source differences must be surfaced as evidence-quality context, but the reasoning discipline remains consistent across promotion types.

## Non-negotiable principles
1. Start from platform objective and observed allocation behavior, never from "which SKU has the highest ROAS".
2. Diagnose campaign/ad-group overall performance before SKU-level performance: order volume first, then ROAS, then traffic/conversion structure, then item-level allocation.
3. Treat 7 days as a minimum observation reference, never as automatic learning completion.
4. Prefer Direct metrics when judging the promoted SKU itself. Broad/Total metrics remain useful for campaign/store contribution.
5. Separate Signal from Confidence. A strong small-sample result is not a proven scalable winner.
6. High Spend Share means the platform is currently allocating/testing more resource; it does not by itself mean an A-stage SKU.
7. A/B/C is an internal analytical model, not a Shopee field or claim about Shopee's private algorithm.
8. Target ROAS is an operating constraint. Do not recommend lowering it merely because budget is under-spent.
9. Structural actions must respect campaign stage, profitability, scale stability, sample confidence, recent-operation cooldown and major-event context.
10. The objective is to identify repeatably scalable SKUs and repeatable mechanisms, not today's top SKU.
11. Never state an internal inference as an official Shopee rule.
12. Missing data is unknown, not zero. Never manufacture a metric from another metric unless the deterministic formula is explicitly valid for that metric.
13. One case is evidence, not a rule. Reusable rules require repeated validation across comparable cases.
14. Prefer controlled, low-risk tests over uncontrolled simultaneous changes when a mechanism is uncertain.
15. Treat candidate-pool architecture as a first-order diagnostic variable. Same category and similar price are not sufficient evidence that an Ad Group is structurally healthy.
16. Treat major-promotion scaling as both GMV capture and a controlled ceiling test; do not generalize event-period capacity directly to normal days.

## Required reasoning order
1. Campaign/ad-group stage: LEARNING / CONVERGING / STABLE / UNSTABLE.
2. Campaign/ad-group orders and evidence density.
3. Campaign/ad-group ROAS versus break-even, ad-spend-ratio constraint and Target ROAS.
4. Candidate-pool architecture: prior evidence strength, anchor/challenger structure, concentration, leader switching and whether the group contains only weak homogeneous candidates.
5. Traffic and conversion structure: impressions, clicks, CTR, add-to-cart when available, CVR, spend, orders and GMV.
6. Daily SKU allocation: impression/click/spend/direct-order/direct-GMV shares.
7. Order-source concentration and leader switching.
8. SKU Direct Orders / Direct CVR / Direct ROAS.
9. CTR and click quality.
10. GMV per Direct Order / value contribution.
11. Multi-day continuity and Signal x Confidence.
12. Scale Stability.
13. Recent operation history, campaign-setting changes and cooldown.
14. Event context such as double-date campaigns or monthly 25th promotions; do not treat event traffic as directly representative of normal days.
15. If an event-period budget is exhausted while economics remain healthy, evaluate controlled scale expansion and latest-increment economics.
16. Only then generate actions or experiments.

## Evidence classes
Every substantive report statement must be typed:
- `FACT`: directly supplied by the analysis package or deterministic calculation.
- `INFERENCE`: interpretation supported by one or more FACT evidence ids.
- `HYPOTHESIS`: a proposition requiring a future observation or controlled experiment.

An `INFERENCE` must never be presented as a Shopee-confirmed algorithm rule. A `HYPOTHESIS` must include a validation condition.

When causal evidence is incomplete, use the following reasoning chain inside the existing output structure:

`FACT -> INFERENCE -> MECHANISM HYPOTHESIS -> EVIDENCE NEEDED -> EXPERIMENT`

The output schema does not need separate fields for every label. Put the relevant content into facts, inferences, hypotheses, data-quality limitations and next validation while preserving these distinctions.

## The six-layer learning lens (江水思维)
Use this as the upper-level method for difficult or uncertain cases.

### 1. 接浪 — Handle the current wave
Describe what is happening now. Identify the current anomaly, constraint or opportunity from observed data.

### 2. 识浪 — Identify the pattern
Ask which variables moved together and what repeatable relationship may explain the event. Separate correlation from causation.

### 3. 观水 — View from the platform/system perspective
Ask: if the platform is optimizing its own objective under the current constraints, why could this allocation/result occur? Use this only as an explanatory model. Never claim knowledge of Shopee's private algorithm without official evidence.

### 4. 望浪 — Look forward
Ask what risk, bottleneck or failure mode may appear if the current configuration continues for the next observation horizon. Use 7/30/90-day horizons when helpful, but express them as scenarios or risks to monitor, not certain predictions.

### 5. 照己 — Find our capability/data gap
Ask why the next wave would be difficult for us. Identify missing data, weak process, weak product competitiveness, poor campaign structure, unclear decision ownership, insufficient sample, or a blind spot in the current model.

### 6. 挖渠 — Create a controlled wave
When the mechanism is uncertain, design a low-cost, controlled, measurable experiment now rather than waiting for a larger failure. Prefer changing one primary variable while holding other important variables stable.

The loop is:

`Observe -> Diagnose -> Hypothesize -> Design Experiment -> Measure -> Validate/Falsify -> Accumulate Cases -> Extract Pattern -> Operating Rule -> Skill Knowledge`

## Experimental context is core evidence
Budget, Target ROAS, platform Estimated/Recommended ROAS and operation history are not decorative fields. They are experiment context and should materially affect causal interpretation when available.

For each campaign/ad-group, prefer to know:
- current Budget;
- current Target ROAS;
- platform Estimated/Recommended ROAS or range when shown by Seller Centre;
- setting-change timestamps;
- old value and new value;
- product add/remove/pause events;
- voucher/price/creative changes;
- Auto Budget changes;
- operator reason or hypothesis;
- observation window;
- major-event context.

If these fields are absent, explicitly reduce causal confidence and state which evidence is needed.

### Target vs Estimated vs Actual ROAS
Treat these as three different signals:
- `Target ROAS`: the operator's constraint/request to the platform.
- `Estimated/Recommended ROAS`: the platform's current expectation/recommendation, if available.
- `Actual ROAS`: observed realized efficiency.

Do not collapse them into one number.

Examples of interpretation:
- Target far above Estimated, Actual near Estimated: investigate whether the Target is outside the platform's currently expected feasible range before calling the campaign execution a failure.
- Target inside/near Estimated, Actual materially below both: investigate traffic quality, conversion acceptance, offer/price, product structure, event context and allocation changes.
- Estimated ROAS is absent: mark the comparison as unavailable rather than inferring it.

## Candidate-pool architecture gate
Before concluding that an Ad Group mainly has a pricing, voucher, budget or Target ROAS problem, inspect the structure of the item pool itself.

A structurally weak pool can exist even when all items are in the same category and similar price band. A common risk pattern is:
- all items have weak or immature historical sales evidence;
- no item has enough order/conversion evidence to act as a trusted anchor;
- allocation remains dispersed across multiple items;
- the daily leader changes frequently;
- a commercial stimulus such as a large voucher is applied across the pool, but the group still does not converge toward a clear high-confidence candidate.

Do not treat this pattern as proof of Shopee's private allocation logic. Treat it as a mechanism hypothesis to be tested.

### Candidate-pool health signals
Prefer to inspect:
- total group orders and evidence density;
- weekly item order evidence when available;
- Top-1 / Top-3 impression share;
- Top-1 / Top-3 click share;
- Top-1 / Top-3 spend share;
- Top-1 / Top-3 Direct Order share;
- Top-1 / Top-3 Direct GMV share;
- day-to-day leader switching;
- whether spend concentration is matched by order/GMV concentration;
- whether the apparent leader has enough sample to be trusted;
- whether the group has a plausible anchor/core candidate plus credible challengers, or only weak homogeneous candidates.

Useful internal labels:
- `ANCHOR_CANDIDATE`: materially stronger prior order/conversion evidence and a plausible core candidate.
- `CREDIBLE_CHALLENGER`: enough signal to justify continued comparison against the anchor.
- `WEAK_HOMOGENEOUS_POOL`: low group evidence plus low item differentiation/concentration; do not assume more discount alone will solve it.
- `CONVERGING_POOL`: allocation and order contribution are increasingly concentrating on a stable subset.

These are internal analytical labels, not Shopee fields.

### Pool-architecture hypothesis
Case-derived working hypothesis:

> A large voucher can improve the commercial offer, but it may fail to solve an Ad Group whose primary bottleneck is candidate-pool architecture. If every candidate is weak and similar in evidence strength, the group may continue exploration without producing a clear traffic/order concentration hierarchy.

Because this originated from an operator-reported case, keep it at `CASE RESULT / HYPOTHESIS` maturity until repeated comparable cases validate it.

See `cases/ad-group-homogeneous-weak-pool-voucher-failure.md`.

## Change-log / experiment model
When operation history is available, reason about changes as causal candidates rather than merely displaying them.

Useful change types include:
- `BUDGET`
- `TARGET_ROAS`
- `AUTO_BUDGET`
- `PRICE`
- `VOUCHER`
- `ITEM_ADD`
- `ITEM_REMOVE`
- `ITEM_PAUSE`
- `CREATIVE`
- `OTHER`

A well-formed experiment/change record should preferably contain:
- campaign/ad-group identity;
- `changed_at`;
- `change_type`;
- `old_value` and `new_value`;
- `reason`;
- `hypothesis`;
- `expected_effect`;
- `observation_window`;
- `operator` or source;
- `remark`;
- `experiment_id` when multiple actions belong to one planned experiment.

When evaluating an adjustment, compare a clean pre-window and post-window where possible. Check whether another major change or promotion overlaps the observation window before attributing causality.

## Controlled-experiment rules (主动挖渠)
When proposing an experiment:
1. State the question to be answered.
2. State the mechanism hypothesis.
3. Change one primary variable whenever feasible.
4. Define what must remain stable (SKU pool, price, voucher, creative, budget or Target ROAS depending on the test).
5. Define the observation window before the test starts.
6. Define primary outcome metrics and guardrails before the test starts.
7. Define what result would support the hypothesis and what result would falsify/weaken it.
8. Avoid interpreting major-promotion periods as ordinary baseline unless the experiment is specifically about promotion traffic.
9. Avoid another structural change during cooldown unless a profitability/risk guardrail is breached.
10. Do not recommend a test that knowingly pushes the account below an explicit profitability constraint without clear authorization.

Useful observation chain after a change:

`setting/action -> impressions -> clicks -> CTR -> add-to-cart (if available) -> CVR -> spend -> orders -> ROAS -> item allocation/order-share changes`

Use the chain to locate where the response occurred instead of attributing every outcome directly to the changed setting.

For candidate-pool experiments, a useful controlled comparison is:

`weak homogeneous pool -> restructure around stronger anchor + limited challengers -> observe concentration, orders and ROAS`

Hold other major commercial variables as stable as practical so that any change in allocation/concentration can be interpreted with higher causal confidence.

## Event-period scaling and ceiling test
Major-promotion periods can provide unusually high-intent traffic and therefore a useful environment for controlled scale testing across `INDIVIDUAL_AD`, `AD_GROUP` and `SHOP_GMV_MAX`.

The operating idea is:

`budget exhausted while ROAS is still healthy -> increase budget in controlled steps -> evaluate the latest increment -> continue only while marginal economics remain acceptable`

This serves two goals:
1. capture additional profitable GMV while high-intent demand is available;
2. estimate the event-period scale ceiling of the promoted link, group or store campaign.

### Do not use blended ROAS alone
A strong early period can keep full-day blended ROAS high even after newly added budget starts buying weaker traffic.

Where the data allows, calculate:

`marginal_roas = incremental_gmv / incremental_ad_spend`

For example, compare the spend/GMV accumulated after each budget increase rather than judging only the day's final aggregate.

The most recent increment should carry more weight when deciding whether to add another increment.

### Event scaling guardrails
Before another budget increase, check:
- budget is actually binding/exhausted;
- current and latest-increment ROAS remain above the relevant profitability floor;
- ad-spend-ratio constraint remains acceptable;
- orders rise meaningfully with additional spend;
- CVR has not materially collapsed;
- stock / fulfillment risk is acceptable;
- for Ad Groups, additional spend is not simply leaking into weak explorers;
- no overlapping structural change makes attribution unusable.

Stop further expansion when the latest increment approaches or crosses the profitability floor, unless an explicitly authorized loss-leading objective exists.

### Ceiling interpretation
The result is `EVENT_SCALE_CEILING_EVIDENCE`, not automatically a normal-day ceiling.

Major-event traffic quality, buyer intent, vouchers, platform subsidies and competitor behavior may differ from ordinary days. Never generalize an event-period ceiling to normal periods without repeated non-event evidence.

### Promotion-type interpretation
- `INDIVIDUAL_AD`: test how much traffic/spend one link can absorb before CVR/ROAS deteriorates.
- `AD_GROUP`: test both group-level scale and whether added budget reinforces strong candidates or diffuses into weak candidates.
- `SHOP_GMV_MAX`: test whether additional store-level spend continues to generate profitable GMV and healthy item contribution when item-level data is available.

Every event-period budget change should enter the operation/change log with timestamp, old/new budget, decision-time ROAS, budget utilization, profitability floor, reason and next observation window.

See `principles/event-period-scaling-and-ceiling-test.md`.

## Knowledge maturity: case is not rule
Never promote a single successful or failed case directly into Skill knowledge.

Use this maturity path:

`HYPOTHESIS -> EXPERIMENT -> CASE RESULT -> REPEATED CASES -> VALIDATED PATTERN -> OPERATING RULE -> SKILL KNOWLEDGE`

A pattern should be considered more transferable when it repeats across comparable campaigns/SKUs and survives different non-event periods. Event-only evidence should be tagged as context-specific.

If repeated cases disagree, preserve the disagreement and look for a moderator variable rather than averaging the contradiction away.

## Internal stages
Campaign maturity:
- `LEARNING`: inside minimum observation window or clearly insufficient feedback.
- `CONVERGING`: sufficient time has passed but allocation/efficiency evidence is still forming.
- `STABLE`: multiple evidence dimensions have converged.
- `UNSTABLE`: long-running with persistent allocation or efficiency instability.

SKU traffic evidence:
- `C`: low-confidence exploration.
- `B`: positive signal under validation.
- `A`: sufficiently supported and efficiency survives scaling.

Do not assign A only because CTR, spend share or one-day ROAS is high. A requires meaningful order evidence, efficiency, continuity and confidence.

## Candidate roles
Candidate Role is independent from A/B/C and should be assigned only when evidence supports it:
- `TRAFFIC_CANDIDATE`: attracts traffic but conversion evidence is not mature.
- `CONVERSION_ANCHOR`: relatively strong Direct CVR/order generation; may have lower GMV/order.
- `HIGH_VALUE_CANDIDATE`: meaningful GMV/order contribution despite lower conversion frequency.
- `STABLE_CORE`: high-confidence, profitable, continuous and scale-resilient.
- `WEAK_EXPLORER`: receives exploration but feedback remains weak.
- `REJECT_CANDIDATE`: sufficient test cost/sample indicates continued allocation is not justified.

## Scale stability
A scalable SKU should show that increased traffic/spend is accompanied by meaningful order growth while Direct CVR and Direct ROAS do not materially collapse. Lack of an expansion episode means scale stability is `UNKNOWN`, not `PASS`.

When a budget or Target ROAS change creates an expansion episode, use it as potential scale-stability evidence only after accounting for event traffic, product changes and other simultaneous interventions.

## Action gates
`LEARNING` defaults to observe and protect the learning environment.

`CONVERGING` focuses on whether allocation and feedback are converging; do not prematurely declare a winner.

`STABLE` can unlock controlled remove/keep/split/Target ROAS/Budget tests when profitability and SKU evidence also pass.

`UNSTABLE` requires diagnosis of candidate-pool coherence, Target ROAS, competitiveness, conversion acceptance, price/value proposition and recent structural changes.

Recent structural operations must create an observation cooldown before another structural action.

If evidence is insufficient for a confident action, the preferred output is not "do nothing". State the missing evidence and design the smallest useful experiment or data-collection action that can resolve the uncertainty.

## Output
Return the structure defined by `schemas/analysis-output.schema.json`.

Reports must include:
- skill version and data cutoff;
- trigger type;
- facts;
- inferences;
- hypotheses;
- campaign stage;
- SKU assessments;
- action gates;
- next validation;
- data-quality limitations.

Where relevant, the narrative must also make clear:
- what changed;
- what the platform response appears to be;
- what remains uncertain;
- what evidence is missing;
- what controlled experiment should answer the next question;
- whether candidate-pool architecture is a likely bottleneck;
- whether an event-period budget expansion is still profitable at the latest increment;
- whether a scale-ceiling conclusion is event-specific or transferable;
- whether a conclusion is a one-off case, repeated pattern or validated operating rule.
