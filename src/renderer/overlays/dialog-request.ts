import { useDialog } from './dialog'

export function useDialogRequest() {
  const dialog = useDialog()

  const hasReadyData = dialog.dialogConfigs.length > 0
  const isVisible = dialog.isOpen && hasReadyData

  const dialogPropsStack = dialog.dialogConfigs.map((config, index) => ({
    title: config.title,
    message: config.message,
    buttons: config.buttons,
    autoCloseMs: config.autoCloseMs,
    inputValue: config.inputValue,
    onInputChange: config.onInputChange,
    dismissible: config.dismissible,
    progressPercent: config.progressPercent,
    progressLabel: config.progressLabel,
    progressItems: config.progressItems,
    isOpen: isVisible,
    onClose: dialog.closeDialog,
    zIndexBase: 70 + (index * 10),
  }))

  const dialogProps = dialogPropsStack.length > 0 ? dialogPropsStack[dialogPropsStack.length - 1] : null

  return {
    ...dialog,
    hasReadyData,
    isVisible,
    dialogPropsStack,
    dialogProps,
  }
}
