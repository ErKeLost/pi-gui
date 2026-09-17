import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/Icon";

export function DeleteSessionDialog({
  open,
  sessionName,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  sessionName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return <Dialog open={open} onOpenChange={next => { if (!next) onCancel(); }}>
    <DialogContent className="delete-session-dialog" showCloseButton={false}>
      <DialogHeader className="delete-session-dialog-header">
        <span className="delete-session-dialog-icon"><Icon name="trash" /></span>
        <div><DialogTitle>删除会话</DialogTitle><DialogDescription>该会话的聊天记录将从本机移除，此操作无法撤销。</DialogDescription></div>
      </DialogHeader>
      <div className="delete-session-dialog-name"><Icon name="chats" /><span title={sessionName}>{sessionName}</span></div>
      <DialogFooter className="delete-session-dialog-footer">
        <DialogClose render={<Button variant="outline">取消</Button>} />
        <Button variant="destructive" aria-label={`删除会话 ${sessionName}`} onClick={onConfirm}><Icon name="trash" />删除会话</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
