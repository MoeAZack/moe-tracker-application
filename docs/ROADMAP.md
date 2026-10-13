# Delivery roadmap

## Now — functional desktop foundation

- [x] Clean public repository and desktop product identity
- [x] Electron desktop shell with isolated preload bridge
- [x] Local-only application server and atomic local database
- [x] Automatic VALORANT and manual replay-folder discovery
- [x] One-click match processing entry point
- [x] Scoreboard, replay, export, and backup folders
- [x] Portable team export
- [ ] Persist normalized local replay evidence before any upload
- [ ] Local review inbox and identity overlay
- [ ] Import/export `.moetracker` packages with integrity hashes

## Next — reliable team synchronization

- [ ] Simple team pairing code for player and coach devices
- [ ] Durable local outbox with retry and idempotency keys
- [ ] Cloud summary contract and replay-hash deduplication
- [ ] Coach acceptance on any authorized coach device
- [ ] Website reduced to accepted statistics and basic team information
- [ ] Sync status, conflict review, and offline indicators

## Then — polished Windows release

- [ ] Background tray behavior and automatic startup option
- [ ] Automatic update channel with rollback
- [ ] Configurable 30-day replay retention and storage budget
- [ ] Encrypted scheduled local backups
- [ ] Windows installer acceptance on a clean machine
- [ ] Mobile/browser/accessibility acceptance for the web summary portal

## Later

- [ ] Official Riot opt-in/API integration if the product is approved
- [ ] Optional coach-requested temporary raw upload
- [ ] Clip extraction from locally available VOD/replay evidence
- [ ] Never: process-memory inspection, injection, or live unfair assistance
