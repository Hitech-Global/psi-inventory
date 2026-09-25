# Case: Homogeneous weak ad-group + large voucher failed to concentrate traffic

## Status
- Knowledge maturity: `CASE RESULT / HYPOTHESIS`
- Not yet an operating rule.
- Source: operator-reported historical case.

## Context
An Ad Group was built from products that were:
- in the same category;
- in a similar price band;
- different SKUs;
- all relatively weak in historical sales evidence.

A large voucher was then applied with the expectation that the short-term price incentive would materially lift conversion.

## Observed result
The intervention did not produce the expected improvement.

The important structural observation was not simply "the voucher failed". The group itself lacked a clear evidence hierarchy: there was no sufficiently proven anchor item that consistently separated itself from the rest of the pool.

## Case inference
A coherent Ad Group needs more than category and price similarity. Candidate-pool structure itself may be a first-order variable.

Working interpretation:
- when every item enters the group with similarly weak prior evidence, the platform has to keep exploring multiple candidates;
- if no item generates materially stronger feedback, allocation may remain fragmented instead of converging toward one link;
- a large voucher applied across the weak pool can improve the offer without solving the allocation-structure problem;
- therefore "same category + same price band" is not sufficient evidence that the group is well structured.

This is an internal mechanism hypothesis, not a Shopee-confirmed private-algorithm rule.

## Mechanism hypothesis
A healthier candidate pool is more likely to converge when it contains a visible performance hierarchy, for example:
- one or a small number of stronger anchor/core candidates with meaningful historical order and conversion evidence;
- a limited number of credible challengers/explorers;
- weak items that are not allowed to dominate exploration cost indefinitely.

The goal is not to manufacture fake winners. The goal is to give the allocation system a candidate pool in which strong feedback can emerge and become concentrated.

## Diagnostic implication
Before using voucher/price/budget/Target ROAS as the main intervention, evaluate **Candidate-Pool Architecture**.

At minimum, inspect:
- campaign/ad-group total orders and evidence density;
- item weekly order evidence when available;
- Top-1 and Top-3 impression share;
- Top-1 and Top-3 click share;
- Top-1 and Top-3 spend share;
- Top-1 and Top-3 order share;
- Top-1 and Top-3 GMV share;
- leader switching across days;
- whether spend concentration is matched by order/GMV concentration;
- whether the apparent leader has enough sample to be trusted.

A group with low total orders plus low concentration and frequent leader switching should be treated as a possible **weak homogeneous pool** rather than automatically as a pricing problem.

## Controlled experiment to validate
Question: does pool architecture, not only discount depth, determine whether traffic converges?

Suggested test design:
1. Hold the major commercial variables as stable as practical: price band, voucher policy, Target ROAS, budget and creative.
2. Compare the weak homogeneous pool with a restructured pool that contains a stronger anchor plus a small number of challengers.
3. Observe for the predetermined window.
4. Primary measurements:
   - total group orders;
   - ROAS;
   - Top-1 / Top-3 spend concentration;
   - Top-1 / Top-3 order concentration;
   - leader switching;
   - SKU Direct CVR / Direct ROAS where available.
5. Support for the hypothesis would be: the restructured pool shows clearer allocation concentration and improved order/efficiency evidence without a disproportionate collapse in ROAS.
6. Evidence against the hypothesis would be: concentration and performance remain unchanged despite a meaningfully stronger candidate hierarchy.

## Skill takeaway for now
Treat `candidate-pool structure` as an explicit diagnostic dimension.

Do **not** convert this case directly into the rule "always put one strong SKU with weak SKUs". Repeated comparable cases are required before promoting the mechanism into an operating rule.