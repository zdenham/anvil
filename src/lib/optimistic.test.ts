// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { optimistic, type Rollback } from "./optimistic";

describe("optimistic", () => {
  it("applies change and persists successfully", async () => {
    let state = "initial";
    const data = "updated";

    await optimistic(
      data,
      (value) => {
        state = value;
        return () => {
          state = "initial";
        };
      },
      () => Promise.resolve()
    );

    expect(state).toBe("updated");
  });

  it("rolls back on persistence failure", async () => {
    let state = "initial";
    const data = "updated";

    await expect(
      optimistic(
        data,
        (value) => {
          state = value;
          return () => {
            state = "initial";
          };
        },
        () => Promise.reject(new Error("disk full"))
      )
    ).rejects.toThrow("disk full");

    expect(state).toBe("initial");
  });

  it("passes the same data to both apply and persist", async () => {
    const applySpy = vi.fn((): Rollback => () => {});
    const persistSpy = vi.fn((): Promise<void> => Promise.resolve());
    const data = "test-data";

    await optimistic(data, applySpy, persistSpy);

    expect(applySpy).toHaveBeenCalledWith("test-data");
    expect(persistSpy).toHaveBeenCalledWith("test-data");
  });

  it("calls apply before persist", async () => {
    const callOrder: string[] = [];

    await optimistic(
      "data",
      () => {
        callOrder.push("apply");
        return () => {};
      },
      async () => {
        callOrder.push("persist");
      }
    );

    expect(callOrder).toEqual(["apply", "persist"]);
  });

  it("preserves the error type on rollback", async () => {
    class CustomError extends Error {
      constructor(public code: number) {
        super("custom error");
        this.name = "CustomError";
      }
    }

    let state = "initial";

    try {
      await optimistic(
        "updated",
        (value) => {
          state = value;
          return () => {
            state = "initial";
          };
        },
        () => Promise.reject(new CustomError(500))
      );
    } catch (error) {
      expect(error).toBeInstanceOf(CustomError);
      expect((error as CustomError).code).toBe(500);
    }

    expect(state).toBe("initial");
  });

  it("handles complex object data with type safety", async () => {
    interface Settings {
      theme: "light" | "dark";
      fontSize: number;
    }

    let currentSettings: Settings = { theme: "light", fontSize: 14 };
    const newSettings: Settings = { theme: "dark", fontSize: 16 };

    await optimistic<Settings>(
      newSettings,
      (settings) => {
        const prev = currentSettings;
        currentSettings = settings;
        return () => {
          currentSettings = prev;
        };
      },
      () => Promise.resolve()
    );

    expect(currentSettings).toEqual({ theme: "dark", fontSize: 16 });
  });

  it("handles complex object rollback correctly", async () => {
    interface Settings {
      theme: "light" | "dark";
      fontSize: number;
    }

    const originalSettings: Settings = { theme: "light", fontSize: 14 };
    let currentSettings: Settings = { ...originalSettings };
    const newSettings: Settings = { theme: "dark", fontSize: 16 };

    await expect(
      optimistic<Settings>(
        newSettings,
        (settings) => {
          const prev = { ...currentSettings };
          currentSettings = settings;
          return () => {
            currentSettings = prev;
          };
        },
        () => Promise.reject(new Error("write failed"))
      )
    ).rejects.toThrow("write failed");

    expect(currentSettings).toEqual(originalSettings);
  });

  it("does not call rollback on success", async () => {
    const rollbackSpy = vi.fn();

    await optimistic(
      "data",
      () => rollbackSpy,
      () => Promise.resolve()
    );

    expect(rollbackSpy).not.toHaveBeenCalled();
  });

  it("calls rollback exactly once on failure", async () => {
    const rollbackSpy = vi.fn();

    await expect(
      optimistic(
        "data",
        () => rollbackSpy,
        () => Promise.reject(new Error("failed"))
      )
    ).rejects.toThrow();

    expect(rollbackSpy).toHaveBeenCalledTimes(1);
  });
});
