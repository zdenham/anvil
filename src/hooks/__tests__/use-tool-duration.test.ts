// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { formatDuration } from "../use-tool-duration";

describe("formatDuration", () => {
  it("returns 0s for zero ms", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  it("returns seconds for < 60s", () => {
    expect(formatDuration(999)).toBe("0s");
    expect(formatDuration(1000)).toBe("1s");
    expect(formatDuration(59_999)).toBe("59s");
  });

  it("returns minutes and seconds for >= 60s", () => {
    expect(formatDuration(60_000)).toBe("1m 0s");
    expect(formatDuration(83_000)).toBe("1m 23s");
    expect(formatDuration(323_000)).toBe("5m 23s");
  });

  it("floors fractional seconds", () => {
    expect(formatDuration(1500)).toBe("1s");
    expect(formatDuration(61_500)).toBe("1m 1s");
  });
});
