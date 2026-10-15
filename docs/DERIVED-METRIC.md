# Canonical derived-metric envelope (S0.2)

Schema identifier: `moetracker.derived-metric/v1` · Implementation: [`lib/derivedMetric.ts`](../lib/derivedMetric.ts) · Tests: [`tests/derivedMetric.test.ts`](../tests/derivedMetric.test.ts)

The envelope gives later summaries, comparisons and review signals one explainable shape. It wraps existing analytics on demand and does not rewrite persisted matches, rounds or aggregate records.

## Contract

| Field | Meaning |
| --- | --- |
| `schema` | Exact versioned identifier. Unknown/future schemas are rejected. |
| `scope.workspaceId` | Owning team workspace. Every source reference must name the same workspace. |
| `kind` | `count`, `scalar`, `average`, `ratio`, `rate` (0–1), or `percentage` (0–100). |
| `value` | Calculated value. `null` means unknown; observed zero remains `0`. |
| `numerator`, `denominator` | Calculation inputs when the kind is fractional; otherwise `null`. |
| `sampleCount` | Nonnegative integer observations used by the calculation. |
| `coverage` | Nonnegative integer `covered` and `total`; covered never exceeds total and the sample cannot exceed covered. |
| `confidence` | Qualitative `level` plus optional 0–1 `score`; an unknown level cannot claim a score. |
| `unknownReason` | Machine-readable reason required exactly when `value` is `null`. |
| `provenance` | Derived as `accepted-only`, `includes-unaccepted`, or `unreferenced`; callers cannot assert a stronger state. |
| `sourceReferences` | Sorted, de-duplicated S0.1 evidence references. Raw screenshots, replays, paths, URLs and secrets are not copied. |
| `calculationVersion` | Bounded immutable version label for the calculation that produced the value. |

Unknown reasons are `no-samples`, `missing-evidence`, `incomplete-coverage`, `contradictory-evidence`, `denominator-zero`, and `unsupported-calculation`.

## Validation and provenance

- Unknown fields, malformed values, unbounded sizes and unsupported schemas fail closed.
- Fractional values must agree with their numerator and denominator. Rate and percentage numerators cannot exceed their denominators.
- Known values require a positive sample; unknown values require an explicit reason. Zero-denominator fractions remain unknown and use `denominator-zero`.
- Unknown reasons must match their facts: `no-samples` requires a zero sample count, `denominator-zero` requires a fractional kind with a zero denominator, and `incomplete-coverage` requires covered to be less than total.
- Each source is normalized by the S0.1 contract, must share the envelope workspace, and is de-duplicated by its canonical evidence key.
- Metric confidence cannot exceed the weakest explicit S0.1 source confidence and is never inferred from coverage.
- `requireAcceptedMetricSources` (or the normalization option) rejects draft, rejected and unreferenced provenance. `resolveDerivedMetricSources` additionally resolves every accepted reference against the authenticated caller's current workspace before publication. This lets internal draft previews exist without allowing them into accepted team analytics.
- Canonical serialization sorts object keys and sources, and `derivedMetricKey` provides a stable SHA-256 identity.

## Compatibility

The count, percentage, ratio and scalar adapters consume representative current analytics shapes (`{ total, samples }`, `{ won, total }`, `{ value, numerator, denominator, samples }`, and `{ value, samples }`). They return an envelope without changing the source object or persisted record. Callers supply workspace identity, calculation version and any available S0.1 references.

Current analytics do not yet emit envelopes directly. S0.3 defines stable signal identifiers, and S1 becomes the first workflow consumer. Legacy outputs without source references remain explicitly `unreferenced` and cannot pass the accepted-only gate.

Envelopes are intentionally not added to generic persisted/public data. Portable imports continue to carry their existing records; workspace-bound envelopes must be recomputed in the destination workspace.
