import { useState } from "react";
import type { UiRequest } from "../../lib/protocol";
import { answerDialog, report } from "../../lib/rpc";
import { Button, Modal, TextArea } from "../UI";

export function ExtensionDialog({ dialog }: { dialog: UiRequest }) {
  const [value, setValue] = useState(dialog.method === "editor" ? dialog.prefill ?? "" : "");
  const [pending, setPending] = useState(false);
  async function answer(data: { value?: string; confirmed?: boolean; cancelled?: boolean }) {
    setPending(true);
    try { await answerDialog(dialog, data); }
    catch (error) { report(error); }
    finally { setPending(false); }
  }
  if (!["confirm", "select", "input", "editor"].includes(dialog.method)) return null;
  const title = "title" in dialog ? dialog.title : "Pi 扩展";
  const footer = <div className="dialog-actions"><Button disabled={pending} onClick={() => void answer({ cancelled: true })}>取消</Button>{dialog.method === "confirm" ? <><Button disabled={pending} onClick={() => void answer({ confirmed: false })}>否</Button><Button className="primary" disabled={pending} onClick={() => void answer({ confirmed: true })}>确认</Button></> : dialog.method !== "select" && <Button className="primary" disabled={pending} onClick={() => void answer({ value })}>提交</Button>}</div>;
  return <Modal open title={title} onCancel={() => { if (!pending) void answer({ cancelled: true }); }} footer={footer}>
    {dialog.method === "confirm" && <p>{dialog.message}</p>}
    {dialog.method === "select" && <div className="dialog-options">{dialog.options.map(option => <Button key={option} disabled={pending} onClick={() => void answer({ value: option })}>{option}</Button>)}</div>}
    {(dialog.method === "input" || dialog.method === "editor") && <TextArea autoFocus value={value} onChange={event => setValue(event.target.value)} rows={dialog.method === "editor" ? 6 : 2} placeholder={dialog.method === "input" ? dialog.placeholder : ""} />}
  </Modal>;
}
