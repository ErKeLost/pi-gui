import { LoaderCircle } from "lucide-react";
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

/** Controlled first-run surface. Connection and persistence stay in the runtime layer. */
export function RemotePairingScreen({ pairingUri, connecting, error, onPairingUriChange, onConnect }: RemotePairingScreenProps) {
  const value = pairingUri.trim();
  return <main className="remote-pairing-screen">
    <section className="remote-pairing-content" aria-labelledby="remote-pairing-title">
      <div className="remote-pairing-emblem" aria-hidden="true"><span>O</span><i><Icon name="link" /></i></div>
      <header className="remote-pairing-heading">
        <p>Orbit Mobile</p>
        <h1 id="remote-pairing-title">连接到你的电脑</h1>
        <span>在电脑端开启移动访问，然后粘贴生成的配对链接。</span>
      </header>
      <form className="remote-pairing-form" aria-busy={connecting} onSubmit={event => { event.preventDefault(); if (value && !connecting) onConnect(value); }}>
        <label htmlFor="remote-pairing-uri">配对链接</label>
        <Input
          id="remote-pairing-uri"
          value={pairingUri}
          disabled={connecting}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "remote-pairing-error" : "remote-pairing-help"}
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          enterKeyHint="go"
          spellCheck={false}
          placeholder="orbit://pair?host=…"
          onChange={event => onPairingUriChange(event.target.value)}
        />
        <p id="remote-pairing-help" className="remote-pairing-help">手机必须能够通过配对链接中的地址访问电脑。</p>
        {error && <p id="remote-pairing-error" className="remote-pairing-error" role="alert"><Icon name="warning-circle" />{error}</p>}
        <Button type="submit" size="lg" disabled={!value || connecting}>{connecting ? <LoaderCircle className="animate-spin" /> : <Icon name="link" />}{connecting ? "正在连接" : "连接电脑"}</Button>
      </form>
      <p className="remote-pairing-security"><Icon name="shield-check" />配对链接包含访问凭据，请勿分享给其他人。</p>
    </section>
  </main>;
}
