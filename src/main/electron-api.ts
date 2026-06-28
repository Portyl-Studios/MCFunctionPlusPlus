import type { DatapackMetadata, DatapackExportSettings } from './datapack-parser'
import type { ExportDatapackResult } from './export'
import type { AppPreferences } from './preferences'
import type { WorkspaceData } from './workspace-parser'

export type { DatapackExportSettings, ExportDatapackResult }

export type TitlebarContextMenuPosition = { x: number; y: number }

export type WorkspaceFileSelection = {
  dir: string
  name: string
  filePath: string
}

export type WorkspaceSaveResult = {
  dir: string
  name: string
}

export type WorkspaceFilePathResolution = {
  dir: string
  name: string
}

export type WorkspaceDefaultResult = {
  dir: string
  name: string
  workspace: WorkspaceData
}

export type AddDatapackExistingResult = {
  metadataPath: string
  metadata: DatapackMetadata
}

export type MinecraftVersionEntry = {
  id: string
  type?: string
  releaseTime?: string
  url?: string
}

export type MinecraftDataEnsureProgress = {
  version: string
  stage: string
  percent: number
  message: string
}

export type EnsureDatapackMetadataResult = {
  metadataPath: string
  metadata: DatapackMetadata
  created: boolean
}

export type ShortcutAction = 'quit' | 'open' | 'save' | 'saveAll' | 'close' | string
export type AppUpdateStatusType = 'checking' | 'up-to-date' | 'update-available' | 'failed'
export type AppUpdateStatus = {
  status: AppUpdateStatusType
  updateAvailable: boolean
  downloadCompleted?: boolean
  latestVersion?: string
  message?: string
}

export type ShortcutHandler = (event: unknown, action: ShortcutAction) => void
export type QuitRequestedHandler = () => void
export type ExternalFileChangeType = 'create' | 'update' | 'delete'
export type ExternalFileChangeEvent = {
  watchId: string
  changeType: ExternalFileChangeType
}

export type ExternalDirectoryChangeEvent = {
  watchId: string
  changeType: ExternalFileChangeType
  path: string
}

export type ExternalDestination = 'bug-report'

export type JavaExecutableValidationResult = {
  valid: boolean
  output: string
  versionText: string | null
}

export type PreferencesChangedEvent = {
  keys: Array<keyof AppPreferences>
}

export interface ElectronAPI {
  isDevMode: () => Promise<boolean>
  minimize: () => Promise<void>
  toggleFullscreen: () => Promise<void>
  isFullScreen: () => Promise<boolean>
  onFullscreenChange: (callback: (isFullScreen: boolean) => void) => () => void
  onTitlebarContextMenu: (callback: (position: TitlebarContextMenuPosition) => void) => () => void
  onQuitRequested: (callback: QuitRequestedHandler) => () => void
  quit: () => Promise<void>
  quitCancelled: () => Promise<void>
  pickDatapackMetadataFile: () => Promise<string | null>
  pickJavaExecutable: () => Promise<string | null>
  validateJavaExecutable: (javaExecutable: string) => Promise<JavaExecutableValidationResult>
  writeFile: (directory: string, filename: string, contents: string) => Promise<string>
  saveFile: (directory: string, relativePath: string, contents: string) => Promise<string>
  readFile: (directory: string, filePath: string) => Promise<string>
  readFileIfExists: (directory: string, filePath: string) => Promise<string | null>
  listFiles: (directory: string) => Promise<string[]>
  workspaceLoad: (directory: string, name: string) => Promise<WorkspaceData>
  workspaceGetOrCreateDefault: () => Promise<WorkspaceDefaultResult>
  workspaceConsumeLaunchPath: () => Promise<string | null>
  onWorkspaceOpenRequested: (callback: (filePath: string) => void) => () => void
  datapackConsumeLaunchPath: () => Promise<string | null>
  onDatapackOpenRequested: (callback: (filePath: string) => void) => () => void
  minecraftDefaultVersionSyncErrorGet: () => Promise<string | null>
  workspaceGet: () => Promise<WorkspaceData | null>
  workspaceInfo: () => Promise<{ dir: string | null; name: string | null }>
  workspaceOpenDialog: () => Promise<WorkspaceFileSelection | null>
  workspaceResolveFilePath: (filePath: string) => Promise<WorkspaceFilePathResolution | null>
  workspaceSaveDialog: (defaultName: string) => Promise<string | null>
  workspaceSaveAs: (directory: string, name: string) => Promise<WorkspaceSaveResult>
  workspaceUpdatePreference: (key: string, value: unknown) => Promise<void>
  workspaceGetPreference: (key: string) => Promise<unknown>
  workspaceSave: () => Promise<void>
  workspaceAddDatapack: (metadataPath: string) => Promise<string[]>
  workspaceRemoveDatapack: (metadataPath: string) => Promise<string[]>
  workspaceGetDatapacks: () => Promise<string[]>
  workspaceSetDatapacks: (metadataPaths: string[]) => Promise<string[]>
  workspaceNew: () => Promise<{ success: boolean }>
  createFolder: (folderPath: string) => Promise<string>
  addDatapackFromMetadata: (metadataPath: string) => Promise<AddDatapackExistingResult>
  ensureDatapackMetadata: (datapackDir: string) => Promise<EnsureDatapackMetadataResult>
  datapackLoad: (datapackDir: string) => Promise<DatapackMetadata>
  datapackGet: () => Promise<DatapackMetadata | null>
  datapackUpdate: (updates: Partial<DatapackMetadata>) => Promise<DatapackMetadata | null>
  datapackSave: () => Promise<DatapackMetadata | null>
  datapackClear: () => Promise<void>
  pickExportFolder: () => Promise<string | null>
  exportDatapack: (datapackDir: string) => Promise<ExportDatapackResult>
  exportReveal: (filePath: string) => Promise<void>
  onShortcut: (callback: ShortcutHandler) => () => void
  revealInFileExplorer: (filePath: string) => Promise<void>
  renameFileOrFolder: (oldPath: string, newName: string) => Promise<string>
  deleteFileOrFolder: (targetPath: string) => Promise<void>
  preferencesGet: <K extends keyof AppPreferences>(key: K) => Promise<AppPreferences[K] | undefined>
  preferencesSet: <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => Promise<void>
  preferencesUpdate: (updates: Partial<AppPreferences>) => Promise<void>
  onPreferencesChanged: (callback: (event: PreferencesChangedEvent) => void) => () => void
  minecraftVersionsGet: () => Promise<MinecraftVersionEntry[]>
  minecraftDataEnsure: (version: string) => Promise<boolean>
  minecraftDataCancel: (version?: string) => Promise<boolean>
  onMinecraftDataEnsureProgress: (callback: (progress: MinecraftDataEnsureProgress) => void) => () => void
  commandSchemaGet: (version: string) => Promise<string>
  minecraftDataGet: (version: string, dataType: string) => Promise<string>
  watchFileStart: (watchId: string, directory: string, relativePath: string) => Promise<void>
  watchFileStop: (watchId: string) => Promise<void>
  watchFileStopAll: () => Promise<void>
  onFileExternalChange: (callback: (event: ExternalFileChangeEvent) => void) => () => void
  watchDirectoryStart: (watchId: string, directory: string) => Promise<void>
  watchDirectoryStop: (watchId: string) => Promise<void>
  watchDirectoryStopAll: () => Promise<void>
  onDirectoryExternalChange: (callback: (event: ExternalDirectoryChangeEvent) => void) => () => void
  getAppUpdateStatus: () => Promise<AppUpdateStatus>
  checkAppUpdateNow: () => Promise<AppUpdateStatus>
  prepareAppUpdateInstallNow: () => Promise<void>
  onAppUpdateDownloadProgress: (callback: (progressPercent: number) => void) => () => void
  onAppUpdateStatusChange: (callback: (status: AppUpdateStatus) => void) => () => void
  openExternal: (destination: ExternalDestination) => Promise<void>
}
