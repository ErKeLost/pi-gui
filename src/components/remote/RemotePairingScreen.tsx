import { BrowserQRCodeReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { ArrowRight, Copy, ImagePlus, LoaderCircle, ScanQrCode, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input } from "../UI";
import { Icon } from "../Icon";
import "../../styles/remote-access.css";

export type RemotePairingScreenProps = {
  pairingUri: string;
  connecting: boolean;
  error?: string | null;
  onPairingUriChange: (value: string) => void;
  onConnect: (pairingUri: string) => void;
};

/** Mobile pairing surface with camera/file QR entry and a manual URI fallback. */
export function RemotePairingScreen({ pairingUri, connecting, error, onPairingUriChange, onConnect }: RemotePairingScreenProps) {
  const value = pairingUri.trim();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState<"camera" | null>(null);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [cameraBusy, setCameraBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const readerRef = useRef<BrowserQRCodeReader | null>(null);
  const scanToken = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const stopCamera = useCallback(() => {
    scanToken.current += 1;
    controlsRef.current?.stop();
    controlsRef.current = null;
    readerRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraBusy(false);
  }, []);

  const closeScanner = useCallback(() => {
    stopCamera();
    setScannerOpen(false);
    setScannerMode(null);
  }, [stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const acceptScan = useCallback((raw: string | undefined) => {
    const candidate = raw?.trim();
    if (!candidate) return false;
    onPairingUriChange(candidate);
    closeScanner();
    return true;
  }, [closeScanner, onPairingUriChange]);

  useEffect(() => {
    if (!scannerOpen || scannerMode !== "camera") return;
    let active = true;
    const token = ++scanToken.current;
    const start = async () => {
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
      if (!active || !videoRef.current) return;
      setCameraBusy(true);
      try {
        const reader = new BrowserQRCodeReader();
        readerRef.current = reader;
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } }, audio: false },
          videoRef.current,
          result => {
            if (active && token === scanToken.current && result) acceptScan(result.getText());
          },
        );
        if (!active || token !== scanToken.current) controls.stop();
        else controlsRef.current = controls;
      } catch (cause) {
        if (active && token === scanToken.current) setScannerError(cause instanceof DOMException && cause.name === "NotAllowedError" ? "摄像头权限未开启，请选择二维码图片或粘贴配对链接。" : "无法打开摄像头，请选择二维码图片或粘贴配对链接。");
      } finally {
        if (active && token === scanToken.current) setCameraBusy(false);
      }
    };
    void start();
    return () => { active = false; if (token === scanToken.current) stopCamera(); };
  }, [acceptScan, scannerMode, scannerOpen, stopCamera]);

  function openScanner() {
    setScannerError(null);
    setScannerMode("camera");
    setScannerOpen(true);
  }

  async function scanFile(file: File | undefined) {
    if (!file) return;
    stopCamera();
    setScannerMode(null);
    setScannerError(null);
    setCameraBusy(true);
    const url = URL.createObjectURL(file);
    try {
      const reader = new BrowserQRCodeReader();
      const result = await reader.decodeFromImageUrl(url);
      if (!acceptScan(result.getText())) setScannerError("没有识别到二维码，请换一张清晰图片。");
    } catch {
      setScannerError("无法读取这张图片，请换一张清晰的二维码截图。");
    } finally {
      URL.revokeObjectURL(url);
      setCameraBusy(false);
    }
  }

  return <main className="remote-pairing-screen">
    <section className="remote-pairing-content" aria-labelledby="remote-pairing-title">
      <div className="remote-pairing-brand"><img src="/orbit-mark.png" alt="Orbit" /></div>
      <header className="remote-pairing-heading">
        <p>ORBIT MOBILE</p>
        <h1 id="remote-pairing-title">连接到你的电脑</h1>
        <span>在电脑端开启移动访问，然后扫描或粘贴生成的配对链接。</span>
      </header>
      <Button type="button" variant="outline" className="remote-pairing-scan-card" onClick={() => void openScanner()} disabled={connecting}><span className="remote-pairing-scan-icon"><ScanQrCode aria-hidden="true" /></span><span><strong>扫描二维码</strong><small>扫描电脑端显示的二维码，快速完成配对</small></span><ArrowRight aria-hidden="true" /></Button>
      <div className="remote-pairing-divider"><span>或</span></div>
      <form className="remote-pairing-form" aria-busy={connecting} onSubmit={event => { event.preventDefault(); if (value && !connecting) onConnect(value); }}>
        <label htmlFor="remote-pairing-uri">配对链接</label>
        <div className="remote-pairing-input-shell"><Input id="remote-pairing-uri" value={pairingUri} disabled={connecting} aria-invalid={Boolean(error)} aria-describedby={error ? "remote-pairing-error" : "remote-pairing-help"} autoCapitalize="none" autoComplete="off" autoCorrect="off" enterKeyHint="go" spellCheck={false} placeholder="orbit://pair?host=…" onChange={event => onPairingUriChange(event.target.value)} /><Button type="button" variant="ghost" size="icon" title="复制配对链接" aria-label="复制配对链接" disabled={!value} onClick={() => void navigator.clipboard.writeText(value)}><Copy aria-hidden="true" /></Button></div>
        <p id="remote-pairing-help" className="remote-pairing-help">手机必须能够通过配对链接中的地址访问电脑。</p>
        {(error || scannerError) && <p id="remote-pairing-error" className="remote-pairing-error" role="alert"><Icon name="warning-circle" />{error || scannerError}</p>}
        <Button type="submit" size="lg" variant="outline" className="remote-pairing-connect" disabled={!value || connecting}>{connecting ? <LoaderCircle className="animate-spin" /> : null}{connecting ? "正在连接" : "连接电脑"}</Button>
      </form>
      <p className="remote-pairing-security"><Icon name="shield-check" />配对链接包含访问凭据，请勿分享给其他人。</p>
    </section>
    {scannerOpen && <div className="remote-pairing-scanner" role="dialog" aria-modal="true" aria-labelledby="remote-pairing-scanner-title">
      <div className="remote-pairing-scanner-card">
        <header><strong id="remote-pairing-scanner-title"><ScanQrCode aria-hidden="true" />扫描二维码</strong><Button type="button" variant="ghost" size="icon" title="关闭扫码" onClick={closeScanner}><X aria-hidden="true" /></Button></header>
        <div className="remote-pairing-camera-frame"><video ref={videoRef} muted playsInline aria-label="二维码摄像头预览" />{cameraBusy && <span><LoaderCircle className="animate-spin" />正在打开摄像头…</span>}{!cameraBusy && scannerError && <span>{scannerError}</span>}</div>
        <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}><ImagePlus aria-hidden="true" />从图片选择二维码</Button>
        <input ref={fileRef} className="remote-pairing-file-input" type="file" accept="image/*" onChange={event => { void scanFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
        <p>将电脑端显示的配对二维码放入框内。</p>
      </div>
    </div>}
  </main>;
}
