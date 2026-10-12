use std::fs;
use std::io::{self, Write};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use tauri::Manager;

fn desktop_exec(executable: &str) -> io::Result<String> {
    if executable.is_empty() || executable.contains('=') || executable.chars().any(char::is_control)
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid desktop executable",
        ));
    }
    // Desktop string escapes are decoded before Exec quoting; both layers must survive.
    let escaped = executable
        .replace('\\', "\\\\\\\\")
        .replace('"', "\\\\\"")
        .replace('$', "\\\\$")
        .replace('`', "\\\\`")
        .replace('%', "%%");
    // GIO validates Exec argv[0] before expanding %% into %. Keep that validation on
    // a fixed executable for percent-bearing paths; env receives the literal path
    // as one argument and launches it directly, without interpreting a shell.
    if executable.contains('%') {
        Ok(format!("/usr/bin/env -- \"{escaped}\" %u"))
    } else {
        Ok(format!("\"{escaped}\" %u"))
    }
}

fn correct_handler(path: &Path, executable: &str) -> io::Result<()> {
    let command = desktop_exec(executable)?;
    if executable.contains('%') {
        let env = fs::metadata("/usr/bin/env")?;
        if !env.is_file() || env.permissions().mode() & 0o111 == 0 {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "Desktop executable launcher unavailable",
            ));
        }
    }
    let contents = fs::read_to_string(path)?;
    let mut in_entry = false;
    let mut replaced = 0;
    let corrected = contents
        .lines()
        .map(|line| {
            if line.starts_with('[') {
                in_entry = line == "[Desktop Entry]";
            }
            if in_entry && line.starts_with("Exec=") {
                replaced += 1;
                format!("Exec={command}")
            } else {
                line.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    if replaced != 1 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Invalid desktop handler",
        ));
    }
    if corrected == contents {
        return Ok(());
    }
    let mut file =
        tempfile::NamedTempFile::new_in(path.parent().ok_or(io::ErrorKind::InvalidInput)?)?;
    file.write_all(corrected.as_bytes())?;
    file.persist(path).map_err(|error| error.error)?;
    Ok(())
}

// tauri-plugin-deep-link 2.4.6 generates an unquoted Linux Exec; retain its registration/delivery.
pub(crate) fn correct_registered_handler(app: &tauri::App) -> io::Result<()> {
    let bin = tauri::utils::platform::current_exe()?;
    let name = bin
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(io::ErrorKind::InvalidInput)?;
    let handler = app
        .path()
        .data_dir()
        .map_err(io::Error::other)?
        .join("applications")
        .join(format!("{name}-handler.desktop"));
    let executable = app
        .env()
        .appimage
        .map(std::path::PathBuf::from)
        .unwrap_or(bin);
    correct_handler(
        &handler,
        executable.to_str().ok_or(io::ErrorKind::InvalidInput)?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_exec_quotes_and_escapes_the_executable_only() {
        assert_eq!(
            desktop_exec("/home/test/My App.AppImage").unwrap(),
            "\"/home/test/My App.AppImage\" %u"
        );
        assert_eq!(
            desktop_exec(r#"/home/test/a"b\c%d$e`f & ; app"#).unwrap(),
            r#"/usr/bin/env -- "/home/test/a\\"b\\\\c%%d\\$e\\`f & ; app" %u"#
        );
        for invalid in ["", "/home/a=b", "/home/a\nb", "/home/a\rb"] {
            assert!(desktop_exec(invalid).is_err());
        }
    }

    #[test]
    fn correct_handler_preserves_mime_and_other_sections_and_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("handler.desktop");
        fs::write(&path, "[Desktop Entry]\nName=Mindwtr\nExec=/home/test/My App %u\nMimeType=x-scheme-handler/mindwtr;\n[Desktop Action QuickAdd]\nExec=other --quick-add\n").unwrap();
        correct_handler(&path, "/home/test/My App").unwrap();
        let corrected = fs::read_to_string(&path).unwrap();
        assert!(corrected.contains("Exec=\"/home/test/My App\" %u\n"));
        assert!(corrected.contains("MimeType=x-scheme-handler/mindwtr;\n"));
        assert!(corrected.contains("[Desktop Action QuickAdd]\nExec=other --quick-add\n"));
        correct_handler(&path, "/home/test/My App").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), corrected);
    }

    #[test]
    fn corrected_handler_delivers_literal_path_and_uri_with_gio() {
        use std::os::unix::fs::PermissionsExt;
        use std::process::Command;
        if Command::new("gio").arg("version").output().is_err() {
            eprintln!("GIO launch regression unavailable: gio not installed");
            return;
        }
        for name in [
            r#"app space"back\$dollar`tick;&"#,
            r#"app space"back\percent%u$dollar`tick;&"#,
        ] {
            let dir = tempfile::tempdir().unwrap();
            let executable = dir.path().join(name);
            fs::write(&executable, "#!/usr/bin/python3\nimport json, pathlib, sys\npathlib.Path(__file__).with_name('argv.json').write_text(json.dumps(sys.argv[1:]))\n").unwrap();
            fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
            let handler = dir.path().join("task-link.desktop");
            fs::write(
                &handler,
                "[Desktop Entry]\nType=Application\nName=Task link test\nExec=placeholder %u\n",
            )
            .unwrap();
            correct_handler(&handler, executable.to_str().unwrap()).unwrap();
            let uri = "mindwtr://open?task=a%20%26%22%5C%25&literal=$(touch%20nope)";
            assert!(Command::new("gio")
                .arg("launch")
                .arg(&handler)
                .arg(uri)
                .status()
                .unwrap()
                .success());
            let output = dir.path().join("argv.json");
            for _ in 0..100 {
                if output.exists() {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            assert_eq!(
                serde_json::from_str::<Vec<String>>(&fs::read_to_string(output).unwrap()).unwrap(),
                vec![uri]
            );
        }
    }
}
