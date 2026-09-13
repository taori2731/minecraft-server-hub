import type { AppLocale } from "./i18n";
import { brand } from "./brand";

export type RebrandCopy = {
  migrationKicker: string;
  migrationTitle: string;
  migrationBody: string;
  migrationDistribution: string;
  migrationClose: string;
  migrationDialogLabel: string;
  nonAffiliationTitle: string;
  nonAffiliationBody: string;
  uninstallDescription: string;
  uninstallPanelTitle: string;
  uninstallDetail: string;
  uninstallButton: string;
  uninstallConfirm: string;
  uninstallSuccess: string;
  uninstallNote: string;
  exitConfirm: string;
};

const copies: Record<AppLocale, RebrandCopy> = {
  ja: {
    migrationKicker: "ブランド更新",
    migrationTitle: `${brand.legacyProductName}は${brand.productName}になりました`,
    migrationBody: "サーバー、ワールド、設定、バックアップは維持されています。",
    migrationDistribution: "更新署名と配布元は従来と同じです。",
    migrationClose: "確認して閉じる",
    migrationDialogLabel: `${brand.productName}の名称変更案内`,
    nonAffiliationTitle: "非公式・非提携",
    nonAffiliationBody: `${brand.productName}はMinecraft、Mojang、Microsoft、Palworld、Pocketpair、Valveとは提携していない独立プロジェクトです。`,
    uninstallDescription: `${brand.productName}の削除はWindowsの「インストールされているアプリ」から行います。確認なく削除は開始しません。`,
    uninstallPanelTitle: "Windowsのアンインストール画面を開く",
    uninstallDetail: "サーバーフォルダーやワールドは、この操作だけでは削除しません。",
    uninstallButton: "アンインストール画面を開く",
    uninstallConfirm: `Windowsのアンインストール画面を開きますか？\n${brand.productName}を選んで削除するまでは、アプリは変更されません。`,
    uninstallSuccess: "Windowsのアンインストール画面を開きました",
    uninstallNote: "このボタンはWindows設定を開くだけです。サーバー、ワールド、バックアップ、アプリ管理データの削除はここでは実行しません。",
    exitConfirm: `${brand.productName}を終了しますか？\n\n起動中のサーバーがある場合は、先に安全停止してください。`,
  },
  en: {
    migrationKicker: "BRAND UPDATE",
    migrationTitle: `${brand.legacyProductName} is now ${brand.productName}`,
    migrationBody: "Your servers, worlds, settings, and backups are preserved.",
    migrationDistribution: "The update signature and distribution source are the same as before.",
    migrationClose: "Acknowledge and close",
    migrationDialogLabel: `${brand.productName} name change notice`,
    nonAffiliationTitle: "Unofficial and unaffiliated",
    nonAffiliationBody: `${brand.productName} is an independent project and is not affiliated with Minecraft, Mojang, Microsoft, Palworld, Pocketpair, or Valve.`,
    uninstallDescription: `Remove ${brand.productName} from Windows Installed apps. Nothing is uninstalled without your confirmation.`,
    uninstallPanelTitle: "Open Windows uninstall settings",
    uninstallDetail: "This action does not delete server folders or worlds by itself.",
    uninstallButton: "Open uninstall settings",
    uninstallConfirm: `Open Windows uninstall settings?\nThe app will not change until you select and remove ${brand.productName}.`,
    uninstallSuccess: "Windows uninstall settings opened",
    uninstallNote: "This button only opens Windows Settings. It does not delete servers, worlds, backups, or app-managed data.",
    exitConfirm: `Exit ${brand.productName}?\n\nIf a server is running, stop it safely first.`,
  },
  de: {
    migrationKicker: "MARKEN-UPDATE",
    migrationTitle: `${brand.legacyProductName} heißt jetzt ${brand.productName}`,
    migrationBody: "Ihre Server, Welten, Einstellungen und Sicherungen bleiben erhalten.",
    migrationDistribution: "Updatesignatur und Verteilungsquelle sind unverändert.",
    migrationClose: "Bestätigen und schließen",
    migrationDialogLabel: `${brand.productName}-Hinweis zur Namensänderung`,
    nonAffiliationTitle: "Inoffiziell und nicht verbunden",
    nonAffiliationBody: `${brand.productName} ist ein unabhängiges Projekt und steht in keiner Verbindung zu Minecraft, Mojang, Microsoft, Palworld, Pocketpair oder Valve.`,
    uninstallDescription: `Entfernen Sie ${brand.productName} über die installierten Apps von Windows. Ohne Ihre Bestätigung wird nichts deinstalliert.`,
    uninstallPanelTitle: "Windows-Deinstallationseinstellungen öffnen",
    uninstallDetail: "Serverordner und Welten werden durch diese Aktion nicht automatisch gelöscht.",
    uninstallButton: "Deinstallationseinstellungen öffnen",
    uninstallConfirm: `Windows-Deinstallationseinstellungen öffnen?\nDie App bleibt unverändert, bis Sie ${brand.productName} auswählen und entfernen.`,
    uninstallSuccess: "Windows-Deinstallationseinstellungen geöffnet",
    uninstallNote: "Diese Schaltfläche öffnet nur die Windows-Einstellungen. Server, Welten, Sicherungen und von der App verwaltete Daten werden nicht gelöscht.",
    exitConfirm: `${brand.productName} beenden?\n\nWenn ein Server läuft, stoppen Sie ihn zuerst sicher.`,
  },
  es: {
    migrationKicker: "ACTUALIZACIÓN DE MARCA",
    migrationTitle: `${brand.legacyProductName} ahora es ${brand.productName}`,
    migrationBody: "Tus servidores, mundos, ajustes y copias de seguridad se conservan.",
    migrationDistribution: "La firma de actualización y el origen de distribución son los mismos de antes.",
    migrationClose: "Confirmar y cerrar",
    migrationDialogLabel: `Aviso de cambio de nombre de ${brand.productName}`,
    nonAffiliationTitle: "No oficial y sin afiliación",
    nonAffiliationBody: `${brand.productName} es un proyecto independiente y no está afiliado a Minecraft, Mojang, Microsoft, Palworld, Pocketpair ni Valve.`,
    uninstallDescription: `Elimina ${brand.productName} desde las aplicaciones instaladas de Windows. Nada se desinstala sin tu confirmación.`,
    uninstallPanelTitle: "Abrir la configuración de desinstalación de Windows",
    uninstallDetail: "Esta acción no elimina por sí sola las carpetas de servidores ni los mundos.",
    uninstallButton: "Abrir configuración de desinstalación",
    uninstallConfirm: `¿Abrir la configuración de desinstalación de Windows?\nLa aplicación no cambiará hasta que selecciones y elimines ${brand.productName}.`,
    uninstallSuccess: "Configuración de desinstalación de Windows abierta",
    uninstallNote: "Este botón solo abre la configuración de Windows. No elimina servidores, mundos, copias de seguridad ni datos gestionados por la aplicación.",
    exitConfirm: `¿Salir de ${brand.productName}?\n\nSi hay un servidor en ejecución, detenlo de forma segura primero.`,
  },
  fr: {
    migrationKicker: "MISE À JOUR DE LA MARQUE",
    migrationTitle: `${brand.legacyProductName} devient ${brand.productName}`,
    migrationBody: "Vos serveurs, mondes, paramètres et sauvegardes sont conservés.",
    migrationDistribution: "La signature de mise à jour et la source de distribution restent les mêmes.",
    migrationClose: "Confirmer et fermer",
    migrationDialogLabel: `Avis de changement de nom de ${brand.productName}`,
    nonAffiliationTitle: "Non officiel et sans affiliation",
    nonAffiliationBody: `${brand.productName} est un projet indépendant et n’est affilié ni à Minecraft, ni à Mojang, ni à Microsoft, ni à Palworld, ni à Pocketpair, ni à Valve.`,
    uninstallDescription: `Supprimez ${brand.productName} depuis les applications installées de Windows. Rien n’est désinstallé sans votre confirmation.`,
    uninstallPanelTitle: "Ouvrir les paramètres de désinstallation de Windows",
    uninstallDetail: "Cette action ne supprime pas à elle seule les dossiers de serveurs ni les mondes.",
    uninstallButton: "Ouvrir les paramètres de désinstallation",
    uninstallConfirm: `Ouvrir les paramètres de désinstallation de Windows ?\nL’application ne changera pas tant que vous n’aurez pas sélectionné et supprimé ${brand.productName}.`,
    uninstallSuccess: "Paramètres de désinstallation de Windows ouverts",
    uninstallNote: "Ce bouton ouvre uniquement les paramètres Windows. Il ne supprime ni serveurs, ni mondes, ni sauvegardes, ni données gérées par l’application.",
    exitConfirm: `Quitter ${brand.productName} ?\n\nSi un serveur fonctionne, arrêtez-le d’abord en toute sécurité.`,
  },
  ko: {
    migrationKicker: "브랜드 업데이트",
    migrationTitle: `${brand.legacyProductName}가 이제 ${brand.productName}가 되었습니다`,
    migrationBody: "서버, 월드, 설정 및 백업은 그대로 유지됩니다.",
    migrationDistribution: "업데이트 서명과 배포 출처는 이전과 동일합니다.",
    migrationClose: "확인하고 닫기",
    migrationDialogLabel: `${brand.productName} 이름 변경 안내`,
    nonAffiliationTitle: "비공식·비제휴",
    nonAffiliationBody: `${brand.productName}는 Minecraft, Mojang, Microsoft, Palworld, Pocketpair, Valve와 제휴하지 않은 독립 프로젝트입니다.`,
    uninstallDescription: `Windows의 설치된 앱에서 ${brand.productName}를 제거하세요. 확인 없이는 아무것도 제거되지 않습니다.`,
    uninstallPanelTitle: "Windows 제거 설정 열기",
    uninstallDetail: "이 작업만으로 서버 폴더나 월드가 삭제되지는 않습니다.",
    uninstallButton: "제거 설정 열기",
    uninstallConfirm: `Windows 제거 설정을 열까요?\n${brand.productName}를 선택하여 제거하기 전에는 앱이 변경되지 않습니다.`,
    uninstallSuccess: "Windows 제거 설정을 열었습니다",
    uninstallNote: "이 버튼은 Windows 설정만 엽니다. 서버, 월드, 백업 또는 앱 관리 데이터는 삭제하지 않습니다.",
    exitConfirm: `${brand.productName}를 종료할까요?\n\n실행 중인 서버가 있다면 먼저 안전하게 중지하세요.`,
  },
  "pt-BR": {
    migrationKicker: "ATUALIZAÇÃO DA MARCA",
    migrationTitle: `${brand.legacyProductName} agora é ${brand.productName}`,
    migrationBody: "Seus servidores, mundos, configurações e backups foram preservados.",
    migrationDistribution: "A assinatura da atualização e a origem da distribuição são as mesmas de antes.",
    migrationClose: "Confirmar e fechar",
    migrationDialogLabel: `Aviso de mudança de nome do ${brand.productName}`,
    nonAffiliationTitle: "Não oficial e sem afiliação",
    nonAffiliationBody: `${brand.productName} é um projeto independente e não tem afiliação com Minecraft, Mojang, Microsoft, Palworld, Pocketpair ou Valve.`,
    uninstallDescription: `Remova ${brand.productName} em Aplicativos instalados do Windows. Nada é desinstalado sem sua confirmação.`,
    uninstallPanelTitle: "Abrir configurações de desinstalação do Windows",
    uninstallDetail: "Essa ação não exclui pastas de servidores nem mundos por si só.",
    uninstallButton: "Abrir configurações de desinstalação",
    uninstallConfirm: `Abrir as configurações de desinstalação do Windows?\nO aplicativo não mudará até você selecionar e remover ${brand.productName}.`,
    uninstallSuccess: "Configurações de desinstalação do Windows abertas",
    uninstallNote: "Este botão apenas abre as Configurações do Windows. Ele não exclui servidores, mundos, backups ou dados gerenciados pelo aplicativo.",
    exitConfirm: `Sair do ${brand.productName}?\n\nSe houver um servidor em execução, pare-o com segurança primeiro.`,
  },
  "zh-CN": {
    migrationKicker: "品牌更新",
    migrationTitle: `${brand.legacyProductName}现已更名为${brand.productName}`,
    migrationBody: "服务器、世界、设置和备份均会保留。",
    migrationDistribution: "更新签名和分发来源与之前相同。",
    migrationClose: "确认并关闭",
    migrationDialogLabel: `${brand.productName} 更名提示`,
    nonAffiliationTitle: "非官方且无关联",
    nonAffiliationBody: `${brand.productName}是独立项目，与 Minecraft、Mojang、Microsoft、Palworld、Pocketpair 或 Valve 没有隶属关系。`,
    uninstallDescription: `请从 Windows 的“已安装的应用”中卸载${brand.productName}。未经确认不会开始卸载。`,
    uninstallPanelTitle: "打开 Windows 卸载设置",
    uninstallDetail: "此操作不会单独删除服务器文件夹或世界。",
    uninstallButton: "打开卸载设置",
    uninstallConfirm: `要打开 Windows 卸载设置吗？\n在选择并删除 ${brand.productName} 之前，应用不会发生变化。`,
    uninstallSuccess: "已打开 Windows 卸载设置",
    uninstallNote: "此按钮只会打开 Windows 设置，不会删除服务器、世界、备份或应用管理的数据。",
    exitConfirm: `要退出${brand.productName}吗？\n\n如果有正在运行的服务器，请先安全停止。`,
  },
  "zh-TW": {
    migrationKicker: "品牌更新",
    migrationTitle: `${brand.legacyProductName}現已更名為${brand.productName}`,
    migrationBody: "伺服器、世界、設定與備份都會保留。",
    migrationDistribution: "更新簽章與發佈來源和之前相同。",
    migrationClose: "確認並關閉",
    migrationDialogLabel: `${brand.productName} 更名提示`,
    nonAffiliationTitle: "非官方且無關聯",
    nonAffiliationBody: `${brand.productName}是獨立專案，與 Minecraft、Mojang、Microsoft、Palworld、Pocketpair 或 Valve 沒有隸屬關係。`,
    uninstallDescription: `請從 Windows 的「已安裝的應用程式」中解除安裝${brand.productName}。未經確認不會開始解除安裝。`,
    uninstallPanelTitle: "開啟 Windows 解除安裝設定",
    uninstallDetail: "此操作不會單獨刪除伺服器資料夾或世界。",
    uninstallButton: "開啟解除安裝設定",
    uninstallConfirm: `要開啟 Windows 解除安裝設定嗎？\n在選取並刪除 ${brand.productName} 之前，應用程式不會變更。`,
    uninstallSuccess: "已開啟 Windows 解除安裝設定",
    uninstallNote: "此按鈕只會開啟 Windows 設定，不會刪除伺服器、世界、備份或應用程式管理的資料。",
    exitConfirm: `要結束${brand.productName}嗎？\n\n如果有正在執行的伺服器，請先安全停止。`,
  },
};

export function rebrandText(locale: AppLocale, key: keyof RebrandCopy) {
  return copies[locale][key];
}

export function getRebrandCopy(locale: AppLocale) {
  return copies[locale];
}
