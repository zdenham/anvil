# Open Source Audit Plan

Prepare the codebase for public release as "anvil" in a new GitHub repo, preserving git history from Jan 15, 2026 onward.

## Phases

- [ ] Rotate all exposed credentials (pre-Jan-15 secrets are burned)

- [ ] Create new "anvil" repo with transplanted history (Jan 15+ only)

- [ ] Strip large artifacts from transplanted history

- [ ] Clean working tree (sensitive files, internal references)

- [ ] Complete mort→anvil rename (resolve TODO(anvil-rename) markers)

- [ ] Remove internal/strategic content from plans/

- [ ] Add LICENSE and update README for public release

- [ ] Final verification pass

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## CRITICAL: Credentials Exposed in Git History

These credentials exist in plaintext in commits **before Jan 15** — they are burned and must be rotated regardless:

| Credential | Location (historical) | Commit | Date |
| --- | --- | --- | --- |
| Anthropic API Key #1 | `.env` | `cfe76bc` | 2025-11-27 |
| Anthropic API Key #2 | `.env` | `fc032e5` | 2026-01-14 |
| Cloudflare User API Token | `.env` | `f0d19e6` | 2026-01-13 |
| Cloudflare API Token | `.env` | `0a0c4e4` | 2026-01-14 |
| Cloudflare Account ID | `.env` | `f0d19e6` | 2026-01-13 |
| Apple ID + password (`shuying@altera.al`) | `secrets/` | Verify not committed |  |
| Apple cert password | `secrets/` | Verify not committed |  |
| ClickHouse password | `server/.env` | Verify not committed |  |

**All of these predate Jan 15 and will NOT appear in the new repo's history.** Still must be rotated since the old repo existed.

## Git History Strategy

**Approach: Transplant post-Jan-15 history into a new "anvil" repo using** `git filter-repo`**.**

**Target repo:** `https://github.com/zdenham/anvil.git` (GitHub, `zdenham` org)

### Why Jan 15 cutoff works

- **174 of 427 commits** are after Jan 15 — preserves the meaningful development history
- All 5 known secret-leaking commits (`cfe76bc`, `fc032e5`, `f0d19e6`, `0a0c4e4`) are **before** Jan 15
- First included commit: `d2012c4` (2026-01-15, "mark plan unread")

### Large artifacts to strip from post-Jan-15 history

These blobs exist in post-Jan-15 commits and must be removed during the transplant:

| File | Commit | Date | Size |
| --- | --- | --- | --- |
| `agents/mort-agents-0.0.1.tgz` | `89c12ed` | 2026-03-05 | \~44MB |
| `dist-web/` (3 commits) | `1a8d847`, `b95a7f0`, `56304ce` + others | 2026-03-03–03-14 | \~3.1MB |
| `playwright-report/index.html` | Various | Various | \~541KB |

### Execution steps

1. Clone the repo locally

2. Use `git filter-repo` to:

   - Remove all commits before Jan 15, 2026
   - Strip `agents/mort-agents-0.0.1.tgz`, `dist-web/`, `playwright-report/`
   - Strip any `.env`, `server/.env`, `secrets/` paths (belt-and-suspenders)

3. Set remote and push to `https://github.com/zdenham/anvil.git`:

   ```bash
   git remote add origin https://github.com/zdenham/anvil.git
   git branch -M main
   git push -u origin main
   ```

   **Note:** The repo will already have an initial `README.md` commit from GitHub setup — force-push will replace it with the filtered history.

4. Verify: scan the new repo for secrets with `trufflehog` or `gitleaks`

## Sensitive Files in Working Tree

### Currently gitignored (verify they stay excluded)

- `.env` — Anthropic keys, Cloudflare tokens, log server URL
- `server/.env` — ClickHouse credentials
- `secrets/` — Apple developer credentials, signing keys, certificates
- `.claude/settings.local.json` — Contains embedded Anthropic API key and Cloudflare tokens in permission allow-lists

### Files to add to .gitignore

- `.claude/settings.local.json` — currently NOT gitignored, contains API keys in bash command allow-lists

### Files to clean up before release

| File | Issue | Action |
| --- | --- | --- |
| `README.md:7-12` | "Internal Distribution" section with R2 bucket URL | Rewrite with public install instructions |
| `README.md:28-29` | Placeholder text ("hello world", "pineapple") | Remove |
| `scripts/internal-build.sh` | Hardcoded R2 bucket paths, internal distribution logic | Remove or generalize |
| `scripts/installation/distribute_internally.sh` | Internal distribution script with R2 URLs | Remove or generalize |
| `scripts/SIGNING_SETUP.md` | References to `shuying@altera.al`, [Altera.al](http://Altera.al) Inc. | Generalize |
| `server/deployment.md` | References `fundamental-research-labs` [Fly.io](http://Fly.io) org, `mort-server` | Generalize |
| `docs/fly-redis.md` | References `mort-redis` internal [Fly.io](http://Fly.io) app | Generalize |

## Internal Infrastructure URLs (TODO(anvil-rename))

These already have `// TODO(anvil-rename)` markers — complete the rename before release:

| File | Line | Value | Notes |
| --- | --- | --- | --- |
| `src/lib/constants.ts` | 3 | `https://mort-server.fly.dev` | Gateway base URL |
| `src-tauri/src/identity.rs` | 6 | `https://mort-server.fly.dev/identity` | Identity server |
| `src-tauri/src/logging/config.rs` | 20 | `https://mort-server.fly.dev/logs` | Log server |
| `src-tauri/src/shell.rs` | 10 | R2 bucket URL for install script | Internal distribution |
| `src-tauri/capabilities/default.json` | 106 | `https://mort-server.fly.dev/*` | HTTP scope |
| `server/fly.toml` | 7 | `app = 'mort-server'` | [Fly.io](http://Fly.io) app name |
| `redis/fly.toml` | 2 | `app = 'mort-redis'` | [Fly.io](http://Fly.io) app name |

**Decision:** Complete the rename to `anvil-server` / `anvil-redis` before release, since the new repo is called "anvil" anyway.

## Plans Directory — Content to Exclude

| Path | Concern | Action |
| --- | --- | --- |
| `plans/completed/presentation-outline.md` | Business strategy, competitive positioning, pricing | **Remove** |
| `plans/deep-sea-novel/` | Personal creative writing project | **Remove** |
| `plans/open-source-audit.md` (this file) | Internal audit of what to remove | **Remove before release** |
| `plans/completed/` (all) | Internal decision logs, architecture discussions | **Review each** |
| `plans/` (active plans) | Development plans, feature roadmaps | **Review each** |

## Licensing

- **No LICENSE file exists** — must add one before open-sourcing
- **No license field** in `package.json` (all marked `"private": true"`)
- All dependencies are from public registries (npm, [crates.io](http://crates.io)) — no private deps
- One git dependency: `tauri-nspanel` from public GitHub repo (pinned to branch, not tag)

**Action:** Choose a license (MIT, Apache 2.0, etc.), add LICENSE file, update package.json.

## Author/PII

- Git commits authored by `Zac Denham <zdenham1@gmail.com>` — decide if this should remain or be anonymized
- `shuying@altera.al` in Apple signing docs — remove before release
- Company name "[Altera.al](http://Altera.al) Inc." in signing identity references — remove or decide if public

## Summary Checklist

- [ ] Rotate: Anthropic API keys (x2)

- [ ] Rotate: Cloudflare API tokens (x2) + review account ID exposure

- [ ] Rotate: ClickHouse password

- [ ] Rotate: Apple app-specific password

- [ ] Create new "anvil" repo on GitHub — already at `https://github.com/zdenham/anvil.git`

- [ ] Transplant post-Jan-15 history with `git filter-repo`, stripping large blobs and secret paths, force-push to `zdenham/anvil`

- [ ] Scan new repo with `trufflehog` / `gitleaks` to verify no secrets leaked

- [ ] Add `.claude/settings.local.json` to `.gitignore`

- [ ] Clean [README.md](http://README.md) (remove internal distribution, placeholder text)

- [ ] Remove or generalize `scripts/internal-build.sh` and `distribute_internally.sh`

- [ ] Generalize `server/deployment.md`, `docs/fly-redis.md`, `scripts/SIGNING_SETUP.md`

- [ ] Complete `TODO(anvil-rename)` — rename all `mort-server` / `mort-redis` URLs

- [ ] Review and clean `plans/` directory (remove presentation-outline, novel, this file)

- [ ] Add LICENSE file

- [ ] Update `package.json` license fields, remove `"private": true` if appropriate

- [ ] Final scan for any remaining secrets/PII