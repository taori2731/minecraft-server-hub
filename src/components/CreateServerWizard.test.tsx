import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { PcDiagnosis, ServerProfile } from "../types";
import { CreateServerWizard } from "./CreateServerWizard";
import { I18nProvider, type AppLocale } from "../lib/i18n";
import { getPalworldLocaleCatalog } from "../lib/palworldLocale";

const backendMock = vi.hoisted(() => ({
  suggestServerPort: vi.fn(async (port: number, _transport: "tcp" | "udp" = "tcp", _reserveAdjacent = false) => port),
  listVersions: vi.fn(async (serverType: string) => serverType === "palworld" ? [] : [{ id: "1.21.100.7", stable: true }]),
  diagnoseNewServer: vi.fn(),
  createServer: vi.fn(),
}));

vi.mock("../lib/backend", () => ({
  backend: backendMock,
  selectFolder: vi.fn(async () => "C:\\Servers"),
}));

function proceed() {
  fireEvent.click(screen.getByRole("button", { name: /次へ/ }));
}

test("EULAはチェックボックスだけで変更され、作成中は明確な待機表示を出す", async () => {
  localStorage.setItem("server-hub:language:v1", "ja");
  let completeCreation!: (server: ServerProfile) => void;
  backendMock.createServer.mockImplementationOnce(() => new Promise<ServerProfile>((resolve) => {
    completeCreation = resolve;
  }));
  const onCreated = vi.fn();
  render(<I18nProvider><CreateServerWizard onClose={vi.fn()} onCreated={onCreated} isFirstServer={false} /></I18nProvider>);

  fireEvent.click(screen.getByRole("button", { name: /Minecraft 統合版/ }));
  proceed();
  fireEvent.change(screen.getByRole("textbox", { name: "サーバー名" }), { target: { value: "Bedrock test" } });
  fireEvent.click(screen.getByRole("button", { name: "選択" }));
  await waitFor(() => expect(screen.getByDisplayValue("C:\\Servers")).toBeInTheDocument());
  proceed();
  await screen.findByRole("option", { name: "1.21.100.7" });
  proceed();
  proceed();
  proceed();

  const checkbox = screen.getByRole("checkbox", { name: "Minecraft EULAに同意する" });
  const card = checkbox.closest(".eula-consent");
  expect(card).not.toBeNull();
  expect(checkbox).not.toBeChecked();
  fireEvent.click(card!);
  expect(checkbox).not.toBeChecked();
  fireEvent.click(checkbox);
  expect(checkbox).toBeChecked();

  fireEvent.click(screen.getByRole("button", { name: "サーバーを作成" }));
  const status = await screen.findByRole("status");
  expect(status).toHaveTextContent("サーバーを準備しています");
  expect(status).toHaveTextContent("公式BDSの取得、安全確認、展開");
  expect(status).toHaveTextContent("アプリは動作中です");

  completeCreation({ id: "bedrock", name: "Bedrock test" } as ServerProfile);
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
});

test("Palworldをトップレベルで選び、Minecraft EULAやJavaを要求せず作成入力へ渡す", async () => {
  localStorage.setItem("server-hub:language:v1", "ja");
  backendMock.listVersions.mockClear();
  backendMock.suggestServerPort.mockImplementation(async (port: number, transport?: "tcp" | "udp") => {
    if (transport === "udp" && port === 8211) return 8212;
    if (transport === "tcp" && port === 8212) return 8213;
    return port;
  });
  backendMock.createServer.mockResolvedValueOnce({ id: "palworld" } as ServerProfile);
  const onCreated = vi.fn();
  render(<I18nProvider><CreateServerWizard onClose={vi.fn()} onCreated={onCreated} isFirstServer={false} /></I18nProvider>);

  fireEvent.click(screen.getByRole("button", { name: /Palworld/ }));
  expect(screen.getByText(/UDP 8211/)).toBeInTheDocument();
  proceed();
  fireEvent.change(screen.getByRole("textbox", { name: "サーバー名" }), { target: { value: "Palworld test" } });
  fireEvent.click(screen.getByRole("button", { name: "選択" }));
  await waitFor(() => expect(screen.getByDisplayValue("C:\\Servers")).toBeInTheDocument());
  proceed();
  await screen.findByText("SteamCMD · 2394010");
  expect(screen.getByRole("button", { name: /次へ/ })).toBeEnabled();
  expect(backendMock.listVersions).not.toHaveBeenCalledWith("palworld");
  proceed();
  expect(screen.getByText("PalServer.exe")).toBeInTheDocument();
  expect(screen.queryByText("使用するJava")).not.toBeInTheDocument();
  proceed();
  expect(screen.getByRole("spinbutton", { name: getPalworldLocaleCatalog("ja").gamePortTitle })).toHaveValue(8212);
  const restPort = screen.getByRole("spinbutton", { name: "REST APIポート" });
  expect(restPort).toHaveValue(8213);
  fireEvent.change(restPort, { target: { value: "8321" } });
  proceed();
  expect(screen.queryByRole("checkbox", { name: "Minecraft EULAに同意する" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Palworldサーバーを作成" }));

  await waitFor(() => expect(backendMock.createServer).toHaveBeenCalledWith(expect.objectContaining({
    gameKind: "palworld",
    serverType: "palworld",
    port: 8212,
    eulaAccepted: false,
    palworldSettings: expect.objectContaining({ restApiPort: 8321, maxPlayers: 32 }),
  })));
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
});

const palworldLocales: AppLocale[] = ["ja", "en", "de", "es", "fr", "ko", "pt-BR", "zh-CN", "zh-TW"];

const diagnosisBase: PcDiagnosis = {
  cpuName: "Test CPU",
  physicalCores: 8,
  logicalThreads: 16,
  cpuUsagePercent: 10,
  memoryTotalMib: 32_768,
  memoryAvailableMib: 16_384,
  gpuName: "Test GPU",
  os: "Windows",
  storageKind: "SSD",
  storageFreeGib: 100,
  storageAvailable: true,
  javaRuntimes: [],
  recommendedMemoryMib: 16_384,
  recommendedPlayers: 32,
  recommendedViewDistance: 10,
  recommendedSimulationDistance: 8,
  warnings: ["日本語のバックエンド警告"],
  privacyNote: "日本語のバックエンド注記",
};

test.each(palworldLocales)("Palworld作成シェルは%sの専用カタログを表示する", async (locale) => {
  localStorage.setItem("server-hub:language:v1", locale);
  const catalog = getPalworldLocaleCatalog(locale);
  render(<I18nProvider><CreateServerWizard onClose={vi.fn()} onCreated={vi.fn()} isFirstServer={false} /></I18nProvider>);

  fireEvent.click(screen.getByRole("button", { name: /Palworld/ }));

  expect(screen.getByText(catalog.diagnosisRepeatTitle)).toBeInTheDocument();
  expect(screen.getByText(catalog.diagnosisDescription)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: catalog.diagnoseButton })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: catalog.cancelButton })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: new RegExp(catalog.nextButton) })).toBeInTheDocument();
  expect(screen.getByRole("list", { name: catalog.progressLabel })).toBeInTheDocument();
  expect(screen.getByPlaceholderText(catalog.saveFolderPlaceholder)).toBeInTheDocument();
});

test.each([
  {
    locale: "en" as const,
    diagnosis: { ...diagnosisBase, memoryTotalMib: 8_192, memoryAvailableMib: 3_072, storageAvailable: false, storageFreeGib: 0 },
    visible: ["warningAvailableMemoryUnder4", "warningTotalMemoryUnder16", "warningStorageUnavailable"] as const,
    hidden: ["warningAvailableMemoryUnder12", "warningStorageUnder10"] as const,
  },
  {
    locale: "de" as const,
    diagnosis: { ...diagnosisBase, memoryTotalMib: 32_768, memoryAvailableMib: 8_192, storageAvailable: true, storageFreeGib: 5 },
    visible: ["warningAvailableMemoryUnder12", "warningStorageUnder10"] as const,
    hidden: ["warningAvailableMemoryUnder4", "warningTotalMemoryUnder16", "warningStorageUnavailable"] as const,
  },
])("Palworld診断警告を$localeでUI条件から再構成する", async ({ locale, diagnosis, visible, hidden }) => {
  localStorage.setItem("server-hub:language:v1", locale);
  backendMock.diagnoseNewServer.mockResolvedValueOnce(diagnosis);
  const catalog = getPalworldLocaleCatalog(locale);
  render(<I18nProvider><CreateServerWizard onClose={vi.fn()} onCreated={vi.fn()} isFirstServer={false} /></I18nProvider>);

  fireEvent.click(screen.getByRole("button", { name: /Palworld/ }));
  fireEvent.click(screen.getByRole("button", { name: catalog.selectFolderButton }));
  await waitFor(() => expect(screen.getByDisplayValue("C:\\Servers")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: catalog.diagnoseButton }));

  for (const key of visible) {
    expect(await screen.findByText(catalog[key])).toBeInTheDocument();
  }
  for (const key of hidden) {
    expect(screen.queryByText(catalog[key])).not.toBeInTheDocument();
  }
  expect(screen.queryByText("日本語のバックエンド警告")).not.toBeInTheDocument();
});
