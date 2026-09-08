import { text, type Catalog, type Locale } from "./locale";

export type ReleaseApprovalCopy = {
  kicker: string; title: string; intro: string; privacy: string; nativeOnly: string;
  prepare: string; preparing: string; refresh: string; ready: string; blocked: string;
  blockers: string; warnings: string; evidenceDigest: string; approvalDigest: string;
  gates: string; gateIntro: string; reviewer: string; reviewerPlaceholder: string;
  rationale: string; rationalePlaceholder: string; phrase: string; phraseHint: string;
  warningsConfirm: string; confirm: string; approve: string; approving: string;
  approved: string; failed: string; ledger: string; eventCount: string; history: string;
  noHistory: string; warningNotice: string;
  conditionQualityStages: string; conditionQualityTests: string; conditionCoverageThresholds: string;
  conditionLicenseMismatch: string; conditionLicenseCoverage: string; conditionLicenseLedger: string;
  conditionBlockedLicenseDecisions: string; conditionEvidenceIntegrity: string;
};

const copies: Record<Locale, ReleaseApprovalCopy> = {
  en: {
    kicker: "Controlled release approval", title: "Release candidate approval gate", intro: "Rebuild the D20 evidence snapshot, evaluate every required gate, and append an explicit approval to a tamper-evident local ledger. Approval never builds, signs, uploads, or publishes anything.", privacy: "Reviewer and rationale stay in this app's local approval ledger. The source workspace is not modified.", nativeOnly: "Release approval is available only in the installed Windows Developer Tools app.",
    prepare: "Evaluate candidate", preparing: "Evaluating release gates…", refresh: "Re-evaluate candidate", ready: "Approval available", blocked: "Approval blocked", blockers: "Blockers", warnings: "Warnings", evidenceDigest: "D20 evidence SHA-256", approvalDigest: "Approval decision SHA-256", gates: "Approval conditions", gateIntro: "Every blocker must pass. Warnings require a separate acknowledgement.",
    reviewer: "Approver", reviewerPlaceholder: "Name or team (2–80 characters)", rationale: "Approval rationale", rationalePlaceholder: "Explain why this exact candidate is acceptable (8–2000 characters)", phrase: "Typed confirmation", phraseHint: "Enter exactly: {phrase}", warningsConfirm: "I reviewed every warning and accept the recorded residual risk.", confirm: "I reviewed this exact digest and authorize recording the release approval.", approve: "Record approval", approving: "Recording approval…", approved: "Approval recorded in the verified local ledger.", failed: "The approval operation failed.",
    ledger: "Local approval ledger", eventCount: "Recorded approvals", history: "Recent approvals", noHistory: "No release approvals have been recorded on this PC.", warningNotice: "Warnings do not disappear when approved; their identifiers are preserved in the audit event.",
    conditionQualityStages: "All required quality stages passed", conditionQualityTests: "All tests passed with no skipped tests", conditionCoverageThresholds: "Coverage thresholds passed", conditionLicenseMismatch: "No license evidence mismatch", conditionLicenseCoverage: "Applicable license evidence coverage", conditionLicenseLedger: "License review ledger integrity", conditionBlockedLicenseDecisions: "No active blocked license decision", conditionEvidenceIntegrity: "D20 evidence payload integrity",
  },
  ja: {
    kicker: "管理されたリリース承認", title: "リリース候補の承認ゲート", intro: "D20証跡を再構築して必須条件を評価し、明示承認を改ざん検出付きのローカル台帳へ追記します。ビルド、署名、アップロード、公開は実行しません。", privacy: "承認者と理由はこのアプリのローカル承認台帳だけに保存され、ソースのワークスペースは変更しません。", nativeOnly: "リリース承認はインストール済みWindows版Developer Toolsでのみ利用できます。",
    prepare: "候補を評価", preparing: "リリース条件を評価しています…", refresh: "候補を再評価", ready: "承認可能", blocked: "承認不可", blockers: "ブロッカー", warnings: "警告", evidenceDigest: "D20証跡SHA-256", approvalDigest: "承認判断SHA-256", gates: "承認条件", gateIntro: "すべてのブロッカーを解消してください。警告は別途確認が必要です。",
    reviewer: "承認者", reviewerPlaceholder: "名前またはチーム（2～80文字）", rationale: "承認理由", rationalePlaceholder: "この候補を承認できる理由（8～2000文字）", phrase: "確認文字列", phraseHint: "正確に入力: {phrase}", warningsConfirm: "すべての警告を確認し、記録される残存リスクを受け入れます。", confirm: "この正確なダイジェストを確認し、リリース承認の記録を許可します。", approve: "承認を記録", approving: "承認を記録しています…", approved: "検証済みローカル台帳へ承認を記録しました。", failed: "承認操作に失敗しました。",
    ledger: "ローカル承認台帳", eventCount: "記録済み承認", history: "最近の承認", noHistory: "このPCにはリリース承認がまだありません。", warningNotice: "承認しても警告は消えず、監査イベントに識別子を残します。",
    conditionQualityStages: "必須品質ステージがすべて成功", conditionQualityTests: "スキップなしですべてのテストが成功", conditionCoverageThresholds: "カバレッジ基準を達成", conditionLicenseMismatch: "ライセンス証拠の不一致なし", conditionLicenseCoverage: "対象ライセンス証拠の網羅性", conditionLicenseLedger: "ライセンス審査台帳の整合性", conditionBlockedLicenseDecisions: "有効なブロック判断なし", conditionEvidenceIntegrity: "D20証跡ペイロードの整合性",
  },
  "zh-CN": {
    kicker: "受控发布审批", title: "候选版本审批门", intro: "重新生成D20证据快照，评估全部必需条件，并将明确审批追加到可检测篡改的本地账本。不会构建、签名、上传或发布任何内容。", privacy: "审批人和理由仅保存在本应用的本地审批账本中，不会修改源工作区。", nativeOnly: "发布审批仅在已安装的Windows Developer Tools应用中可用。",
    prepare: "评估候选版本", preparing: "正在评估发布条件…", refresh: "重新评估候选版本", ready: "可审批", blocked: "审批被阻止", blockers: "阻止项", warnings: "警告", evidenceDigest: "D20证据SHA-256", approvalDigest: "审批决定SHA-256", gates: "审批条件", gateIntro: "所有阻止项必须通过；警告需要单独确认。",
    reviewer: "审批人", reviewerPlaceholder: "姓名或团队（2–80个字符）", rationale: "审批理由", rationalePlaceholder: "说明为何可接受此候选版本（8–2000个字符）", phrase: "输入确认文字", phraseHint: "请准确输入：{phrase}", warningsConfirm: "我已检查全部警告并接受记录的剩余风险。", confirm: "我已检查此精确摘要并允许记录发布审批。", approve: "记录审批", approving: "正在记录审批…", approved: "审批已记录到验证过的本地账本。", failed: "审批操作失败。",
    ledger: "本地审批账本", eventCount: "已记录审批", history: "最近审批", noHistory: "此电脑尚未记录发布审批。", warningNotice: "审批不会清除警告；警告标识会保留在审计事件中。",
    conditionQualityStages: "所有必需质量阶段均通过", conditionQualityTests: "所有测试通过且无跳过", conditionCoverageThresholds: "覆盖率阈值通过", conditionLicenseMismatch: "无许可证证据不一致", conditionLicenseCoverage: "适用许可证证据覆盖率", conditionLicenseLedger: "许可证审查账本完整性", conditionBlockedLicenseDecisions: "无有效阻止决定", conditionEvidenceIntegrity: "D20证据载荷完整性",
  },
  "zh-TW": {
    kicker: "受控發行核准", title: "發行候選版本核准閘門", intro: "重新建立D20證據快照、評估所有必要條件，並將明確核准追加至可偵測竄改的本機帳本。不會建置、簽署、上傳或發佈任何內容。", privacy: "核准人與理由只保存在本應用程式的本機核准帳本，不會修改來源工作區。", nativeOnly: "發行核准僅能在已安裝的Windows Developer Tools應用程式中使用。",
    prepare: "評估候選版本", preparing: "正在評估發行條件…", refresh: "重新評估候選版本", ready: "可核准", blocked: "核准遭阻擋", blockers: "阻擋項目", warnings: "警告", evidenceDigest: "D20證據SHA-256", approvalDigest: "核准決定SHA-256", gates: "核准條件", gateIntro: "所有阻擋項目都必須通過；警告需另行確認。",
    reviewer: "核准人", reviewerPlaceholder: "姓名或團隊（2–80個字元）", rationale: "核准理由", rationalePlaceholder: "說明為何可接受此候選版本（8–2000個字元）", phrase: "輸入確認文字", phraseHint: "請精確輸入：{phrase}", warningsConfirm: "我已檢查所有警告並接受記錄的剩餘風險。", confirm: "我已檢查此精確摘要並允許記錄發行核准。", approve: "記錄核准", approving: "正在記錄核准…", approved: "核准已記錄至驗證過的本機帳本。", failed: "核准操作失敗。",
    ledger: "本機核准帳本", eventCount: "已記錄核准", history: "最近核准", noHistory: "此電腦尚未記錄發行核准。", warningNotice: "核准不會清除警告；警告識別碼會保留在稽核事件中。",
    conditionQualityStages: "所有必要品質階段皆通過", conditionQualityTests: "所有測試通過且無略過", conditionCoverageThresholds: "涵蓋率門檻通過", conditionLicenseMismatch: "無授權證據不一致", conditionLicenseCoverage: "適用授權證據涵蓋率", conditionLicenseLedger: "授權審查帳本完整性", conditionBlockedLicenseDecisions: "無有效阻擋決定", conditionEvidenceIntegrity: "D20證據承載內容完整性",
  },
  ko: {
    kicker: "통제된 릴리스 승인", title: "릴리스 후보 승인 게이트", intro: "D20 증거 스냅샷을 다시 만들고 모든 필수 조건을 평가한 뒤 명시적 승인을 변조 감지 로컬 원장에 추가합니다. 빌드, 서명, 업로드 또는 게시를 실행하지 않습니다.", privacy: "승인자와 사유는 이 앱의 로컬 승인 원장에만 저장되며 소스 작업 공간은 변경되지 않습니다.", nativeOnly: "릴리스 승인은 설치된 Windows Developer Tools 앱에서만 사용할 수 있습니다.",
    prepare: "후보 평가", preparing: "릴리스 조건 평가 중…", refresh: "후보 다시 평가", ready: "승인 가능", blocked: "승인 차단됨", blockers: "차단 항목", warnings: "경고", evidenceDigest: "D20 증거 SHA-256", approvalDigest: "승인 결정 SHA-256", gates: "승인 조건", gateIntro: "모든 차단 항목이 통과해야 하며 경고는 별도로 확인해야 합니다.",
    reviewer: "승인자", reviewerPlaceholder: "이름 또는 팀(2~80자)", rationale: "승인 사유", rationalePlaceholder: "이 후보를 승인할 수 있는 이유(8~2000자)", phrase: "확인 문구", phraseHint: "정확히 입력: {phrase}", warningsConfirm: "모든 경고를 검토하고 기록되는 잔여 위험을 수락합니다.", confirm: "이 정확한 다이제스트를 검토했으며 릴리스 승인 기록을 허용합니다.", approve: "승인 기록", approving: "승인 기록 중…", approved: "검증된 로컬 원장에 승인이 기록되었습니다.", failed: "승인 작업에 실패했습니다.",
    ledger: "로컬 승인 원장", eventCount: "기록된 승인", history: "최근 승인", noHistory: "이 PC에 기록된 릴리스 승인이 없습니다.", warningNotice: "승인해도 경고는 사라지지 않으며 식별자가 감사 이벤트에 보존됩니다.",
    conditionQualityStages: "모든 필수 품질 단계 통과", conditionQualityTests: "건너뛴 항목 없이 모든 테스트 통과", conditionCoverageThresholds: "커버리지 기준 통과", conditionLicenseMismatch: "라이선스 증거 불일치 없음", conditionLicenseCoverage: "적용 라이선스 증거 범위", conditionLicenseLedger: "라이선스 검토 원장 무결성", conditionBlockedLicenseDecisions: "활성 차단 결정 없음", conditionEvidenceIntegrity: "D20 증거 페이로드 무결성",
  },
  es: {
    kicker: "Aprobación de versión controlada", title: "Puerta de aprobación de la versión candidata", intro: "Reconstruye la evidencia D20, evalúa cada condición obligatoria y añade la aprobación explícita a un registro local con detección de alteraciones. No compila, firma, carga ni publica nada.", privacy: "El aprobador y el motivo permanecen en el registro local de esta aplicación. El espacio de trabajo no se modifica.", nativeOnly: "La aprobación solo está disponible en la aplicación Windows Developer Tools instalada.",
    prepare: "Evaluar candidata", preparing: "Evaluando condiciones…", refresh: "Volver a evaluar", ready: "Aprobación disponible", blocked: "Aprobación bloqueada", blockers: "Bloqueos", warnings: "Advertencias", evidenceDigest: "SHA-256 de evidencia D20", approvalDigest: "SHA-256 de la decisión", gates: "Condiciones de aprobación", gateIntro: "Todos los bloqueos deben pasar; las advertencias requieren confirmación aparte.",
    reviewer: "Aprobador", reviewerPlaceholder: "Nombre o equipo (2–80 caracteres)", rationale: "Motivo de aprobación", rationalePlaceholder: "Explica por qué esta candidata es aceptable (8–2000 caracteres)", phrase: "Confirmación escrita", phraseHint: "Escribe exactamente: {phrase}", warningsConfirm: "He revisado todas las advertencias y acepto el riesgo residual registrado.", confirm: "He revisado este resumen exacto y autorizo registrar la aprobación.", approve: "Registrar aprobación", approving: "Registrando aprobación…", approved: "Aprobación registrada en el registro local verificado.", failed: "La operación de aprobación falló.",
    ledger: "Registro local de aprobaciones", eventCount: "Aprobaciones registradas", history: "Aprobaciones recientes", noHistory: "No hay aprobaciones registradas en este PC.", warningNotice: "La aprobación no elimina advertencias; sus identificadores quedan en el evento de auditoría.",
    conditionQualityStages: "Todas las etapas de calidad pasaron", conditionQualityTests: "Todas las pruebas pasaron sin omisiones", conditionCoverageThresholds: "Umbrales de cobertura superados", conditionLicenseMismatch: "Sin discrepancias de licencia", conditionLicenseCoverage: "Cobertura de evidencia de licencia aplicable", conditionLicenseLedger: "Integridad del registro de licencias", conditionBlockedLicenseDecisions: "Sin decisiones de bloqueo activas", conditionEvidenceIntegrity: "Integridad de la evidencia D20",
  },
  de: {
    kicker: "Kontrollierte Release-Freigabe", title: "Freigabegate für Release-Kandidaten", intro: "Erstellt den D20-Nachweis neu, bewertet alle Pflichtbedingungen und hängt eine ausdrückliche Freigabe an ein manipulationssicheres lokales Protokoll an. Es wird nichts gebaut, signiert, hochgeladen oder veröffentlicht.", privacy: "Freigebender und Begründung bleiben im lokalen Freigabeprotokoll dieser App. Der Quell-Workspace wird nicht verändert.", nativeOnly: "Die Release-Freigabe ist nur in der installierten Windows-Developer-Tools-App verfügbar.",
    prepare: "Kandidat bewerten", preparing: "Release-Bedingungen werden bewertet…", refresh: "Kandidat neu bewerten", ready: "Freigabe möglich", blocked: "Freigabe blockiert", blockers: "Blocker", warnings: "Warnungen", evidenceDigest: "D20-Nachweis SHA-256", approvalDigest: "Freigabeentscheidung SHA-256", gates: "Freigabebedingungen", gateIntro: "Alle Blocker müssen bestehen; Warnungen benötigen eine separate Bestätigung.",
    reviewer: "Freigebender", reviewerPlaceholder: "Name oder Team (2–80 Zeichen)", rationale: "Freigabebegründung", rationalePlaceholder: "Warum ist genau dieser Kandidat akzeptabel? (8–2000 Zeichen)", phrase: "Bestätigungstext", phraseHint: "Exakt eingeben: {phrase}", warningsConfirm: "Ich habe alle Warnungen geprüft und akzeptiere das protokollierte Restrisiko.", confirm: "Ich habe diesen exakten Digest geprüft und erlaube die Protokollierung der Freigabe.", approve: "Freigabe protokollieren", approving: "Freigabe wird protokolliert…", approved: "Freigabe im verifizierten lokalen Protokoll gespeichert.", failed: "Die Freigabeoperation ist fehlgeschlagen.",
    ledger: "Lokales Freigabeprotokoll", eventCount: "Protokollierte Freigaben", history: "Letzte Freigaben", noHistory: "Auf diesem PC wurden noch keine Freigaben protokolliert.", warningNotice: "Warnungen verschwinden durch die Freigabe nicht; ihre Kennungen bleiben im Audit-Ereignis erhalten.",
    conditionQualityStages: "Alle erforderlichen Qualitätsstufen bestanden", conditionQualityTests: "Alle Tests ohne Überspringen bestanden", conditionCoverageThresholds: "Abdeckungsschwellen bestanden", conditionLicenseMismatch: "Keine Lizenznachweis-Abweichung", conditionLicenseCoverage: "Abdeckung anwendbarer Lizenznachweise", conditionLicenseLedger: "Integrität des Lizenzprüfprotokolls", conditionBlockedLicenseDecisions: "Keine aktive Sperrentscheidung", conditionEvidenceIntegrity: "Integrität des D20-Nachweises",
  },
  fr: {
    kicker: "Approbation de version contrôlée", title: "Porte d’approbation de la version candidate", intro: "Reconstruit la preuve D20, évalue toutes les conditions obligatoires et ajoute une approbation explicite à un registre local détectant les altérations. Rien n’est compilé, signé, téléversé ou publié.", privacy: "L’approbateur et la justification restent dans le registre local de cette application. L’espace de travail source n’est pas modifié.", nativeOnly: "L’approbation est disponible uniquement dans l’application Windows Developer Tools installée.",
    prepare: "Évaluer la candidate", preparing: "Évaluation des conditions…", refresh: "Réévaluer la candidate", ready: "Approbation possible", blocked: "Approbation bloquée", blockers: "Blocages", warnings: "Avertissements", evidenceDigest: "SHA-256 de la preuve D20", approvalDigest: "SHA-256 de la décision", gates: "Conditions d’approbation", gateIntro: "Tous les blocages doivent réussir ; les avertissements exigent une confirmation séparée.",
    reviewer: "Approbateur", reviewerPlaceholder: "Nom ou équipe (2–80 caractères)", rationale: "Justification", rationalePlaceholder: "Expliquez pourquoi cette candidate est acceptable (8–2000 caractères)", phrase: "Confirmation saisie", phraseHint: "Saisissez exactement : {phrase}", warningsConfirm: "J’ai examiné tous les avertissements et j’accepte le risque résiduel enregistré.", confirm: "J’ai vérifié ce condensat exact et j’autorise l’enregistrement de l’approbation.", approve: "Enregistrer l’approbation", approving: "Enregistrement…", approved: "Approbation enregistrée dans le registre local vérifié.", failed: "L’opération d’approbation a échoué.",
    ledger: "Registre local des approbations", eventCount: "Approbations enregistrées", history: "Approbations récentes", noHistory: "Aucune approbation n’est enregistrée sur ce PC.", warningNotice: "L’approbation ne supprime pas les avertissements ; leurs identifiants restent dans l’événement d’audit.",
    conditionQualityStages: "Toutes les étapes qualité requises ont réussi", conditionQualityTests: "Tous les tests ont réussi sans omission", conditionCoverageThresholds: "Seuils de couverture respectés", conditionLicenseMismatch: "Aucune incohérence de licence", conditionLicenseCoverage: "Couverture des preuves de licence applicables", conditionLicenseLedger: "Intégrité du registre des licences", conditionBlockedLicenseDecisions: "Aucune décision de blocage active", conditionEvidenceIntegrity: "Intégrité de la preuve D20",
  },
  "pt-BR": {
    kicker: "Aprovação controlada de versão", title: "Porta de aprovação da versão candidata", intro: "Reconstrói a evidência D20, avalia todas as condições obrigatórias e adiciona a aprovação explícita a um registro local com detecção de alteração. Nada é compilado, assinado, enviado ou publicado.", privacy: "A pessoa aprovadora e a justificativa ficam no registro local deste aplicativo. O workspace de origem não é alterado.", nativeOnly: "A aprovação está disponível somente no aplicativo Windows Developer Tools instalado.",
    prepare: "Avaliar candidata", preparing: "Avaliando condições…", refresh: "Reavaliar candidata", ready: "Aprovação disponível", blocked: "Aprovação bloqueada", blockers: "Bloqueios", warnings: "Avisos", evidenceDigest: "SHA-256 da evidência D20", approvalDigest: "SHA-256 da decisão", gates: "Condições de aprovação", gateIntro: "Todos os bloqueios devem passar; avisos exigem confirmação separada.",
    reviewer: "Pessoa aprovadora", reviewerPlaceholder: "Nome ou equipe (2–80 caracteres)", rationale: "Justificativa", rationalePlaceholder: "Explique por que esta candidata é aceitável (8–2000 caracteres)", phrase: "Confirmação digitada", phraseHint: "Digite exatamente: {phrase}", warningsConfirm: "Revisei todos os avisos e aceito o risco residual registrado.", confirm: "Revisei este resumo exato e autorizo registrar a aprovação.", approve: "Registrar aprovação", approving: "Registrando aprovação…", approved: "Aprovação registrada no registro local verificado.", failed: "A operação de aprovação falhou.",
    ledger: "Registro local de aprovações", eventCount: "Aprovações registradas", history: "Aprovações recentes", noHistory: "Nenhuma aprovação foi registrada neste PC.", warningNotice: "A aprovação não remove avisos; seus identificadores permanecem no evento de auditoria.",
    conditionQualityStages: "Todas as etapas de qualidade passaram", conditionQualityTests: "Todos os testes passaram sem omissões", conditionCoverageThresholds: "Limites de cobertura atendidos", conditionLicenseMismatch: "Sem divergência de licença", conditionLicenseCoverage: "Cobertura de evidência de licença aplicável", conditionLicenseLedger: "Integridade do registro de licenças", conditionBlockedLicenseDecisions: "Sem decisão de bloqueio ativa", conditionEvidenceIntegrity: "Integridade da evidência D20",
  },
};

const existingConditionKeys: Record<string, keyof Catalog> = {
  versionConsistency: "check_versionConsistency", publicKeyMatches: "check_publicKeyMatches",
  manifestVersion: "check_manifestVersion", artifactPresent: "check_installerPresent",
  artifactSha256: "check_sha256Calculated", artifactSignature: "check_cryptographicSignature",
  artifactHistoryIntegrity: "check_artifactHistoryIntegrity", dependencyLockfiles: "check_dependencyLockfiles",
  dependencyIntegrity: "check_dependencyIntegrity", bundleCurrent: "check_bundlePerformance",
  qualityCurrent: "check_qualityEvidence", dependencyLicenseMetadata: "check_dependencyLicenseMetadata",
  dependencyReciprocalLicenses: "check_dependencyReciprocalLicenses", dependencyAdvisories: "check_dependencyAdvisories",
};

const customConditionKeys: Record<string, keyof Pick<ReleaseApprovalCopy,
  "conditionQualityStages" | "conditionQualityTests" | "conditionCoverageThresholds" |
  "conditionLicenseMismatch" | "conditionLicenseCoverage" | "conditionLicenseLedger" |
  "conditionBlockedLicenseDecisions" | "conditionEvidenceIntegrity">> = {
  qualityStages: "conditionQualityStages", qualityTests: "conditionQualityTests",
  coverageThresholds: "conditionCoverageThresholds", licenseMismatch: "conditionLicenseMismatch",
  licenseCoverage: "conditionLicenseCoverage", licenseLedger: "conditionLicenseLedger",
  blockedLicenseDecisions: "conditionBlockedLicenseDecisions", evidenceIntegrity: "conditionEvidenceIntegrity",
};

export const releaseApprovalText = (locale: Locale): ReleaseApprovalCopy => copies[locale];

export function releaseApprovalConditionLabel(locale: Locale, id: string): string {
  const catalogKey = existingConditionKeys[id];
  if (catalogKey) return text(locale, catalogKey);
  const customKey = customConditionKeys[id];
  return customKey ? copies[locale][customKey] : id;
}
