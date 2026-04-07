export interface RenamePathActionOptions {
  fullPath: string
  currentName: string
  promptRename: (title: string, message: string, defaultValue: string) => Promise<string | null>
  showError: (title: string, message: string) => Promise<void>
  preRenameCheck?: () => Promise<boolean>
  onRenamed?: (newName: string) => Promise<void>
}

export const renamePathWithPrompt = async ({
  fullPath,
  currentName,
  promptRename,
  showError,
  preRenameCheck,
  onRenamed,
}: RenamePathActionOptions): Promise<boolean> => {
  if (preRenameCheck) {
    const canProceed = await preRenameCheck()
    if (!canProceed) {
      return false
    }
  }

  const newName = await promptRename('Rename', 'Enter new name:', currentName)
  if (!newName || newName === currentName) {
    return false
  }

  try {
    await window.electron.renameFileOrFolder(fullPath, newName)
    await onRenamed?.(newName)
    return true
  } catch (error) {
    console.error('Failed to rename item:', error)
    await showError('Error', `Failed to rename: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return false
  }
}

export interface DeletePathActionOptions {
  fullPath: string
  itemName: string
  itemType: 'file' | 'folder'
  confirmDelete: (title: string, message: string) => Promise<boolean>
  showError: (title: string, message: string) => Promise<void>
  preDeleteCheck?: () => Promise<boolean>
  onDeleted?: () => Promise<void>
}

export const deletePathWithConfirm = async ({
  fullPath,
  itemName,
  itemType,
  confirmDelete,
  showError,
  preDeleteCheck,
  onDeleted,
}: DeletePathActionOptions): Promise<boolean> => {
  if (preDeleteCheck) {
    const canProceed = await preDeleteCheck()
    if (!canProceed) {
      return false
    }
  }

  const confirmed = await confirmDelete(
    'Delete',
    `Are you sure you want to delete the ${itemType} "${itemName}"?${itemType === 'file' ? '' : ' This will delete all contents.'}`,
  )
  if (!confirmed) {
    return false
  }

  try {
    await window.electron.deleteFileOrFolder(fullPath)
    await onDeleted?.()
    return true
  } catch (error) {
    console.error('Failed to delete item:', error)
    await showError('Error', `Failed to delete: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return false
  }
}
