# Orbit mobile architecture

Orbit uses one React application for desktop and mobile. The Android package is
not a second chat client and does not stream the desktop screen. It renders the
same transcript, thinking, tool, and sub-agent components from structured Pi RPC
events.

## Runtime boundary

```text
Android WebView                       Desktop Orbit Host
----------------                     ------------------
shared React UI                       local React UI
remote runtime adapter  <- WebSocket -> remote Host
existing transcript reducer           Bridge -> bundled Pi RPC process
```

The desktop remains the execution authority. Pi, project files, credentials,
terminal commands, and child-agent processes stay on that machine. Android sends
typed commands to the Host and consumes the same Pi JSONL events that the desktop
uses. This preserves event ordering and avoids a second transcript model.

The transport batches burst events, uses bounded queues, and disconnects slow
clients instead of allowing unbounded memory growth. It sends structured JSON,
not screenshots or video frames.

## Connection scope

The first implementation is intended for a trusted LAN or a Tailscale network.
The pairing token authenticates a client, but plain `ws://` does not encrypt LAN
traffic by itself. Do not expose the Host port directly to the public Internet.
Tailscale supplies encrypted transport between enrolled devices; a future public
relay must use TLS or an equivalent authenticated encrypted channel.

The Host is disabled until the user starts mobile access. Restarting it revokes
the current in-memory pairing token. Treat the pairing URI as a secret.

## Install and use the Android build

1. Download `orbit-android-arm64-v0.2.15.apk` from the Orbit GitHub Release and
   open it on an ARM64 Android phone. If Android asks, allow the browser or file
   manager to install an unknown app. The release APK is signed so later Orbit
   releases using the same upload key can update it.
2. Keep the computer and phone on the same LAN, or connect both to the same
   Tailscale network. On the computer, open the project in Orbit and go to
   **Settings → General → Mobile access**.
3. Click **Enable**, copy the pairing URI, and paste it into Orbit on the phone.
   The URI contains the temporary access token; do not share it. The phone then
   attaches to the active Pi connection on the computer.
4. Send prompts from either side. Pi, tools, thinking, child-agent activity,
   session changes, and Markdown output are executed by the computer and are
   rendered through the same reducer on both devices.

The phone does not start Pi or access the computer filesystem locally. If the
computer Host is stopped, the phone returns to the pairing screen. Start Host
again and pair with the newly generated URI.

## Android toolchain

This repository currently uses Tauri CLI 2.11.4. Its Android template targets
Android SDK 36 and NDK 29.0.13846066. The generated Gradle project uses Android
Gradle Plugin 8.11, which requires JDK 17 or newer.

Required local components:

- Android SDK Platform 36
- Android SDK Platform-Tools
- Android SDK Build-Tools 35.0.0 or newer compatible version
- Android SDK Command-line Tools
- NDK (Side by side) 29.0.13846066
- Rust targets `aarch64-linux-android`, `armv7-linux-androideabi`,
  `i686-linux-android`, and `x86_64-linux-android`

Xcode is used for iOS and cannot replace the Android SDK, NDK, or JDK.

The Android release is signed with a private upload keystore. The keystore and
`keystore.properties` stay outside Git; a debug APK can be installed for local
testing, while a signed release APK can be installed over time and upgraded by
the same signing key.

## Sources

- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#android)
- [Tauri mobile development](https://v2.tauri.app/develop/)
- [Android Gradle Plugin 8.11 compatibility](https://developer.android.com/build/releases/past-releases/agp-8-11-0-release-notes#compatibility)
- [Android Java versions](https://developer.android.com/build/jdks)
- [Android NDK installation](https://developer.android.com/studio/projects/install-ndk)
- Pi RPC contract: `node_modules/@earendil-works/pi-coding-agent/docs/rpc.md`
