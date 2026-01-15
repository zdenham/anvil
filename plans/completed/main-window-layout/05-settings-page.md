# Settings Page Components

## Files

- `src/components/main-window/settings-page.tsx`
- `src/components/main-window/settings-section.tsx`
- `src/components/main-window/settings/hotkey-settings.tsx`
- `src/components/main-window/settings/api-key-settings.tsx`
- `src/components/main-window/settings/repository-settings.tsx`
- `src/components/main-window/settings/about-settings.tsx`

## Purpose

Settings container with sections for hotkey, API key, repositories, and about info.

---

## SettingsPage

### Implementation

```typescript
import { HotkeySettings } from "./settings/hotkey-settings";
import { ApiKeySettings } from "./settings/api-key-settings";
import { RepositorySettings } from "./settings/repository-settings";
import { AboutSettings } from "./settings/about-settings";

export function SettingsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <header className="px-6 py-4 border-b border-slate-800">
        <h2 className="text-lg font-semibold text-slate-100">Settings</h2>
      </header>
      <div className="p-6 space-y-6 max-w-2xl">
        <HotkeySettings />
        <ApiKeySettings />
        <RepositorySettings />
        <AboutSettings />
      </div>
    </div>
  );
}
```

---

## SettingsSection

Reusable wrapper for each settings group.

### Implementation

```typescript
interface SettingsSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <section className="bg-slate-800/30 rounded-lg p-4">
      <h3 className="text-base font-medium text-slate-100 mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-slate-500 mb-4">{description}</p>
      )}
      <div>{children}</div>
    </section>
  );
}
```

---

## HotkeySettings

### Implementation

```typescript
import { Keyboard } from "lucide-react";
import { SettingsSection } from "../settings-section";
import { HotkeyRecorder } from "@/components/onboarding/HotkeyRecorder";

export function HotkeySettings() {
  // TODO: Get current hotkey from store/backend
  const currentHotkey = "Cmd+Shift+Space";

  return (
    <SettingsSection
      title="Global Hotkey"
      description="Keyboard shortcut to open the spotlight"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-300">
          <Keyboard size={16} />
          <kbd className="px-2 py-1 bg-slate-700 rounded text-sm">{currentHotkey}</kbd>
        </div>
        <button className="text-sm text-blue-400 hover:text-blue-300">
          Change
        </button>
      </div>
    </SettingsSection>
  );
}
```

---

## ApiKeySettings

### Implementation

```typescript
import { Key, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { SettingsSection } from "../settings-section";

export function ApiKeySettings() {
  const [showKey, setShowKey] = useState(false);
  // TODO: Get from store
  const apiKey = "sk-ant-...";
  const maskedKey = apiKey.slice(0, 10) + "..." + apiKey.slice(-4);

  return (
    <SettingsSection
      title="Anthropic API Key"
      description="Your API key for Claude"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-300">
          <Key size={16} />
          <code className="text-sm font-mono">
            {showKey ? apiKey : maskedKey}
          </code>
          <button
            onClick={() => setShowKey(!showKey)}
            className="text-slate-500 hover:text-slate-400"
          >
            {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <button className="text-sm text-blue-400 hover:text-blue-300">
          Update
        </button>
      </div>
    </SettingsSection>
  );
}
```

---

## RepositorySettings

### Implementation

```typescript
import { Folder, Plus, Trash2 } from "lucide-react";
import { SettingsSection } from "../settings-section";

export function RepositorySettings() {
  // TODO: Get from workspaces store
  const repositories = [
    { id: "1", path: "/Users/zac/projects/app", name: "app" },
  ];

  return (
    <SettingsSection
      title="Repositories"
      description="Connected code repositories"
    >
      <div className="space-y-2">
        {repositories.map((repo) => (
          <div
            key={repo.id}
            className="flex items-center justify-between py-2 px-3 bg-slate-800/50 rounded"
          >
            <div className="flex items-center gap-2 text-slate-300">
              <Folder size={16} />
              <span className="font-medium">{repo.name}</span>
              <span className="text-xs text-slate-500">{repo.path}</span>
            </div>
            <button className="text-slate-500 hover:text-red-400">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <button className="w-full py-2 px-3 border border-dashed border-slate-700
                          rounded text-slate-500 hover:text-slate-400 hover:border-slate-600
                          flex items-center justify-center gap-2">
          <Plus size={16} />
          Add Repository
        </button>
      </div>
    </SettingsSection>
  );
}
```

---

## AboutSettings

### Implementation

```typescript
import { Info } from "lucide-react";
import { SettingsSection } from "../settings-section";

export function AboutSettings() {
  // TODO: Get from Tauri
  const version = "0.1.0";

  return (
    <SettingsSection title="About">
      <div className="flex items-center gap-2 text-slate-400">
        <Info size={16} />
        <span>Mortician v{version}</span>
      </div>
    </SettingsSection>
  );
}
```

---

## Dependencies

- `lucide-react`
- `@/components/onboarding/HotkeyRecorder` (reuse existing)
- `@/lib/hotkey-service` (getSavedHotkey, saveHotkey)
- `@/entities/repositories` (useRepoStore, repoService)

## Notes

### Authentication Model
The app uses Claude CLI authentication rather than storing API keys directly. The "API Key Settings" section may need to be renamed or repurposed to show Claude CLI auth status instead. Consider:
- Showing if Claude CLI is authenticated
- Link to Claude CLI auth documentation
- Status indicator for API connectivity

### Repository Data
Repository settings should use `repoService.getAll()` to get the actual repository list from the entity store.
