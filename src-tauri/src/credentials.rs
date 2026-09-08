use crate::error::{AppError, AppResult};

const PALWORLD_REST_SERVICE: &str = "Minecraft Server Hub - Palworld REST";
const CO_MANAGEMENT_SERVICE: &str = "Minecraft Server Hub - Co-management host";
const CO_MANAGEMENT_PENDING_SERVICE: &str = "Minecraft Server Hub - Co-management pending code";

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
fn co_management_entry(host_id: &str) -> AppResult<keyring::Entry> {
    keyring::Entry::new(CO_MANAGEMENT_SERVICE, host_id).map_err(|error| {
        AppError::Other(format!(
            "Windows資格情報マネージャーを準備できません: {error}"
        ))
    })
}

#[cfg(windows)]
fn co_management_pending_entry(server_id: &str, participant_id: &str) -> AppResult<keyring::Entry> {
    keyring::Entry::new(
        CO_MANAGEMENT_PENDING_SERVICE,
        &format!("{server_id}:{participant_id}"),
    )
    .map_err(|error| AppError::Other(format!("Windows資格情報を準備できません: {error}")))
}

#[cfg(windows)]
pub fn ensure_co_management_host_token(
    host_id: &str,
    generate: impl FnOnce() -> String,
) -> AppResult<String> {
    let entry = co_management_entry(host_id)?;
    match entry.get_password() {
        Ok(token) if !token.trim().is_empty() => Ok(token),
        Ok(_) | Err(keyring::Error::NoEntry) => {
            let token = generate();
            entry.set_password(&token).map_err(|error| {
                AppError::Other(format!(
                    "共同管理ホスト資格情報をWindowsへ保存できません: {error}"
                ))
            })?;
            Ok(token)
        }
        Err(error) => Err(AppError::Other(format!(
            "共同管理ホスト資格情報をWindowsから取得できません: {error}"
        ))),
    }
}

#[cfg(windows)]
pub fn load_co_management_host_token(host_id: &str) -> AppResult<String> {
    co_management_entry(host_id)?
        .get_password()
        .map_err(|error| {
            AppError::Other(format!(
                "共同管理ホスト資格情報をWindowsから取得できません: {error}"
            ))
        })
}

#[cfg(windows)]
pub fn delete_co_management_host_token(host_id: &str) -> AppResult<()> {
    match co_management_entry(host_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(AppError::Other(format!(
            "共同管理ホスト資格情報をWindowsから削除できません: {error}"
        ))),
    }
}

#[cfg(windows)]
pub fn store_co_management_pending_code(
    server_id: &str,
    participant_id: &str,
    code: &str,
) -> AppResult<()> {
    co_management_pending_entry(server_id, participant_id)?
        .set_password(code)
        .map_err(|error| {
            AppError::Other(format!(
                "共同管理の参加コードをWindowsへ保存できません: {error}"
            ))
        })
}

#[cfg(windows)]
pub fn load_co_management_pending_code(server_id: &str, participant_id: &str) -> AppResult<String> {
    co_management_pending_entry(server_id, participant_id)?
        .get_password()
        .map_err(|error| {
            AppError::Other(format!(
                "共同管理の参加コードをWindowsから取得できません: {error}"
            ))
        })
}

#[cfg(windows)]
pub fn delete_co_management_pending_code(server_id: &str, participant_id: &str) -> AppResult<()> {
    match co_management_pending_entry(server_id, participant_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(AppError::Other(format!(
            "共同管理の参加コードをWindowsから削除できません: {error}"
        ))),
    }
}

#[cfg(not(windows))]
pub fn ensure_co_management_host_token(
    _host_id: &str,
    _generate: impl FnOnce() -> String,
) -> AppResult<String> {
    Err(AppError::Validation(
        "共同管理ホスト資格情報はWindows版でのみ利用できます".into(),
    ))
}

#[cfg(not(windows))]
pub fn load_co_management_host_token(_host_id: &str) -> AppResult<String> {
    Err(AppError::Validation(
        "共同管理ホスト資格情報はWindows版でのみ利用できます".into(),
    ))
}

#[cfg(not(windows))]
pub fn delete_co_management_host_token(_host_id: &str) -> AppResult<()> {
    Ok(())
}

#[cfg(not(windows))]
pub fn store_co_management_pending_code(
    _server_id: &str,
    _participant_id: &str,
    _code: &str,
) -> AppResult<()> {
    Err(AppError::Validation(
        "共同管理の参加コード保存はWindows版でのみ利用できます".into(),
    ))
}

#[cfg(not(windows))]
pub fn load_co_management_pending_code(
    _server_id: &str,
    _participant_id: &str,
) -> AppResult<String> {
    Err(AppError::Validation(
        "共同管理の参加コード取得はWindows版でのみ利用できます".into(),
    ))
}

#[cfg(not(windows))]
pub fn delete_co_management_pending_code(_server_id: &str, _participant_id: &str) -> AppResult<()> {
    Ok(())
}

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
