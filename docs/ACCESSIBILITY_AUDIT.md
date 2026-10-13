# Accessibility audit

Audit date: 13 October 2026 (`Africa/Cairo`).

## Scope and standard

The production bundle was tested against automated WCAG 2.2 Level A and AA rules using axe-core in Chrome/Edge. Six surfaces were audited:

- desktop player login
- desktop coach login
- desktop authenticated summary
- mobile player login
- mobile coach login
- mobile authenticated summary

## Result

All six surfaces passed with zero axe-core violations. The audit initially found invalid tab semantics on the login selector; the controls now expose `role="tab"` within their tab list, and the complete audit passes after the correction.

The audit is repeatable with `npm run test:a11y` and is enforced as a gate in the signed Windows release workflow.

## Manual boundary

Automated conformance does not replace testing with people who use assistive technology. Screen-reader usability, cognitive accessibility, and real-device zoom/OS high-contrast behavior should still be evaluated on the second physical acceptance PC before declaring independently certified accessibility.
