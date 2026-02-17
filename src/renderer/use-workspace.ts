import { useState } from 'react'

interface WorkspaceInfo {
  dir: string | null
  name: string | null
}

export function useWorkspace() {
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo>({
    dir: null,
    name: null
  })

  const handleOpenWorkspace = async () => {
    const result = await (window as any).electron.workspaceOpenDialog()
    if (result) {
      try {
        await (window as any).electron.workspaceLoad(result.dir, result.name)
        setWorkspaceInfo({ dir: result.dir, name: result.name })
      } catch (error) {
        console.error('Failed to load workspace:', error)
      }
    }
  }

  const handleSaveWorkspace = async () => {
    // If no workspace is loaded, treat it as "Save Workspace As"
    if (!workspaceInfo.dir || !workspaceInfo.name) {
      await handleSaveWorkspaceAs()
      return
    }

    // Otherwise, just overwrite the current workspace
    try {
      await (window as any).electron.workspaceSave()
    } catch (error) {
      console.error('Failed to save workspace:', error)
    }
  }

  const handleSaveWorkspaceAs = async () => {
    const defaultName = workspaceInfo.name || 'workspace'
    const filePath = await (window as any).electron.workspaceSaveDialog(defaultName)
    if (filePath) {
      try {
        // Extract directory and name from the file path
        const lastSlash = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'))
        const dir = filePath.substring(0, lastSlash)
        const filename = filePath.substring(lastSlash + 1)
        const name = filename.replace(/\.mpp-workspace$/, '')
        const result = await (window as any).electron.workspaceSaveAs(dir, name)
        setWorkspaceInfo({ dir: result.dir, name: result.name })
      } catch (error) {
        console.error('Failed to save workspace as:', error)
      }
    }
  }

  return {
    workspaceInfo,
    setWorkspaceInfo,
    handleOpenWorkspace,
    handleSaveWorkspace,
    handleSaveWorkspaceAs
  }
}

