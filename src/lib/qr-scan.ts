import type { DecodeHintType as DecodeHint } from "@zxing/library";

export function isScanCanceled(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return error instanceof DOMException && error.name === "AbortError"
    || /cancel|abort|closed/i.test(message);
}

export async function decodeImageUrl(url: string): Promise<string | null> {
  try {
    const [{ BrowserQRCodeReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
      import("@zxing/browser"),
      import("@zxing/library"),
    ]);
    const hints = new Map<DecodeHint, unknown>([
      [DecodeHintType.TRY_HARDER, true],
      [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]],
    ]);
    return (await new BrowserQRCodeReader(hints).decodeFromImageUrl(url)).getText().trim() || null;
  } catch {
    return null;
  }
}

export async function scanQrNative(signal: AbortSignal): Promise<string> {
  const scanner = await import("@tauri-apps/plugin-barcode-scanner");
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const permission = await scanner.requestPermissions();
  if (permission !== "granted") throw new Error("摄像头权限未开启，请在系统设置中允许相机，或从相册选择二维码。");
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const abort = () => { void scanner.cancel(); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    // Omitting formats uses ML Kit's all-format path. The Android plugin's
    // single-format mapper currently appends an invalid zero entry for QR.
    while (!signal.aborted) {
      const result = await scanner.scan({ cameraDirection: "back", windowed: true });
      if (result.format !== scanner.Format.QRCode) continue;
      const content = result.content.trim();
      if (content) return content;
    }
    throw new DOMException("Aborted", "AbortError");
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
