import { useDialog } from './dialog'

export function useDialogRequest() {
  const dialog = useDialog()

  const hasReadyData = dialog.dialogConfig !== null
  const isVisible = dialog.isOpen && hasReadyData

  const dialogProps = dialog.dialogConfig === null
    ? null
    : {
        title: dialog.dialogConfig.title,
        message: dialog.dialogConfig.message,
        buttons: dialog.dialogConfig.buttons,
        autoCloseMs: dialog.dialogConfig.autoCloseMs,
        inputValue: dialog.dialogConfig.inputValue,
        onInputChange: dialog.dialogConfig.onInputChange,
        isOpen: isVisible,
        onClose: dialog.closeDialog,
      }

  return {
    ...dialog,
    hasReadyData,
    isVisible,
    dialogProps,
  }
}
