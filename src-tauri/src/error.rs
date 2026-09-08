use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("入力内容が正しくありません: {0}")]
    Validation(String),
    #[error("ファイル操作に失敗しました: {0}")]
    Io(#[from] std::io::Error),
    #[error("データベース操作に失敗しました: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("ダウンロードに失敗しました: {0}")]
    Network(#[from] reqwest::Error),
    #[error("配布元の応答を解釈できませんでした: {0}")]
    Json(#[from] serde_json::Error),
    #[error("サーバーが見つかりません")]
    NotFound,
    #[error("サーバーはすでに起動しています")]
    AlreadyRunning,
    #[error("サーバーは起動していません")]
    NotRunning,
    #[error("安全停止が時間内に完了しませんでした。強制終了する前に確認してください。")]
    ForceRequired,
    #[error("{0}")]
    Other(String),
}

pub type AppResult<T> = Result<T, AppError>;

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
