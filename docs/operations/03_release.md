# Release runbook

This fork publishes CLI archives and desktop installers to
[golitedev/t3privacy releases](https://github.com/golitedev/t3privacy/releases).
The `Release` workflow uses standard GitHub-hosted runners and `GITHUB_TOKEN`;
it needs no upstream runners, npm publisher, GitHub App, or hosted-service secrets.
Enable Actions in the fork and allow workflows to write repository contents.

## Publish stable

1. Commit and push the code you want to ship to `main`.
2. Open **Actions → Release → Run workflow**, select `main`, choose `stable`, and
   enter a version such as `0.1.11`. With no override, the workflow uses
   `apps/server/package.json`. Unlike upstream, the first stable release does not
   require a previously published nightly.
3. All platform builds and their packaged-binary checks must succeed. The workflow
   uploads assets to a draft before publishing it as the latest stable release.
4. Install using the commands in the release notes and check `t3 --version`.

Alternatively, push a `vX.Y.Z` tag to publish that exact commit. Use plain stable
versions; prerelease tags do not trigger publishing. Published versions are immutable:
use a new version for another release. An interrupted draft can be retried.
Version alignment happens inside each build; the workflow does not push version
bumps to `main`.

## Nightlies

Run **Release** manually with `channel=nightly`. The workflow uses the next patch
version followed by `-nightly.YYYYMMDD.RUN`, publishes it as a prerelease, and
leaves the latest stable release unchanged. Automatic nightly scheduling is disabled.
The standard installer accepts `T3CODE_CHANNEL=nightly`.

## Assets and updates

Each release includes:

- CLI archives for Linux x64/ARM64, Apple Silicon macOS, and Windows x64/ARM64.
- Desktop installers for Linux, macOS, and Windows, including Intel macOS.
- Desktop update manifests, the shell and PowerShell installers, and `SHA256SUMS`.
- `release.json`, containing the version and highest supported database migration.

The fork's installers and runtime archive downloads point at this repository.
`t3 update` and the desktop update-track checks read `release.json` from GitHub
rather than querying upstream's `t3` npm package. Keep this metadata with the
archives so database compatibility checks can run before an update.
Automatic desktop update polling remains disabled. The release pipeline does not
publish upstream npm, AUR, hosted web, mobile-store builds, or announcements.

Keep the exact Node version in root `package.json`: standalone executable builds
require it. Keep the old database fixture under `scripts/fixtures/desktop-launch`
so packaged-app checks continue to verify forward migrations.

## Optional desktop signing

Without signing credentials, macOS and Windows builds are unsigned. macOS CLI
archives are signed ad hoc. To enable signing, configure the secrets declared by
`.github/workflows/release-desktop.yml`:

- macOS: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`,
  `APPLE_API_ISSUER`, `MACOS_PROVISIONING_PROFILE`, and the `APPLE_TEAM_ID` variable.
- Windows: the `AZURE_*` Trusted Signing credentials declared in that workflow.

The reusable desktop workflow retains the upstream packaging, native-module,
CLI archive, WSL runtime, and launch checks.
