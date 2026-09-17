import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
    <DialogContent className="delete-session-dialog">
      <DialogHeader>
        <DialogTitle>删除“{sessionName}”？</DialogTitle>
      </DialogHeader>
      <DialogFooter className="delete-session-dialog-footer">
        <DialogClose render={<Button variant="outline">取消</Button>} />
        <Button variant="destructive" onClick={onConfirm}>删除</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
