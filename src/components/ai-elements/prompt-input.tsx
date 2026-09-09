import type { FormEvent, KeyboardEvent, TextareaHTMLAttributes } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
export type PromptInputMessage = { text: string; files?: File[] };
export function PromptInput({
  onSubmit,
  children,
  className = "",
  allowEmpty = false,
  ...props
}: Omit<React.FormHTMLAttributes<HTMLFormElement>, "onSubmit"> & {
  onSubmit: (message: PromptInputMessage) => void;
  allowEmpty?: boolean;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = String(form.get("message") ?? "");
    if (text.trim() || allowEmpty) {
      onSubmit({ text });
      event.currentTarget.reset();
    }
  }
  return (
    <form
      {...props}
      className={`ai-prompt-input ${className}`}
      onSubmit={submit}
    >
      {children}
    </form>
  );
}
export function PromptInputTextarea({
  value,
  onChange,
  onKeyDown,
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }
  return (
    <Textarea
      {...props}
      className={`composer-input ${className}`}
      name="message"
      value={value}
      onChange={onChange}
      onKeyDown={handleKeyDown}
    />
  );
}
export function PromptInputSubmit({
  status = "ready",
  disabled,
  title,
  "aria-label": ariaLabel,
  onClick,
}: {
  status?: "ready" | "streaming";
  disabled?: boolean;
  title?: string;
  "aria-label"?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}) {
  return (
    <Button
      type={status === "streaming" ? "button" : "submit"}
      size="icon"
      variant="secondary"
      className="ai-prompt-submit"
      title={title}
      aria-label={ariaLabel ?? "发送消息"}
      disabled={disabled}
      onClick={onClick}
    >
      {status === "streaming" ? <Square /> : <ArrowUp />}
    </Button>
  );
}
