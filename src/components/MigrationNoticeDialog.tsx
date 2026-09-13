import type { AppLocale } from "../lib/i18n";
import { brand } from "../lib/brand";
import { getRebrandCopy } from "../lib/rebrandLocale";

export function MigrationNoticeDialog({ locale, onClose }: { locale: AppLocale; onClose: () => void }) {
  const copy = getRebrandCopy(locale);
  return (
    <div className="modal-backdrop migration-notice-backdrop">
      <section className="wizard migration-notice" role="dialog" aria-modal="true" aria-labelledby="migration-notice-title" aria-describedby="migration-notice-body">
        <header className="wizard-header">
          <div>
            <span className="section-kicker">{copy.migrationKicker}</span>
            <h2 id="migration-notice-title">{copy.migrationTitle}</h2>
          </div>
          <span className="sr-only">{brand.productName}</span>
        </header>
        <div className="wizard-body" id="migration-notice-body">
          <p>{copy.migrationBody}</p>
          <p className="privacy-note">{copy.migrationDistribution}</p>
        </div>
        <footer className="wizard-footer">
          <button className="primary-button" type="button" onClick={onClose}>{copy.migrationClose}</button>
        </footer>
      </section>
    </div>
  );
}
