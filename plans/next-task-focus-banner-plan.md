# Next Task Focus Banner Implementation Plan

## Overview

Add a visual banner that briefly appears at the top of the simple task window when navigation to the next task occurs, providing user feedback that the action was successful.

## Requirements

### Visual Design
- **Position**: Bottom of the simple task window (overlaying the quick actions panel)
- **Content**: Two-line confirmation with previous task completion + next task focus
- **Animation**: Fade in with subtle slide up, pause briefly, then fade out
- **Timing**: ~1.5 second total duration (0.2s in, 1.1s visible, 0.2s out) - snappy but readable
- **Styling**: Centered text with gaussian blur backdrop effect above quick actions

### Technical Requirements
- **Persistence**: Banner must survive task ID changes (not tied to specific thread/task)
- **Global State**: Needs to be triggered from navigation hook but displayed in UI component
- **Animation**: Smooth CSS transitions with proper cleanup
- **Accessibility**: Screen reader friendly announcements

## Implementation Strategy

### 1. Global Banner State Management

**New File**: `src/stores/navigation-banner-store.ts`

```typescript
import { create } from 'zustand';

interface NavigationBannerState {
  isVisible: boolean;
  completionMessage: string;
  nextTaskMessage: string;
  showBanner: (completionMessage: string, nextTaskMessage: string) => void;
  hideBanner: () => void;
}

export const useNavigationBannerStore = create<NavigationBannerState>((set, get) => ({
  isVisible: false,
  completionMessage: '',
  nextTaskMessage: '',

  showBanner: (completionMessage: string, nextTaskMessage: string) => {
    set({ isVisible: true, completionMessage, nextTaskMessage });

    // Auto-hide after 1.5 seconds
    setTimeout(() => {
      get().hideBanner();
    }, 1500);
  },

  hideBanner: () => set({ isVisible: false, completionMessage: '', nextTaskMessage: '' }),
}));
```

### 2. Banner UI Component

**New File**: `src/components/simple-task/navigation-banner.tsx`

```tsx
import { useNavigationBannerStore } from '@/stores/navigation-banner-store';
import { useEffect, useState } from 'react';
import { CheckCircle, ArrowRight } from 'lucide-react';

export function NavigationBanner() {
  const { isVisible, completionMessage, nextTaskMessage } = useNavigationBannerStore();
  const [shouldRender, setShouldRender] = useState(false);

  // Handle mount/unmount for smooth animations
  useEffect(() => {
    if (isVisible) {
      setShouldRender(true);
    } else {
      // Delay unmounting to allow exit animation
      const timer = setTimeout(() => setShouldRender(false), 200);
      return () => clearTimeout(timer);
    }
  }, [isVisible]);

  if (!shouldRender) return null;

  return (
    <div
      className={`
        absolute bottom-0 left-0 right-0 z-50
        flex items-center justify-center pb-4
        transition-all duration-200 ease-out
        ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}
      `}
      role="status"
      aria-live="polite"
    >
      <div className="backdrop-blur-md bg-black/20 text-white px-4 py-3 rounded-lg text-sm font-medium">
        <div className="flex items-center justify-center gap-3">
          <div className="flex items-center gap-2 text-green-300">
            <CheckCircle size={16} />
            <span>{completionMessage}</span>
          </div>
          <ArrowRight size={16} className="text-white/60" />
          <div className="text-white">
            {nextTaskMessage}
          </div>
        </div>
      </div>
    </div>
  );
}
```

### 3. Integration with Navigation Hook

**Update**: `src/hooks/use-navigate-to-next-task.ts`

```typescript
import { useCallback } from "react";
import { useSimpleTaskNavigation } from "./use-simple-task-navigation";
import { useNavigationBannerStore } from "@/stores/navigation-banner-store";

// Helper to get action-specific completion messages
function getCompletionMessage(actionType: 'archive' | 'markUnread' | 'quickAction'): string {
  switch (actionType) {
    case 'archive':
      return 'Task archived';
    case 'markUnread':
      return 'Marked unread';
    case 'quickAction':
      return 'Task skipped';
    default:
      return 'Task completed';
  }
}

export function useNavigateToNextTask(currentTaskId: string) {
  const { getNextUnreadTaskId } = useSimpleTaskNavigation(currentTaskId);
  const { showBanner } = useNavigationBannerStore();

  const navigateToNextTaskOrFallback = useCallback(async (
    options: {
      fallbackToTasksPanel?: boolean;
      actionType?: 'archive' | 'markUnread' | 'quickAction';
    } = {}
  ): Promise<boolean> => {
    const { fallbackToTasksPanel = true, actionType = 'quickAction' } = options;

    // Get next unread task
    const result = await getNextUnreadTaskId(currentTaskId);

    if (result.taskId && result.threadId) {
      // Import openSimpleTask dynamically to avoid circular imports
      const { openSimpleTask } = await import("@/lib/hotkey-service");
      await openSimpleTask(result.threadId, result.taskId);

      // Show success banner with completion confirmation
      const completionMessage = getCompletionMessage(actionType);
      showBanner(completionMessage, "Next task focused");

      return true; // Navigation successful
    }

    // No unread tasks available - fallback to tasks panel if requested
    if (fallbackToTasksPanel) {
      const { showTasksPanel } = await import("@/lib/hotkey-service");
      await showTasksPanel();

      // Show fallback banner
      const completionMessage = getCompletionMessage(actionType);
      showBanner(completionMessage, "Switched to tasks panel");
    }

    return false; // No next task available or fallback occurred
  }, [currentTaskId, getNextUnreadTaskId, showBanner]);

  return {
    navigateToNextTaskOrFallback,
  };
}
```

### 4. Add Banner to Simple Task Window

**Update**: `src/components/simple-task/simple-task-window.tsx`

```typescript
// Add import
import { NavigationBanner } from './navigation-banner';

// Add banner as relative positioned overlay in the main container
return (
  <div className="flex flex-col h-screen bg-surface-900 relative">
    <SimpleTaskHeader
      task={task}
      // ... existing props
    />
    {/* ... existing content */}
    <SuggestedActionsPanel
      // ... existing props
    />

    {/* Banner overlays at bottom */}
    <NavigationBanner />
  </div>
);
```

## Implementation Steps

### Phase 1: Core Infrastructure
- [ ] Create `navigation-banner-store.ts` with Zustand state management
- [ ] Create `NavigationBanner` component with animations
- [ ] Add banner to Simple Task Window layout

### Phase 2: Navigation Integration
- [ ] Update `useNavigateToNextTask` hook to trigger banner with action types
- [ ] Update mark unread action: `navigateToNextTaskOrFallback({ actionType: 'markUnread' })`
- [ ] Update archive action: `navigateToNextTaskOrFallback({ actionType: 'archive' })`
- [ ] Update quick action: `navigateToNextTaskOrFallback({ actionType: 'quickAction' })`
- [ ] Test banner appears with correct completion messages

### Phase 3: Polish & Accessibility
- [ ] Fine-tune animation timing and easing
- [ ] Add proper ARIA labels and screen reader support
- [ ] Add keyboard shortcut to dismiss banner early (ESC key)
- [ ] Test banner behavior across rapid navigation actions

### Phase 4: Enhanced Features (Optional)
- [ ] Add different banner types (success, info, warning)
- [ ] Add task title to banner: "Switched to: [Task Title]"
- [ ] Add subtle sound effect or haptic feedback
- [ ] Add preference to disable banner in settings

## Technical Considerations

### Animation Performance
- Use `transform` properties for smooth GPU-accelerated animations
- Implement proper animation lifecycle to avoid memory leaks
- Handle rapid successive navigations gracefully

### State Management
- Banner state is global but ephemeral (auto-clears)
- Use Zustand for lightweight global state without React Context complexity
- Store survives component unmounts but resets on app restart

### Accessibility
- Use `aria-live="polite"` for screen reader announcements
- Provide keyboard shortcut to dismiss banner early
- Ensure banner doesn't interfere with focus management

### Edge Cases
- **Rapid Navigation**: Subsequent navigation calls should replace current banner
- **Task Loading Delays**: Banner should appear immediately, not wait for task content
- **Navigation Failures**: No banner should appear if navigation fails
- **Banner Overlap**: Ensure banner doesn't interfere with other UI elements

## Message Examples

### Banner Content for Different Actions

**Archive Action:**
```
✓ Task archived → Next task focused
```

**Mark Unread Action:**
```
✓ Marked unread → Next task focused
```

**Quick Action (during streaming):**
```
✓ Task skipped → Next task focused
```

**Fallback to Tasks Panel:**
```
✓ Task archived → Switched to tasks panel
```

### Visual Layout
```
┌─────────────────────────────────────────┐
│ ✓ Task archived → Next task focused    │
└─────────────────────────────────────────┘
 green icon/text   arrow   white text
```

## Visual Design Specifications

### Colors & Styling
```css
/* Banner Container */
background: rgba(0, 0, 0, 0.2) /* black/20 */
backdrop-filter: blur(12px) /* gaussian blur */
text: white
border-radius: 8px
padding: 8px 16px

/* Animation Timing */
duration: 200ms
easing: cubic-bezier(0.4, 0, 0.2, 1) /* ease-out */
opacity: 0 → 1
transform: translateY(8px) → translateY(0)
```

### Layout
- **Position**: Absolute bottom overlay within simple task container
- **Alignment**: Centered horizontally above quick actions
- **Z-index**: 50 (above quick actions panel)
- **Content**: Simple centered text, no icon needed for speed
- **Backdrop**: Strong gaussian blur for readability over any background

## Success Metrics

### User Experience
- [ ] Navigation actions feel responsive and confirmed
- [ ] Banner timing feels natural (not too fast or slow)
- [ ] Banner doesn't interfere with task reading/writing
- [ ] Multiple rapid navigations handle gracefully

### Technical
- [ ] No performance impact on navigation speed
- [ ] Smooth animations on all screen sizes
- [ ] Proper cleanup prevents memory leaks
- [ ] Screen reader compatibility verified

### Integration
- [ ] Works consistently across all three navigation triggers
- [ ] Banner state persists through task changes
- [ ] No conflicts with existing UI components
- [ ] Easy to extend for future banner types