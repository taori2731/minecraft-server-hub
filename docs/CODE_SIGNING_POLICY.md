# Code signing policy

## Status

The normal Windows in-app update path uses the same Tauri Updater detached Minisign signature model as release 0.3.9. A valid Tauri updater signature is mandatory. SignPath and Windows Authenticode are not dependencies or required gates for this path.

Authenticode may be added later as an optional publisher-reputation layer, but its presence or `Valid` status must not be confused with the Tauri update-integrity decision. The release workflow does not submit artifacts to an external signing service.

## Scope

This policy covers the Windows x64 NSIS installer and its adjacent `.sig` file. The updater public key is embedded in both `src-tauri/updater-public.key` and `src-tauri/tauri.conf.json`; those values must remain unchanged while releases signed by the current key are in use.

The developer-tools installer has its own configuration and feed. It is not included in the main application's 0.3.10 release gate.

## Roles

- Committers and reviewers: [`taori2731`](https://github.com/taori2731), the repository owner.
- Release approver: [`taori2731`](https://github.com/taori2731), responsible for approving the exact 0.3.10 candidate after all pre-public checks pass.
- Release repository: [`taori2731/minecraft-server-hub-releases`](https://github.com/taori2731/minecraft-server-hub-releases).

## Secrets

- `TAURI_SIGNING_PRIVATE_KEY` contains the existing Tauri updater private key and is supplied only to the build/sign steps.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is supplied only when that key is encrypted.
- `RELEASE_REPO_TOKEN` is a separate least-privilege GitHub token used to create and publish the Draft in the release repository.

No secret value may be committed, printed, placed in an artifact, included in `latest.json`, or pasted into an issue or chat. If the existing private key is missing or does not produce a signature accepted by the embedded public key, the release stops. A replacement key must not be generated for 0.3.10.

## Required release flow

The manually dispatched `Release Windows updater` workflow accepts only `main`, `version=0.3.10`, and `release_tag=v0.3.10`. It:

1. checks all JavaScript, Rust, Cargo, and Tauri version sources;
2. checks that the updater public key matches the Tauri configuration and was not changed in the release commit;
3. runs application, Rust, developer-tools, UI, and website regression checks;
4. builds the Windows x64 NSIS installer;
5. signs the final release bytes with the Tauri updater private key;
6. verifies the adjacent `.sig` using the embedded public key;
7. calculates SHA-256 and generates an authentication-free HTTPS `latest.json`;
8. saves the exact pre-public bundle as an Actions Artifact;
9. refuses to reuse an existing release or tag and creates `v0.3.10` as a Draft;
10. downloads the three updater files from the Draft and verifies their identity and signature;
11. publishes the verified Draft as Latest;
12. downloads the public Latest feed and assets again and compares their SHA-256 values to the local candidate.

The public asset set is:

- `Minecraft.Server.Hub_0.3.10_x64-setup.exe`
- `Minecraft.Server.Hub_0.3.10_x64-setup.exe.sig`
- `latest.json`
- `SHA256SUMS.txt`

No Authenticode `Valid` check is part of these gates. The optional `-CheckAuthenticode` and `-RequireAuthenticode` switches in the local QA helper are explicitly outside the normal app-update policy.

## Existing-release compatibility

The public key and the Tauri configuration key must not change for 0.3.10. This preserves the ability of installed 0.3.9 applications to validate the 0.3.10 update. The 0.3.9 Release and its assets are never deleted or overwritten by the workflow.

Key rotation is a separate migration project. It requires a tested bootstrap or manual-install path for every supported installed version before the new public key is published.

## Integrity and privacy

The updater signature authenticates the exact installer bytes. The manifest signature must equal the adjacent `.sig`; the manifest URL must be absolute HTTPS without user information, a query, or a fragment; and the URL filename must equal the selected installer filename. SHA-256 is an additional transfer-integrity comparison, not a replacement for the Tauri signature.

The normal release path does not send the installer to an external signing service. GitHub Actions receives only the configured build secrets and publishes only the four listed release assets.
