# Hybrid replay ingestion

## Safe default: local evidence

The Windows collector defaults to `local-evidence`. It hashes the stable `.vrf`, checks the owned and pinned `MoeAZack/vrfkit` v0.2.6-moe.1 executable and `build-info.json`, runs vrfkit and the checked-in normalizer locally, validates the bounded schema, and hashes the evidence envelope. The API revalidates its claimed parser identity, source SHA-256, original size, device binding, provenance, structure, and envelope checksum. This is **device-attested evidence**, not cryptographic proof that an uncompromised parser produced it: a compromised enrolled device can forge content and recompute the checksum. Coach review is the trust boundary. A successful submission creates a **coach-review draft**; it never accepts a match or rating automatically.

Configure all three absolute runtime paths before approving an upload:

```powershell
node .\scripts\replay-collector.mjs configure --vrfkit-binary "C:\Tools\vrfkit\vrfkit.exe" --python "C:\Python312\python.exe" --normalizer "C:\MoeTracker\scripts\normalize-vrfkit-export.py" --local-evidence
```

If any runtime component or pin is absent, the collector fails closed. It does not silently switch to raw mode.

## Raw fallback removed

The coach-only raw fallback, which uploaded `.vrf` files to a Google Cloud
Storage bucket, was removed on 22 October 2026. Its `raw/initiate` and
`raw/finalize` routes answer 410, a collector configured for it migrates to
`local-evidence`, and a queued job that still points at a raw object fails with
a message to import the replay again from the PC that recorded it. Replays are
only processed on the PC that recorded them.
