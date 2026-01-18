fn main() {
    // Bake MORT_APP_SUFFIX into the binary at compile time
    let suffix = std::env::var("MORT_APP_SUFFIX").unwrap_or_default();
    println!("cargo:rustc-env=MORT_APP_SUFFIX={}", suffix);

    // Bake default hotkeys
    let spotlight_hotkey = std::env::var("MORT_SPOTLIGHT_HOTKEY")
        .unwrap_or_else(|_| "Command+Space".to_string());
    let clipboard_hotkey = std::env::var("MORT_CLIPBOARD_HOTKEY")
        .unwrap_or_else(|_| "Command+Option+C".to_string());
    println!("cargo:rustc-env=MORT_SPOTLIGHT_HOTKEY={}", spotlight_hotkey);
    println!("cargo:rustc-env=MORT_CLIPBOARD_HOTKEY={}", clipboard_hotkey);

    tauri_build::build()
}
