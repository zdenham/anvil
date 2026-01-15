# 04: Visual Differentiation

## Goal

Make it instantly obvious which instance of Mort you're using to prevent confusion.

## Design: Build-Time Suffix

The `APP_SUFFIX` is baked at build time (see 01-build-configuration.md) and drives visual differentiation throughout the app.

| Suffix | Display Name | Icon | Spotlight Color |
|--------|--------------|------|-----------------|
| _(none)_ | Mort | Standard | Dark gray |
| `dev` | Mort Dev | Purple-tinted | Purple tint |
| `canary` | Mort Canary | Orange-tinted | Orange tint |

## Differentiation Points

### 1. App Icon

**Production**: Current icon (standard branding)
**Other instances**: Modified icon with visual distinction

Options:
- **Color shift**: Purple/blue tint overlay
- **Badge**: Small text badge in corner (e.g., "DEV")
- **Border**: Colored border around icon
- **Invert**: Inverted color scheme

**Files needed** (`src-tauri/icons-dev/`):
```
icons-dev/
├── 32x32.png
├── 128x128.png
├── 128x128@2x.png
├── icon.icns
├── icon.ico
└── icon.png
```

**Generation approach**:
1. Export current icons from Figma/source
2. Apply color transformation (suggest: shift hue to purple/orange)
3. Optionally add text overlay
4. Generate all required sizes

**Quick script approach** (ImageMagick):
```bash
# Create dev icons with purple tint
for f in src-tauri/icons/*.png; do
  convert "$f" -modulate 100,100,150 "src-tauri/icons-dev/$(basename $f)"
done

# Recreate .icns for macOS
iconutil -c icns src-tauri/icons-dev/icon.iconset -o src-tauri/icons-dev/icon.icns
```

### 2. App Name (Build-Time)

Set in Tauri config overlay per instance:

**`src-tauri/tauri.conf.dev.json`**:
```json
{
  "productName": "Mort Dev",
  "app": {
    "windows": [
      {
        "title": "Mort Dev"
      }
    ]
  }
}
```

### 3. Window Titles (Runtime)

Each panel should reflect the instance using the baked suffix:

**`src-tauri/src/panels.rs`**:
```rust
use crate::build_info;

fn panel_title(base: &str) -> String {
    let suffix = build_info::display_suffix();
    if suffix.is_empty() {
        base.to_string()
    } else {
        format!("{}{}", base, suffix)
    }
}

// Usage:
let title = panel_title("Spotlight");
// Production: "Spotlight"
// Dev build: "Spotlight Dev"
```

Note: `build_info::display_suffix()` returns " Dev", " Canary", etc. with proper capitalization (see 01-build-configuration.md).

### 4. Spotlight Background Color

The most visible differentiation - color the spotlight panel background based on instance.

**`src/components/spotlight/spotlight.tsx`** (or wherever the spotlight container is):

```typescript
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

// In the component:
const [appSuffix, setAppSuffix] = useState('');

useEffect(() => {
  invoke<PathsInfo>('get_paths_info').then(info => {
    setAppSuffix(info.app_suffix);
  });
}, []);

// Apply to container
<div className={cn(
  "spotlight-container",
  appSuffix && `spotlight-${appSuffix}`  // e.g., "spotlight-dev"
)}>
```

**CSS** (`src/styles/spotlight.css` or globals):

```css
/* Production - default dark background */
.spotlight-container {
  background: rgba(20, 20, 25, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

/* Dev instance - purple tint */
.spotlight-dev {
  background: rgba(45, 25, 60, 0.95);
  border: 1px solid rgba(139, 92, 246, 0.3);
}

/* Or use CSS variable approach */
:root {
  --spotlight-bg: rgba(20, 20, 25, 0.95);
  --spotlight-border: rgba(255, 255, 255, 0.1);
}

:root[data-app-suffix="dev"] {
  --spotlight-bg: rgba(45, 25, 60, 0.95);
  --spotlight-border: rgba(139, 92, 246, 0.3);
}

/* Feature builds - orange tint */
:root[data-app-suffix="feature"] {
  --spotlight-bg: rgba(60, 35, 20, 0.95);
  --spotlight-border: rgba(249, 115, 22, 0.3);
}
```

**Alternative: Dynamic color from suffix**:

```typescript
// Generate consistent color from suffix string
function getSuffixColor(suffix: string): string {
  if (!suffix) return 'rgba(20, 20, 25, 0.95)';

  // Simple hash to hue
  let hash = 0;
  for (let i = 0; i < suffix.length; i++) {
    hash = suffix.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;

  return `hsla(${hue}, 40%, 15%, 0.95)`;
}
```

### 5. Small UI Badge

Add visual cues within the app UI.

**Global indicator component** (`src/components/ui/BuildModeIndicator.tsx`):
```typescript
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface PathsInfo {
  data_dir: string;
  config_dir: string;
  app_suffix: string;
  is_alternate_build: boolean;
}

export function BuildModeIndicator() {
  const [suffix, setSuffix] = useState<string>('');

  useEffect(() => {
    invoke<PathsInfo>('get_paths_info').then(info => {
      setSuffix(info.app_suffix);
    });
  }, []);

  if (!suffix) return null;

  return (
    <div className="fixed bottom-2 right-2 px-2 py-1 bg-purple-500 text-white text-xs rounded opacity-75">
      {suffix.toUpperCase()}
    </div>
  );
}
```

**Via CSS variable**:
```css
/* Set by JS on load based on app_suffix */
:root[data-app-suffix]:not([data-app-suffix=""]) {
  --accent-color: #8b5cf6;  /* Purple for non-production */
  --header-bg: #1e1b4b;     /* Darker purple tint */
}
```

**Initialize in app root**:
```typescript
// src/App.tsx or similar
useEffect(() => {
  invoke<PathsInfo>('get_paths_info').then(info => {
    if (info.app_suffix) {
      document.documentElement.dataset.appSuffix = info.app_suffix;
    }
  });
}, []);
```

### 6. Dock Icon Badge (macOS)

Tauri supports dock badge text:

**`src-tauri/src/lib.rs`**:
```rust
#[cfg(target_os = "macos")]
fn set_dock_badge(app: &AppHandle) {
    if let Ok(suffix) = std::env::var("MORT_APP_SUFFIX") {
        if !suffix.is_empty() {
            // Tauri 2.0 API for dock badge
            // app.set_badge_label(Some(suffix.to_uppercase()));
        }
    }
}
```

### 7. Menu Bar

The app name in menu bar comes from `productName` in Tauri config, set at build time.

## Differentiation Summary

| Element | Production | With Suffix |
|---------|------------|-------------|
| App Icon | Standard | Tinted/badged |
| Dock Name | Mort | Mort {Suffix} |
| Window Titles | "Spotlight" | "Spotlight ({Suffix})" |
| **Spotlight Background** | Dark gray | Purple/colored tint |
| Menu Bar | Mort | Mort {Suffix} |
| In-app Badge | None | "{SUFFIX}" indicator |
| Accent Color | Default | Purple tint |

## Files to Create

| File | Purpose |
|------|---------|
| `src-tauri/icons-dev/*` | Dev build icon set |
| `src/components/ui/BuildModeIndicator.tsx` | In-app indicator |

## Files to Modify

| File | Change |
|------|--------|
| `src-tauri/tauri.conf.dev.json` | Product name, icon paths |
| `src-tauri/src/panels.rs` | `panel_title()` function |
| `src/App.tsx` or layout | Add BuildModeIndicator, set CSS var |
| `src/styles/globals.css` | App-suffix CSS variables |

## Verification

1. Build production and a dev instance
2. Install both
3. Check Dock shows different icons and names
4. Open spotlight on each - titles should differ
5. Check in-app UI shows badge on non-production
6. Screenshot both side-by-side for confirmation
