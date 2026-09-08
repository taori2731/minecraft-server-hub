import type { AppLocale } from "./i18n";

export interface PalworldDeleteCopy {
  passwordWarning: string;
  essentialTitle: string;
  essentialDetail: string;
  essentialRecovery: string;
  essentialButton: string;
  essentialConfirm: string;
  essentialOverlayTitle: string;
  essentialOverlayDetail: string;
  noneTitle: string;
  noneDetail: string;
  noneWarning: string;
  noneButton: string;
  noneConfirm: string;
  noneOverlayTitle: string;
  noneOverlayDetail: string;
}

export interface MinecraftDeleteCopy {
  noneTitle: string;
  noneDetail: string;
  noneWarning: string;
  noneButton: string;
  noneConfirm: string;
  noneOverlayTitle: string;
  noneOverlayDetail: string;
}

const copies: Record<AppLocale, PalworldDeleteCopy> = {
  ja: {
    passwordWarning: "Palworldの重要データには参加・管理パスワードが含まれる場合があります。バックアップを第三者へ共有しないでください。",
    essentialTitle: "重要データを保存して高速削除（おすすめ）",
    essentialDetail: "ワールド・設定・Modだけを保存し、SteamCMDで再取得できる公式ファイルは保存せず削除します。",
    essentialRecovery: "復旧時はSteamCMDで公式サーバーを再取得し、このバックアップの重要データを戻します。",
    essentialButton: "重要データを保存して高速削除",
    essentialConfirm: "重要データだけをバックアップして、登録済みのPalworldサーバーフォルダーを削除します。公式ファイルはバックアップに含まれません。続けますか？",
    essentialOverlayTitle: "重要データを保存して高速削除しています",
    essentialOverlayDetail: "ワールド・設定・Modを検証して保存した後、再取得できる公式サーバーファイルを含む登録済みフォルダーを削除します。",
    noneTitle: "バックアップせず今すぐ削除",
    noneDetail: "登録済みフォルダーをすぐ削除します。ワールド・設定・Modも残りません。",
    noneWarning: "最終バックアップは作成されません。削除したデータはこのアプリから復旧できません。",
    noneButton: "今すぐ削除",
    noneConfirm: "バックアップを一切作成せず、登録済みのPalworldサーバーフォルダーを今すぐ削除します。この操作は取り消せません。続けますか？",
    noneOverlayTitle: "バックアップせず削除しています",
    noneOverlayDetail: "最終バックアップを作成せず、登録済みのPalworldサーバーフォルダーを削除します。",
  },
  en: {
    passwordWarning: "Palworld's essential data may contain join and administrator passwords. Do not share the backup with other people.",
    essentialTitle: "Save essential data and delete quickly (recommended)",
    essentialDetail: "Save only worlds, settings, and mods, then delete official files that SteamCMD can download again.",
    essentialRecovery: "To restore, download the official server with SteamCMD and put the essential data from this backup back into it.",
    essentialButton: "Save essential data and delete quickly",
    essentialConfirm: "Back up only essential data and delete the registered Palworld server folder. Official files will not be included in the backup. Continue?",
    essentialOverlayTitle: "Saving essential data and deleting quickly",
    essentialOverlayDetail: "After verifying and saving worlds, settings, and mods, the registered folder including replaceable official files will be deleted.",
    noneTitle: "Delete now without a backup",
    noneDetail: "Delete the registered folder immediately. Worlds, settings, and mods will not remain.",
    noneWarning: "No final backup will be created. This app cannot restore the deleted data.",
    noneButton: "Delete now",
    noneConfirm: "Delete the registered Palworld server folder now without creating any backup. This cannot be undone. Continue?",
    noneOverlayTitle: "Deleting without a backup",
    noneOverlayDetail: "The registered Palworld server folder is being deleted without creating a final backup.",
  },
  de: {
    passwordWarning: "Die wichtigen Palworld-Daten können Beitritts- und Administratorpasswörter enthalten. Gib das Backup nicht an andere weiter.",
    essentialTitle: "Wichtige Daten sichern und schnell löschen (empfohlen)",
    essentialDetail: "Nur Welten, Einstellungen und Mods sichern; offizielle, per SteamCMD erneut ladbare Dateien nicht sichern.",
    essentialRecovery: "Zur Wiederherstellung den offiziellen Server per SteamCMD laden und die wichtigen Daten aus diesem Backup zurückspielen.",
    essentialButton: "Wichtige Daten sichern und schnell löschen",
    essentialConfirm: "Nur wichtige Daten sichern und den registrierten Palworld-Serverordner löschen. Offizielle Dateien sind nicht im Backup enthalten. Fortfahren?",
    essentialOverlayTitle: "Wichtige Daten werden gesichert und schnell gelöscht",
    essentialOverlayDetail: "Nach Prüfung und Sicherung von Welten, Einstellungen und Mods wird der registrierte Ordner samt ersetzbarer offizieller Dateien gelöscht.",
    noneTitle: "Jetzt ohne Backup löschen",
    noneDetail: "Den registrierten Ordner sofort löschen. Welten, Einstellungen und Mods bleiben nicht erhalten.",
    noneWarning: "Es wird kein letztes Backup erstellt. Die App kann die gelöschten Daten nicht wiederherstellen.",
    noneButton: "Jetzt löschen",
    noneConfirm: "Den registrierten Palworld-Serverordner jetzt ohne Backup löschen. Dies kann nicht rückgängig gemacht werden. Fortfahren?",
    noneOverlayTitle: "Wird ohne Backup gelöscht",
    noneOverlayDetail: "Der registrierte Palworld-Serverordner wird ohne letztes Backup gelöscht.",
  },
  es: {
    passwordWarning: "Los datos esenciales de Palworld pueden contener contraseñas de acceso y administración. No compartas la copia con otras personas.",
    essentialTitle: "Guardar datos esenciales y eliminar rápido (recomendado)",
    essentialDetail: "Guarda solo mundos, ajustes y mods; omite los archivos oficiales que SteamCMD puede volver a descargar.",
    essentialRecovery: "Para restaurar, descarga el servidor oficial con SteamCMD y repón los datos esenciales de esta copia.",
    essentialButton: "Guardar datos esenciales y eliminar rápido",
    essentialConfirm: "¿Guardar solo los datos esenciales y eliminar la carpeta registrada de Palworld? Los archivos oficiales no se incluirán en la copia.",
    essentialOverlayTitle: "Guardando datos esenciales y eliminando rápido",
    essentialOverlayDetail: "Tras verificar y guardar mundos, ajustes y mods, se eliminará la carpeta registrada con los archivos oficiales reemplazables.",
    noneTitle: "Eliminar ahora sin copia de seguridad",
    noneDetail: "Elimina la carpeta registrada de inmediato. No se conservarán mundos, ajustes ni mods.",
    noneWarning: "No se creará una copia final. La aplicación no podrá restaurar los datos eliminados.",
    noneButton: "Eliminar ahora",
    noneConfirm: "¿Eliminar ahora la carpeta registrada de Palworld sin crear ninguna copia? Esta acción no se puede deshacer.",
    noneOverlayTitle: "Eliminando sin copia de seguridad",
    noneOverlayDetail: "Se está eliminando la carpeta registrada de Palworld sin crear una copia final.",
  },
  fr: {
    passwordWarning: "Les données essentielles de Palworld peuvent contenir les mots de passe de connexion et d’administration. Ne partagez pas la sauvegarde.",
    essentialTitle: "Sauvegarder l’essentiel et supprimer rapidement (recommandé)",
    essentialDetail: "Sauvegarde uniquement les mondes, paramètres et mods, sans les fichiers officiels retéléchargeables par SteamCMD.",
    essentialRecovery: "Pour restaurer, retéléchargez le serveur officiel avec SteamCMD puis remettez les données essentielles de cette sauvegarde.",
    essentialButton: "Sauvegarder l’essentiel et supprimer rapidement",
    essentialConfirm: "Sauvegarder uniquement les données essentielles et supprimer le dossier du serveur Palworld enregistré ? Les fichiers officiels ne seront pas inclus.",
    essentialOverlayTitle: "Sauvegarde de l’essentiel et suppression rapide",
    essentialOverlayDetail: "Après vérification et sauvegarde des mondes, paramètres et mods, le dossier enregistré et ses fichiers officiels remplaçables seront supprimés.",
    noneTitle: "Supprimer maintenant sans sauvegarde",
    noneDetail: "Supprime immédiatement le dossier enregistré. Les mondes, paramètres et mods ne seront pas conservés.",
    noneWarning: "Aucune sauvegarde finale ne sera créée. L’application ne pourra pas restaurer les données supprimées.",
    noneButton: "Supprimer maintenant",
    noneConfirm: "Supprimer maintenant le dossier du serveur Palworld enregistré sans aucune sauvegarde ? Cette action est irréversible.",
    noneOverlayTitle: "Suppression sans sauvegarde",
    noneOverlayDetail: "Le dossier du serveur Palworld enregistré est supprimé sans créer de sauvegarde finale.",
  },
  ko: {
    passwordWarning: "Palworld 중요 데이터에는 참가 및 관리자 비밀번호가 포함될 수 있습니다. 백업을 다른 사람과 공유하지 마세요.",
    essentialTitle: "중요 데이터 저장 후 빠르게 삭제(권장)",
    essentialDetail: "월드, 설정, 모드만 저장하고 SteamCMD로 다시 받을 수 있는 공식 파일은 저장하지 않습니다.",
    essentialRecovery: "복원할 때 SteamCMD로 공식 서버를 다시 받은 뒤 이 백업의 중요 데이터를 되돌립니다.",
    essentialButton: "중요 데이터 저장 후 빠르게 삭제",
    essentialConfirm: "중요 데이터만 백업하고 등록된 Palworld 서버 폴더를 삭제할까요? 공식 파일은 백업에 포함되지 않습니다.",
    essentialOverlayTitle: "중요 데이터를 저장하고 빠르게 삭제하는 중",
    essentialOverlayDetail: "월드, 설정, 모드를 확인해 저장한 뒤 다시 받을 수 있는 공식 파일을 포함한 등록 폴더를 삭제합니다.",
    noneTitle: "백업 없이 지금 삭제",
    noneDetail: "등록된 폴더를 즉시 삭제합니다. 월드, 설정, 모드도 남지 않습니다.",
    noneWarning: "최종 백업을 만들지 않습니다. 삭제한 데이터는 이 앱에서 복원할 수 없습니다.",
    noneButton: "지금 삭제",
    noneConfirm: "백업을 전혀 만들지 않고 등록된 Palworld 서버 폴더를 지금 삭제할까요? 이 작업은 되돌릴 수 없습니다.",
    noneOverlayTitle: "백업 없이 삭제하는 중",
    noneOverlayDetail: "최종 백업을 만들지 않고 등록된 Palworld 서버 폴더를 삭제합니다.",
  },
  "pt-BR": {
    passwordWarning: "Os dados essenciais do Palworld podem conter senhas de entrada e de administrador. Não compartilhe o backup.",
    essentialTitle: "Salvar dados essenciais e excluir rapidamente (recomendado)",
    essentialDetail: "Salva apenas mundos, configurações e mods, sem copiar arquivos oficiais que o SteamCMD pode baixar novamente.",
    essentialRecovery: "Para restaurar, baixe novamente o servidor oficial pelo SteamCMD e recoloque os dados essenciais deste backup.",
    essentialButton: "Salvar dados essenciais e excluir rapidamente",
    essentialConfirm: "Salvar apenas os dados essenciais e excluir a pasta registrada do servidor Palworld? Os arquivos oficiais não entrarão no backup.",
    essentialOverlayTitle: "Salvando dados essenciais e excluindo rapidamente",
    essentialOverlayDetail: "Após verificar e salvar mundos, configurações e mods, a pasta registrada e os arquivos oficiais substituíveis serão excluídos.",
    noneTitle: "Excluir agora sem backup",
    noneDetail: "Exclui a pasta registrada imediatamente. Mundos, configurações e mods não serão mantidos.",
    noneWarning: "Nenhum backup final será criado. O aplicativo não poderá restaurar os dados excluídos.",
    noneButton: "Excluir agora",
    noneConfirm: "Excluir agora a pasta registrada do servidor Palworld sem criar backup? Esta ação não pode ser desfeita.",
    noneOverlayTitle: "Excluindo sem backup",
    noneOverlayDetail: "A pasta registrada do servidor Palworld está sendo excluída sem criar um backup final.",
  },
  "zh-CN": {
    passwordWarning: "Palworld 重要数据可能包含加入密码和管理员密码。请勿将备份分享给他人。",
    essentialTitle: "保存重要数据并快速删除（推荐）",
    essentialDetail: "仅保存世界、设置和模组，不保存可通过 SteamCMD 重新下载的官方文件。",
    essentialRecovery: "恢复时，请先用 SteamCMD 重新下载官方服务器，再放回此备份中的重要数据。",
    essentialButton: "保存重要数据并快速删除",
    essentialConfirm: "仅备份重要数据并删除已注册的 Palworld 服务器文件夹？官方文件不会包含在备份中。",
    essentialOverlayTitle: "正在保存重要数据并快速删除",
    essentialOverlayDetail: "验证并保存世界、设置和模组后，将删除包含可替换官方文件的已注册文件夹。",
    noneTitle: "不备份，立即删除",
    noneDetail: "立即删除已注册的文件夹。世界、设置和模组也不会保留。",
    noneWarning: "不会创建最终备份。本应用无法恢复删除的数据。",
    noneButton: "立即删除",
    noneConfirm: "不创建任何备份，立即删除已注册的 Palworld 服务器文件夹？此操作无法撤销。",
    noneOverlayTitle: "正在不备份删除",
    noneOverlayDetail: "正在删除已注册的 Palworld 服务器文件夹，不创建最终备份。",
  },
  "zh-TW": {
    passwordWarning: "Palworld 重要資料可能包含加入密碼與管理員密碼。請勿將備份分享給他人。",
    essentialTitle: "儲存重要資料並快速刪除（建議）",
    essentialDetail: "只儲存世界、設定與模組，不儲存可透過 SteamCMD 重新下載的官方檔案。",
    essentialRecovery: "還原時，請先用 SteamCMD 重新下載官方伺服器，再放回此備份的重要資料。",
    essentialButton: "儲存重要資料並快速刪除",
    essentialConfirm: "只備份重要資料並刪除已登錄的 Palworld 伺服器資料夾？官方檔案不會包含在備份中。",
    essentialOverlayTitle: "正在儲存重要資料並快速刪除",
    essentialOverlayDetail: "驗證並儲存世界、設定與模組後，將刪除包含可替換官方檔案的已登錄資料夾。",
    noneTitle: "不備份，立即刪除",
    noneDetail: "立即刪除已登錄的資料夾。世界、設定與模組也不會保留。",
    noneWarning: "不會建立最終備份。本應用程式無法還原已刪除的資料。",
    noneButton: "立即刪除",
    noneConfirm: "不建立任何備份，立即刪除已登錄的 Palworld 伺服器資料夾？此操作無法復原。",
    noneOverlayTitle: "正在不備份刪除",
    noneOverlayDetail: "正在刪除已登錄的 Palworld 伺服器資料夾，不建立最終備份。",
  },
};

const minecraftCopies: Record<AppLocale, MinecraftDeleteCopy> = {
  ja: {
    noneTitle: "バックアップせず今すぐ削除",
    noneDetail: "登録済みのMinecraftサーバーフォルダーをすぐ削除します。ワールド、設定、Mod／プラグインも残りません。",
    noneWarning: "最終バックアップは作成されません。削除したワールド、設定、Mod／プラグインはこのアプリから復旧できません。",
    noneButton: "今すぐ削除",
    noneConfirm: "バックアップを一切作成せず、登録済みのMinecraftサーバーフォルダーを今すぐ削除します。この操作は取り消せません。続けますか？",
    noneOverlayTitle: "バックアップせず削除しています",
    noneOverlayDetail: "最終バックアップを作成せず、登録済みのMinecraftサーバーフォルダーを削除します。",
  },
  en: {
    noneTitle: "Delete now without a backup",
    noneDetail: "Delete the registered Minecraft server folder immediately. Worlds, settings, mods, and plugins will not remain.",
    noneWarning: "No final backup will be created. This app cannot restore deleted worlds, settings, mods, or plugins.",
    noneButton: "Delete now",
    noneConfirm: "Delete the registered Minecraft server folder now without creating any backup. This cannot be undone. Continue?",
    noneOverlayTitle: "Deleting without a backup",
    noneOverlayDetail: "The registered Minecraft server folder is being deleted without creating a final backup.",
  },
  de: {
    noneTitle: "Jetzt ohne Backup löschen",
    noneDetail: "Den registrierten Minecraft-Serverordner sofort löschen. Welten, Einstellungen, Mods und Plugins bleiben nicht erhalten.",
    noneWarning: "Es wird kein letztes Backup erstellt. Die App kann gelöschte Welten, Einstellungen, Mods oder Plugins nicht wiederherstellen.",
    noneButton: "Jetzt löschen",
    noneConfirm: "Den registrierten Minecraft-Serverordner jetzt ohne Backup löschen? Dies kann nicht rückgängig gemacht werden. Fortfahren?",
    noneOverlayTitle: "Wird ohne Backup gelöscht",
    noneOverlayDetail: "Der registrierte Minecraft-Serverordner wird ohne letztes Backup gelöscht.",
  },
  es: {
    noneTitle: "Eliminar ahora sin copia de seguridad",
    noneDetail: "Elimina de inmediato la carpeta registrada del servidor de Minecraft. No se conservarán mundos, ajustes, mods ni plugins.",
    noneWarning: "No se creará una copia final. La aplicación no podrá restaurar los mundos, ajustes, mods ni plugins eliminados.",
    noneButton: "Eliminar ahora",
    noneConfirm: "¿Eliminar ahora la carpeta registrada del servidor de Minecraft sin crear ninguna copia? Esta acción no se puede deshacer.",
    noneOverlayTitle: "Eliminando sin copia de seguridad",
    noneOverlayDetail: "Se está eliminando la carpeta registrada del servidor de Minecraft sin crear una copia final.",
  },
  fr: {
    noneTitle: "Supprimer maintenant sans sauvegarde",
    noneDetail: "Supprime immédiatement le dossier du serveur Minecraft enregistré. Les mondes, paramètres, mods et plugins ne seront pas conservés.",
    noneWarning: "Aucune sauvegarde finale ne sera créée. L’application ne pourra pas restaurer les mondes, paramètres, mods ou plugins supprimés.",
    noneButton: "Supprimer maintenant",
    noneConfirm: "Supprimer maintenant le dossier du serveur Minecraft enregistré sans aucune sauvegarde ? Cette action est irréversible.",
    noneOverlayTitle: "Suppression sans sauvegarde",
    noneOverlayDetail: "Le dossier du serveur Minecraft enregistré est supprimé sans créer de sauvegarde finale.",
  },
  ko: {
    noneTitle: "백업 없이 지금 삭제",
    noneDetail: "등록된 Minecraft 서버 폴더를 즉시 삭제합니다. 월드, 설정, 모드, 플러그인도 남지 않습니다.",
    noneWarning: "최종 백업을 만들지 않습니다. 삭제한 월드, 설정, 모드, 플러그인은 이 앱에서 복원할 수 없습니다.",
    noneButton: "지금 삭제",
    noneConfirm: "백업을 전혀 만들지 않고 등록된 Minecraft 서버 폴더를 지금 삭제할까요? 이 작업은 되돌릴 수 없습니다.",
    noneOverlayTitle: "백업 없이 삭제하는 중",
    noneOverlayDetail: "최종 백업을 만들지 않고 등록된 Minecraft 서버 폴더를 삭제합니다.",
  },
  "pt-BR": {
    noneTitle: "Excluir agora sem backup",
    noneDetail: "Exclui imediatamente a pasta registrada do servidor Minecraft. Mundos, configurações, mods e plugins não serão mantidos.",
    noneWarning: "Nenhum backup final será criado. O aplicativo não poderá restaurar mundos, configurações, mods ou plugins excluídos.",
    noneButton: "Excluir agora",
    noneConfirm: "Excluir agora a pasta registrada do servidor Minecraft sem criar backup? Esta ação não pode ser desfeita.",
    noneOverlayTitle: "Excluindo sem backup",
    noneOverlayDetail: "A pasta registrada do servidor Minecraft está sendo excluída sem criar um backup final.",
  },
  "zh-CN": {
    noneTitle: "不备份，立即删除",
    noneDetail: "立即删除已注册的 Minecraft 服务器文件夹。世界、设置、模组和插件也不会保留。",
    noneWarning: "不会创建最终备份。本应用无法恢复已删除的世界、设置、模组或插件。",
    noneButton: "立即删除",
    noneConfirm: "不创建任何备份，立即删除已注册的 Minecraft 服务器文件夹？此操作无法撤销。",
    noneOverlayTitle: "正在不备份删除",
    noneOverlayDetail: "正在删除已注册的 Minecraft 服务器文件夹，不创建最终备份。",
  },
  "zh-TW": {
    noneTitle: "不備份，立即刪除",
    noneDetail: "立即刪除已登錄的 Minecraft 伺服器資料夾。世界、設定、模組與外掛也不會保留。",
    noneWarning: "不會建立最終備份。本應用程式無法還原已刪除的世界、設定、模組或外掛。",
    noneButton: "立即刪除",
    noneConfirm: "不建立任何備份，立即刪除已登錄的 Minecraft 伺服器資料夾？此操作無法復原。",
    noneOverlayTitle: "正在不備份刪除",
    noneOverlayDetail: "正在刪除已登錄的 Minecraft 伺服器資料夾，不建立最終備份。",
  },
};

export const palworldDeleteCopy = (locale: AppLocale): PalworldDeleteCopy => copies[locale];
export const palworldDeleteWarning = (locale: AppLocale): string => copies[locale].passwordWarning;
export const minecraftDeleteCopy = (locale: AppLocale): MinecraftDeleteCopy => minecraftCopies[locale];
