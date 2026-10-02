---
name: shopee-gmv-max-analysis
version: 0.2.0
description: Diagnose Shopee GMV Max and Ad Group performance with a campaign-first, funnel-first, evidence-linked operating framework.
---

# Shopee GMV Max / Ad Group Analysis Skill

## Purpose
This skill is the reasoning layer for Shopee advertising analysis. The application supplies normalized facts and deterministic metrics; the model interprets them. The report must diagnose the campaign before diagnosing individual SKUs and must end with a testable next action.

The operating path is:

`campaign evidence -> maturity -> overall efficiency -> funnel -> SKU structure -> A/B/C -> action -> validation`

## Non-negotiable principles
1. Start with campaign-level Direct Orders, then ROAS/economic constraints, then funnel, and only then SKU structure.
2. Never jump from a zero-order SKU directly to a removal recommendation without checking sample/cost evidence.
3. Treat Signal and Confidence separately. A strong small-sample result is not a proven scalable winner.
4. Prefer Direct metrics for judging the promoted SKU itself. Broad/Total metrics remain useful for campaign/store contribution.
5. A/B/C is an internal operating model, not a Shopee field and not a claim about Shopee's private algorithm.
6. Spend Share is observed allocation behavior. It is not a business target and is not proof of quality.
7. One strong SKU carrying most or all orders can be a valid stable structure. Multi-SKU success is NOT required for STABLE.
8. Target ROAS is an operating constraint, not automatically a profitability threshold.
9. Never call ROAS, CTR, CVR, CPC or another metric strong/weak/good/poor unless a supplied comparator supports that judgment.
10. Never state an internal inference as an official Shopee rule.

## Evidence availability gate
Before reasoning, inspect `evidenceAvailability`, `dataQuality`, and deterministic metrics.

- Empty item arrays mean no SKU evidence.
- Empty allocation arrays mean no allocation or leader-switch evidence.
- Missing add-to-cart data means do not infer add-to-cart quality.
- Missing break-even ROAS means do not label profitability from ROAS alone.
- Missing Target ROAS means do not infer whether Target was met.
- Missing platform recommended ROAS means do not invent it.
- Range-only Ad Group data cannot support daily stability claims.

State missing evidence as a limitation instead of filling the gap with assumptions.

## Required reasoning order
Follow this order even when another observation looks more interesting:

1. **Maturity / sample sufficiency** — observation days and latest-7-day Direct Orders.
2. **Campaign order output** — Direct Orders first; Broad Orders only as additional contribution context.
3. **Campaign economics** — actual ROAS versus supplied break-even, ad-spend-ratio constraint, and Target ROAS.
4. **Campaign funnel** — Impressions -> Clicks -> CTR -> Add to Cart -> Add-to-Cart Rate -> Direct CVR -> Direct Orders.
5. **Period comparison** — current window versus the supplied comparable previous window when available.
6. **SKU allocation structure** — impression/click/spend/direct-order/direct-GMV shares and concentration.
7. **SKU conversion evidence** — Direct Orders, Direct CVR, Direct ROAS, CPC/CPA and continuity.
8. **A/B/C + Candidate Role** — assign only after Signal x Confidence is considered.
9. **Scale Stability** — determine whether efficiency survives increased traffic/spend.
10. **Recent operations / cooldown** — avoid reading post-change noise as a stable new state.
11. **Action and validation** — every structural recommendation must say what evidence justifies it and what to measure next.

## Maturity and campaign stage
Use `deterministicMetrics.maturity` when present. The default internal maturity floor is 7 daily observations plus the configured `weeklyOrderReference` (normally 25) Direct Orders in the latest 7 days.

This maturity floor means the campaign has enough feedback to move beyond pure LEARNING. It does **not** automatically mean STABLE.

- **LEARNING**: observation/sample floor is not met, or critical campaign evidence is unavailable.
- **CONVERGING**: maturity floor is met but efficiency, funnel, allocation or continuity evidence is still forming.
- **STABLE**: maturity floor is met and multiple evidence dimensions are sufficiently consistent for controlled optimization.
- **UNSTABLE**: a mature/long-running campaign shows persistent material deterioration or volatility in efficiency, funnel, allocation or order output.

Important stage rules:

- Never keep a campaign in LEARNING solely because only one SKU is converting when the campaign maturity floor is already met.
- Never prevent STABLE solely because orders are concentrated in one SKU.
- Single-SKU dominance is a **structure/concentration observation**, not instability by itself.
- A brief one-day allocation dip is not enough by itself to call the campaign UNSTABLE; use continuity and the full selected window.
- Order volume alone is not enough to call a campaign STABLE.

## Learning epoch, reset events, and operation source
Do not define the analysis window as a fixed trailing 7-day calendar window. Determine the current learning epoch from campaign start plus the latest material operation evidence.

Every operation must be interpreted with both **event type** and **actor/source** when available:
- `SELLER`: seller/operator initiated.
- `SHOPEE_SYSTEM`: platform automation such as dynamic-budget or promotion optimization.
- `UNKNOWN`: source cannot be proven from supplied evidence.

For Indonesia GMV Max, apply this conservative hierarchy:
- Campaign activation / creation of a new Ad Group starts a new learning epoch.
- A SELLER Target ROAS change is a confirmed learning reset: the post-change observation period starts from that change.
- A SELLER daily-budget change is a learning-impact event, not automatically a confirmed full 7-day reset. Start a post-change comparison segment, but do not claim a full reset unless the package shows the campaign re-entered Learning Phase or another official signal confirms it.
- Pause/resume or temporary no-balance interruption is a learning-impact event, not automatically a confirmed full reset.
- SKU membership/structure changes are material structure events. Treat them as post-change segmentation points, but do not call them confirmed full learning resets unless official evidence supplied for that campaign says so.
- `SHOPEE_SYSTEM` automatic budget increases or promotion-period automatic optimization are system-optimization events. Do not treat them as seller resets by default.
- If actor/source is `UNKNOWN`, never assume a detected Target ROAS or budget change was seller initiated. Mark it `RESET_CANDIDATE` / source-unknown and lower confidence rather than creating a false reset.

Always preserve both sides of a material change:
- **pre-change baseline**: the most comparable stable period before the change;
- **post-change observation**: data from the change onward.

The report must state the latest material event, actor/source, reset classification, effective date, days observed since the event, and whether the campaign has enough post-change evidence for a new stability judgment.

When `deterministicMetrics.timeContext` is present, treat it as authoritative:
- `learningEpoch` defines the current operation-driven learning epoch and calendar-day maturity evidence;
- `beforeAfter.transitionDate` is the operation date;
- `beforeAfter.postPeriod.startDate` is the first clean full-day performance observation after a non-midnight operation;
- `beforeAfter.allDays` preserves real business output;
- `beforeAfter.normalDays.balancedPre` versus `balancedPost` is the primary promo-adjusted before/after comparison;
- `beforeAfter.promo` is a separate one-day stress-test view.

Do not replace this with a generic trailing-7-day comparison when operation-driven time context is available.

## Promotion / campaign-date segmentation
For the current Southeast Asia operating framework, promotion events are single-day markers:
- **Double-date promo day**: `1.1`, `2.2`, `3.3`, ... `12.12`.
- **Pay Day promo day**: the `25th` of each month.

Tag only the event date itself as `PROMO_DAY`. The day before and day after remain `NORMAL` unless supplied evidence shows another specific event or an observed performance anomaly. Do not create a hard-coded `POST_PROMO` exclusion window.

Both the pre-change baseline and post-change observation window must be checked for these promo-day markers.

When promo dates overlap either side of a before/after comparison, preserve two views when evidence allows:
- **all-days view**: actual business performance including promo days;
- **normal-days view**: comparison after excluding the single promo dates from both sides.

Use the normal-days view as the primary evidence for whether an advertising adjustment improved or weakened the underlying steady-state performance. Keep promo-day performance separately as a one-day promotion / scale-stress segment; never delete it.

If a promo day is present on only one side of the comparison, explicitly warn that the all-days before/after result is promotion-contaminated and must not be attributed directly to the advertising adjustment.

## Campaign economics and ROAS discipline
Always state the actual metric before its interpretation.

When comparators are available, use explicit relationships such as:
- `actual Direct ROAS X > break-even ROAS Y`
- `actual Direct ROAS X < Target ROAS Y`
- `Broad ACOS X <= ad-spend-ratio limit Y`

When a comparator is missing, say it is unavailable. Do not replace it with an invented benchmark.

Do not use adjectives such as "strong efficiency", "weak ROAS", "healthy", "poor", "good" or equivalents unless the statement names the supplied benchmark that makes the adjective meaningful.

Target ROAS and break-even ROAS answer different questions. A campaign can be above break-even while below Target ROAS; report both facts rather than collapsing them into one verdict.

`adSpendRatioLimit` is a separate shop-level advertising-cost constraint, not a product break-even ROAS. Evaluate it only as `Broad ACOS <= adSpendRatioLimit` or equivalently `Broad ROAS >= 1 / adSpendRatioLimit`. Never compare Direct ROAS to `1 / adSpendRatioLimit`, and never call that derived Broad ROAS threshold a break-even ROAS.

## Funnel diagnosis
Campaign funnel diagnosis is mandatory when the metrics are available.

Read the funnel in this sequence:
`Impressions -> Clicks -> CTR -> Add to Cart -> Add-to-Cart Rate -> Direct CVR -> Direct Orders`

Use current-versus-previous comparable-period metrics when supplied. Describe the changed layer before attributing a cause.

Examples:
- Impressions up while CTR falls: traffic expanded but click acceptance weakened; do not yet blame product conversion.
- Clicks/CTR are acceptable while Direct CVR falls: investigate traffic quality, price/value proposition, product page and SKU mix.
- Add-to-cart remains healthy but Direct CVR falls: investigate checkout/promotion/price friction before concluding the ad traffic is bad.
- If add-to-cart evidence is unavailable, omit this branch rather than estimating it.

Never skip the campaign funnel and jump directly from campaign ROAS to SKU pruning.

## Allocation and SKU structure
After the campaign-level diagnosis, inspect SKU allocation.

Use impression share, click share, spend share, Direct Order share and Direct GMV share as observed allocation/output facts. For Ad Group reports, SKU Spend Share is mandatory whenever spend exists: show each material SKU's current-window Spend Share and compare it with Direct Order Share and Direct GMV Share. When a comparable previous window exists, also describe the Spend Share change. Concentration is not automatically bad: a campaign may intentionally converge around one proven A SKU plus a small exploration pool.

Interpret allocation as a relationship, not as a standalone score:
- Spend Share materially above Direct Order Share / Direct GMV Share is evidence that the SKU consumes more budget than the conversion/output share it returns; combine this with clicks, CVR, order count and sample sufficiency before pruning.
- Direct Order Share materially above Spend Share is evidence of efficient conversion allocation in the observed window, but does not prove that forcing more Spend Share will preserve ROAS.
- A high Spend Share with mature orders and acceptable economics may simply identify the current A core; do not penalize concentration by itself.

A useful structural pattern can be:
`strong A core + limited B/C exploration`

A problematic structural pattern can be:
`weak/uncertain SKUs consuming meaningful test cost without conversion feedback`

Do not require multiple SKUs to convert. Do not recommend forcing spend to be evenly distributed.

Spend Share is normally a dependent/observed variable. Never recommend "keep SKU spend share above N%" or claim that a spend-share threshold will cause a specific ROAS unless that threshold and causal relationship are explicitly supplied by deterministic evidence. If a possible relationship is worth testing, express it only as a HYPOTHESIS with a validation plan and no invented threshold.

## Internal A/B/C traffic evidence
A/B/C describes evidence status, not permanent product quality.

- **C — exploration / low confidence**: new or weakly sampled SKU; little conversion evidence. High Spend Share alone cannot upgrade C.
- **B — positive signal under validation**: conversion/efficiency signal exists, but sample, continuity or scale stability is not yet sufficient for A.
- **A — validated core**: evidence is mature enough, conversion/efficiency is supported against available constraints, and continuity exists. A can be assigned even when Scale Stability is still UNKNOWN; scale resilience is assessed separately.

Do not assign A merely because an SKU has the highest ROAS in a small sample. Do not assign C merely because an SKU received less spend.

## Candidate roles
Candidate Role is independent from A/B/C:

- `TRAFFIC_CANDIDATE`: attracts impressions/clicks but conversion evidence is not mature.
- `CONVERSION_ANCHOR`: meaningful Direct Order / Direct CVR contribution; may not have the highest value per order.
- `HIGH_VALUE_CANDIDATE`: meaningful Direct GMV or GMV/order contribution despite lower conversion frequency.
- `STABLE_CORE`: validated, efficient against available constraints, continuous and scale-resilient.
- `WEAK_EXPLORER`: receives exploration but feedback remains weak or insufficient.
- `REJECT_CANDIDATE`: sufficient test sample/cost demonstrates continued allocation is not justified.

`REJECT_CANDIDATE` requires evidence of sufficient test opportunity. Zero orders alone is not enough. Prefer `WEAK_EXPLORER` when the package cannot establish adequate clicks/spend/test cost or when key conversion evidence is missing.

`STABLE_CORE` additionally requires verified Scale Stability. If Scale Stability is UNKNOWN because no expansion episode is supplied, use `CONVERSION_ANCHOR` (or another evidence-supported role) rather than `STABLE_CORE`.

When item break-even ROAS or platform recommended ROAS is supplied, include it in the SKU assessment. When it is absent, do not invent a threshold.

## Scale stability
A scalable SKU should show an expansion episode where more traffic/spend produces meaningful order growth without material collapse in Direct CVR and Direct ROAS.

- No expansion episode -> Scale Stability is UNKNOWN, not PASS.
- High historical ROAS before expansion does not prove scale stability.
- A temporary Spend Share dip does not prove scale failure if conversion/efficiency recovers and the wider window remains coherent.

## Causal discipline and prohibited reasoning
The report must distinguish correlation, inference and causal evidence.

Never:
- invent numeric thresholds such as 80% Spend Share or ROAS 8.0 unless they appear in the package or this Skill;
- say a Spend Share level will *cause* or *maintain* a ROAS level;
- say "lack of multi-SKU success prevents STABLE";
- call a campaign efficient/inefficient without a supplied economic comparator;
- treat 100% order concentration as proof of instability;
- treat one abnormal day as a persistent trend without multi-day evidence;
- recommend lowering Target ROAS merely because budget is under-spent;
- infer Shopee private algorithm rules from observed allocation.

## Evidence classes
Every substantive statement must belong to one of these evidence classes:

- **FACT**: directly supplied by the Analysis Package or deterministically calculated by the application.
- **INFERENCE**: interpretation supported by one or more FACT evidence ids.
- **HYPOTHESIS**: a proposition requiring future observation or a controlled experiment.

An INFERENCE must never be presented as a Shopee-confirmed algorithm rule. A HYPOTHESIS must include a concrete validation condition and must not present its expected result as fact.

## Action gates
Structural actions must follow the diagnosis, not precede it.

- **LEARNING**: default to observe/protect learning unless there is a clear safety/profitability breach.
- **CONVERGING**: use mature evidence to prune only clearly disproven candidates; keep credible B exploration limited and measurable.
- **STABLE**: controlled keep/remove/split/budget/Target tests may be considered when economics, evidence and cooldown permit.
- **UNSTABLE**: diagnose the broken layer first — order output, economics, funnel, allocation, candidate-pool coherence, competitiveness or recent changes — before scaling.

For a mature campaign, a clearly proven `REJECT_CANDIDATE` may be tested with a pause/remove experiment. Compare campaign Direct Orders, Direct ROAS/ACOS and funnel after the change over a comparable observation window.

For Ad Group campaigns, budget and Target ROAS are group-level controls. Do not recommend changing an individual SKU bid, individual SKU budget, or another per-item control unless the Analysis Package explicitly proves that control exists. SKU-level structural actions should default to keep / observe / pause / remove; group budget or Target ROAS changes must be reasoned at campaign level.

Do not recommend extracting a SKU into a single-product scale campaign merely because it leads one short window. The preferred operating path is:

`Ad Group validation -> evidence maturity -> stable A core -> controlled single-product scaling`

## Report composition
Keep the visible report concise but preserve the diagnostic order.

### FACT ordering
Prioritize FACTs in this sequence when available:
1. maturity: observation days and latest-7-day Direct Orders versus the configured weekly reference;
2. campaign Direct Orders and actual Direct/Broad ROAS;
3. economic comparators: break-even, ad-spend-ratio limit/required ROAS, Target ROAS;
4. campaign funnel: Impressions, Clicks, CTR, Add to Cart, Add-to-Cart Rate, Direct CVR;
5. comparable-period changes;
6. Ad Group SKU allocation structure: Spend Share first, then Impression Share / Click Share / Direct Order Share / Direct GMV Share, including the clearest spend-versus-output mismatch or concentration pattern; only after that present the strongest item-level evidence.

### INFERENCE ordering
1. campaign-level problem statement;
2. funnel/root-cause interpretation;
3. SKU-structure interpretation;
4. only then individual SKU decisions.

The root cause should answer: **what layer currently constrains growth or efficiency, and which facts prove it?**

## Hypotheses and next validation
A useful hypothesis changes one decision variable or tests one identified mechanism. Validation should name:
- what changes or is observed;
- the comparable observation window;
- the campaign/SKU metrics that determine whether the hypothesis survives.

A hypothesis is uncertain by definition. Use wording such as `may`, `could`, or `if ... then test whether ...`; do not use `will`, `guarantee`, or equivalent certainty for an untested outcome.

Avoid hypotheses that merely restate a correlation. Example of an invalid hypothesis: "keeping the leader above 80% Spend Share will keep ROAS above 8" when neither threshold is supplied.

A better form is: "If the non-converting SKU is consuming sufficient test cost without add-to-cart/order feedback, pausing it may improve campaign efficiency; validate by comparing Direct Orders, Direct ROAS/ACOS and funnel metrics over the next comparable window while the remaining structure is unchanged."

## Output
Return the structure defined by `schemas/analysis-output.schema.json`.

Reports must include skill identity/version, data cutoff, trigger, stage, FACTs, evidence-linked INFERENCEs, testable HYPOTHESIS items, SKU assessments, action gates, next validation and data-quality limitations.

Do not add narrative outside the JSON structure. Do not expose chain-of-thought. Output only concise conclusions and evidence links required by the schema.
