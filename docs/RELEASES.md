# Desktop releases

Pushing a `v*` tag starts the `Release desktop app` GitHub Actions workflow.
It publishes signed installers for Apple Silicon macOS, Intel macOS, and Windows,
then uploads `latest.json` for the built-in Tauri updater.

The updater checks GitHub Releases at application startup in production builds.
When a newer version is available, it offers to download, install, and relaunch
the app. The signing private key is stored only in the GitHub repository secrets
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

To release a version, keep `package.json`, `src-tauri/Cargo.toml`, and
`src-tauri/tauri.conf.json` aligned, commit the version bump, then push its tag:

```sh
git tag v0.1.0
git push origin v0.1.0
```
