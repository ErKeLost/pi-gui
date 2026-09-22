import { forwardRef, useRef, type CompositionEvent, type FormEvent, type KeyboardEvent, type TextareaHTMLAttributes } from "react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Icon } from "../Icon";
import { shouldSubmitComposer } from "../../lib/composer";
export type PromptInputMessage = { text: string; files?: File[] };
export const PromptInput = forwardRef<HTMLFormElement, Omit<React.FormHTMLAttributes<HTMLFormElement>, "onSubmit"> & {
  onSubmit: (message: PromptInputMessage) => void;
  allowEmpty?: boolean;
}>(function PromptInput({ onSubmit, children, className = "", allowEmpty = false, ...props }, ref) {
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
      ref={ref}
      className={`ai-prompt-input ${className}`}
      onSubmit={submit}
    >
      {children}
    </form>
  );
});
export function PromptInputTextarea({
  value,
  onChange,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const composing = useRef(false);
  function handleCompositionStart(event: CompositionEvent<HTMLTextAreaElement>) {
    composing.current = true;
    onCompositionStart?.(event);
  }
  function handleCompositionEnd(event: CompositionEvent<HTMLTextAreaElement>) {
    onCompositionEnd?.(event);
    setTimeout(() => { composing.current = false; }, 0);
  }
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || !shouldSubmitComposer({key:event.key,shiftKey:event.shiftKey,isComposing:event.nativeEvent.isComposing,keyCode:event.keyCode},composing.current)) return;
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
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
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
      variant={status === "streaming" ? "destructive" : "default"}
      className="ai-prompt-submit size-8 rounded-full p-0 flex items-center justify-center shrink-0 shadow-sm"
      title={title}
      aria-label={ariaLabel ?? "发送消息"}
      disabled={disabled}
      onClick={onClick}
    >
      {status === "streaming" ? <Icon name="stop-fill" className="size-4" /> : <Icon name="arrow-up" className="size-4 stroke-[2.5]" />}
    </Button>
  );
}
