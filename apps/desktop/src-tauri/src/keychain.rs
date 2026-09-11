use std::path::{Path, PathBuf};
type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

pub trait SecretStore {
    fn get(&self) -> Result<Option<Vec<u8>>>;
    fn put(&self, key: &[u8]) -> Result<()>;
}

pub struct WorkspaceKey {
    pub bytes: Vec<u8>,
    legacy: Option<PathBuf>,
}
impl WorkspaceKey {
    // Only retire the old file once the backend has opened the encrypted state.
    pub fn finish_migration(&self) -> Result<()> {
        if let Some(path) = &self.legacy {
            if std::fs::read(path)? != self.bytes {
                return Err("Legacy workspace key changed during migration".into());
            }
            std::fs::remove_file(path)?;
        }
        Ok(())
    }
}

pub fn random_key() -> Result<Vec<u8>> {
    let mut key = vec![0u8; 32];
    getrandom::fill(&mut key).map_err(|_| "Operating system randomness unavailable")?;
    Ok(key)
}

pub fn load_or_create(data: &Path, store: &impl SecretStore) -> Result<WorkspaceKey> {
    let legacy_path = data.join("workspace.key");
    let legacy = match std::fs::read(&legacy_path) {
        Ok(key) => Some(key),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };
    let stored = store.get()?;
    let needs_store = stored.is_none();
    if legacy.as_ref().is_some_and(|key| key.len() != 32)
        || stored.as_ref().is_some_and(|key| key.len() != 32)
    {
        return Err("Invalid workspace encryption key; data was left unchanged".into());
    }
    let key = match (stored, legacy.as_ref()) {
        (Some(stored), Some(legacy)) if &stored != legacy => return Err("Keychain and legacy workspace keys disagree; data was left unchanged".into()),
        (Some(stored), _) => stored,
        (None, Some(legacy)) => legacy.clone(),
        (None, None) if data.join("workspace.enc").exists() => return Err("Encrypted workspace exists without its encryption key; restore the original key before opening VOID".into()),
        (None, None) => random_key()?,
    };
    if needs_store {
        store.put(&key)?;
    }
    if store.get()?.as_deref() != Some(key.as_slice()) {
        return Err("Keychain did not retain the workspace key; data was left unchanged".into());
    }
    Ok(WorkspaceKey {
        bytes: key,
        legacy: legacy.map(|_| legacy_path),
    })
}

pub fn ephemeral() -> Result<WorkspaceKey> {
    Ok(WorkspaceKey {
        bytes: random_key()?,
        legacy: None,
    })
}

#[cfg(target_os = "macos")]
pub struct MacKeychain {
    pub account: String,
}
#[cfg(target_os = "macos")]
impl SecretStore for MacKeychain {
    fn get(&self) -> Result<Option<Vec<u8>>> {
        match security_framework::passwords::get_generic_password(
            "dev.void.desktop.workspace",
            &self.account,
        ) {
            Ok(key) => Ok(Some(key)),
            Err(error) if error.code() == -25300 => Ok(None),
            Err(_) => Err("Cannot unlock the VOID workspace key in macOS Keychain".into()),
        }
    }
    fn put(&self, key: &[u8]) -> Result<()> {
        security_framework::passwords::set_generic_password(
            "dev.void.desktop.workspace",
            &self.account,
            key,
        )
        .map_err(|_| "Cannot save the VOID workspace key in macOS Keychain".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    struct Store {
        key: RefCell<Option<Vec<u8>>>,
        writable: bool,
    }
    impl SecretStore for Store {
        fn get(&self) -> Result<Option<Vec<u8>>> {
            Ok(self.key.borrow().clone())
        }
        fn put(&self, key: &[u8]) -> Result<()> {
            if !self.writable {
                return Err("Keychain locked".into());
            }
            *self.key.borrow_mut() = Some(key.to_vec());
            Ok(())
        }
    }
    fn directory(name: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("void-keychain-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }
    #[test]
    fn migrates_existing_key_without_deleting_it_before_backend_readiness() {
        let dir = directory("migration");
        let original = vec![17; 32];
        std::fs::write(dir.join("workspace.key"), &original).unwrap();
        let store = Store {
            key: RefCell::new(None),
            writable: true,
        };
        let key = load_or_create(&dir, &store).unwrap();
        assert_eq!(key.bytes, original);
        assert_eq!(store.get().unwrap(), Some(original));
        assert!(dir.join("workspace.key").exists());
        key.finish_migration().unwrap();
        assert!(!dir.join("workspace.key").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn locked_keychain_preserves_legacy_key_and_ciphertext() {
        let dir = directory("locked");
        let original = vec![18; 32];
        std::fs::write(dir.join("workspace.key"), &original).unwrap();
        std::fs::write(dir.join("workspace.enc"), b"encrypted-state").unwrap();
        let store = Store {
            key: RefCell::new(None),
            writable: false,
        };
        assert!(load_or_create(&dir, &store).is_err());
        assert_eq!(std::fs::read(dir.join("workspace.key")).unwrap(), original);
        assert_eq!(
            std::fs::read(dir.join("workspace.enc")).unwrap(),
            b"encrypted-state"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn mismatched_or_missing_keys_never_replace_existing_encrypted_data() {
        let dir = directory("mismatch");
        std::fs::write(dir.join("workspace.key"), vec![19; 32]).unwrap();
        let store = Store {
            key: RefCell::new(Some(vec![20; 32])),
            writable: true,
        };
        assert!(load_or_create(&dir, &store).is_err());
        assert_eq!(store.get().unwrap(), Some(vec![20; 32]));
        std::fs::remove_file(dir.join("workspace.key")).unwrap();
        *store.key.borrow_mut() = None;
        std::fs::write(dir.join("workspace.enc"), b"encrypted-state").unwrap();
        assert!(load_or_create(&dir, &store).is_err());
        assert_eq!(store.get().unwrap(), None);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
