export const RELEASES_API = "https://api.github.com/repos/ErKeLost/pi-gui/releases/latest";

type GithubAsset = {
  name?: unknown;
  browser_download_url?: unknown;
};

type GithubRelease = {
  tag_name?: unknown;
  body?: unknown;
  assets?: unknown;
};

export type MobileUpdate = {
  version: string;
  body: string;
  downloadUrl: string;
};

function versionParts(value: string): number[] | null {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1).map(Number) : null;
}

export function isNewerVersion(current: string, candidate: string): boolean {
  const left = versionParts(current);
  const right = versionParts(candidate);
  if (!left || !right) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (right[index] !== left[index]) return right[index] > left[index];
  }
  return false;
}

export function parseMobileUpdate(currentVersion: string, input: unknown): MobileUpdate | null {
  if (!input || typeof input !== "object") return null;
  const release = input as GithubRelease;
  if (typeof release.tag_name !== "string" || !isNewerVersion(currentVersion, release.tag_name)) return null;
  if (!Array.isArray(release.assets)) return null;

  const version = release.tag_name.replace(/^v/, "");
  const expectedName = `orbit-android-arm64-v${version}.apk`;
  const asset = (release.assets as GithubAsset[]).find(item => item?.name === expectedName);
  if (!asset || typeof asset.browser_download_url !== "string") return null;

  const url = new URL(asset.browser_download_url);
  if (url.protocol !== "https:" || url.hostname !== "github.com") return null;
  const expectedPath = `/ErKeLost/pi-gui/releases/download/v${version}/${expectedName}`;
  if (url.pathname !== expectedPath) return null;

  return {
    version,
    body: typeof release.body === "string" ? release.body : "新版本已经可以安装。",
    downloadUrl: url.toString(),
  };
}

export async function checkMobileUpdate(currentVersion: string): Promise<MobileUpdate | null> {
  const response = await fetch(RELEASES_API, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`检查更新失败（HTTP ${response.status}）`);
  return parseMobileUpdate(currentVersion, await response.json());
}
