use crate::error::{AppError, AppResult};

const PALWORLD_REST_SERVICE: &str = "Minecraft Server Hub - Palworld REST";

#[cfg(all(windows, not(test)))]
fn entry(server_id: &str) -> AppResult<keyring::Entry> {
    keyring::Entry::new(PALWORLD_REST_SERVICE, server_id).map_err(|error| {
        AppError::Other(format!(
            "Windows資格情報マネージャーを準備できません: {error}"
        ))
    })
}

#[cfg(all(test, windows))]
mod test_store {
    use std::{
        any::Any,
        collections::HashMap,
        sync::{Arc, Mutex, OnceLock},
    };

    use keyring::credential::CredentialApi;

    use super::{AppResult, PALWORLD_REST_SERVICE};

    type Secret = Arc<Mutex<Option<Vec<u8>>>>;

    static CREDENTIALS: OnceLock<Mutex<HashMap<String, Secret>>> = OnceLock::new();

    #[derive(Clone)]
    struct MemoryCredential {
        secret: Secret,
    }

    impl CredentialApi for MemoryCredential {
        fn set_secret(&self, secret: &[u8]) -> keyring::Result<()> {
            *self.secret.lock().expect("test credential mutex poisoned") = Some(secret.to_vec());
            Ok(())
        }

        fn get_secret(&self) -> keyring::Result<Vec<u8>> {
            self.secret
                .lock()
                .expect("test credential mutex poisoned")
                .clone()
                .ok_or(keyring::Error::NoEntry)
        }

        fn delete_credential(&self) -> keyring::Result<()> {
            self.secret
                .lock()
                .expect("test credential mutex poisoned")
                .take()
                .map(|_| ())
                .ok_or(keyring::Error::NoEntry)
        }

        fn as_any(&self) -> &dyn Any {
            self
        }
    }

    pub(super) fn entry(server_id: &str) -> AppResult<keyring::Entry> {
        let credentials = CREDENTIALS.get_or_init(|| Mutex::new(HashMap::new()));
        let secret = credentials
            .lock()
            .expect("test credential map poisoned")
            .entry(format!("{PALWORLD_REST_SERVICE}\0{server_id}"))
            .or_insert_with(|| Arc::new(Mutex::new(None)))
            .clone();
        Ok(keyring::Entry::new_with_credential(Box::new(
            MemoryCredential { secret },
        )))
    }
}

#[cfg(all(test, windows))]
fn entry(server_id: &str) -> AppResult<keyring::Entry> {
    test_store::entry(server_id)
}

#[cfg(windows)]
pub fn store_palworld_admin_password(server_id: &str, password: &str) -> AppResult<()> {
    entry(server_id)?.set_password(password).map_err(|error| {
        AppError::Other(format!(
            "Palworld管理資格情報をWindowsへ保存できません: {error}"
        ))
    })
}

#[cfg(windows)]
pub fn load_palworld_admin_password(server_id: &str) -> AppResult<String> {
    entry(server_id)?.get_password().map_err(|error| {
        AppError::Other(format!(
            "Palworld管理資格情報をWindowsから取得できません: {error}"
        ))
    })
}

#[cfg(windows)]
pub fn delete_palworld_admin_password(server_id: &str) -> AppResult<()> {
    match entry(server_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(AppError::Other(format!(
            "Palworld管理資格情報をWindowsから削除できません: {error}"
        ))),
    }
}

#[cfg(not(windows))]
pub fn store_palworld_admin_password(_server_id: &str, _password: &str) -> AppResult<()> {
    Err(AppError::Validation(
        "Palworld管理資格情報はWindows版でのみ利用できます".into(),
    ))
}

#[cfg(not(windows))]
pub fn load_palworld_admin_password(_server_id: &str) -> AppResult<String> {
    Err(AppError::Validation(
        "Palworld管理資格情報はWindows版でのみ利用できます".into(),
    ))
}

#[cfg(not(windows))]
pub fn delete_palworld_admin_password(_server_id: &str) -> AppResult<()> {
    Ok(())
}

#[cfg(windows)]
#[cfg(all(test, windows))]
mod tests {
    use super::{
        delete_palworld_admin_password, load_palworld_admin_password, store_palworld_admin_password,
    };

    #[test]
    fn round_trips_a_temporary_windows_credential_without_logging_it() {
        let server_id = format!("palworld-credential-test-{}", uuid::Uuid::new_v4());
        let secret = format!("test-{}", uuid::Uuid::new_v4().simple());
        store_palworld_admin_password(&server_id, &secret).unwrap();
        assert!(load_palworld_admin_password(&server_id).unwrap() == secret);
        delete_palworld_admin_password(&server_id).unwrap();
        assert!(load_palworld_admin_password(&server_id).is_err());
    }
}
