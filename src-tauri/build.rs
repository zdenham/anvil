fn main() {
    // Rebuild when these env vars change
    println!("cargo:rerun-if-env-changed=ANVIL_APP_SUFFIX");
    println!("cargo:rerun-if-env-changed=ANVIL_WS_PORT");
    println!("cargo:rerun-if-env-changed=ANVIL_SPOTLIGHT_HOTKEY");
    println!("cargo:rerun-if-env-changed=ANVIL_CLIPBOARD_HOTKEY");

    // Bake ANVIL_APP_SUFFIX into the binary at compile time
    let suffix = std::env::var("ANVIL_APP_SUFFIX").unwrap_or_default();
    println!("cargo:rustc-env=ANVIL_APP_SUFFIX={}", suffix);

    // Bake WS server port (default 9600, dev preset uses 9601)
    let ws_port = std::env::var("ANVIL_WS_PORT").unwrap_or_else(|_| "9600".to_string());
    println!("cargo:rustc-env=ANVIL_WS_PORT={}", ws_port);

    // Bake default hotkeys
    let spotlight_hotkey = std::env::var("ANVIL_SPOTLIGHT_HOTKEY")
        .unwrap_or_else(|_| "Command+Space".to_string());
    let clipboard_hotkey = std::env::var("ANVIL_CLIPBOARD_HOTKEY")
        .unwrap_or_else(|_| "Command+Option+C".to_string());
    println!("cargo:rustc-env=ANVIL_SPOTLIGHT_HOTKEY={}", spotlight_hotkey);
    println!("cargo:rustc-env=ANVIL_CLIPBOARD_HOTKEY={}", clipboard_hotkey);

    tauri_build::build()
}
