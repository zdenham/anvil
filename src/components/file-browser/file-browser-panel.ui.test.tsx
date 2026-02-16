import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test/helpers";
import { mockInvoke } from "@/test/mocks/tauri-api";
import type { DirEntry } from "@/lib/filesystem-client";

// Mock navigation service
vi.mock("@/stores/navigation-service", () => ({
  navigationService: {
    navigateToFile: vi.fn(),
  },
}));

// Mock file watcher client — non-fatal, so just stub all methods
vi.mock("@/lib/file-watcher-client", () => ({
  fileWatcherClient: {
    startWatch: vi.fn().mockResolvedValue(undefined),
    stopWatch: vi.fn().mockResolvedValue(undefined),
    onChanged: vi.fn().mockResolvedValue(() => {}),
  },
}));

import { navigationService } from "@/stores/navigation-service";
import { fileWatcherClient } from "@/lib/file-watcher-client";
import { FileBrowserPanel } from "./file-browser-panel";

function makeDirEntries(): DirEntry[] {
  return [
    { name: "src", path: "/project/src", isDirectory: true, isFile: false },
    { name: "lib", path: "/project/lib", isDirectory: true, isFile: false },
    { name: "App.tsx", path: "/project/App.tsx", isDirectory: false, isFile: true },
    { name: "main.ts", path: "/project/main.ts", isDirectory: false, isFile: true },
  ];
}

function makeNestedEntries(): DirEntry[] {
  return [
    { name: "components", path: "/project/src/components", isDirectory: true, isFile: false },
    { name: "index.ts", path: "/project/src/index.ts", isDirectory: false, isFile: true },
  ];
}

describe("FileBrowserPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: return root entries for fs_list_dir
    mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "fs_list_dir") {
        const path = args?.path as string;
        if (path === "/project") return makeDirEntries();
        if (path === "/project/src") return makeNestedEntries();
        throw new Error(`Directory not found: ${path}`);
      }
      if (cmd === "web_log") return;
      throw new Error(`Unmocked command: ${cmd}`);
    });
  });

  it("renders directory entries after loading", async () => {
    render(
      <FileBrowserPanel
        rootPath="/project"
        repoId="repo-1"
        worktreeId="wt-1"
        onClose={vi.fn()}
      />
    );

    // Directories should appear first (sorted), then files
    await waitFor(() => {
      expect(screen.getByText("lib")).toBeInTheDocument();
    });
    expect(screen.getByText("src")).toBeInTheDocument();
    expect(screen.getByText("App.tsx")).toBeInTheDocument();
    expect(screen.getByText("main.ts")).toBeInTheDocument();
  });

  it("sorts directories before files", async () => {
    render(
      <FileBrowserPanel
        rootPath="/project"
        repoId="repo-1"
        worktreeId="wt-1"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("lib")).toBeInTheDocument();
    });

    // Get all button texts in order
    const buttons = screen.getAllByRole("button").filter(
      (b) => !b.getAttribute("aria-label")
    );
    const labels = buttons.map((b) => b.textContent).filter(Boolean);

    // Directories (lib, src) should come before files (App.tsx, main.ts)
    const libIndex = labels.indexOf("lib");
    const srcIndex = labels.indexOf("src");
    const appIndex = labels.indexOf("App.tsx");
    const mainIndex = labels.indexOf("main.ts");

    expect(libIndex).toBeLessThan(appIndex);
    expect(srcIndex).toBeLessThan(mainIndex);
  });

  it("expands a folder on click and shows nested entries", async () => {
    render(
      <FileBrowserPanel
        rootPath="/project"
        repoId="repo-1"
        worktreeId="wt-1"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("src")).toBeInTheDocument();
    });

    // Click on "src" directory to expand it
    fireEvent.click(screen.getByText("src"));

    // Should show nested entries while keeping root entries visible
    await waitFor(() => {
      expect(screen.getByText("components")).toBeInTheDocument();
    });
    expect(screen.getByText("index.ts")).toBeInTheDocument();

    // Root entries should still be visible
    expect(screen.getByText("lib")).toBeInTheDocument();
    expect(screen.getByText("App.tsx")).toBeInTheDocument();
  });

  it("collapses a folder on second click", async () => {
    render(
      <FileBrowserPanel
        rootPath="/project"
        repoId="repo-1"
        worktreeId="wt-1"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("src")).toBeInTheDocument();
    });

    // Expand
    fireEvent.click(screen.getByText("src"));
    await waitFor(() => {
      expect(screen.getByText("index.ts")).toBeInTheDocument();
    });

    // Collapse
    fireEvent.click(screen.getByText("src"));

    // Nested entries should be gone
    await waitFor(() => {
      expect(screen.queryByText("index.ts")).not.toBeInTheDocument();
    });
    expect(screen.queryByText("components")).not.toBeInTheDocument();

    // Root entries should remain
    expect(screen.getByText("lib")).toBeInTheDocument();
  });

  it("opens files via navigation service on click", async () => {
    render(
      <FileBrowserPanel
        rootPath="/project"
        repoId="repo-1"
        worktreeId="wt-1"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("App.tsx")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("App.tsx"));

    expect(navigationService.navigateToFile).toHaveBeenCalledWith(
      "/project/App.tsx",
      { repoId: "repo-1", worktreeId: "wt-1" }
    );
  });

  it("shows root name in header", async () => {
    render(
      <FileBrowserPanel
        rootPath="/project"
        repoId="repo-1"
        worktreeId="wt-1"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("project")).toBeInTheDocument();
    });
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    render(
      <FileBrowserPanel
        rootPath="/project"
        repoId="repo-1"
        worktreeId="wt-1"
        onClose={onClose}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("lib")).toBeInTheDocument();
    });

    const closeButton = screen.getByLabelText("Close file browser");
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalled();
  });

  it("shows refresh button", async () => {
    render(
      <FileBrowserPanel
        rootPath="/project"
        repoId="repo-1"
        worktreeId="wt-1"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Refresh directory")).toBeInTheDocument();
    });
  });

  it("shows error state when directory listing fails", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "fs_list_dir") throw new Error("Permission denied");
      if (cmd === "web_log") return;
      throw new Error(`Unmocked command: ${cmd}`);
    });

    render(
      <FileBrowserPanel
        rootPath="/project"
        repoId="repo-1"
        worktreeId="wt-1"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Directory not found")).toBeInTheDocument();
    });
    expect(screen.getByText("/project")).toBeInTheDocument();
  });

  it("shows empty directory state", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "fs_list_dir") return [];
      if (cmd === "web_log") return;
      throw new Error(`Unmocked command: ${cmd}`);
    });

    render(
      <FileBrowserPanel
        rootPath="/project"
        repoId="repo-1"
        worktreeId="wt-1"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Empty directory")).toBeInTheDocument();
    });
  });

  it("starts file watcher on mount", async () => {
    render(
      <FileBrowserPanel
        rootPath="/project"
        repoId="repo-1"
        worktreeId="wt-1"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(fileWatcherClient.startWatch).toHaveBeenCalledWith(
        "file-tree-wt-1-root",
        "/project",
        false
      );
    });
  });

  it("starts watcher for expanded directory", async () => {
    render(
      <FileBrowserPanel
        rootPath="/project"
        repoId="repo-1"
        worktreeId="wt-1"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("src")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("src"));

    await waitFor(() => {
      expect(fileWatcherClient.startWatch).toHaveBeenCalledWith(
        "file-tree-wt-1-/project/src",
        "/project/src",
        false
      );
    });
  });
});
