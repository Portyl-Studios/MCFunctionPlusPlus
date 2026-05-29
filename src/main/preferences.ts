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
  javaPath?: string
}

interface AppPreferences {
  panels?: PanelPreferences
  window?: WindowPreferences
  updates?: UpdatesPreferences
  workspace?: WorkspacePreferences
  minecraft?: MinecraftPreferences
}

const createDefaultPanelPreferences = (): PanelPreferences => ({
  leftPanelTabOrder: ['explorer'],
  rightPanelTabOrder: ['preferences', 'settings'],
  bottomPanelTabOrder: ['debug'],
  visibleLeftPanelTabs: ['explorer'],
  visibleRightPanelTabs: ['preferences', 'settings'],
  visibleBottomPanelTabs: ['debug'],
  activeLeftTabId: 'explorer',
  activeRightTabId: 'preferences',
  activeBottomTabId: 'debug',
  leftPanelWidth: 350,
  rightPanelWidth: 350,
  bottomPanelHeight: 250,
})

const createDefaultWindowPreferences = (): WindowPreferences => ({
  isFullScreen: false,
})

const createDefaultUpdatesPreferences = (): UpdatesPreferences => ({
  deferredVersion: '',
})

const createDefaultWorkspacePreferences = (): WorkspacePreferences => ({
  lastActive: {
    dir: '',
    name: '',
  },
})

const createDefaultMinecraftPreferences = (): MinecraftPreferences => ({
  hideSnapshotsInVersionMenu: false,
  defaultVersion: '',
  javaPath: '',
})

const createDefaultAppPreferences = (): AppPreferences => ({
  panels: createDefaultPanelPreferences(),
  window: createDefaultWindowPreferences(),
  updates: createDefaultUpdatesPreferences(),
  workspace: createDefaultWorkspacePreferences(),
  minecraft: createDefaultMinecraftPreferences(),
})

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const sanitizeWorkspacePreferences = (value: unknown): WorkspacePreferences => {
  const defaults = createDefaultWorkspacePreferences()
  const defaultLastActive = defaults.lastActive ?? { dir: '', name: '' }
  if (!isRecord(value)) return defaults

  const rawLastActive = isRecord(value.lastActive)
    ? value.lastActive
    : null
  const dir = typeof rawLastActive?.dir === 'string' ? rawLastActive.dir : defaultLastActive.dir
  const name = typeof rawLastActive?.name === 'string' ? rawLastActive.name : defaultLastActive.name

  return {
    lastActive: { dir, name },
  }
}

const sanitizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

const sanitizePanelsPreferences = (value: unknown): PanelPreferences => {
  const defaults = createDefaultPanelPreferences()
  if (!isRecord(value)) return defaults

  return {
    leftPanelTabOrder: Array.isArray(value.leftPanelTabOrder)
      ? sanitizeStringArray(value.leftPanelTabOrder)
      : defaults.leftPanelTabOrder,
    rightPanelTabOrder: Array.isArray(value.rightPanelTabOrder)
      ? sanitizeStringArray(value.rightPanelTabOrder)
      : defaults.rightPanelTabOrder,
    bottomPanelTabOrder: Array.isArray(value.bottomPanelTabOrder)
      ? sanitizeStringArray(value.bottomPanelTabOrder)
      : defaults.bottomPanelTabOrder,
    visibleLeftPanelTabs: Array.isArray(value.visibleLeftPanelTabs)
      ? sanitizeStringArray(value.visibleLeftPanelTabs)
      : defaults.visibleLeftPanelTabs,
    visibleRightPanelTabs: Array.isArray(value.visibleRightPanelTabs)
      ? sanitizeStringArray(value.visibleRightPanelTabs)
      : defaults.visibleRightPanelTabs,
    visibleBottomPanelTabs: Array.isArray(value.visibleBottomPanelTabs)
      ? sanitizeStringArray(value.visibleBottomPanelTabs)
      : defaults.visibleBottomPanelTabs,
    activeLeftTabId: typeof value.activeLeftTabId === 'string'
      ? value.activeLeftTabId
      : defaults.activeLeftTabId,
    activeRightTabId: typeof value.activeRightTabId === 'string'
      ? value.activeRightTabId
      : defaults.activeRightTabId,
    activeBottomTabId: typeof value.activeBottomTabId === 'string'
      ? value.activeBottomTabId
      : defaults.activeBottomTabId,
    leftPanelWidth: typeof value.leftPanelWidth === 'number' && Number.isFinite(value.leftPanelWidth)
      ? value.leftPanelWidth
      : defaults.leftPanelWidth,
    rightPanelWidth: typeof value.rightPanelWidth === 'number' && Number.isFinite(value.rightPanelWidth)
      ? value.rightPanelWidth
      : defaults.rightPanelWidth,
    bottomPanelHeight: typeof value.bottomPanelHeight === 'number' && Number.isFinite(value.bottomPanelHeight)
      ? value.bottomPanelHeight
      : defaults.bottomPanelHeight,
  }
}

const sanitizeWindowPreferences = (value: unknown): WindowPreferences => {
  const defaults = createDefaultWindowPreferences()
  if (!isRecord(value)) return defaults
  return {
    isFullScreen: typeof value.isFullScreen === 'boolean'
      ? value.isFullScreen
      : defaults.isFullScreen,
  }
}

const sanitizeUpdatesPreferences = (value: unknown): UpdatesPreferences => {
  const defaults = createDefaultUpdatesPreferences()
  if (!isRecord(value)) return defaults
  return {
    deferredVersion: typeof value.deferredVersion === 'string'
      ? value.deferredVersion
      : defaults.deferredVersion,
  }
}

const sanitizeMinecraftPreferences = (value: unknown): MinecraftPreferences => {
  const defaults = createDefaultMinecraftPreferences()
  if (!isRecord(value)) return defaults
  return {
    hideSnapshotsInVersionMenu: typeof value.hideSnapshotsInVersionMenu === 'boolean'
      ? value.hideSnapshotsInVersionMenu
      : defaults.hideSnapshotsInVersionMenu,
    defaultVersion: typeof value.defaultVersion === 'string' && isDottedNumericVersion(value.defaultVersion)
      ? value.defaultVersion
      : defaults.defaultVersion,
    javaPath: typeof value.javaPath === 'string'
      ? value.javaPath.trim()
      : defaults.javaPath,
  }
}

const sanitizeAppPreferences = (value: unknown): AppPreferences => {
  const source = isRecord(value) ? value : {}

  return {
    panels: sanitizePanelsPreferences(source.panels),
    window: sanitizeWindowPreferences(source.window),
    updates: sanitizeUpdatesPreferences(source.updates),
    workspace: sanitizeWorkspacePreferences(source.workspace),
    minecraft: sanitizeMinecraftPreferences(source.minecraft),
  }
}

class PreferencesManager {
  private preferencesPath: string
  private preferences: AppPreferences = createDefaultAppPreferences()
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
      this.preferences = createDefaultAppPreferences()
      this.loaded = true

      try {
        await fs.writeFile(this.preferencesPath, JSON.stringify(this.preferences, null, 2), 'utf-8')
      } catch {
        // Ignore persistence errors and keep defaults in memory.
      }
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
