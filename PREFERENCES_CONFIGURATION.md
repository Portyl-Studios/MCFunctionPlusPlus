# Preferences System Configuration Guide

This document explains how to add and configure new application preferences with different field types.

## Architecture Overview

The preferences system consists of four main components:

1. **preferences-schema.ts** - Type definitions and field configuration helpers
2. **default-preferences-schema.ts** - The actual preference schema with sections and fields
3. **preference-field-renderer.tsx** - Component renderers for different field types
4. **preferences-panel.tsx** - The main UI panel that displays preferences
5. **index.tsx** - Integration with the main app that loads/saves preferences

## Adding a New Preference

### Step 1: Update the Schema

Edit `default-preferences-schema.ts` and add your field to the appropriate section, or create a new section:

```typescript
import { fieldConfigs } from './preferences-schema'

export const defaultPreferencesSchema: PreferenceSchema = {
  sections: [
    {
      id: 'mySection',
      title: 'My Section',
      description: 'Description of what these settings do',
      fields: {
        myNewSetting: fieldConfigs.text('My Setting Label', {
          description: 'Help text explaining this setting',
          placeholder: 'Example value',
        }),
      },
    },
  ],
}
```

### Step 2: Update the Preferences Interface

Edit `src/main/preferences.ts` to add your new field to the appropriate interface:

```typescript
interface MyPreferences {
  myNewSetting?: string
}

interface AppPreferences {
  mySection?: MyPreferences
}
```

Also update the sanitizer function for your section to ensure proper validation:

```typescript
const sanitizeMyPreferences = (value: unknown): MyPreferences => {
  const defaults = createDefaultMyPreferences()
  if (!isRecord(value)) return defaults
  return {
    myNewSetting: typeof value.myNewSetting === 'string'
      ? value.myNewSetting
      : defaults.myNewSetting,
  }
}
```

## Field Types

The system supports multiple field types. Here are examples of each:

### Text Field
```typescript
fieldConfigs.text('Setting Name', {
  description: 'Help text',
  placeholder: 'example@email.com',
  multiline: false,
})
```

### Number Field
```typescript
fieldConfigs.number('Panel Width', {
  description: 'Width in pixels',
  min: 200,
  max: 800,
  step: 10,
})
```

### Checkbox
```typescript
fieldConfigs.checkbox('Enable Feature', {
  description: 'Enable or disable the feature',
})
```

### Dropdown/Select
```typescript
fieldConfigs.dropdown('Version', [
  { label: '1.20.1', value: '1.20.1' },
  { label: '1.20.4', value: '1.20.4' },
  { label: '1.21', value: '1.21' },
], {
  description: 'Select a Minecraft version',
  searchable: true,
})
```

**With Async Options** (fetched at runtime):
```typescript
fieldConfigs.dropdown('Version', async () => {
  const versions = await window.electron.minecraftVersionsGet()
  return versions.map(v => ({
    label: v.id,
    value: v.id,
    description: v.releaseTime,
  }))
}, {
  description: 'Select a Minecraft version',
})
```

### Textarea
```typescript
fieldConfigs.textarea('Custom Script', {
  description: 'Enter custom script code',
  rows: 6,
  placeholder: 'function() { ... }',
})
```

### Color
```typescript
fieldConfigs.color('Theme Color', {
  description: 'Choose a color',
  allowAlpha: true,
})
```

## Adding a New Field Type

To add a new field type (e.g., a file picker, date picker):

### 1. Add Type Definition in `preferences-schema.ts`

```typescript
export type PreferenceFieldType = 
  | 'text'
  | 'number'
  | 'checkbox'
  | 'dropdown'
  | 'myNewType'  // Add here
  // ...

export interface MyNewTypeFieldConfig extends BaseFieldConfig {
  type: 'myNewType'
  // Add any specific properties needed
  customProp?: string
}

export type FieldConfig = 
  | TextFieldConfig
  | NumberFieldConfig
  | MyNewTypeFieldConfig  // Add here
  // ...
```

### 2. Add Helper in `fieldConfigs`

```typescript
export const fieldConfigs = {
  // ... existing helpers
  myNewType: (label: string, config?: Partial<MyNewTypeFieldConfig>): MyNewTypeFieldConfig => ({
    type: 'myNewType',
    label,
    ...config,
  }),
}
```

### 3. Add Renderer in `preference-field-renderer.tsx`

```typescript
function MyNewTypeFieldRenderer({
  config,
  value,
  onChange,
  disabled,
}: {
  config: MyNewTypeFieldConfig
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
}) {
  // Implement your custom renderer here
  return (
    <input
      type="file"
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      // ... other props
    />
  )
}
```

### 4. Add Case in Main Dispatcher

```typescript
export function PreferenceFieldRenderer({
  fieldKey,
  config,
  value,
  onChange,
  disabled,
}: FieldRendererProps) {
  switch (config.type) {
    // ... existing cases
    case 'myNewType':
      return (
        <MyNewTypeFieldRenderer
          config={config}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      )
    // ...
  }
}
```

## Usage in Components

The preferences are loaded automatically in the main `CodeEditor` component. To access preferences in your components:

```typescript
// Load a specific preference from electron API
const versions = await window.electron.preferencesGet('minecraft')

// Update a preference
await window.electron.preferencesSet('minecraft', {
  defaultVersion: '1.20.1',
  hideSnapshotsInVersionMenu: true,
})

// Update multiple sections at once
await window.electron.preferencesUpdate({
  minecraft: { defaultVersion: '1.20.1' },
  window: { isFullScreen: false },
})
```

## Organizing Preferences by Section

Group related preferences into sections for better UX:

```typescript
{
  sections: [
    {
      id: 'editor',
      title: 'Editor',
      fields: { /* editor-related settings */ }
    },
    {
      id: 'appearance',
      title: 'Appearance',
      fields: { /* appearance settings */ }
    },
  ],
}
```

## Hiding Preferences from UI

Mark fields as hidden if they should be managed programmatically:

```typescript
fieldConfigs.text('Internal Cache', {
  hidden: true,  // Won't appear in the UI
})
```

## Best Practices

1. **Organize by section** - Group related settings in meaningful sections
2. **Provide descriptions** - Help users understand what each setting does
3. **Validate on save** - The backend sanitizers validate all preferences
4. **Use appropriate types** - Choose field types that match the data
5. **Provide defaults** - Always define default values in the backend
6. **Plan for extensibility** - Structure your schema for future additions
7. **Test new fields** - Verify both UI rendering and data persistence

## Schema Structure Reference

```typescript
interface PreferenceSchema {
  sections: PreferenceSection[]
  fieldConfigMap?: Map<string, FieldConfig>
}

interface PreferenceSection {
  id: string                              // Unique section ID
  title: string                           // Display title
  description?: string                    // Help text
  fields: Record<string, FieldConfig>    // Field configurations
}

interface BaseFieldConfig {
  label: string                           // Field label
  description?: string                    // Help text
  category?: string                       // Optional grouping
  hidden?: boolean                        // Hide from UI if true
}
```
