//! Installed font families for Settings -> Look & feel -> Font (#1244). The
//! webview cannot list system fonts (WebKit has no API for it, Chromium prompts),
//! so the desktop shell enumerates them natively and the page shows a dropdown.

use std::collections::{BTreeMap, BTreeSet};

/// A family is only offered when it has a face at least this heavy.
///
/// Chromium (WebView2 on Windows) draws *synthesized* bold — the regular glyph smeared
/// outwards, which looks doubled and blurry next to crisp regular text — whenever text
/// asks for weight 600 or more and the family it resolved has no face that heavy. The
/// app's sidebar labels, section headings, task titles and "Add task" are `font-semibold`
/// (600), so a family that stops at 500 makes every one of them blurry (#1244). Measured
/// in Chromium: rendering "Handgloves" from a family with only a 400 face jumps from
/// 505k to 702k ink at weight 600, while a family with a real 700 face renders that face.
const BOLD_WEIGHT: u16 = 600;

/// Family names the renderer can draw bold, sorted and deduplicated.
///
/// Each item is one face: the family name it reports and the heaviest weight that face
/// can render. Names are grouped without regard to case, so a family whose bold face
/// spells the name differently from its regular face still counts as bold-capable.
pub(crate) fn bold_capable_families<I>(faces: I) -> Vec<String>
where
    I: IntoIterator<Item = (String, u16)>,
{
    let mut names: BTreeSet<String> = BTreeSet::new();
    let mut heaviest: BTreeMap<String, u16> = BTreeMap::new();
    for (name, weight) in faces {
        let name = name.trim().to_string();
        if name.is_empty() {
            continue;
        }
        let slot = heaviest.entry(name.to_lowercase()).or_insert(0);
        *slot = (*slot).max(weight);
        names.insert(name);
    }
    let mut families: Vec<String> = names
        .into_iter()
        .filter(|name| heaviest.get(&name.to_lowercase()).copied().unwrap_or(0) >= BOLD_WEIGHT)
        .collect();
    families.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()).then_with(|| a.cmp(b)));
    families
}

fn be_u16(data: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes(data.get(at..at + 2)?.try_into().ok()?))
}

fn be_u32(data: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(data.get(at..at + 4)?.try_into().ok()?))
}

/// Top of a variable font's `wght` axis, in CSS weight units, or `None` when the face is
/// not variable.
///
/// fontdb reports a variable font as a single face at its default weight, usually 400, so
/// without this the whole family would count as having no bold face and be dropped —
/// Adwaita Sans on Linux, Bahnschrift and Segoe UI Variable on Windows. The renderer can
/// draw real bold from those, because it uses the axis.
///
/// The bytes come from a file on the user's disk, so every read is bounds-checked and a
/// malformed or truncated font yields `None` instead of a panic.
fn variable_weight_max(data: &[u8], face_index: u32) -> Option<u16> {
    // A font collection puts one table directory per font after a 12-byte header.
    let directory = if data.get(..4)? == b"ttcf" {
        be_u32(data, 12 + 4 * face_index as usize)? as usize
    } else {
        0
    };
    let table_count = be_u16(data, directory + 4)? as usize;
    let mut fvar = None;
    for index in 0..table_count {
        let record = directory + 12 + 16 * index;
        if data.get(record..record + 4)? == b"fvar" {
            fvar = Some(be_u32(data, record + 8)? as usize);
            break;
        }
    }
    let fvar = fvar?;
    let axes = fvar + be_u16(data, fvar + 4)? as usize;
    let axis_count = be_u16(data, fvar + 8)? as usize;
    let axis_size = be_u16(data, fvar + 10)? as usize;
    for index in 0..axis_count {
        let axis = axes + index * axis_size;
        if data.get(axis..axis + 4)? == b"wght" {
            // maxValue is a 16.16 fixed-point number; its whole part is the CSS weight.
            return Some((be_u32(data, axis + 12)? >> 16) as u16);
        }
    }
    None
}

fn load_system_font_families() -> Vec<String> {
    let mut database = fontdb::Database::new();
    database.load_system_fonts();
    let mut faces: Vec<(String, u16)> = Vec::new();
    for face in database.faces() {
        let mut weight = face.weight.0;
        if weight < BOLD_WEIGHT {
            // Only the faces that would otherwise be dropped are worth opening, and the
            // font data is memory-mapped: this touches the two tables read below, not
            // the whole file.
            if let Some(axis_max) = database
                .with_face_data(face.id, |data, index| variable_weight_max(data, index))
                .flatten()
            {
                weight = weight.max(axis_max);
            }
        }
        for (name, _) in &face.families {
            faces.push((name.clone(), weight));
        }
    }
    bold_capable_families(faces)
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
    use super::{bold_capable_families, variable_weight_max};

    fn faces(entries: &[(&str, u16)]) -> Vec<(String, u16)> {
        entries.iter().map(|(name, weight)| ((*name).to_string(), *weight)).collect()
    }

    #[test]
    fn dedupes_trims_and_sorts_case_insensitively() {
        let families = bold_capable_families(faces(&[
            ("Zilla Slab", 700),
            (" inter ", 400),
            (" inter ", 700),
            ("Inter", 400),
            ("", 700),
            ("arial", 700),
            ("Inter", 700),
        ]));
        assert_eq!(families, vec!["arial", "Inter", "inter", "Zilla Slab"]);
    }

    #[test]
    fn drops_families_whose_faces_all_stop_below_semibold() {
        // The app asks for weight 600, so 500 is not enough: the renderer would
        // synthesize the bold and the text would look blurry (#1244).
        let families = bold_capable_families(faces(&[
            ("Ink Free", 400),
            ("Noto Sans Lisu", 500),
            ("Segoe UI", 400),
            ("Segoe UI", 600),
        ]));
        assert_eq!(families, vec!["Segoe UI"]);
    }

    #[test]
    fn a_bold_face_spelled_differently_still_counts() {
        let families = bold_capable_families(faces(&[("Inter", 400), ("INTER", 700)]));
        assert_eq!(families, vec!["INTER", "Inter"]);
    }

    /// Minimal font: a table directory holding one `fvar` table with one axis. `start` is
    /// where this font begins in the file, because table offsets are counted from there.
    fn font_with_axis(tag: &[u8; 4], max_weight: u16, start: u32) -> Vec<u8> {
        let mut fvar: Vec<u8> = Vec::new();
        fvar.extend_from_slice(&1u16.to_be_bytes()); // majorVersion
        fvar.extend_from_slice(&0u16.to_be_bytes()); // minorVersion
        fvar.extend_from_slice(&16u16.to_be_bytes()); // axesArrayOffset
        fvar.extend_from_slice(&2u16.to_be_bytes()); // reserved
        fvar.extend_from_slice(&1u16.to_be_bytes()); // axisCount
        fvar.extend_from_slice(&20u16.to_be_bytes()); // axisSize
        fvar.extend_from_slice(&0u16.to_be_bytes()); // instanceCount
        fvar.extend_from_slice(&0u16.to_be_bytes()); // instanceSize
        fvar.extend_from_slice(tag);
        fvar.extend_from_slice(&(100u32 << 16).to_be_bytes()); // minValue
        fvar.extend_from_slice(&(400u32 << 16).to_be_bytes()); // defaultValue
        fvar.extend_from_slice(&((max_weight as u32) << 16).to_be_bytes()); // maxValue
        fvar.extend_from_slice(&0u16.to_be_bytes()); // flags
        fvar.extend_from_slice(&0u16.to_be_bytes()); // axisNameID

        let mut font: Vec<u8> = Vec::new();
        font.extend_from_slice(&0x0001_0000u32.to_be_bytes()); // sfntVersion
        font.extend_from_slice(&1u16.to_be_bytes()); // numTables
        font.extend_from_slice(&[0; 6]); // searchRange, entrySelector, rangeShift
        font.extend_from_slice(b"fvar");
        font.extend_from_slice(&0u32.to_be_bytes()); // checksum
        font.extend_from_slice(&(start + 28).to_be_bytes()); // offset, right after this directory
        font.extend_from_slice(&(fvar.len() as u32).to_be_bytes());
        font.extend_from_slice(&fvar);
        font
    }

    #[test]
    fn reads_the_top_of_the_weight_axis() {
        assert_eq!(variable_weight_max(&font_with_axis(b"wght", 900, 0), 0), Some(900));
    }

    #[test]
    fn ignores_a_font_with_no_weight_axis() {
        assert_eq!(variable_weight_max(&font_with_axis(b"wdth", 900, 0), 0), None);
        assert_eq!(variable_weight_max(&[0x00, 0x01, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0], 0), None);
    }

    #[test]
    fn a_collection_reads_the_requested_font() {
        // 4 tag + 4 version + 4 numFonts + 4 offset, so font 0 starts at byte 16.
        let inner = font_with_axis(b"wght", 800, 16);
        let mut collection: Vec<u8> = Vec::new();
        collection.extend_from_slice(b"ttcf");
        collection.extend_from_slice(&0x0001_0000u32.to_be_bytes()); // version
        collection.extend_from_slice(&1u32.to_be_bytes()); // numFonts
        collection.extend_from_slice(&16u32.to_be_bytes()); // offset of font 0
        collection.extend_from_slice(&inner);
        assert_eq!(variable_weight_max(&collection, 0), Some(800));
        assert_eq!(variable_weight_max(&collection, 1000), None);
    }

    #[test]
    fn a_truncated_font_never_panics() {
        // Cutting the file short must read as "not variable", or as the axis it did
        // manage to read, but never off the end of the slice.
        let font = font_with_axis(b"wght", 900, 0);
        for end in 0..font.len() {
            let read = variable_weight_max(&font[..end], 0);
            assert!(matches!(read, None | Some(900)), "truncated at {end} read {read:?}");
        }
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
