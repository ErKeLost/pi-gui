import { describe, expect, test } from "bun:test";
import { isNewerVersion, parseMobileUpdate } from "../src/lib/mobile-update";

describe("Android release updates", () => {
  test("compares semantic versions without lexical ordering bugs", () => {
    expect(isNewerVersion("0.2.15", "v0.2.16")).toBe(true);
    expect(isNewerVersion("0.2.15", "v0.3.0")).toBe(true);
    expect(isNewerVersion("0.2.15", "v0.2.15")).toBe(false);
    expect(isNewerVersion("0.10.0", "v0.9.9")).toBe(false);
    expect(isNewerVersion("unknown", "v0.2.16")).toBe(false);
  });

  test("accepts only the signed release APK naming and GitHub path", () => {
    const update = parseMobileUpdate("0.2.15", {
      tag_name: "v0.2.16",
      body: "Fixes",
      assets: [{
        name: "orbit-android-arm64-v0.2.16.apk",
        browser_download_url: "https://github.com/ErKeLost/pi-gui/releases/download/v0.2.16/orbit-android-arm64-v0.2.16.apk",
      }],
    });
    expect(update).toEqual({
      version: "0.2.16",
      body: "Fixes",
      downloadUrl: "https://github.com/ErKeLost/pi-gui/releases/download/v0.2.16/orbit-android-arm64-v0.2.16.apk",
    });
    expect(parseMobileUpdate("0.2.15", {
      tag_name: "v0.2.16",
      assets: [{
        name: "orbit-android-arm64-v0.2.16.apk",
        browser_download_url: "https://example.com/orbit.apk",
      }],
    })).toBeNull();
  });
});
