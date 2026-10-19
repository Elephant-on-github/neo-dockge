# Security Waivers — neo-dockge 1.6.0

Release gate: `npm audit --omit=dev` must be clean. As of 2026-10-19, 10 advisories
cannot be cleared without replacing upstream libraries. Per the design spec
(Constraints → "Audit release gate"), each is documented here with an open tracking
issue rather than shipped silently. All are cleared to zero by bumping direct deps
except the two chains below.

Superseded this release: the `tar` critical (CVE-class hardlink/symlink path
traversal) under `@louislam/sqlite3` was fixed by an npm `overrides` pin to
`tar@^7.5.22` (verified: sqlite3 still loads its native binding). The chains below
have no patched version published at any level.

## Chain 1 — `@inventage/envsubst` glob tooling (5 × high)

`@inventage/envsubst` → `globby` → `fast-glob` → `braces` / `micromatch`

- Advisories: DoS classes (braces stack-exhaustion via deeply nested patterns;
  fast-glob/globby/micromatch related DoS). `npm audit` reports `range: *` /
  `<=3.0.3` — i.e. **every published version is affected; no fix exists yet**.
- Reachability in dockge: these run only when envsubst expands *file-glob* variable
  patterns. dockge uses envsubst for `${VAR}` string interpolation in compose/env
  files, not attacker-supplied globs. A successful DoS requires an authenticated user
  to already control stack content. Impact is a hung request, not RCE or data loss.
- Tracking issue: #3 — "Waiver: envsubst/globby DoS chain — recheck for patched release"
- Clear when: a patched `braces`/`micromatch`/`fast-glob`/`globby` lands; re-run
  `npm audit --omit=dev` and drop this section.

## Chain 2 — `@louislam/sqlite3` install-time tooling (5 × low)

`@louislam/sqlite3` → `@mapbox/node-pre-gyp` → `node-gyp` → `make-fetch-happen` →
`http-proxy-agent` → `@tootallnate/once`

- Advisories: low severity. These packages are **build-time only** — used by
  `node-pre-gyp` to download/compile sqlite3's native binary during `npm ci` in the
  Docker image build. They are not in the runtime request path of a running dockge.
- `@louislam/sqlite3@15.1.6` is already the latest published version (upstream's own
  maintained fork); no newer release exists to pull a fixed toolchain.
- Tracking issue: #4 — "Waiver: sqlite3 install-time toolchain (node-gyp chain) — low"
- Clear when: upstream `@louislam/sqlite3` bumps its node-pre-gyp/tar toolchain, or
  dockge migrates off sqlite3 (partner escalation per spec).

## Not waived — cleared by dependency bumps this release

Fixed by moving direct deps to current versions: `express` → 4.22.3 (body-parser,
path-to-regexp, qs, proxy-addr), `mysql2` → 3.24.6 (auth-plugin downgrade, zlib bomb),
`socket.io`/engine.io/ws family, `redbean-node` → 0.4.0 (glob, lodash),
`@inventage/envsubst` → 0.17.0, plus `tar` (critical) via override. Express stays on
4.x per spec §Decision 7 (5.x is a larger migration, deferred).
