# Security Policy

## Reporting a vulnerability

Please do not include passwords, invitation secrets, database credentials, save files, or other private data in a public issue.

If GitHub private vulnerability reporting is available for this repository, use it. Otherwise, open a minimal public issue that contains no exploit details and ask for a private reporting channel. We will document the affected version, impact, reproduction boundary, and remediation status before publishing details.

## Supported versions

Only the current `main` branch and the latest published release are actively reviewed. Older releases may not receive security fixes; do not expose a relay or game management endpoint to the internet while running an unsupported version.

## Security boundaries

- The desktop application is Windows-first and keeps game settings, local process control, and host credentials on the host PC.
- Palworld management passwords and recovery data must not be copied into issues, logs, SQLite exports, GitHub Actions output, or public artifacts.
- The repository's updater public keys are safe to publish. Updater private keys, SignPath tokens, database credentials, and certificate material must remain in an approved secret store.

## Release security

See the [Code signing policy](docs/CODE_SIGNING_POLICY.md) and [application update release procedure](docs/APP_UPDATE_RELEASE.md). A build is not a trusted public release until the Windows Authenticode signature, Tauri updater signature, checksums, clean installation, and update checks have all passed.
