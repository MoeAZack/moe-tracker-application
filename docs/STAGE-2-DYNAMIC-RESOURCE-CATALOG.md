# Stage 2 — dynamic map, agent and weapon catalog

Completed 20 October 2026 (Africa/Cairo). Installation was intentionally skipped: the owner confirmed that the current workspace is disposable validation data and requested installation only when a physical runtime gate needs it.

## Contract

`lib/resourceCatalog.ts` is the shared runtime catalog for maps, agents and weapons. It merges configured active resources, explicitly disabled resources and names observed in retained evidence without deleting history.

- Configured names determine the canonical display spelling.
- Matching is case-insensitive, preventing `summit` and `Summit` from becoming separate rows.
- Disabled maps and agents disappear from current selectors, statistics and compositions while retained matches remain readable.
- A newly configured map or agent immediately receives an empty analytics/composition row; evidence is not required first.
- The weapon catalog includes Warden and supplies one deterministic local artwork path for every resource.
- Missing artwork degrades to a labelled initials tile rather than a broken or invisible control.

The catalog now feeds match entry, VOD map discovery, match editing, map analysis, the best-map calculator, compositions, economy-by-map and all map/agent/weapon media tiles.

## Validation

- 117 automated test files and 796 tests passed.
- Production web/server build passed.
- New tests cover a zero-evidence Summit row, case-insensitive custom agents, disabled historical resources, Warden and KAY/O asset resolution.
- `npm run stage2:audit -- --db <workspace-db>` performs a non-writing catalog audit against disposable real data.

The installed disposable workspace resolved 12 active maps (2 observed), 29 active agents (10 observed), and 21 active weapons (20 observed). Warden was both observed and resolved to its active catalog entry and local artwork. One OCR artifact, `Wardsan`, was retained as inactive historical evidence rather than promoted into analytics; this is the intended fail-closed behavior.

## Exit gate

- [x] One catalog and normalization rule across selectors and analytics.
- [x] New maps propagate before evidence exists.
- [x] New agents propagate and disabled agents leave current analysis.
- [x] Warden is a first-class full-buy weapon with local artwork.
- [x] Historical evidence remains readable after rotation/disable actions.
- [x] Unknown artwork has a coherent fallback.
- [x] Full automated suite and production build pass.
