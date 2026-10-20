# Stage 6 — explainable analytics

Stage 6 makes the existing player, map, economy and rating analytics inspectable without presenting missing evidence as zero.

## Player metric coverage

Every expanded player profile includes a collapsed **Metric availability** ledger. For kills, deaths, assists, ACS, ADR, headshots, FK/FD, trades, plants, defuses, orbs, ultimate uses, KAST and multi-kills it records:

- accepted rows covered and total accepted rows;
- complete, partial or unavailable status;
- evidence confidence and contributing source names;
- the confirmed-round denominator where a percentage or round-derived count needs one;
- an explicit reason when accepted evidence cannot provide the metric.

A recorded `0` is covered evidence. A missing field stays unavailable and is never converted to zero.

## Best Map contribution ledger

The Best Map calculator now uses `best-map-ledger/v1`. Each map exposes its match, attack, defense, pistol, post-pistol, bonus, team K/D and equal-weight player-form contributions with their configured weights and sample counts.

When a dimension has no evidence, it contributes a visible neutral baseline rather than silently acting like a loss or disappearing from the denominator. The ledger reports weighted evidence coverage and a low/medium/high descriptive confidence label beside the final score.

## Existing contextual analytics retained

- Player profiles retain map, agent, attack/defense, weapon, opening, objective and evidence-linked round splits.
- Economy retains pistol, mid-buy and full-buy context plus weapon, map, side, site, agent and player dimensions.
- Weapon results remain equipped-weapon observations; they are not described as proven purchases.
- Calibrated ratings remain descriptive: robust peer baselines, shrinkage, intervals, trends and context splits. No predictive claim is made.

## Validation boundary

Pure ledger tests cover known zero, partial coverage, unavailable evidence, neutral map fallbacks and contribution arithmetic. UI contract tests cover the collapsed player ledger and exposed map score evidence. The final installed responsive and keyboard pass remains Stage 11.
