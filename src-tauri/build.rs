fn main() {
    // Track directory changes as well as known assets: newly added JS/CSS must
    // be embedded on the next Cargo build, including builds without the CLI.
    println!("cargo:rerun-if-changed=../web");
    tauri_build::build()
}
