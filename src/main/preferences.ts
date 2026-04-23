import { app } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import { isDottedNumericVersion } from '../shared/utils'

interface PanelPreferences {
  leftPanelTabOrder: string[]
  rightPanelTabOrder: string[]
  bottomPanelTabOrder: string[]
  visibleLeftPanelTabs: string[]
  visibleRightPanelTabs: string[]
  visibleBottomPanelTabs: string[]
  activeLeftTabId?: string
  activeRightTabId?: string
  activeBottomTabId?: string
  leftPanelWidth?: number
  rightPanelWidth?: number
  bottomPanelHeight?: number
}

interface WindowPreferences {
  isFullScreen?: boolean
}

interface UpdatesPreferences {
  deferredVersion?: string
}

interface WorkspacePreferences {
  lastActive?: {
    dir: string
    name: string
  }
}

interface MinecraftPreferences {
  hideSnapshotsInVersionMenu?: boolean
  defaultVersion?: string
}

interface AppPreferences {
  panels?: PanelPreferences
  window?: WindowPreferences
  updates?: UpdatesPreferences
  workspace?: WorkspacePreferences
  minecraft?: MinecraftPreferences
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const sanitizeWorkspacePreferences = (value: unknown): WorkspacePreferences | undefined => {
  if (!isRecord(value)) return undefined

  const next: WorkspacePreferences = {}
  const rawLastActive = value.lastActive
  if (isRecord(rawLastActive)) {
    const dir = typeof rawLastActive.dir === 'string' ? rawLastActive.dir : null
    const name = typeof rawLastActive.name === 'string' ? rawLastActive.name : null
    if (dir && name) {
      next.lastActive = { dir, name }
    }
  }

  return Object.keys(next).length > 0 ? next : undefined
}

const sanitizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

const sanitizePanelsPreferences = (value: unknown): PanelPreferences | undefined => {
  if (!isRecord(value)) return undefined

  const next: PanelPreferences = {
    leftPanelTabOrder: sanitizeStringArray(value.leftPanelTabOrder),
    rightPanelTabOrder: sanitizeStringArray(value.rightPanelTabOrder),
    bottomPanelTabOrder: sanitizeStringArray(value.bottomPanelTabOrder),
    visibleLeftPanelTabs: sanitizeStringArray(value.visibleLeftPanelTabs),
    visibleRightPanelTabs: sanitizeStringArray(value.visibleRightPanelTabs),
    visibleBottomPanelTabs: sanitizeStringArray(value.visibleBottomPanelTabs),
  }

  if (typeof value.activeLeftTabId === 'string') next.activeLeftTabId = value.activeLeftTabId
  if (typeof value.activeRightTabId === 'string') next.activeRightTabId = value.activeRightTabId
  if (typeof value.activeBottomTabId === 'string') next.activeBottomTabId = value.activeBottomTabId
  if (typeof value.leftPanelWidth === 'number') next.leftPanelWidth = value.leftPanelWidth
  if (typeof value.rightPanelWidth === 'number') next.rightPanelWidth = value.rightPanelWidth
  if (typeof value.bottomPanelHeight === 'number') next.bottomPanelHeight = value.bottomPanelHeight

  return next
}

const sanitizeWindowPreferences = (value: unknown): WindowPreferences | undefined => {
  if (!isRecord(value)) return undefined
  const next: WindowPreferences = {}
  if (typeof value.isFullScreen === 'boolean') {
    next.isFullScreen = value.isFullScreen
  }
  return Object.keys(next).length > 0 ? next : undefined
}

const sanitizeUpdatesPreferences = (value: unknown): UpdatesPreferences | undefined => {
  if (!isRecord(value)) return undefined
  const next: UpdatesPreferences = {}
  if (typeof value.deferredVersion === 'string') {
    next.deferredVersion = value.deferredVersion
  }
  return Object.keys(next).length > 0 ? next : undefined
}

const sanitizeMinecraftPreferences = (value: unknown): MinecraftPreferences | undefined => {
  if (!isRecord(value)) return undefined
  const next: MinecraftPreferences = {}
  if (typeof value.hideSnapshotsInVersionMenu === 'boolean') {
    next.hideSnapshotsInVersionMenu = value.hideSnapshotsInVersionMenu
  }
  if (typeof value.defaultVersion === 'string' && isDottedNumericVersion(value.defaultVersion)) {
    next.defaultVersion = value.defaultVersion
  }
  return Object.keys(next).length > 0 ? next : undefined
}

const sanitizeAppPreferences = (value: unknown): AppPreferences => {
  if (!isRecord(value)) return {}

  const next: AppPreferences = {}

  const sanitizedPanels = sanitizePanelsPreferences(value.panels)
  if (sanitizedPanels) next.panels = sanitizedPanels

  const sanitizedWindow = sanitizeWindowPreferences(value.window)
  if (sanitizedWindow) next.window = sanitizedWindow

  const sanitizedUpdates = sanitizeUpdatesPreferences(value.updates)
  if (sanitizedUpdates) next.updates = sanitizedUpdates

  const sanitizedWorkspace = sanitizeWorkspacePreferences(value.workspace)
  if (sanitizedWorkspace) {
    next.workspace = sanitizedWorkspace
  }

  const sanitizedMinecraft = sanitizeMinecraftPreferences(value.minecraft)
  if (sanitizedMinecraft) {
    next.minecraft = sanitizedMinecraft
  }

  return next
}

class PreferencesManager {
  private preferencesPath: string
  private preferences: AppPreferences = {}
  private loaded = false

  constructor() {
    const userDataPath = app.getPath('userData')
    this.preferencesPath = path.join(userDataPath, 'preferences.json')
  }

  async load(): Promise<AppPreferences> {
    if (this.loaded) {
      return this.preferences
    }

    try {
      const data = await fs.readFile(this.preferencesPath, 'utf-8')
      const parsed = JSON.parse(data)
      const sanitized = sanitizeAppPreferences(parsed)

      this.preferences = sanitized
      this.loaded = true

      if (JSON.stringify(parsed) !== JSON.stringify(sanitized)) {
        await fs.writeFile(this.preferencesPath, JSON.stringify(sanitized, null, 2), 'utf-8')
      }
    } catch (error) {
      // File doesn't exist or is invalid, use defaults
      this.preferences = {}
      this.loaded = true
    }

    return this.preferences
  }

  async save(): Promise<void> {
    try {
      this.preferences = sanitizeAppPreferences(this.preferences)
      await fs.writeFile(
        this.preferencesPath,
        JSON.stringify(this.preferences, null, 2),
        'utf-8'
      )
    } catch (error) {
      throw new Error(`Failed to save preferences: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  async get<K extends keyof AppPreferences>(key: K): Promise<AppPreferences[K] | undefined> {
    if (!this.loaded) {
      await this.load()
    }
    return this.preferences[key]
  }

  async set<K extends keyof AppPreferences>(key: K, value: AppPreferences[K]): Promise<void> {
    if (!this.loaded) {
      await this.load()
    }
    this.preferences[key] = value
    await this.save()
  }

  async update(updates: Partial<AppPreferences>): Promise<void> {
    if (!this.loaded) {
      await this.load()
    }
    this.preferences = { ...this.preferences, ...updates }
    await this.save()
  }

  getSync(): AppPreferences {
    return this.preferences
  }
}

export const preferencesManager = new PreferencesManager()
export type {
  AppPreferences,
  PanelPreferences,
  WindowPreferences,
  UpdatesPreferences,
  WorkspacePreferences,
  MinecraftPreferences,
}
