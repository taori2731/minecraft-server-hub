import type { Locale } from "./locale";

export type ReleaseHandoffCopy = {
  title: string; intro: string; privacy: string; nativeOnly: string;
  prepare: string; preparing: string; refresh: string; verify: string; verifying: string;
  ready: string; approvalRequired: string; approvalRequiredHint: string;
  version: string; approval: string; warnings: string; packSize: string;
  candidateDigest: string; approvalDigest: string; payloadDigest: string;
  contents: string; confirm: string; export: string; exporting: string;
  exported: string; canceled: string; failed: string; verified: string; invalid: string;
  currentCandidate: string; currentApproval: string; matches: string; differs: string;
  noPersonalData: string; noPublish: string;
};

export type ReleaseHandoffTrustCopy = {
  title: string; expectedDigest: string; expectedDigestHint: string; expectedDigestPlaceholder: string;
  selfIntegrity: string; selfIntegrityPassed: string; originAssurance: string;
  notEstablished: string; trustedDigestMatch: string; localApprovalMatch: string; digestMismatch: string;
  digestNotProvided: string; digestMatches: string; digestDiffers: string; caveat: string;
};

const copies: Record<Locale, ReleaseHandoffCopy> = {
  en: {
    title: "Release handoff pack", intro: "Package the current D20 evidence and its exact D21 approval anchor for a release operator. Self-integrity checks detect changes; sender authenticity requires a trusted digest or the original local ledger.", privacy: "Approver names and rationales are excluded. Only hashes, warning identifiers, timestamps, and the sanitized D20 evidence are transferred.", nativeOnly: "Release handoff is available only in the installed Windows Developer Tools app.",
    prepare: "Prepare handoff", preparing: "Matching the current approval…", refresh: "Refresh handoff", verify: "Verify saved pack", verifying: "Verifying handoff…", ready: "Ready to hand off", approvalRequired: "Current candidate is not approved", approvalRequiredHint: "Record an approval for this exact candidate in D21, then prepare the handoff again.",
    version: "Version", approval: "Approval event", warnings: "Preserved warnings", packSize: "Pack size", candidateDigest: "Candidate SHA-256", approvalDigest: "Approval event SHA-256", payloadDigest: "Handoff SHA-256", contents: "Included evidence", confirm: "I understand that this pack transfers candidate and approval references but does not authenticate the sender or publish a release.", export: "Export .mshhandoff", exporting: "Exporting handoff…", exported: "Release handoff exported to {path}", canceled: "The file selection was canceled.", failed: "The handoff operation failed.", verified: "Self-integrity checks passed", invalid: "Invalid handoff pack", currentCandidate: "Current candidate", currentApproval: "Local approval", matches: "Matches", differs: "Differs", noPersonalData: "No approver name or rationale", noPublish: "No build, signing, upload, or publish capability",
  },
  ja: {
    title: "リリース引き継ぎパック", intro: "現在のD20証跡と、それに完全一致するD21承認アンカーを公開担当へ渡せる形にまとめます。内部変更は自己整合性で検出し、送信元の確認には信頼済みSHA-256または元のローカル台帳を使います。", privacy: "承認者名と承認理由は含めません。ハッシュ、警告識別子、日時、匿名化済みD20証跡だけを引き継ぎます。", nativeOnly: "リリース引き継ぎはインストール済みWindows版Developer Toolsでのみ利用できます。",
    prepare: "引き継ぎを準備", preparing: "現在の承認と照合しています…", refresh: "引き継ぎを再確認", verify: "保存済みパックを検証", verifying: "引き継ぎを検証しています…", ready: "引き継ぎ可能", approvalRequired: "現在の候補は未承認です", approvalRequiredHint: "D21でこの候補と完全一致する承認を記録してから、もう一度準備してください。",
    version: "バージョン", approval: "承認イベント", warnings: "保持される警告", packSize: "パック容量", candidateDigest: "候補SHA-256", approvalDigest: "承認イベントSHA-256", payloadDigest: "引き継ぎSHA-256", contents: "含まれる証跡", confirm: "このパックは候補と承認の参照情報を渡しますが、送信元の真正性を証明せず、リリースも公開しないことを理解しました。", export: ".mshhandoffを保存", exporting: "引き継ぎを保存しています…", exported: "リリース引き継ぎを{path}へ保存しました", canceled: "ファイル選択をキャンセルしました。", failed: "引き継ぎ操作に失敗しました。", verified: "自己整合性チェック成功", invalid: "引き継ぎパックが無効です", currentCandidate: "現在の候補", currentApproval: "ローカル承認", matches: "一致", differs: "不一致", noPersonalData: "承認者名・理由を含みません", noPublish: "ビルド・署名・アップロード・公開機能なし",
  },
  "zh-CN": {
    title: "发布交接包", intro: "将当前 D20 证据与完全匹配的 D21 审批锚点打包交给发布人员。内部变更由自身完整性检查发现；确认来源需要可信 SHA-256 或原始本地台账。", privacy: "不包含审批者姓名或理由，仅传递哈希、警告标识、时间和已净化的 D20 证据。", nativeOnly: "发布交接仅可在已安装的 Windows Developer Tools 中使用。",
    prepare: "准备交接", preparing: "正在匹配当前审批…", refresh: "重新检查交接", verify: "验证已保存的包", verifying: "正在验证交接…", ready: "可以交接", approvalRequired: "当前候选版本尚未审批", approvalRequiredHint: "请先在 D21 中记录与此候选版本完全匹配的审批。", version: "版本", approval: "审批事件", warnings: "保留的警告", packSize: "包大小", candidateDigest: "候选 SHA-256", approvalDigest: "审批事件 SHA-256", payloadDigest: "交接 SHA-256", contents: "包含的证据", confirm: "我理解此包仅传递候选版本和审批引用，不验证发送者身份，也不会发布版本。", export: "导出 .mshhandoff", exporting: "正在导出交接…", exported: "发布交接已导出到 {path}", canceled: "已取消文件选择。", failed: "交接操作失败。", verified: "自身完整性检查通过", invalid: "交接包无效", currentCandidate: "当前候选", currentApproval: "本地审批", matches: "匹配", differs: "不匹配", noPersonalData: "不含审批者姓名或理由", noPublish: "无构建、签名、上传或发布能力",
  },
  "zh-TW": {
    title: "發行交接套件", intro: "將目前 D20 證據與完全相符的 D21 核准錨點封裝給發行人員。內部變更由自身完整性檢查發現；確認來源需要可信 SHA-256 或原始本機台帳。", privacy: "不包含核准者姓名或理由，只傳遞雜湊、警告識別碼、時間與已清理的 D20 證據。", nativeOnly: "發行交接僅能在已安裝的 Windows Developer Tools 中使用。",
    prepare: "準備交接", preparing: "正在比對目前核准…", refresh: "重新檢查交接", verify: "驗證已儲存套件", verifying: "正在驗證交接…", ready: "可交接", approvalRequired: "目前候選版本尚未核准", approvalRequiredHint: "請先在 D21 記錄與此候選版本完全相符的核准。", version: "版本", approval: "核准事件", warnings: "保留的警告", packSize: "套件大小", candidateDigest: "候選 SHA-256", approvalDigest: "核准事件 SHA-256", payloadDigest: "交接 SHA-256", contents: "包含的證據", confirm: "我了解此套件只傳遞候選版本與核准參照，不驗證傳送者身分，也不會發行版本。", export: "匯出 .mshhandoff", exporting: "正在匯出交接…", exported: "發行交接已匯出至 {path}", canceled: "已取消檔案選擇。", failed: "交接操作失敗。", verified: "自身完整性檢查通過", invalid: "交接套件無效", currentCandidate: "目前候選", currentApproval: "本機核准", matches: "相符", differs: "不符", noPersonalData: "不含核准者姓名或理由", noPublish: "無建置、簽署、上傳或發行能力",
  },
  ko: {
    title: "릴리스 인계 팩", intro: "현재 D20 증거와 정확히 일치하는 D21 승인 앵커를 릴리스 담당자에게 전달합니다. 내부 변경은 자체 무결성으로 감지하며 출처 확인에는 신뢰한 SHA-256 또는 원본 로컬 원장을 사용합니다.", privacy: "승인자 이름과 사유는 제외하며 해시, 경고 식별자, 시간 및 정제된 D20 증거만 전달합니다.", nativeOnly: "릴리스 인계는 설치된 Windows Developer Tools에서만 사용할 수 있습니다.",
    prepare: "인계 준비", preparing: "현재 승인을 대조하는 중…", refresh: "인계 다시 확인", verify: "저장된 팩 검증", verifying: "인계 검증 중…", ready: "인계 가능", approvalRequired: "현재 후보가 승인되지 않았습니다", approvalRequiredHint: "D21에서 이 후보와 정확히 일치하는 승인을 기록하세요.", version: "버전", approval: "승인 이벤트", warnings: "보존된 경고", packSize: "팩 크기", candidateDigest: "후보 SHA-256", approvalDigest: "승인 이벤트 SHA-256", payloadDigest: "인계 SHA-256", contents: "포함된 증거", confirm: "이 팩은 후보와 승인 참조만 전달하며 발신자를 인증하거나 릴리스를 게시하지 않음을 이해했습니다.", export: ".mshhandoff 내보내기", exporting: "인계 내보내는 중…", exported: "릴리스 인계를 {path}에 내보냈습니다", canceled: "파일 선택을 취소했습니다.", failed: "인계 작업에 실패했습니다.", verified: "자체 무결성 검사 통과", invalid: "잘못된 인계 팩", currentCandidate: "현재 후보", currentApproval: "로컬 승인", matches: "일치", differs: "불일치", noPersonalData: "승인자 이름 또는 사유 없음", noPublish: "빌드, 서명, 업로드 또는 게시 기능 없음",
  },
  es: {
    title: "Paquete de entrega de versión", intro: "Empaqueta la evidencia D20 y su ancla D21 exacta. La integridad interna detecta cambios; para confirmar el origen se necesita un SHA-256 confiable o el registro local original.", privacy: "Se excluyen el nombre y la justificación del aprobador; solo se transfieren hashes, avisos, fechas y la evidencia D20 saneada.", nativeOnly: "La entrega solo está disponible en Developer Tools para Windows.",
    prepare: "Preparar entrega", preparing: "Comparando la aprobación actual…", refresh: "Actualizar entrega", verify: "Verificar paquete", verifying: "Verificando entrega…", ready: "Listo para entregar", approvalRequired: "El candidato actual no está aprobado", approvalRequiredHint: "Registra en D21 una aprobación que coincida exactamente con este candidato.", version: "Versión", approval: "Evento de aprobación", warnings: "Avisos conservados", packSize: "Tamaño", candidateDigest: "SHA-256 del candidato", approvalDigest: "SHA-256 de aprobación", payloadDigest: "SHA-256 de entrega", contents: "Evidencia incluida", confirm: "Entiendo que este paquete transfiere referencias del candidato y la aprobación, pero no autentica al remitente ni publica la versión.", export: "Exportar .mshhandoff", exporting: "Exportando entrega…", exported: "Entrega exportada a {path}", canceled: "Selección cancelada.", failed: "Falló la operación de entrega.", verified: "Integridad interna verificada", invalid: "Paquete de entrega no válido", currentCandidate: "Candidato actual", currentApproval: "Aprobación local", matches: "Coincide", differs: "Difiere", noPersonalData: "Sin nombre ni justificación", noPublish: "Sin compilación, firma, subida ni publicación",
  },
  de: {
    title: "Release-Übergabepaket", intro: "Bündelt den D20-Nachweis mit dem passenden D21-Anker. Interne Änderungen erkennt die Selbstintegrität; zur Herkunftsprüfung dient eine vertrauenswürdige SHA-256 oder das ursprüngliche lokale Ledger.", privacy: "Name und Begründung des Freigebenden werden ausgeschlossen. Übertragen werden nur Hashes, Warnungskennungen, Zeiten und bereinigte D20-Nachweise.", nativeOnly: "Die Release-Übergabe ist nur in den installierten Windows Developer Tools verfügbar.",
    prepare: "Übergabe vorbereiten", preparing: "Aktuelle Freigabe wird abgeglichen…", refresh: "Übergabe aktualisieren", verify: "Gespeichertes Paket prüfen", verifying: "Übergabe wird geprüft…", ready: "Übergabebereit", approvalRequired: "Aktueller Kandidat ist nicht freigegeben", approvalRequiredHint: "Erfasse in D21 eine exakt passende Freigabe.", version: "Version", approval: "Freigabeereignis", warnings: "Erhaltene Warnungen", packSize: "Paketgröße", candidateDigest: "Kandidaten-SHA-256", approvalDigest: "Freigabe-SHA-256", payloadDigest: "Übergabe-SHA-256", contents: "Enthaltene Nachweise", confirm: "Mir ist bewusst, dass dieses Paket nur Kandidaten- und Freigabereferenzen überträgt, den Absender nicht authentifiziert und nichts veröffentlicht.", export: ".mshhandoff exportieren", exporting: "Übergabe wird exportiert…", exported: "Release-Übergabe nach {path} exportiert", canceled: "Dateiauswahl abgebrochen.", failed: "Übergabe fehlgeschlagen.", verified: "Selbstintegrität geprüft", invalid: "Ungültiges Übergabepaket", currentCandidate: "Aktueller Kandidat", currentApproval: "Lokale Freigabe", matches: "Stimmt überein", differs: "Weicht ab", noPersonalData: "Kein Name oder Begründung", noPublish: "Kein Build, Signieren, Upload oder Veröffentlichen",
  },
  fr: {
    title: "Paquet de passation de version", intro: "Regroupe la preuve D20 et son ancre D21 exacte. L’auto-intégrité détecte les changements ; confirmer l’origine exige un SHA-256 fiable ou le registre local d’origine.", privacy: "Le nom et la justification de l’approbateur sont exclus. Seuls les hachages, avertissements, dates et preuves D20 assainies sont transmis.", nativeOnly: "La passation est disponible uniquement dans Developer Tools pour Windows.",
    prepare: "Préparer la passation", preparing: "Correspondance de l’approbation…", refresh: "Actualiser la passation", verify: "Vérifier le paquet", verifying: "Vérification de la passation…", ready: "Prêt à transmettre", approvalRequired: "Le candidat actuel n’est pas approuvé", approvalRequiredHint: "Enregistrez dans D21 une approbation correspondant exactement à ce candidat.", version: "Version", approval: "Événement d’approbation", warnings: "Avertissements conservés", packSize: "Taille", candidateDigest: "SHA-256 du candidat", approvalDigest: "SHA-256 de l’approbation", payloadDigest: "SHA-256 de passation", contents: "Preuves incluses", confirm: "Je comprends que ce paquet transmet des références du candidat et de l’approbation, sans authentifier l’expéditeur ni publier la version.", export: "Exporter .mshhandoff", exporting: "Exportation de la passation…", exported: "Passation exportée vers {path}", canceled: "Sélection annulée.", failed: "Échec de la passation.", verified: "Auto-intégrité vérifiée", invalid: "Paquet de passation invalide", currentCandidate: "Candidat actuel", currentApproval: "Approbation locale", matches: "Correspond", differs: "Diffère", noPersonalData: "Sans nom ni justification", noPublish: "Sans compilation, signature, téléversement ni publication",
  },
  "pt-BR": {
    title: "Pacote de transferência da versão", intro: "Agrupa a evidência D20 e sua âncora D21 exata. A autointegridade detecta mudanças; confirmar a origem exige um SHA-256 confiável ou o registro local original.", privacy: "O nome e a justificativa do aprovador são excluídos. Apenas hashes, alertas, datas e a evidência D20 sanitizada são transferidos.", nativeOnly: "A transferência está disponível somente no Developer Tools instalado no Windows.",
    prepare: "Preparar transferência", preparing: "Comparando a aprovação atual…", refresh: "Atualizar transferência", verify: "Verificar pacote salvo", verifying: "Verificando transferência…", ready: "Pronto para transferir", approvalRequired: "O candidato atual não foi aprovado", approvalRequiredHint: "Registre no D21 uma aprovação que corresponda exatamente a este candidato.", version: "Versão", approval: "Evento de aprovação", warnings: "Alertas preservados", packSize: "Tamanho", candidateDigest: "SHA-256 do candidato", approvalDigest: "SHA-256 da aprovação", payloadDigest: "SHA-256 da transferência", contents: "Evidências incluídas", confirm: "Entendo que este pacote transfere referências do candidato e da aprovação, mas não autentica o remetente nem publica a versão.", export: "Exportar .mshhandoff", exporting: "Exportando transferência…", exported: "Transferência exportada para {path}", canceled: "Seleção cancelada.", failed: "Falha na transferência.", verified: "Autointegridade verificada", invalid: "Pacote de transferência inválido", currentCandidate: "Candidato atual", currentApproval: "Aprovação local", matches: "Corresponde", differs: "Difere", noPersonalData: "Sem nome ou justificativa", noPublish: "Sem compilação, assinatura, envio ou publicação",
  },
};

export const releaseHandoffText = (locale: Locale): ReleaseHandoffCopy => copies[locale];

const trustCopies: Record<Locale, ReleaseHandoffTrustCopy> = {
  en: {
    title: "Independent trust check", expectedDigest: "Expected file SHA-256", expectedDigestHint: "Optional: paste the SHA-256 received through a separate trusted channel before choosing the pack.", expectedDigestPlaceholder: "64 hexadecimal characters",
    selfIntegrity: "Self-integrity", selfIntegrityPassed: "Internal hashes are consistent", originAssurance: "Origin assurance", notEstablished: "Not established", trustedDigestMatch: "Trusted digest matches", localApprovalMatch: "Original local approval matches", digestMismatch: "Expected digest differs", digestNotProvided: "No trusted digest supplied", digestMatches: "Matches", digestDiffers: "Differs", caveat: "Internal hashes alone do not authenticate the sender. A matching digest is meaningful only when it came through a channel you trust.",
  },
  ja: {
    title: "独立した信頼確認", expectedDigest: "期待するファイルSHA-256", expectedDigestHint: "任意：パックを選ぶ前に、別の信頼できる経路で受け取ったSHA-256を貼り付けます。", expectedDigestPlaceholder: "16進数64文字",
    selfIntegrity: "自己整合性", selfIntegrityPassed: "内部ハッシュが整合", originAssurance: "送信元の確認", notEstablished: "未確認", trustedDigestMatch: "信頼済みダイジェストと一致", localApprovalMatch: "元のローカル承認と一致", digestMismatch: "期待ダイジェストと不一致", digestNotProvided: "信頼済みダイジェスト未入力", digestMatches: "一致", digestDiffers: "不一致", caveat: "内部ハッシュだけでは送信元を証明できません。SHA-256一致が意味を持つのは、その値を信頼できる別経路で受け取った場合だけです。",
  },
  "zh-CN": {
    title: "独立信任检查", expectedDigest: "预期文件 SHA-256", expectedDigestHint: "可选：选择交接包前，粘贴通过另一个可信渠道收到的 SHA-256。", expectedDigestPlaceholder: "64 个十六进制字符",
    selfIntegrity: "自身完整性", selfIntegrityPassed: "内部哈希一致", originAssurance: "来源可信度", notEstablished: "尚未建立", trustedDigestMatch: "可信摘要匹配", localApprovalMatch: "原始本地审批匹配", digestMismatch: "预期摘要不匹配", digestNotProvided: "未提供可信摘要", digestMatches: "匹配", digestDiffers: "不匹配", caveat: "仅凭内部哈希无法验证发送者。只有摘要来自您信任的另一个渠道时，匹配结果才有意义。",
  },
  "zh-TW": {
    title: "獨立信任檢查", expectedDigest: "預期檔案 SHA-256", expectedDigestHint: "選填：選擇交接套件前，貼上透過另一個可信管道收到的 SHA-256。", expectedDigestPlaceholder: "64 個十六進位字元",
    selfIntegrity: "自身完整性", selfIntegrityPassed: "內部雜湊一致", originAssurance: "來源可信度", notEstablished: "尚未建立", trustedDigestMatch: "可信摘要相符", localApprovalMatch: "原始本機核准相符", digestMismatch: "預期摘要不符", digestNotProvided: "未提供可信摘要", digestMatches: "相符", digestDiffers: "不符", caveat: "僅靠內部雜湊無法驗證傳送者。只有摘要來自您信任的另一個管道時，相符結果才有意義。",
  },
  ko: {
    title: "독립 신뢰 확인", expectedDigest: "예상 파일 SHA-256", expectedDigestHint: "선택 사항: 팩을 선택하기 전에 별도의 신뢰할 수 있는 경로로 받은 SHA-256을 붙여 넣으세요.", expectedDigestPlaceholder: "16진수 64자",
    selfIntegrity: "자체 무결성", selfIntegrityPassed: "내부 해시 일치", originAssurance: "출처 신뢰", notEstablished: "확인되지 않음", trustedDigestMatch: "신뢰한 다이제스트와 일치", localApprovalMatch: "원본 로컬 승인과 일치", digestMismatch: "예상 다이제스트와 불일치", digestNotProvided: "신뢰한 다이제스트 없음", digestMatches: "일치", digestDiffers: "불일치", caveat: "내부 해시만으로 발신자를 인증할 수 없습니다. SHA-256 값이 신뢰하는 별도 경로에서 왔을 때만 일치 결과가 의미가 있습니다.",
  },
  es: {
    title: "Comprobación de confianza independiente", expectedDigest: "SHA-256 esperado del archivo", expectedDigestHint: "Opcional: pega el SHA-256 recibido por otro canal de confianza antes de elegir el paquete.", expectedDigestPlaceholder: "64 caracteres hexadecimales",
    selfIntegrity: "Integridad interna", selfIntegrityPassed: "Los hashes internos son coherentes", originAssurance: "Garantía de origen", notEstablished: "No establecida", trustedDigestMatch: "Coincide con el resumen confiable", localApprovalMatch: "Coincide con la aprobación local original", digestMismatch: "El resumen esperado difiere", digestNotProvided: "No se indicó un resumen confiable", digestMatches: "Coincide", digestDiffers: "Difiere", caveat: "Los hashes internos no autentican al remitente. La coincidencia solo es significativa si el resumen llegó por un canal de confianza.",
  },
  de: {
    title: "Unabhängige Vertrauensprüfung", expectedDigest: "Erwartete Datei-SHA-256", expectedDigestHint: "Optional: Füge vor der Dateiauswahl die über einen separaten vertrauenswürdigen Kanal erhaltene SHA-256 ein.", expectedDigestPlaceholder: "64 Hexadezimalzeichen",
    selfIntegrity: "Selbstintegrität", selfIntegrityPassed: "Interne Hashes sind konsistent", originAssurance: "Herkunftsnachweis", notEstablished: "Nicht hergestellt", trustedDigestMatch: "Vertrauenswürdiger Hash stimmt überein", localApprovalMatch: "Ursprüngliche lokale Freigabe stimmt überein", digestMismatch: "Erwarteter Hash weicht ab", digestNotProvided: "Kein vertrauenswürdiger Hash angegeben", digestMatches: "Stimmt überein", digestDiffers: "Weicht ab", caveat: "Interne Hashes authentifizieren den Absender nicht. Eine Übereinstimmung ist nur aussagekräftig, wenn der Hash über einen vertrauenswürdigen Kanal kam.",
  },
  fr: {
    title: "Contrôle de confiance indépendant", expectedDigest: "SHA-256 attendu du fichier", expectedDigestHint: "Facultatif : collez le SHA-256 reçu par un autre canal de confiance avant de choisir le paquet.", expectedDigestPlaceholder: "64 caractères hexadécimaux",
    selfIntegrity: "Auto-intégrité", selfIntegrityPassed: "Les hachages internes sont cohérents", originAssurance: "Assurance d’origine", notEstablished: "Non établie", trustedDigestMatch: "Le condensat fiable correspond", localApprovalMatch: "L’approbation locale d’origine correspond", digestMismatch: "Le condensat attendu diffère", digestNotProvided: "Aucun condensat fiable fourni", digestMatches: "Correspond", digestDiffers: "Diffère", caveat: "Les hachages internes n’authentifient pas l’expéditeur. La correspondance n’a de valeur que si le condensat provient d’un canal de confiance.",
  },
  "pt-BR": {
    title: "Verificação de confiança independente", expectedDigest: "SHA-256 esperado do arquivo", expectedDigestHint: "Opcional: cole o SHA-256 recebido por outro canal confiável antes de escolher o pacote.", expectedDigestPlaceholder: "64 caracteres hexadecimais",
    selfIntegrity: "Autointegridade", selfIntegrityPassed: "Hashes internos consistentes", originAssurance: "Garantia de origem", notEstablished: "Não estabelecida", trustedDigestMatch: "Hash confiável correspondente", localApprovalMatch: "Aprovação local original correspondente", digestMismatch: "Hash esperado diferente", digestNotProvided: "Nenhum hash confiável informado", digestMatches: "Corresponde", digestDiffers: "Difere", caveat: "Hashes internos não autenticam o remetente. A correspondência só é significativa quando o hash veio por um canal confiável.",
  },
};

export const releaseHandoffTrustText = (locale: Locale): ReleaseHandoffTrustCopy => trustCopies[locale];

const contentCopies: Record<Locale, [string, string, string, string]> = {
  en: ["D20 sanitized evidence", "D21 approval anchor", "Warning identifiers", "Ledger hash"],
  ja: ["D20匿名化済み証跡", "D21承認アンカー", "警告識別子", "台帳ハッシュ"],
  "zh-CN": ["D20 净化证据", "D21 审批锚点", "警告标识", "台账哈希"],
  "zh-TW": ["D20 清理後證據", "D21 核准錨點", "警告識別碼", "台帳雜湊"],
  ko: ["D20 정제 증거", "D21 승인 앵커", "경고 식별자", "원장 해시"],
  es: ["Evidencia D20 saneada", "Ancla de aprobación D21", "Identificadores de avisos", "Hash del registro"],
  de: ["Bereinigter D20-Nachweis", "D21-Freigabeanker", "Warnungskennungen", "Ledger-Hash"],
  fr: ["Preuve D20 assainie", "Ancre d’approbation D21", "Identifiants d’avertissement", "Hachage du registre"],
  "pt-BR": ["Evidência D20 sanitizada", "Âncora de aprovação D21", "Identificadores de alertas", "Hash do registro"],
};

export const releaseHandoffContents = (locale: Locale): [string, string, string, string] => contentCopies[locale];
