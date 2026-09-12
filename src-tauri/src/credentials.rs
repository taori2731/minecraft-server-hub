use crate::error::{AppError, AppResult};

const PALWORLD_REST_SERVICE: &str = "Minecraft Server Hub - Palworld REST";

#[cfg(windows)]
fn entry(server_id: &str) -> AppResult<keyring::Entry> {
    keyring::Entry::new(PALWORLD_REST_SERVICE, server_id).map_err(|error| {
        AppError::Other(format!(
            "Windows資格情報マネージャーを準備できません: {error}"
        ))
    })
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
