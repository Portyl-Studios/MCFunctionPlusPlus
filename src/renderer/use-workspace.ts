import { useState, useEffect } from 'react'

interface WorkspaceInfo {
  dir: string | null
  name: string | null
}

export function useWorkspace() {
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo>({
    dir: null,
    name: null
  })

  // Load or create default workspace on mount
  useEffect(() => {
    const loadDefaultWorkspace = async () => {
      try {
        const result = await window.electron.workspaceGetOrCreateDefault()
        await window.electron.workspaceLoad(result.dir, result.name)
        setWorkspaceInfo({ dir: result.dir, name: result.name })
      } catch (error) {
        console.error('Failed to load default workspace:', error)
      }
    }

    loadDefaultWorkspace()
  }, [])

  const handleOpenWorkspace = async (): Promise<boolean> => {
    const result = await window.electron.workspaceOpenDialog()
    if (!result) {
      return false
    }

    try {
      await window.electron.workspaceLoad(result.dir, result.name)
      setWorkspaceInfo({ dir: result.dir, name: result.name })
      return true
    } catch (error) {
      console.error('Failed to load workspace:', error)
      return false
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
      await window.electron.workspaceSave()
    } catch (error) {
      console.error('Failed to save workspace:', error)
    }
  }

  const handleSaveWorkspaceAs = async (): Promise<boolean> => {
    const defaultName = workspaceInfo.name || 'workspace'
    const filePath = await window.electron.workspaceSaveDialog(defaultName)
    if (filePath) {
      try {
        // Extract directory and name from the file path
        const lastSlash = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'))
        const dir = filePath.substring(0, lastSlash)
        const filename = filePath.substring(lastSlash + 1)
        const name = filename.replace(/\.mpp-workspace$/, '')
        const result = await window.electron.workspaceSaveAs(dir, name)
        setWorkspaceInfo({ dir: result.dir, name: result.name })
        return true
      } catch (error) {
        console.error('Failed to save workspace as:', error)
        return false
      }
    }

    return false
  }

  const handleAddDatapack = async (metadataPath: string) => {
    try {
      await window.electron.workspaceAddDatapack(metadataPath)
    } catch (error) {
      console.error('Failed to add datapack to workspace:', error)
    }
  }

  const handleRemoveDatapack = async (metadataPath: string) => {
    try {
      await window.electron.workspaceRemoveDatapack(metadataPath)
    } catch (error) {
      console.error('Failed to remove datapack from workspace:', error)
    }
  }

  const handleGetDatapacks = async () => {
    try {
      return await window.electron.workspaceGetDatapacks()
    } catch (error) {
      console.error('Failed to get datapacks from workspace:', error)
      return []
    }
  }

  const handleNewWorkspace = async (): Promise<boolean> => {
    const previousWorkspace = workspaceInfo

    try {
      await window.electron.workspaceNew()
      // Automatically trigger Save As dialog
      const didSave = await handleSaveWorkspaceAs()
      if (!didSave) {
        if (previousWorkspace.dir && previousWorkspace.name) {
          await window.electron.workspaceLoad(previousWorkspace.dir, previousWorkspace.name)
          setWorkspaceInfo(previousWorkspace)
        }
        return false
      }

      return true
    } catch (error) {
      console.error('Failed to create new workspace:', error)
      return false
    }
  }

  const handleOpenDefaultWorkspace = async (): Promise<boolean> => {
    try {
      const result = await window.electron.workspaceGetOrCreateDefault()
      await window.electron.workspaceLoad(result.dir, result.name)
      setWorkspaceInfo({ dir: result.dir, name: result.name })
      return true
    } catch (error) {
      console.error('Failed to load default workspace:', error)
      return false
    }
  }

  return {
    workspaceInfo,
    setWorkspaceInfo,
    handleOpenWorkspace,
    handleSaveWorkspace,
    handleSaveWorkspaceAs,
    handleNewWorkspace,
    handleOpenDefaultWorkspace,
    handleAddDatapack,
    handleRemoveDatapack,
    handleGetDatapacks
  }
}

