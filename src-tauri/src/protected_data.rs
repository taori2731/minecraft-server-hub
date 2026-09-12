//! Windows user-scoped protection for data that must survive a process restart.
//!
//! The protected envelope is deliberately opaque to SQLite, ZIP, and the
//! configuration backup code. On non-Windows targets we fail closed instead of
//! silently writing a plaintext fallback.

use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};

pub const DPAPI_BLOB_MAGIC: &[u8] = b"MSH-DPAPI-V2\0";
const LEGACY_DPAPI_BLOB_MAGIC: &[u8] = b"MSH-CO-MANAGEMENT-DPAPI-V1\0";
pub const DPAPI_TEXT_PREFIX: &str = "dpapi-v1:";
pub const BACKUP_SECRET_ENTRY_DOMAIN: &[u8] = b"minecraft-server-hub:backup:secret-entry:v1\0";
pub const PALWORLD_CONFIG_BACKUP_DOMAIN: &[u8] =
    b"minecraft-server-hub:palworld-config-backup:v1\0";

fn entropy(domain: &[u8], scope_key: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(scope_key.as_bytes());
    hasher.finalize().into()
}

#[cfg(windows)]
pub fn protect_bytes(domain: &[u8], scope_key: &str, plaintext: &[u8]) -> AppResult<Vec<u8>> {
    use std::{ffi::c_void, slice};

    use windows::Win32::{
        Foundation::{HLOCAL, LocalFree},
        Security::Cryptography::{CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData},
    };

    let data_length = u32::try_from(plaintext.len())
        .map_err(|_| AppError::Validation("OS保護対象のデータが大きすぎます".into()))?;
    let protection_entropy = entropy(domain, scope_key);
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: data_length,
        pbData: plaintext.as_ptr() as *mut u8,
    };
    let optional_entropy = CRYPT_INTEGER_BLOB {
        cbData: protection_entropy.len() as u32,
        pbData: protection_entropy.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptProtectData(
            &mut input,
            None,
            Some(&optional_entropy),
            None::<*const c_void>,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|error| AppError::Other(format!("OS保護に失敗しました: {error}")))?;
        if output.pbData.is_null() {
            return Err(AppError::Other("OS保護結果が空です".into()));
        }
        let encrypted = slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(Some(HLOCAL(output.pbData as *mut c_void)));
        let mut envelope = DPAPI_BLOB_MAGIC.to_vec();
        envelope.extend_from_slice(&encrypted);
        Ok(envelope)
    }
}

#[cfg(not(windows))]
pub fn protect_bytes(_domain: &[u8], _scope_key: &str, _plaintext: &[u8]) -> AppResult<Vec<u8>> {
    Err(AppError::Other(
        "OS保護された復旧データはWindowsでのみ作成できます".into(),
    ))
}

#[cfg(windows)]
pub fn unprotect_bytes(domain: &[u8], scope_key: &str, envelope: &[u8]) -> AppResult<Vec<u8>> {
    use std::{ffi::c_void, slice};

    use windows::Win32::{
        Foundation::{HLOCAL, LocalFree},
        Security::Cryptography::{
            CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptUnprotectData,
        },
    };

    let encrypted = envelope
        .strip_prefix(DPAPI_BLOB_MAGIC)
        .or_else(|| envelope.strip_prefix(LEGACY_DPAPI_BLOB_MAGIC))
        .ok_or_else(|| AppError::Other("旧形式または平文の保護データです".into()))?;
    let data_length = u32::try_from(encrypted.len())
        .map_err(|_| AppError::Other("保護データの暗号文が大きすぎます".into()))?;
    let protection_entropy = entropy(domain, scope_key);
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: data_length,
        pbData: encrypted.as_ptr() as *mut u8,
    };
    let optional_entropy = CRYPT_INTEGER_BLOB {
        cbData: protection_entropy.len() as u32,
        pbData: protection_entropy.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptUnprotectData(
            &mut input,
            None,
            Some(&optional_entropy),
            None::<*const c_void>,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|error| AppError::Other(format!("OS保護解除に失敗しました: {error}")))?;
        if output.pbData.is_null() {
            return Err(AppError::Other("OS保護解除結果が空です".into()));
        }
        let plaintext = slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(Some(HLOCAL(output.pbData as *mut c_void)));
        Ok(plaintext)
    }
}

#[cfg(not(windows))]
pub fn unprotect_bytes(_domain: &[u8], _scope_key: &str, envelope: &[u8]) -> AppResult<Vec<u8>> {
    if is_protected_blob(envelope) {
        Err(AppError::Other(
            "OS保護された復旧データの解除はWindowsでのみ可能です".into(),
        ))
    } else {
        Err(AppError::Other("旧形式または平文の保護データです".into()))
    }
}

pub fn is_protected_blob(value: &[u8]) -> bool {
    value.starts_with(DPAPI_BLOB_MAGIC) || value.starts_with(LEGACY_DPAPI_BLOB_MAGIC)
}

pub fn is_protected_text(value: &str) -> bool {
    value.starts_with(DPAPI_TEXT_PREFIX)
}
