# 01: Fix "Add Repository" Button

## Prerequisites
None - this is the first task.

## Goal
Make the settings page "Add Repository" button functional.

## Tasks

### 1. Wire up file picker dialog

**File**: `src/components/main-window/settings/repository-settings.tsx`

Replace the non-functional handler:
```typescript
// Current:
const handleAddRepository = async () => {
  console.log("Add repository");
};

// New:
import { open } from "@tauri-apps/plugin-dialog";

const handleAddRepository = async () => {
  try {
    const selectedPath = await open({
      directory: true,
      multiple: false,
      title: "Select Repository Folder",
    });

    if (selectedPath && typeof selectedPath === "string") {
      await repoService.createFromFolder(selectedPath);
      await repoService.hydrate();
    }
  } catch (error) {
    console.error("Failed to add repository:", error);
    // Show user-facing error (Task 3)
  }
};
```

**Reference**: `src/components/spotlight/spotlight.tsx` lines 282-306 has working file picker example.

### 2. Add validation in repository service

**File**: `src/entities/repositories/service.ts`

Add validation before creating repository:
- Check if repository path is already registered
- Check if repository name/slug would conflict
- Return meaningful error messages

```typescript
// In service, add method or enhance createFromFolder:
async validateNewRepository(path: string): Promise<{ valid: boolean; error?: string }> {
  const existing = this.getRepositories();

  // Check for duplicate path
  for (const repo of existing) {
    if (repo.sourcePath === path) {
      return { valid: false, error: "Repository already added" };
    }
  }

  // Check path exists and is git repo
  // ... (may need Rust command or fs check)

  return { valid: true };
}
```

### 3. Add success/error feedback in UI

**File**: `src/components/main-window/settings/repository-settings.tsx`

Add state for operation feedback:
```typescript
const [addState, setAddState] = useState<{
  loading: boolean;
  error: string | null;
}>({ loading: false, error: null });
```

Show loading spinner during operation, error message on failure, and potentially a success toast.

## Success Criteria
- [ ] Clicking "Add Repository" opens native folder picker
- [ ] Selecting a valid git repo folder adds it to the repository list
- [ ] Duplicate paths show error message
- [ ] Loading state visible during operation
- [ ] Error messages displayed to user on failure

## Files Modified
- `src/components/main-window/settings/repository-settings.tsx`
- `src/entities/repositories/service.ts`
