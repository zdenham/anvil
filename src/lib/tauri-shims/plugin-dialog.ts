/**
 * Shim: @tauri-apps/plugin-dialog
 *
 * Provides web-native fallbacks for Tauri dialog APIs.
 * - open(): uses <input type="file"> for file picking
 * - confirm(): uses window.confirm()
 */

interface OpenDialogOptions {
  directory?: boolean;
  multiple?: boolean;
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}

/** Open a file/directory picker dialog */
export async function open(options?: OpenDialogOptions): Promise<string | string[] | null> {
  // For directory picking, we can't do much in the browser
  if (options?.directory) {
    const path = window.prompt("Enter directory path:");
    return path || null;
  }

  // File picking via hidden <input type="file">
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = options?.multiple ?? false;

    if (options?.filters?.length) {
      const extensions = options.filters
        .flatMap((f) => f.extensions.map((ext) => `.${ext}`));
      input.accept = extensions.join(",");
    }

    input.onchange = () => {
      if (!input.files?.length) {
        resolve(null);
        return;
      }
      const paths = Array.from(input.files).map((f) => f.name);
      resolve(options?.multiple ? paths : paths[0]);
    };

    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Show a confirmation dialog */
export async function confirm(message: string, _options?: { title?: string; okLabel?: string; cancelLabel?: string }): Promise<boolean> {
  return window.confirm(message);
}

/** Show a message dialog */
export async function message(msg: string, _options?: { title?: string }): Promise<void> {
  window.alert(msg);
}
