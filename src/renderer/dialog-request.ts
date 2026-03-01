import { useDialog } from "./dialog"

export function useDialogRequest() {
  const dialog = useDialog()

  const dialogProps = dialog.dialogConfig
    ? {
        ...dialog.dialogConfig,
        isOpen: dialog.isOpen,
        onClose: dialog.closeDialog,
      }
    : null

  return {
    ...dialog,
    dialogProps,
  }
}
