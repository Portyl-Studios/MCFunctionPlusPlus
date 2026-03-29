import { app } from 'electron'
import path from 'path'
import fs from 'fs/promises'

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

interface AppPreferences {
  panels?: PanelPreferences
  window?: WindowPreferences
  updates?: UpdatesPreferences
  workspace?: WorkspacePreferences
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
      this.preferences = JSON.parse(data)
      this.loaded = true
    } catch (error) {
      // File doesn't exist or is invalid, use defaults
      this.preferences = {}
      this.loaded = true
    }

    return this.preferences
  }

  async save(): Promise<void> {
    try {
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
export type { AppPreferences, PanelPreferences, WindowPreferences, UpdatesPreferences, WorkspacePreferences }
