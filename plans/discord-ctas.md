# Discord Community CTAs

Add CTAs across the app and landing page to drive users to the Discord: `https://discord.gg/tbkAetedSd`

## Phases

- [x] Add dedicated Discord step to onboarding flow

- [x] Add Discord CTA to guide content (in-app)

- [x] Add Discord CTA to about settings

- [x] Add Discord CTA to landing page footer

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Dedicated Discord Onboarding Step

**Goal:** Add a new onboarding step between `welcome` and `repository` that strongly encourages users to join the Discord. The step is skippable (user can click "Continue" without joining), but the primary CTA should be prominent and compelling.

### New file: `src/components/onboarding/steps/DiscordStep.tsx`

Create a new step component following the same pattern as `WelcomeStep.tsx` and `RepositoryStep.tsx`.

**Design:**

- Headline: "Join the Community"
- Short copy explaining the value — get help, share what you're building, shape the product
- Large, prominent "Join Discord" button that opens the invite link via `openUrl` from `@tauri-apps/plugin-opener`
- After the user clicks the Discord button, show a subtle confirmation state (checkmark + "See you in there!") — but don't gate progression on it
- The "Continue" button in the OnboardingFlow footer always works regardless — this IS the skip mechanism, no separate skip button needed

```tsx
import { useState } from "react";
import { MessageCircle, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

export const DiscordStep = () => {
  const [hasClicked, setHasClicked] = useState(false);

  const handleJoinDiscord = async () => {
    await openUrl("https://discord.gg/tbkAetedSd");
    setHasClicked(true);
  };

  return (
    <div data-testid="onboarding-step-discord" className="space-y-6">
      <div className="space-y-2">
        <MessageCircle size={40} className="text-surface-300" />
        <h2 className="text-2xl font-bold text-surface-100 font-mono">
          Join the Community
        </h2>
        <p className="text-lg text-surface-300">
          Get help, share what you're building, and help shape where Anvil goes next.
        </p>
      </div>

      <button
        onClick={handleJoinDiscord}
        className="inline-flex items-center gap-3 px-5 py-3 text-base font-medium text-white bg-[#5865F2] hover:bg-[#4752C4] rounded-lg transition-colors"
      >
        <ExternalLink size={18} />
        Join the Anvil Discord
      </button>

      {hasClicked && (
        <p className="text-sm text-surface-400">
          ✓ See you in there! You can always find the link in Settings too.
        </p>
      )}
    </div>
  );
};
```

**Notes on the Discord button color:** `#5865F2` is the official Discord blurple. This makes the button visually distinct from the rest of the onboarding UI, drawing the eye. `#4752C4` is the hover variant.

### Changes to `src/components/onboarding/OnboardingFlow.tsx`

1. **Add** `'discord'` **to** `OnboardingStepName`**:**

   ```typescript
   type OnboardingStepName = 'welcome' | 'discord' | 'repository';
   ```

2. **Import the new step:**

   ```typescript
   import { DiscordStep } from "./steps/DiscordStep";
   ```

3. **Update step navigation** — the flow becomes `welcome → discord → repository`:

   - `handleNext`: `welcome` → `discord`, `discord` → `repository`, `repository` → complete
   - `handleBack`: `repository` → `discord`, `discord` → `welcome`
   - `canProceed`: `discord` → always `true` (skippable)

4. **Update progress indicators:**

   - `totalSteps` → `3`
   - Step numbers: welcome=1, discord=2, repository=3

5. **Update** `renderStepContent` to include the discord case:

   ```typescript
   case 'discord':
     return <DiscordStep />;
   ```

6. **Update** `getButtonText`**:**

   - When on `discord` step, show `"Continue ↵"` (not "Skip" — we want the default path to feel like progression, not opting out)

7. **Update Enter key handler** to handle the new step transition.

### Why a dedicated step instead of a mention on the welcome step

The welcome step should stay focused ("here's Anvil, ready?"). A dedicated step gives Discord its own moment without cluttering other steps. The step is inherently skippable because the Continue button always works — no extra "Skip" UI needed. This keeps the UX clean while maximizing Discord conversion.

## Phase 2: Guide Content — Community Section

**File:** `src/components/content-pane/guide-content.tsx`

Add a new "Community" section at the bottom of the guide (after the Modes section, before the conditional Get Started block). This is the most-seen surface — it shows in every new/empty tab.

```tsx
<Divider />
<section className="mb-6">
  <h2 className="text-sm font-medium font-mono text-surface-300 uppercase tracking-wider mb-2">
    Community
  </h2>
  <p className="text-sm text-surface-400 mb-3">
    Got a question, idea, or just want to see what others are building?
  </p>
  <button
    onClick={() => openUrl("https://discord.gg/tbkAetedSd")}
    className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-surface-100 bg-surface-700 hover:bg-surface-600 rounded-md transition-colors"
  >
    Join the Discord →
  </button>
</section>
```

**Note:** Use `openUrl` from `@tauri-apps/plugin-opener` for external links in Tauri. Check how `markdown-renderer.tsx` or `spotlight-settings.tsx` handle this for the import pattern.

## Phase 3: About Settings — Community Link

**File:** `src/components/main-window/settings/about-settings.tsx`

Add a Discord link row below the existing version/update row inside the `<SettingsSection>`. Keep it lightweight — a single row with an icon and link text.

```tsx
<div className="flex items-center justify-between mt-3 pt-3 border-t border-surface-700/50">
  <div className="flex items-center gap-2 text-surface-400">
    <MessageCircle size={16} />
    <span>Community</span>
  </div>
  <button
    onClick={() => openUrl("https://discord.gg/tbkAetedSd")}
    className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-surface-100 bg-surface-700 hover:bg-surface-600 rounded-md transition-colors"
  >
    <ExternalLink size={14} />
    <span>Discord</span>
  </button>
</div>
```

Import `MessageCircle` and `ExternalLink` from lucide-react, `openUrl` from `@tauri-apps/plugin-opener`.

## Phase 4: Landing Page Footer

**File:** `landing/src/App.tsx`

Add a footer section after the FeatureGrid section. The landing page is a standalone Vite app (no Tauri), so standard `<a>` tags work fine.

```tsx
{/* Footer */}
<footer className="w-full max-w-3xl px-6 pb-12 pt-4 border-t border-surface-800">
  <div className="flex items-center justify-center gap-6 text-sm text-surface-500">
    <a
      href="https://discord.gg/tbkAetedSd"
      target="_blank"
      rel="noopener noreferrer"
      className="hover:text-surface-300 transition-colors"
    >
      Discord
    </a>
    <a
      href="https://github.com/juice-sh/anvil"
      target="_blank"
      rel="noopener noreferrer"
      className="hover:text-surface-300 transition-colors"
    >
      GitHub
    </a>
  </div>
</footer>
```

**Note:** Confirm the correct GitHub URL before implementing. The GitHub link is optional if the repo isn't public yet — Discord alone is fine.

## Implementation Notes

- **Discord invite link:** `https://discord.gg/tbkAetedSd` — use this everywhere
- **Opening URLs in Tauri:** Use `openUrl` from `@tauri-apps/plugin-opener` for in-app links. The landing page (standalone Vite) can use normal `<a>` tags.
- **Discord blurple:** `#5865F2` (primary), `#4752C4` (hover) — use on the onboarding CTA button to make it pop
- **No Discord icon needed** — lucide-react doesn't have one. Use `MessageCircle` or just text. A custom SVG Discord icon could be added later if desired.
- **Tone:** Friendly and casual, not pushy. "Join the Community" for onboarding, "Join the Discord" elsewhere. The onboarding step should feel like a natural part of setup, not an interruption.