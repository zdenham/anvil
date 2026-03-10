import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useImagePaste } from "./use-image-paste";

vi.mock("@/lib/logger-client", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockWriteBinaryFile = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/tauri-commands", () => ({
  fsCommands: {
    writeBinaryFile: (...args: unknown[]) => mockWriteBinaryFile(...args),
  },
}));

const mockGetMortDir = vi.fn().mockResolvedValue("/Users/test/.mort");
vi.mock("@/lib/paths", () => ({
  getMortDir: () => mockGetMortDir(),
}));

function createImageFile(size = 100): File {
  const data = new Uint8Array(size);
  return new File([data], "screenshot.png", { type: "image/png" });
}

function createPasteEvent(items: DataTransferItem[]): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { items },
  });
  return event;
}

function createImageItem(file: File): DataTransferItem {
  return {
    kind: "file",
    type: file.type,
    getAsFile: () => file,
  } as unknown as DataTransferItem;
}

describe("useImagePaste", () => {
  let element: HTMLTextAreaElement;

  beforeEach(() => {
    vi.clearAllMocks();
    element = document.createElement("textarea");
    document.body.appendChild(element);
  });

  afterEach(() => {
    document.body.removeChild(element);
  });

  it("should call onImagePasted with temp file path when image is pasted", async () => {
    const onImagePasted = vi.fn();
    const ref = { current: element };

    renderHook(() => useImagePaste(ref, onImagePasted));

    const file = createImageFile();
    const event = createPasteEvent([createImageItem(file)]);
    element.dispatchEvent(event);

    await vi.waitFor(() => {
      expect(mockWriteBinaryFile).toHaveBeenCalledTimes(1);
    });

    expect(onImagePasted).toHaveBeenCalledTimes(1);
    const path = onImagePasted.mock.calls[0][0] as string;
    expect(path).toMatch(/^\/Users\/test\/\.mort\/tmp\/paste-\d+-[a-z0-9]+\.png$/);
  });

  it("should pass base64 data to writeBinaryFile", async () => {
    const onImagePasted = vi.fn();
    const ref = { current: element };

    renderHook(() => useImagePaste(ref, onImagePasted));

    const file = createImageFile(4);
    const event = createPasteEvent([createImageItem(file)]);
    element.dispatchEvent(event);

    await vi.waitFor(() => {
      expect(mockWriteBinaryFile).toHaveBeenCalledTimes(1);
    });

    const [path, base64Data] = mockWriteBinaryFile.mock.calls[0] as [string, string];
    expect(path).toContain(".mort/tmp/paste-");
    expect(typeof base64Data).toBe("string");
    // base64 of 4 zero bytes = "AAAAAA=="
    expect(base64Data).toBe("AAAAAA==");
  });

  it("should ignore paste events with no image items", () => {
    const onImagePasted = vi.fn();
    const ref = { current: element };

    renderHook(() => useImagePaste(ref, onImagePasted));

    const textItem = {
      kind: "string",
      type: "text/plain",
      getAsFile: () => null,
    } as unknown as DataTransferItem;

    const event = createPasteEvent([textItem]);
    element.dispatchEvent(event);

    expect(mockWriteBinaryFile).not.toHaveBeenCalled();
    expect(onImagePasted).not.toHaveBeenCalled();
  });

  it("should skip images larger than 10MB", async () => {
    const { logger } = await import("@/lib/logger-client");
    const onImagePasted = vi.fn();
    const ref = { current: element };

    renderHook(() => useImagePaste(ref, onImagePasted));

    const largeFile = createImageFile(11 * 1024 * 1024);
    const event = createPasteEvent([createImageItem(largeFile)]);
    element.dispatchEvent(event);

    expect(mockWriteBinaryFile).not.toHaveBeenCalled();
    expect(onImagePasted).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("should use correct extension for jpeg images", async () => {
    const onImagePasted = vi.fn();
    const ref = { current: element };

    renderHook(() => useImagePaste(ref, onImagePasted));

    const jpegFile = new File([new Uint8Array(10)], "photo.jpg", { type: "image/jpeg" });
    const event = createPasteEvent([createImageItem(jpegFile)]);
    element.dispatchEvent(event);

    await vi.waitFor(() => {
      expect(onImagePasted).toHaveBeenCalledTimes(1);
    });

    const path = onImagePasted.mock.calls[0][0] as string;
    expect(path).toMatch(/\.jpg$/);
  });

  it("should do nothing when ref is null", () => {
    const onImagePasted = vi.fn();
    const ref = { current: null };

    renderHook(() => useImagePaste(ref, onImagePasted));

    // No error thrown, no listeners attached
    expect(onImagePasted).not.toHaveBeenCalled();
  });

  it("should clean up event listener on unmount", () => {
    const onImagePasted = vi.fn();
    const ref = { current: element };

    const { unmount } = renderHook(() => useImagePaste(ref, onImagePasted));
    unmount();

    const file = createImageFile();
    const event = createPasteEvent([createImageItem(file)]);
    element.dispatchEvent(event);

    expect(mockWriteBinaryFile).not.toHaveBeenCalled();
    expect(onImagePasted).not.toHaveBeenCalled();
  });
});
