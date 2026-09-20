---
name: shopee-gmv-max-analysis
version: 0.1.0
description: Analyze Shopee GMV Max campaigns from a normalized analysis package and return evidence-separated, stage-aware reports.
---

# Shopee GMV Max Analysis Skill

## Purpose
This skill is the reasoning layer for Shopee GMV Max analysis. The Shopee Analytics application is the data platform, scheduler, report store and UI. It must provide normalized facts and deterministic metrics; this skill interprets them.

## Non-negotiable principles
1. Start from platform objective and observed allocation behavior, never from "which SKU has the highest ROAS".
2. Treat 7 days as a minimum observation reference, never as automatic learning completion.
3. Prefer Direct metrics when judging the promoted SKU itself. Broad/Total metrics remain useful for campaign/store contribution.
4. Separate Signal from Confidence. A strong small-sample result is not a proven scalable winner.
5. High Spend Share means the platform is currently allocating/testing more resource; it does not by itself mean an A-stage SKU.
6. A/B/C is an internal analytical model, not a Shopee field or claim about Shopee's private algorithm.
7. Target ROAS is an operating constraint. Do not recommend lowering it merely because budget is under-spent.
8. Structural actions must respect campaign stage, profitability, scale stability, sample confidence and recent-operation cooldown.
9. The objective is to identify repeatably scalable SKUs, not today's top SKU.
10. Never state an internal inference as an official Shopee rule.

## Required reasoning order
1. Campaign stage: LEARNING / CONVERGING / STABLE / UNSTABLE.
2. Campaign Direct Orders and evidence density.
3. Campaign ROAS versus break-even, ad-spend-ratio constraint and Target ROAS.
4. Daily SKU allocation: impression/click/spend/direct-order/direct-GMV shares.
5. Order-source concentration and leader switching.
6. SKU Direct Orders / Direct CVR / Direct ROAS.
7. CTR.
8. GMV per Direct Order.
9. Multi-day continuity and Signal x Confidence.
10. Scale Stability.
11. Recent operation history and cooldown.
12. Only then generate actions.

## Evidence classes
Every substantive report statement must be typed:
- FACT: directly supplied by the analysis package or deterministic calculation.
- INFERENCE: interpretation supported by one or more FACT evidence ids.
- HYPOTHESIS: a proposition requiring a future observation or controlled experiment.

An INFERENCE must never be presented as a Shopee-confirmed algorithm rule. A HYPOTHESIS must include a validation condition.

## Internal stages
Campaign maturity:
- LEARNING: inside minimum observation window or clearly insufficient feedback.
- CONVERGING: sufficient time has passed but allocation/efficiency evidence is still forming.
- STABLE: multiple evidence dimensions have converged.
- UNSTABLE: long-running with persistent allocation or efficiency instability.

SKU traffic evidence:
- C: low-confidence exploration.
- B: positive signal under validation.
- A: sufficiently supported and efficiency survives scaling.

## Candidate roles
Candidate Role is independent from A/B/C and should be assigned only when evidence supports it:
- TRAFFIC_CANDIDATE: attracts traffic but conversion evidence is not mature.
- CONVERSION_ANCHOR: relatively strong Direct CVR/order generation; may have lower GMV/order.
- HIGH_VALUE_CANDIDATE: meaningful GMV/order contribution despite lower conversion frequency.
- STABLE_CORE: high-confidence, profitable, continuous and scale-resilient.
- WEAK_EXPLORER: receives exploration but feedback remains weak.
- REJECT_CANDIDATE: sufficient test cost/sample indicates continued allocation is not justified.

## Scale stability
A scalable SKU should show that increased traffic/spend is accompanied by meaningful order growth while Direct CVR and Direct ROAS do not materially collapse. Lack of an expansion episode means scale stability is UNKNOWN, not PASS.

## Action gates
LEARNING defaults to observe and protect the learning environment.
CONVERGING focuses on whether allocation and feedback are converging; do not prematurely declare a winner.
STABLE can unlock controlled remove/keep/split/Target ROAS/Budget tests when profitability and SKU evidence also pass.
UNSTABLE requires diagnosis of candidate-pool coherence, Target ROAS, competitiveness, conversion acceptance and price/value proposition.

Recent structural operations must create an observation cooldown before another structural action.

## Output
Return the structure defined by schemas/analysis-output.schema.json. Reports must include skill version, data cutoff, trigger type, facts, inferences, hypotheses, campaign stage, SKU assessments, action gates, next validation and data-quality limitations.
