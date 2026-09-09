# Code signing policy

## Status

This policy is effective for the public repository. The SignPath Foundation application is pending; no SignPath Foundation certificate is currently active and no installer is described as SignPath-signed until the request is approved and the resulting signature is independently verified.

The intended service is: **Free code signing provided by SignPath.io, certificate by SignPath Foundation**.

## Scope

The policy covers the Windows NSIS installer produced from this repository. The Tauri updater's detached Minisign signature is a separate integrity layer and uses a private key stored outside the repository. Windows Authenticode and the Tauri updater signature must both be verified after the final installer bytes are produced.

The developer-tools installer will follow the same policy only after its own artifact configuration, version metadata, and clean-install evidence are reviewed.

## Roles

Until additional maintainers are formally added:

- Committers and reviewers: [`taori2731`](https://github.com/taori2731), the repository owner. Changes to source, build scripts, workflow files, and signing policy are reviewed through the repository's normal change process.
- Approver: [`taori2731`](https://github.com/taori2731), responsible for approving a specific release candidate for signing after the release gates pass.

SignPath organization and project identifiers are intentionally kept in SignPath/GitHub configuration rather than source control. The signing workflow fails closed when those values or the API token are not configured.

## Build and signing flow

1. A release candidate is built by the manual GitHub Actions workflow on the `main` branch using a GitHub-hosted Windows runner.
2. The version must match the repository metadata. The Tauri updater private key is supplied only as a GitHub Actions secret; it is never committed, printed, or placed in a public artifact.
3. The unsigned NSIS installer is uploaded to GitHub Actions before the SignPath request. SignPath verifies the GitHub workflow origin and the artifact provenance.
4. SignPath receives the artifact and waits for the project's manual approval. A missing project, policy, token, or approval stops the workflow.
5. The returned Authenticode-signed installer is given a new Tauri updater signature because Authenticode changes the final executable bytes.
6. The workflow verifies Authenticode, verifies the Tauri signature with the embedded public key, creates `latest.json`, records SHA-256, and uploads a release bundle for the release owner to inspect.
7. Only after clean Windows install, uninstall, reinstall, update, and rollback checks pass may the exact bundle be published to the release repository.

The workflow does not automatically publish to the release repository. This keeps signing approval, release review, and external distribution as separate decisions.

## Privacy and third-party services

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it. Optional downloads and relay connections are user-requested features and are described in the README and the third-party notices. SignPath, GitHub Actions, Cloudflare, the optional relay hosting provider, game distribution services, Modrinth, and playit.gg each have their own terms and privacy policies; users must review those services before enabling the corresponding feature.

The developer-tools dependency/advisory checks are development and release checks. They are not an in-app network or vulnerability scanner and do not automatically contact an advisory service.

## Release gate

An unsigned installer may be used for local QA only. It must not be represented as a trusted public release. The current release procedure remains the authoritative checklist for Tauri updater key rotation, Authenticode verification, artifact hashes, and clean-environment acceptance.
