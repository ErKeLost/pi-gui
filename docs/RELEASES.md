# Desktop releases

Pushing a `v*` tag starts the `Release desktop app` GitHub Actions workflow.
It publishes signed installers for Apple Silicon macOS, Intel macOS, Linux x86_64,
and Windows, then uploads `latest.json` for the built-in Tauri updater.

Linux publishes an AppImage, a Debian package, and an RPM package. Fedora KDE
Plasma users can install the `.rpm` or run the AppImage. The official Tauri
updater uses the signed AppImage artifact on Linux; `.deb` and `.rpm`
installations are updated by installing a newer package manually (or through
the user's package manager).

The updater checks GitHub Releases at application startup in production builds.
When a newer version is available, it offers to download, install, and relaunch
the app. This uses Tauri's official `tauri-plugin-updater` flow and requires the
release assets and `latest.json` to be signed with the configured public key. The
signing private key is stored only in the GitHub repository secrets
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

To release a version, keep `package.json`, `src-tauri/Cargo.toml`, and
`src-tauri/tauri.conf.json` aligned, commit the version bump, then push its tag:

```sh
git tag v0.1.4
git push origin v0.1.4
```
