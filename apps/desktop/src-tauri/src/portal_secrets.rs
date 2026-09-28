//! Flatpak credentials use only the Secret portal, never the host Secret Service.
use fs2::FileExt;
use oo7::{file::Keyring, Secret};
use std::{collections::HashMap, fs::OpenOptions, os::unix::fs::OpenOptionsExt, path::Path};

enum Operation {
    Read,
    Write(Option<String>),
}

pub(crate) fn get(path: &Path, service: &str, account: &str) -> Result<Option<String>, String> {
    run(path, service, account, Operation::Read)
}

pub(crate) fn set(
    path: &Path,
    service: &str,
    account: &str,
    value: Option<String>,
) -> Result<(), String> {
    let value = value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    run(path, service, account, Operation::Write(value)).map(|_| ())
}

fn run(
    path: &Path,
    service: &str,
    account: &str,
    operation: Operation,
) -> Result<Option<String>, String> {
    // These shared credential calls are synchronous, including calls from Tokio.
    // A separate thread avoids nesting a runtime or blocking its I/O executor.
    std::thread::scope(|scope| {
        scope
            .spawn(move || {
                let parent = path.parent().ok_or("Credential directory is missing")?;
                std::fs::create_dir_all(parent)
                    .map_err(|_| "Cannot create credential directory")?;
                let lock = OpenOptions::new()
                    .read(true)
                    .write(true)
                    .create(true)
                    .truncate(false)
                    .mode(0o600)
                    .open(path.with_extension("lock"))
                    .map_err(|_| "Cannot open credential lock")?;
                lock.lock_exclusive()
                    .map_err(|_| "Cannot lock credential store")?;
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .map_err(|_| "Cannot start credential runtime")?;
                runtime.block_on(async {
                    let secret = tokio::time::timeout(
                        std::time::Duration::from_secs(30),
                        ashpd::desktop::secret::retrieve(),
                    )
                    .await
                    .map_err(|_| "Secret portal timed out")?
                    .map_err(|_| "Secret portal is unavailable or access was declined")?;
                    execute(path, Secret::from(secret), service, account, operation).await
                })
            })
            .join()
            .map_err(|_| "Credential worker failed".to_owned())?
    })
}

async fn read(store: &Keyring, attributes: &HashMap<&str, &str>) -> Result<Option<String>, String> {
    let item = store
        .lookup_item(attributes)
        .await
        .map_err(|_| "Cannot read encrypted credentials")?;
    item.map(|item| {
        String::from_utf8(item.secret().as_bytes().to_vec())
            .map_err(|_| "Stored credential is not valid text".to_owned())
    })
    .transpose()
}

async fn execute(
    path: &Path,
    secret: Secret,
    service: &str,
    account: &str,
    operation: Operation,
) -> Result<Option<String>, String> {
    // Load fresh while holding the file lock: other processes must not lose a
    // credential when this process writes a different account.
    let store = Keyring::load(path, secret.clone())
        .await
        .map_err(|_| "Cannot unlock encrypted credentials".to_owned())?;
    let attributes = HashMap::from([("service", service), ("account", account)]);
    match operation {
        Operation::Read => read(&store, &attributes).await,
        Operation::Write(value) => {
            match &value {
                Some(value) => store
                    .create_item("Mindwtr credential", &attributes, value.as_str(), true)
                    .await
                    .map(|_| ()),
                None => store.delete(&attributes).await,
            }
            .map_err(|_| "Cannot save encrypted credentials".to_owned())?;
            // oo7 syncs the temporary file and renames it. Persist the directory
            // entry too before callers remove their existing plaintext fallback.
            std::fs::File::open(path.parent().ok_or("Credential directory is missing")?)
                .and_then(|directory| directory.sync_all())
                .map_err(|_| "Cannot persist encrypted credentials".to_owned())?;
            let persisted = Keyring::load(path, secret)
                .await
                .map_err(|_| "Cannot verify encrypted credentials".to_owned())?;
            if read(&persisted, &attributes).await? != value {
                return Err("Encrypted credential verification failed".to_owned());
            }
            log::info!(
                "Portal credential write verified extra.releaseCheck=v1.3.3/flatpak-secret-portal"
            );
            Ok(None)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[tokio::test]
    async fn encrypted_credentials_survive_reopen_replace_and_delete_without_touching_other_accounts(
    ) {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("credentials.keyring");
        let secret = Secret::from(vec![42; 64]);
        for (account, value) in [("dropbox", "test-token"), ("webdav", "other-secret")] {
            execute(
                &path,
                secret.clone(),
                "test:secrets",
                account,
                Operation::Write(Some(value.into())),
            )
            .await
            .unwrap();
        }
        let bytes = std::fs::read(&path).unwrap();
        assert!(!bytes.windows(10).any(|window| window == b"test-token"));
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            execute(
                &path,
                secret.clone(),
                "test:secrets",
                "dropbox",
                Operation::Read
            )
            .await
            .unwrap()
            .as_deref(),
            Some("test-token")
        );
        assert!(execute(
            &path,
            Secret::from(vec![43; 64]),
            "test:secrets",
            "dropbox",
            Operation::Write(Some("wrong".into()))
        )
        .await
        .is_err());
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        execute(
            &path,
            secret.clone(),
            "test:secrets",
            "dropbox",
            Operation::Write(Some("replacement".into())),
        )
        .await
        .unwrap();
        assert_eq!(
            execute(
                &path,
                secret.clone(),
                "test:secrets",
                "dropbox",
                Operation::Read
            )
            .await
            .unwrap()
            .as_deref(),
            Some("replacement")
        );
        execute(
            &path,
            secret.clone(),
            "test:secrets",
            "dropbox",
            Operation::Write(None),
        )
        .await
        .unwrap();
        assert_eq!(
            execute(
                &path,
                secret.clone(),
                "test:secrets",
                "dropbox",
                Operation::Read
            )
            .await
            .unwrap(),
            None
        );
        assert_eq!(
            execute(
                &path,
                secret.clone(),
                "test:secrets",
                "webdav",
                Operation::Read
            )
            .await
            .unwrap()
            .as_deref(),
            Some("other-secret")
        );
        assert_eq!(
            execute(
                &path,
                secret,
                "another-app:secrets",
                "webdav",
                Operation::Read
            )
            .await
            .unwrap(),
            None
        );
    }
}
