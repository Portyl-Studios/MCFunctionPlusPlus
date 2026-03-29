import { useState, useEffect } from 'react'
import { showToastEvent } from './overlays/toast-events'

interface WorkspaceInfo {
  dir: string | null
  name: string | null
}

export function useWorkspace() {
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo>({
    dir: null,
    name: null
  })

  const saveLastActiveWorkspace = async (dir: string, name: string) => {
    await window.electron.preferencesSet('workspace', {
      lastActive: { dir, name },
    })
  }

  const getWorkspaceToastLabel = (name: string) => name.replace(/\.mpp-workspace$/, '')

  const loadWorkspaceAndPersist = async (dir: string, name: string, showToast: boolean = true) => {
    await window.electron.workspaceLoad(dir, name)
    setWorkspaceInfo({ dir, name })
    await saveLastActiveWorkspace(dir, name)

    if (showToast) {
      showToastEvent(`Workspace opened: ${getWorkspaceToastLabel(name)}`)
    }
  }

  const openWorkspaceFromFilePath = async (filePath: string, showToast: boolean = true): Promise<boolean> => {
    if (!filePath || !filePath.toLowerCase().endsWith('.mpp-workspace')) {
      return false
    }

    const normalizedPath = filePath.replace(/\\/g, '/')
    const lastSlash = normalizedPath.lastIndexOf('/')
    if (lastSlash <= 0) {
      return false
    }

    const dir = normalizedPath.slice(0, lastSlash)
    const filename = normalizedPath.slice(lastSlash + 1)
    const name = filename.replace(/\.mpp-workspace$/, '')
    if (!dir || !name) {
      return false
    }

    try {
      await loadWorkspaceAndPersist(dir, name, showToast)
      return true
    } catch (error) {
      console.error('Failed to open workspace from file path:', error)
      return false
    }
  }

  // Load last active workspace if available; otherwise load/create default workspace.
  useEffect(() => {
    const initializeWorkspace = async () => {
      const loadDefaultWorkspace = async () => {
        const result = await window.electron.workspaceGetOrCreateDefault()
        await loadWorkspaceAndPersist(result.dir, result.name)
      }

      try {
        const launchWorkspacePath = await window.electron.workspaceConsumeLaunchPath()
        if (launchWorkspacePath) {
          const didOpenLaunchWorkspace = await openWorkspaceFromFilePath(launchWorkspacePath)
          if (didOpenLaunchWorkspace) {
            return
          }
        }

        const savedWorkspacePreference = await window.electron.preferencesGet('workspace')
        const savedLastActive = savedWorkspacePreference?.lastActive

        if (savedLastActive?.dir && savedLastActive?.name) {
          try {
            await loadWorkspaceAndPersist(savedLastActive.dir, savedLastActive.name)
            return
          } catch (error) {
            console.warn('Failed to load last active workspace, falling back to default workspace:', error)
          }
        } else {
          console.warn('Last active workspace is missing, falling back to default workspace')
        }

        await loadDefaultWorkspace()
      } catch (error) {
        console.error('Workspace initialization failed, attempting default workspace fallback:', error)
        try {
          await loadDefaultWorkspace()
        } catch (fallbackError) {
          console.error('Failed to load default workspace:', fallbackError)
        }
      }
    }

    initializeWorkspace()
  }, [])

  useEffect(() => {
    const unsubscribe = window.electron.onWorkspaceOpenRequested(async (filePath) => {
      await openWorkspaceFromFilePath(filePath)
    })

    return () => {
      unsubscribe()
    }
  }, [])

  const handleOpenWorkspace = async (): Promise<boolean> => {
    const result = await window.electron.workspaceOpenDialog()
    if (!result) {
      return false
    }

    try {
      await loadWorkspaceAndPersist(result.dir, result.name)
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
        await saveLastActiveWorkspace(result.dir, result.name)
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
          await loadWorkspaceAndPersist(previousWorkspace.dir, previousWorkspace.name)
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
      await loadWorkspaceAndPersist(result.dir, result.name)
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

