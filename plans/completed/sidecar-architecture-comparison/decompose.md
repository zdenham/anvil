# decompose (aquamarine-lamprey)

**Philosophy:** Most ambitious — complete modular rewrite with web-first thinking.

## Unique Decisions

- `registerDispatcher()` **Map pattern** — dynamic dispatcher registration, most extensible routing
- **Browser dialog shims** — `<input type="file">` for file picker, `window.prompt()` for directories (best UX)
- **Vite alias swaps** — shims injected at build time via resolve.alias, not runtime detection
- `dist-web/` **as Express static fallback** — serves compiled frontend from sidecar
- `tsup` **build** (esbuild-based) instead of tsc — faster builds
- **Port file polling in Rust** — 15s timeout, 100ms interval (only impl with readiness check)
- **Typed extractors** — `extractString()`, `extractNumber()` instead of generic `extractArg<T>()`

## Strengths

- Most commands implemented (\~100)
- Best dialog shims (actual browser file picker)
- Most modular command organization (18 command files)
- Only implementation with Rust-side readiness check
- Typed argument extraction (catches type errors earlier)

## Weaknesses

- **SHOWSTOPPER: Port file hash mismatch** — Rust uses `DefaultHasher` (SipHash), Node uses SHA-256. They will never produce the same hash. The Rust readiness check times out and kills the running sidecar.
- **22 MB committed** `dist-web/` — 2,704 build artifacts in git
- **All sync I/O** — `readFileSync`, `writeFileSync`, `execSync` throughout. Blocks event loop for ALL clients.
- `child.pid!` non-null assertion — `spawn()` can return undefined pid
- `fs_grep` iterates directories for literal filename match, not glob