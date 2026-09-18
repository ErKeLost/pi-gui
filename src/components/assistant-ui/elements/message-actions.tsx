"use client";

import type { ComponentProps } from "react";
import {
  CheckIcon,
  GitForkIcon,
  CopyIcon,
  EllipsisIcon,
  RefreshCwIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ghostButton, iconSwap, iconSwapIn, iconSwapOut } from "./surfaces";

export type Reaction = "up" | "down" | null;

export interface MessageActionsProps extends Omit<
  ComponentProps<"div">,
  "children"
> {
  copied: boolean;
  reaction?: Reaction;
  regenerating?: boolean;
  onCopy: () => void;
  onBranch?: () => void;
  branching?: boolean;
  branchDisabled?: boolean;
  onReactionChange?: (reaction: Reaction) => void;
  onRegenerate?: () => void;
  onMore?: () => void;
}

export function MessageActions({
  copied,
  reaction = null,
  regenerating = false,
  onCopy,
  onBranch,
  branching = false,
  branchDisabled = false,
  onReactionChange,
  onRegenerate,
  onMore,
  className,
  ...props
}: MessageActionsProps) {
  const buttonClassName = cn(
    ghostButton,
    "size-8 text-foreground/70 hover:text-foreground",
  );

  return (
    <div
      data-slot="message-actions"
      className={cn("flex items-center gap-1", className)}

      {...props}
    >
      <button
        type="button"
        aria-label={copied ? "已复制" : "复制消息"}
        onClick={onCopy}
        className={cn(
          buttonClassName,
          "grid place-items-center",
          copied && "text-emerald-500",
        )}
      >
        <CopyIcon
          className={cn(
            iconSwap,
            "size-4",
            copied ? iconSwapOut : iconSwapIn,
          )}
        />
        <CheckIcon
          className={cn(
            iconSwap,
            "size-4",
            copied ? iconSwapIn : iconSwapOut,
          )}
        />
      </button>
      {onBranch && <button
        type="button"
        aria-label={branching ? "正在创建分支" : "分支到新聊天"}
        title={branching ? "正在创建分支" : "分支到新聊天"}
        disabled={branchDisabled || branching}
        onClick={onBranch}
        className={cn(buttonClassName, "disabled:opacity-40 disabled:cursor-not-allowed")}
      >
        <GitForkIcon className="size-4" />
      </button>}
      {onReactionChange && <>
      <button
        type="button"
        aria-label="Mark response helpful"
        aria-pressed={reaction === "up"}
        onClick={() => onReactionChange(reaction === "up" ? null : "up")}
        className={cn(
          buttonClassName,
          reaction === "up" &&
            "bg-foreground/[0.06] text-foreground/90 dark:bg-foreground/[0.09]",
        )}
      >
        <ThumbsUpIcon className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="Mark response unhelpful"
        aria-pressed={reaction === "down"}
        onClick={() => onReactionChange(reaction === "down" ? null : "down")}
        className={cn(
          buttonClassName,
          reaction === "down" &&
            "bg-foreground/[0.06] text-foreground/90 dark:bg-foreground/[0.09]",
        )}
      >
        <ThumbsDownIcon className="size-3.5" />
      </button>
      </>}
      {onRegenerate && <button
        type="button"
        aria-label="Regenerate response"
        onClick={onRegenerate}
        className={buttonClassName}
      >
        <RefreshCwIcon
          className={cn(
            "size-3.5",
            regenerating && "animate-spin motion-reduce:animate-none",
          )}
        />
      </button>}
      {onMore && <button
        type="button"
        aria-label="More response actions"
        onClick={onMore}
        className={buttonClassName}
      >
        <EllipsisIcon className="size-3.5" />
      </button>}
    </div>
  );
}
