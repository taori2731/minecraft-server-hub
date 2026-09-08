import { useDeferredValue, useMemo, useState } from "react";
import type { LogEntry } from "../types";
import { Icon } from "./Icon";

interface Props {
  logs: LogEntry[];
  running: boolean;
  onClear: () => void;
  onCopy: (text: string) => void;
  onSave: () => void;
  onCommand: (value: string) => Promise<void>;
  commandsEnabled?: boolean;
  commandUnavailableMessage?: string;
}

export function ConsoleTab({ logs, running, onClear, onCopy, onSave, onCommand, commandsEnabled = true, commandUnavailableMessage }: Props) {
  const [query, setQuery] = useState("");
  const [command, setCommand] = useState("");
  const deferredQuery = useDeferredValue(query.toLowerCase());
  const filtered = useMemo(() => logs.filter((entry) => `${entry.level} ${entry.message}`.toLowerCase().includes(deferredQuery)), [logs, deferredQuery]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = command.trim();
    if (!value) return;
    await onCommand(value);
    setCommand("");
  };

  const allText = filtered.map((entry) => `[${entry.timestamp}] [${entry.level}] ${entry.message}`).join("\n");
  return (
    <div className="tab-content console-content">
      <section className="console-panel">
        <header className="console-toolbar">
          <label className="search-field"><Icon name="search" size={18} /><span className="sr-only">ログを検索</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ログを検索" /></label>
          <span className="result-count">{filtered.length} 件</span>
          <button className="small-button" type="button" onClick={() => onCopy(allText)}><Icon name="clipboard" size={17} />コピー</button>
          <button className="small-button" type="button" onClick={onSave}><Icon name="download" size={17} />保存</button>
          <button className="small-button" type="button" onClick={onClear}><Icon name="trash" size={17} />クリア</button>
        </header>
        <div className="console-log" role="log" aria-live="polite">
          {filtered.map((entry, index) => <div data-no-translate key={`${entry.timestamp}-${index}`}><time>[{entry.timestamp}]</time><b className={entry.level.toLowerCase()}>[{entry.level}]</b><span>{entry.message}</span></div>)}
          {filtered.length === 0 ? <p className="empty-log">一致するログはありません。</p> : null}
        </div>
        {commandsEnabled ? <form className="command-line" onSubmit={submit}>
          <span aria-hidden="true">›</span>
          <input aria-label="サーバーコマンド" value={command} onChange={(event) => setCommand(event.target.value)} disabled={!running} placeholder={running ? "コマンドを入力（例: list）" : "サーバーを起動するとコマンドを送信できます"} />
          <button className="primary-button" type="submit" disabled={!running || command.trim().length === 0}>送信</button>
        </form> : <div className="console-command-unavailable" role="note"><Icon name="info" size={17} />{commandUnavailableMessage ?? "This server exposes logs as read-only."}</div>}
      </section>
    </div>
  );
}
