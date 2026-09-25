# Principle: Ad Group structure should align with the platform's optimization direction

## Status
- Knowledge maturity: `OPERATING PRINCIPLE`
- This is a decision-framework principle, not a claim about Shopee's private algorithm.

## Core idea
After diagnosing Ad Group overall performance, inspect the **product structure of the group** before jumping into item-level tactics.

The operating philosophy is:

> Understand what the platform is trying to optimize, then design the candidate pool so the platform can more easily discover, compare, validate and concentrate resources on stronger candidates. Work with the mechanism instead of fighting it.

In Chinese: **顺势而为，而不是硬刚。**

This does not mean blindly accepting platform recommendations. It means designing the inputs and experiments so that the platform's optimization process has a cleaner environment in which to reveal useful signals.

## Required analysis sequence
For an Ad Group, use this order:

1. **Overall group performance**
   - total orders / evidence density;
   - ROAS versus break-even and Target ROAS;
   - spend utilization;
   - CTR / CVR / add-to-cart where available;
   - promotion/event context.

2. **Candidate-pool architecture**
   - are items truly comparable in category / use case / price band;
   - does the group contain a plausible anchor/core candidate;
   - are challengers credible rather than uniformly weak;
   - how much historical order/conversion evidence does each item have;
   - Top-1 / Top-3 impression, click, spend, order and GMV concentration;
   - daily leader switching;
   - whether spend concentration is followed by order/GMV concentration;
   - whether the group is converging or endlessly exploring.

3. **Item-level diagnosis**
   - Direct Orders;
   - Direct CVR;
   - Direct ROAS;
   - CTR;
   - GMV per order / value contribution;
   - continuity and Signal x Confidence;
   - A/B/C internal traffic-evidence stage;
   - candidate role.

4. **Only then choose the intervention**
   - keep / remove / split items;
   - restructure the candidate pool;
   - voucher / price test;
   - Target ROAS test;
   - budget test;
   - single-product campaign graduation;
   - or continue observation.

## Structural requirement
`Same category + similar price band` is a compatibility filter, not a complete Ad Group design rule.

A useful pool should also allow **performance differentiation** to emerge. Avoid assuming that a collection of equally weak products becomes a strong group simply because the products are similar.

A practical working structure may contain:
- a stronger anchor/core candidate with meaningful evidence;
- a limited number of credible challengers;
- a small exploration tail whose test cost is controlled.

This is not a fixed 1/N formula and should not be treated as an official Shopee requirement. The correct structure depends on real evidence.

## Platform-alignment questions
When a group performs poorly, ask:

- Is the platform receiving enough conversions to learn anything useful?
- Does the candidate pool create a visible hierarchy of feedback, or is every item similarly weak?
- Is traffic starting to concentrate on items that also generate orders, or only spend?
- Are we trying to force an outcome with vouchers/budget/Target ROAS before giving the system a coherent candidate pool?
- If we were the platform optimizer, what evidence would make us allocate more budget to one item rather than another?

These questions are reasoning tools, not claims about hidden Shopee implementation details.

## Anti-pattern: fighting the platform
Examples of possible anti-patterns:
- repeatedly raising discounts across all weak items without changing the pool structure;
- repeatedly increasing budget while order evidence remains thin and allocation remains fragmented;
- forcing a very aggressive Target ROAS change while the system has not identified stable conversion candidates;
- filling a group with many similar but unproven SKUs and expecting the system to create a winner from insufficient evidence;
- making multiple structural changes at once, destroying the ability to learn from the result.

## Desired behavior: create a better optimization environment
Instead:
- give the system a coherent and comparable pool;
- preserve enough differentiation for a stronger candidate to emerge;
- protect learning periods from unnecessary structural changes;
- remove persistently weak explorers after sufficient evidence;
- allow validated strong candidates to accumulate more concentrated evidence;
- use controlled experiments to test uncertain mechanisms.

The goal is not to control every unit of traffic manually. The goal is to **shape the environment so that the platform's own optimization process is more likely to converge in a direction that also satisfies our profitability and growth constraints**.

## Skill implication
Whenever an Ad Group is analyzed, the report should explicitly answer:

1. Is the overall group healthy?
2. Is the candidate-pool structure compatible with the platform's optimization objective?
3. Is the pool showing convergence toward a stable subset?
4. If not, is the likely bottleneck offer quality, candidate-pool architecture, insufficient evidence, or campaign settings?
5. What is the smallest platform-aligned intervention or experiment that should be tried next?
