import { ipcMain } from 'electron'
import path from 'path'
import {
  parseDatapackMetadata,
  writeDatapackMetadata,
  createDefaultDatapackMetadata,
  updateDatapackLastOpened,
  type DatapackMetadata
} from './datapack-parser'

class DatapackManager {
  private currentDatapackDir: string | null = null
  private currentDatapackName: string | null = null
  private currentDatapackMetadata: DatapackMetadata | null = null

  async loadDatapack(datapackDir: string): Promise<DatapackMetadata> {
    this.currentDatapackDir = datapackDir
    const datapackName = path.basename(datapackDir)
    this.currentDatapackName = datapackName

    // Try to load existing metadata file
    let metadata = await parseDatapackMetadata(datapackDir)

    // If no metadata file exists, create a default one
    // ID would be the first two letters of the name, uppercase
    if (!metadata) {
      const sanitizedId = datapackName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 2).toUpperCase() || 'DP'
      metadata = createDefaultDatapackMetadata(datapackName, sanitizedId)
      await writeDatapackMetadata(datapackDir, metadata)
    } else {
      // Update lastOpened timestamp
      metadata = updateDatapackLastOpened(metadata)
      await writeDatapackMetadata(datapackDir, metadata)
    }

    this.currentDatapackMetadata = metadata
    return metadata
  }

  getDatapack(): DatapackMetadata | null {
    return this.currentDatapackMetadata
  }

  getDatapackDir(): string | null {
    return this.currentDatapackDir
  }

  getDatapackName(): string | null {
    return this.currentDatapackName
  }

  updateMetadata(updates: Partial<DatapackMetadata>): void {
    if (!this.currentDatapackMetadata) return

    this.currentDatapackMetadata = {
      ...this.currentDatapackMetadata,
      ...updates
    }
  }

  async saveDatapack(): Promise<void> {
    if (!this.currentDatapackDir || !this.currentDatapackMetadata) {
      throw new Error('No datapack loaded')
    }

    await writeDatapackMetadata(this.currentDatapackDir, this.currentDatapackMetadata)
  }

  clear(): void {
    this.currentDatapackDir = null
    this.currentDatapackName = null
    this.currentDatapackMetadata = null
  }
}

export const datapackManager = new DatapackManager()

export const registerDatapackHandlers = (): void => {
  ipcMain.handle('datapack-load', async (_event, { datapackDir }) => {
    return await datapackManager.loadDatapack(datapackDir)
  })

  ipcMain.handle('datapack-get', async () => {
    return datapackManager.getDatapack()
  })

  ipcMain.handle('datapack-update', async (_event, { updates }) => {
    datapackManager.updateMetadata(updates)
    return datapackManager.getDatapack()
  })

  ipcMain.handle('datapack-save', async () => {
    await datapackManager.saveDatapack()
    return datapackManager.getDatapack()
  })

  ipcMain.handle('datapack-clear', async () => {
    datapackManager.clear()
  })
}
