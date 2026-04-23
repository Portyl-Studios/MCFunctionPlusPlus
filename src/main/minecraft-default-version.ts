import { resolveLatestMinecraftReleaseVersion } from './minecraft-data'
import { preferencesManager } from './preferences'

const INITIAL_MINECRAFT_DEFAULT_VERSION = '26.1.2'

const formatMinecraftManifestErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return typeof error === 'string' ? error : 'Unknown error'
}

export const ensureInitialMinecraftVersionPreference = async (): Promise<string> => {
  const currentMinecraftPrefs = await preferencesManager.get('minecraft') ?? {}

  if (!currentMinecraftPrefs.defaultVersion) {
    await preferencesManager.set('minecraft', {
      ...currentMinecraftPrefs,
      defaultVersion: INITIAL_MINECRAFT_DEFAULT_VERSION,
    })
    return INITIAL_MINECRAFT_DEFAULT_VERSION
  }

  return currentMinecraftPrefs.defaultVersion
}

export const syncDefaultMinecraftVersionPreference = async (): Promise<{ version: string; errorMessage: string | null }> => {
  const currentMinecraftPrefs = await preferencesManager.get('minecraft') ?? {}

  let resolvedVersion: string | null = null
  let errorMessage: string | null = null

  try {
    resolvedVersion = await resolveLatestMinecraftReleaseVersion()
  } catch (error) {
    console.error('Failed to resolve latest Minecraft release version from Mojang manifest:', error)
    const fallbackVersion = currentMinecraftPrefs.defaultVersion ?? INITIAL_MINECRAFT_DEFAULT_VERSION
    errorMessage = `Failed to refresh the default Minecraft version from the Mojang manifest. The app will use ${fallbackVersion} for now. ${formatMinecraftManifestErrorMessage(error)}`
  }

  if (resolvedVersion && currentMinecraftPrefs.defaultVersion !== resolvedVersion) {
    await preferencesManager.set('minecraft', {
      ...currentMinecraftPrefs,
      defaultVersion: resolvedVersion,
    })
  }

  return {
    version: currentMinecraftPrefs.defaultVersion ?? resolvedVersion ?? INITIAL_MINECRAFT_DEFAULT_VERSION,
    errorMessage,
  }
}