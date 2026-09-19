//! Installed font families for Settings -> Look & feel -> Font (#1244). The
//! webview cannot list system fonts (WebKit has no API for it, Chromium prompts),
//! so the desktop shell enumerates them natively and the page shows a dropdown.

use std::collections::BTreeSet;

pub(crate) fn unique_sorted_families<I>(names: I) -> Vec<String>
where
    I: IntoIterator<Item = String>,
{
    let unique: BTreeSet<String> = names
        .into_iter()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .collect();
    let mut families: Vec<String> = unique.into_iter().collect();
    families.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()).then_with(|| a.cmp(b)));
    families
}

fn load_system_font_families() -> Vec<String> {
    let mut database = fontdb::Database::new();
    database.load_system_fonts();
    unique_sorted_families(
        database
            .faces()
            .flat_map(|face| face.families.iter().map(|(name, _)| name.clone())),
    )
}

// fontdb walks every font directory on disk; keep that off the main thread.
#[tauri::command]
pub(crate) async fn list_system_fonts() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(load_system_font_families)
        .await
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::unique_sorted_families;

    #[test]
    fn dedupes_trims_and_sorts_case_insensitively() {
        let families = unique_sorted_families(
            ["Zilla Slab", " inter ", "Inter", "", "arial", "Inter"]
                .into_iter()
                .map(String::from),
        );
        assert_eq!(families, vec!["arial", "Inter", "inter", "Zilla Slab"]);
    }

    #[test]
    fn command_is_registered() {
        let source = include_str!("lib.rs");
        let handler = source
            .split_once("tauri::generate_handler![")
            .and_then(|(_, rest)| rest.split_once("])").map(|(commands, _)| commands))
            .expect("Tauri command handler should be present");
        assert!(handler.contains("list_system_fonts,"));
    }
}
