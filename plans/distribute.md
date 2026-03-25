# Distribution Pipeline Overhaul

Rename "distribute internally" → "distribute" and make it the public distribution mechanism. Upload both DMG and .app zip, create a new `anvil` R2 bucket, and add a download button to the landing page.

## Context

**Current state:**

- Build script: `scripts/internal-build.sh` → uploads `{version}.zip` (zipped .app) to `mort-builds` R2 bucket
- Install script: `scripts/installation/distribute_internally.sh` → curls zip from R2, extracts to `/Applications`
- In-app update: `src-tauri/src/shell.rs` → fetches `distribute_internally.sh` from R2
- Landing page: `landing/src/App.tsx` → no download button
- Tauri already produces a DMG at `src-tauri/target/release/bundle/dmg/Anvil_{semver}_aarch64.dmg`
- npm script: `"release:internal": "./scripts/internal-build.sh"`
- R2 bucket paths use `mort-builds/` and `mort-installation-scripts/` prefixes

**Target state:**

- New R2 bucket named `anvil` (or `anvil-builds`)
- Both `.zip` (app bundle) and `.dmg` uploaded per version
- Landing page has a download button that reads the version file and links to the DMG
- All naming changed from "internal" to just "distribute"

## Phases

- [x] Phase 1: Create new R2 bucket and update bucket references

- [x] Phase 2: Upload both DMG and zip in build script

- [x] Phase 3: Rename scripts and references from "internal" to "distribute"

- [x] Phase 4: Add download button to landing page

- [x] Phase 5: Update in-app update mechanism

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Create new R2 bucket and update bucket references

**Done.** Bucket `anvil-builds` is live: <https://dash.cloudflare.com/dca0333c01f9e32e6d51431f4f6cab88/r2/default/buckets/anvil-builds>

Public access confirmed at: <https://pub-3bbf8a6a4ba248d3aaa0453e7c25d57e.r2.dev> (returns 404 on empty bucket — publicly reachable).

**New R2 bucket layout:**

```
anvil-builds/
  builds/
    v0.0.82/
      Anvil-v0.0.82.dmg             # DMG installer
      Anvil-v0.0.82.zip             # Zipped .app bundle
  distribute/
    version                          # plain text, e.g. "v0.0.82"
    install.sh                     # Install/update script
```

Note the new structure: versioned subdirectories keep things clean and allow hosting multiple versions if needed.

## Phase 2: Upload both DMG and zip in build script

**File:** `scripts/internal-build.sh` (will be renamed in Phase 3)

Changes:

1. After the zip step (current step 5), locate the DMG that Tauri already produces:

   ```bash
   DMG_PATH="src-tauri/target/release/bundle/dmg/Anvil_${SEMVER_VERSION}_aarch64.dmg"
   ```

2. Rename/copy the DMG to a cleaner name for distribution:

   ```bash
   DIST_DMG_NAME="Anvil-${NEW_VERSION}.dmg"
   cp "$DMG_PATH" "src-tauri/target/release/bundle/dmg/${DIST_DMG_NAME}"
   ```

3. Also rename the zip for consistency:

   ```bash
   DIST_ZIP_NAME="Anvil-${NEW_VERSION}.zip"
   ```

4. Upload both artifacts to the new bucket:

   ```bash
   # Upload DMG
   npx wrangler r2 object put "anvil-builds/releases/${NEW_VERSION}/${DIST_DMG_NAME}" \
     --file="src-tauri/target/release/bundle/dmg/${DIST_DMG_NAME}" \
     --content-type="application/x-apple-diskimage" \
     --remote
   
   # Upload zip
   npx wrangler r2 object put "anvil-builds/releases/${NEW_VERSION}/${DIST_ZIP_NAME}" \
     --file="${ZIP_PATH}" \
     --content-type="application/zip" \
     --remote
   ```

5. Update the version file to the new bucket path:

   ```bash
   npx wrangler r2 object put "anvil-builds/distribute/version" \
     --file="$VERSION_FILE" \
     --content-type="text/plain" \
     --remote
   ```

6. Remove the old `mort-builds` upload commands (or keep temporarily for migration)

## Phase 3: Rename scripts and references from "internal" to "distribute"

### File renames

- `scripts/internal-build.sh` → `scripts/distribute.sh`
- `scripts/installation/distribute_internally.sh` → `scripts/installation/install.sh`

### Reference updates

1. `package.json` — rename npm script:

   ```json
   "release:internal" → "release"
   ```

   (value changes to `"./scripts/distribute.sh"`)

2. `src-tauri/src/shell.rs` — update the script URL:

   ```rust
   let script_url = "https://<NEW_BUCKET_PUBLIC_URL>/distribute/install.sh";
   ```

   Also rename the command from `run_internal_update` → `run_update` and update all references.

3. `README.md` — update the install command:

   ```
   curl -sL https://<NEW_BUCKET_PUBLIC_URL>/distribute/install.sh | bash
   ```

   Change section heading from "Internal Distribution" → "Installation"

4. `scripts/distribute.sh` (the build script) — update the final echo to reference the new URL

5. **Upload the install script** to the new bucket path:

   ```bash
   npx wrangler r2 object put "anvil-builds/distribute/install.sh" \
     --file="scripts/installation/install.sh" \
     --content-type="text/plain" \
     --remote
   ```

6. **Rust callers** — grep for `run_internal_update` in the Tauri commands registration and frontend bindings (`src/lib/tauri-commands.ts`) and update to `run_update`.

## Phase 4: Add download button to landing page

**File:** `landing/src/App.tsx`

Add a download section between the tagline and features:

```tsx
<section className="w-full max-w-2xl px-6 pb-8 flex justify-center">
  <DownloadButton />
</section>
```

**New component:** `landing/src/components/download-button.tsx`

Behavior:

1. On mount, fetch the version file from R2: `GET <BUCKET_URL>/distribute/version`
2. Display a download button that links to the DMG: `<BUCKET_URL>/builds/{version}/Anvil-{version}.dmg`
3. Show the version number on or near the button (e.g. "Download v0.0.82 for macOS")
4. Include a smaller link below for the zip: "or download .app bundle"
5. Handle loading state (version fetch) and error state gracefully

Keep it simple — a direct `<a href>` link, no JS-driven download. The R2 bucket serves the files directly.

## Phase 5: Update in-app update mechanism

**File:** `scripts/installation/install.sh` (renamed install script)

Update the curl URLs to point at the new bucket:

```bash
VERSION=$(curl -sL <BUCKET_URL>/distribute/version)
curl -fL <BUCKET_URL>/builds/${VERSION}/Anvil-${VERSION}.zip -o ~/Downloads/Anvil.zip
```

The in-app updater still uses the zip (not DMG) since it needs to extract programmatically. The DMG is for first-time installs from the website.

Remove all `TODO(anvil-rename)` comments from files touched in this plan since the migration is now complete for these paths.

## Out of scope

- **Old bucket cleanup** — we can keep uploading to `mort-builds` temporarily and remove later once all users have migrated
- **Auto-update (Sparkle/Tauri updater)** — future improvement, not part of this change
- **Windows/Linux** — macOS only for now
- **CDN/custom domain** — using R2 public URL for now, can add a custom domain later

---

## Addendum: Path Naming & Version Reset

The new `anvil-builds` R2 bucket is now created. Three adjustments to the plan above:

### 1. Object path prefixes

The old bucket used `mort-builds/` and `mort-installation-scripts/` as top-level object key prefixes. The new bucket should use cleaner names:

| Old (in `mort-builds` bucket) | New (in `anvil-builds` bucket) |
| --- | --- |
| `mort-builds/{version}.zip` | `builds/{version}/Anvil-{version}.zip` |
| `mort-builds/{version}.zip` | `builds/{version}/Anvil-{version}.dmg` |
| `mort-installation-scripts/version` | `distribute/version` |
| `mort-installation-scripts/distribute_internally.sh` | `distribute/install.sh` |

This means everywhere the plan above says `anvil-builds/releases/...` should instead use `anvil-builds/builds/...` for artifacts and `anvil-builds/distribute/...` for version file and install script.

**Concrete path mapping (updating Phase 1 bucket layout):**

```
anvil-builds/
  builds/
    v0.0.1/
      Anvil-v0.0.1.dmg
      Anvil-v0.0.1.zip
  distribute/
    version                          # plain text, e.g. "v0.0.1"
    install.sh                     # Install/update script
```

### 2. Version reset to 0.0.1

Since this is a fresh distribution under the Anvil name, reset the version to `v0.0.1`. This affects:

- `scripts/internal-build.sh` (→ `scripts/distribute.sh`): The version bump logic currently reads from a version file and increments. For the first release, manually set or seed the version file with `v0.0.1`.
- `package.json`: If there's a `version` field used by the build, set it to `0.0.1`.
- `src-tauri/tauri.conf.json`: The Tauri app version should be `0.0.1` so the DMG filename becomes `Anvil_0.0.1_aarch64.dmg`.
- **R2 version file**: The first upload writes `v0.0.1` to `anvil-builds/builds/version`.

### 3. Upload command corrections

Update the wrangler upload commands in Phase 2 to use the new paths:

```bash
# Upload DMG
npx wrangler r2 object put "anvil-builds/builds/${NEW_VERSION}/Anvil-${NEW_VERSION}.dmg" \
  --file="src-tauri/target/release/bundle/dmg/${DIST_DMG_NAME}" \
  --content-type="application/x-apple-diskimage" \
  --remote

# Upload zip
npx wrangler r2 object put "anvil-builds/builds/${NEW_VERSION}/Anvil-${NEW_VERSION}.zip" \
  --file="${ZIP_PATH}" \
  --content-type="application/zip" \
  --remote

# Upload version file
npx wrangler r2 object put "anvil-builds/distribute/version" \
  --file="$VERSION_FILE" \
  --content-type="text/plain" \
  --remote
```

And the install script upload in Phase 3:

```bash
npx wrangler r2 object put "anvil-builds/distribute/install.sh" \
  --file="scripts/installation/install.sh" \
  --content-type="text/plain" \
  --remote
```

### Files affected by these adjustments

| File | Change |
| --- | --- |
| `scripts/internal-build.sh` | All `r2 object put` paths: `builds/` prefix, version reset |
| `scripts/installation/install.sh` | Fetch URLs: `distribute/version`, `builds/{v}/Anvil-{v}.zip` |
| `src-tauri/src/shell.rs` | Script URL: `.../distribute/install.sh` |
| `README.md` | Install curl URL: `.../distribute/install.sh` |
| `landing/src/components/download-button.tsx` | Fetch `distribute/version`, link to `builds/{v}/Anvil-{v}.dmg` |
| `src-tauri/tauri.conf.json` | Version → `0.0.1` |
| `package.json` | Version → `0.0.1` (if applicable) |
