import { useState } from 'react'
import type { DatapackMetadata } from '../main/datapack-parser'

interface DatapackInfo {
  dir: string | null
  name: string | null
  metadata: DatapackMetadata | null
}

export function useDatapack() {
  const [datapackInfo, setDatapackInfo] = useState<DatapackInfo>({
    dir: null,
    name: null,
    metadata: null
  })

  const handleLoadDatapack = async (datapackDir: string) => {
    try {
      const metadata = await (window as any).electron.datapackLoad(datapackDir)
      const datapackName = datapackDir.split(/[\\/]/).pop() || 'datapack'
      setDatapackInfo({
        dir: datapackDir,
        name: datapackName,
        metadata
      })
      return metadata
    } catch (error) {
      console.error('Failed to load datapack:', error)
      return null
    }
  }

  const handleUpdateMetadata = async (updates: Partial<DatapackMetadata>) => {
    try {
      const updated = await (window as any).electron.datapackUpdate(updates)
      setDatapackInfo((prev) => ({
        ...prev,
        metadata: updated
      }))
      return updated
    } catch (error) {
      console.error('Failed to update datapack metadata:', error)
      return null
    }
  }

  const handleSaveDatapack = async () => {
    try {
      const saved = await (window as any).electron.datapackSave()
      setDatapackInfo((prev) => ({
        ...prev,
        metadata: saved
      }))
      return saved
    } catch (error) {
      console.error('Failed to save datapack:', error)
      return null
    }
  }

  const handleClearDatapack = async () => {
    try {
      await (window as any).electron.datapackClear()
      setDatapackInfo({
        dir: null,
        name: null,
        metadata: null
      })
    } catch (error) {
      console.error('Failed to clear datapack:', error)
    }
  }

  return {
    datapackInfo,
    setDatapackInfo,
    handleLoadDatapack,
    handleUpdateMetadata,
    handleSaveDatapack,
    handleClearDatapack
  }
}
