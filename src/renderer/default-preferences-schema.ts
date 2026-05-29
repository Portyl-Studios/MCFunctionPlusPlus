/**
 * Default Preferences Schema
 * 
 * This defines the structure and rendering configuration for all app preferences.
 * Update this file to add new preferences or modify how they're displayed.
 */

import type { PreferenceSchema } from './preferences-schema'
import { fieldConfigs } from './preferences-schema'

export const defaultPreferencesSchema: PreferenceSchema = {
  sections: [
    {
      id: 'minecraft',
      title: 'Minecraft',
      description: 'Minecraft version and data settings',
      fields: {
        defaultVersion: fieldConfigs.text('Default Version', {
          description: 'Default Minecraft version for new datapacks',
          readOnly: true,
        }),
        hideSnapshotsInVersionMenu: fieldConfigs.checkbox('Hide Snapshots', {
          description: 'Hide snapshot versions in the version selection menu',
        }),
        javaPath: fieldConfigs.text('Java Path', {
          description: 'Custom path to java.exe used for Minecraft data generation. Leave blank to use java from PATH.',
          placeholder: 'C:\\Program Files\\Java\\jdk-26.0.1\\bin\\java.exe',
          browseAction: 'pickJavaExecutable',
          browseButtonLabel: 'Browse',
        }),
        retryMinecraftDataBootstrap: fieldConfigs.button('Retry Minecraft Data Sync', {
          description: 'Run the Minecraft data preparation flow again after changing Java settings.',
          buttonLabel: 'Run Again',
          actionId: 'retryMinecraftDataBootstrap',
        }),
      },
    },
    {
      id: 'window',
      title: 'Window',
      description: 'Application window settings',
      fields: {
        isFullScreen: fieldConfigs.checkbox('Full Screen', {
          description: 'Launch application in full screen mode',
        }),
      },
    },
  ],
}
