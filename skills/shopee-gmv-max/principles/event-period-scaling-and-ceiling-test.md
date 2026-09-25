# Principle: Event-period scaling as both GMV capture and ceiling test

## Status
- Knowledge maturity: `OPERATOR PLAYBOOK / HYPOTHESIS`
- Not a Shopee-official rule.
- Applies to major-promotion contexts where buyer intent and traffic quality may differ materially from normal days.

## Core idea
Major promotions such as double-date campaigns and monthly promotion days should not be analyzed like ordinary traffic days.

When buyer intent is materially stronger, budgets for Individual Ads, Ad Groups and Shop GMV Max may be consumed much faster. If a campaign repeatedly exhausts budget while realized ROAS still satisfies the operating target and remains above the profitability floor, controlled budget expansion can serve two purposes:

1. Capture more profitable GMV while high-intent demand is available.
2. Probe the current scale ceiling of the promoted link or candidate pool.

This is not simply "spend more because it is a promotion". It is a controlled expansion test with explicit guardrails.

## Three-layer decision logic
### Layer 1 — Is demand constrained by budget?
Evidence can include:
- budget exhausted early;
- spend curve hits the cap before the useful selling window ends;
- impression/click/order flow stops because budget is unavailable;
- ROAS is still above the current target and above the profitability floor at the time of exhaustion.

If budget is not actually binding, raising it does not test scale ceiling.

### Layer 2 — Does additional budget still produce acceptable economics?
After each increase, observe:
- incremental spend;
- incremental orders;
- incremental GMV;
- post-change CVR;
- post-change ROAS;
- item allocation changes for Ad Groups;
- whether the additional spend is captured by the same strong item or diffuses into weaker traffic/items.

Do not rely only on full-day blended ROAS. A strong early period can hide a weak marginal expansion period.

Where data allows, estimate **marginal ROAS** for the increment:

`marginal_roas = incremental_gmv / incremental_ad_spend`

The practical stop signal should be based more heavily on the economics of the latest increment than on the day's blended average.

### Layer 3 — Stop before profitable scale turns into unprofitable scale
Use explicit guardrails such as:
- break-even ROAS;
- ad-spend-ratio ceiling;
- contribution-margin floor;
- stock / fulfillment constraints;
- abnormal CVR deterioration;
- campaign-specific risk limits.

The aim is to find the largest economically acceptable spend region, not to maximize spend without constraint.

## Scale-ceiling interpretation
A promotion period can reveal a link's short-run demand/traffic ceiling because high-intent traffic makes the system less demand-constrained than ordinary days.

A useful sequence is:

`budget exhausted -> raise budget -> observe latest increment -> repeat while marginal economics remain acceptable -> stop near profitability guardrail`

This can reveal:
- how much spend the link can absorb before ROAS deteriorates;
- whether orders continue to rise with spend;
- whether CVR remains resilient under larger traffic;
- whether the campaign's allocation remains concentrated on productive items;
- whether the link has latent scale that normal-day traffic could not expose.

## Important caution
A promotion-period ceiling is not automatically a normal-day ceiling.

Buyer intent, platform traffic mix, vouchers, event subsidies, competitive intensity and conversion propensity can all differ materially from normal periods.

Therefore label the result as:
- `EVENT_SCALE_CEILING_EVIDENCE`
not
- `NORMAL_DAY_SCALE_CEILING`

Only repeated evidence outside event periods can support transfer to normal-day operating rules.

## Application by promotion type
### Individual Ads
Focus on whether the single product can absorb additional traffic while preserving CVR, order growth and profitability.

### Ad Groups
In addition to group-level ROAS, inspect whether additional budget:
- reinforces the strong candidate(s), or
- spills into weak explorers and degrades group efficiency.

Budget expansion during promotions is therefore also a test of candidate-pool architecture.

### Shop GMV Max
Inspect whether increased budget continues to generate profitable store-level GMV and whether item-level contribution remains healthy when item performance is available.

## Change-log requirement
Every promotion-period budget increase should preferably be recorded with:
- timestamp;
- old budget;
- new budget;
- reason;
- current ROAS at decision time;
- current spend / budget utilization;
- break-even ROAS;
- observation window for the next increment;
- result of the increment.

This turns a one-off scaling action into reusable experimental evidence.

## Skill behavior
When a major event is active, the Skill should explicitly ask:
- Is budget exhausted or likely to exhaust while economics are still acceptable?
- Is the current ROAS above Target ROAS and the profitability floor?
- What happened after the most recent budget increment?
- Is the **latest increment** still profitable?
- Is allocation quality holding or deteriorating?
- Are we measuring an event-period ceiling or mistakenly generalizing to normal days?

When the latest increment approaches or falls below the profitability floor, stop further expansion unless the operator explicitly accepts a loss-leading objective.