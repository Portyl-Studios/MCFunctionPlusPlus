/**
 * Preferences Schema Configuration System
 * 
 * This system defines how preference fields should be rendered and validated.
 * It's designed to be extensible for future field types and configurations.
 */

export type PreferenceFieldType = 
  | 'text'
  | 'number'
  | 'checkbox'
  | 'dropdown'
  | 'select'
  | 'color'
  | 'textarea'
  | 'button'
  // Add more types as needed

export interface BaseFieldConfig {
  label: string
  description?: string
  category?: string
  hidden?: boolean
  readOnly?: boolean
}

export interface TextFieldConfig extends BaseFieldConfig {
  type: 'text'
  placeholder?: string
  multiline?: boolean
  browseAction?: 'pickJavaExecutable'
  browseButtonLabel?: string
}

export interface NumberFieldConfig extends BaseFieldConfig {
  type: 'number'
  min?: number
  max?: number
  step?: number
}

export interface CheckboxFieldConfig extends BaseFieldConfig {
  type: 'checkbox'
}

export interface DropdownOption {
  label: string
  value: unknown
  description?: string
}

export interface DropdownFieldConfig extends BaseFieldConfig {
  type: 'dropdown' | 'select'
  options: DropdownOption[] | (() => Promise<DropdownOption[]>)
  multiple?: boolean
  searchable?: boolean
}

export interface ColorFieldConfig extends BaseFieldConfig {
  type: 'color'
  allowAlpha?: boolean
}

export interface TextareaFieldConfig extends BaseFieldConfig {
  type: 'textarea'
  rows?: number
  placeholder?: string
}

export interface ButtonFieldConfig extends BaseFieldConfig {
  type: 'button'
  buttonLabel?: string
  actionId: string
}

export type FieldConfig = 
  | TextFieldConfig
  | NumberFieldConfig
  | CheckboxFieldConfig
  | DropdownFieldConfig
  | ColorFieldConfig
  | TextareaFieldConfig
  | ButtonFieldConfig

export interface PreferenceSection {
  id: string
  title: string
  description?: string
  fields: Record<string, FieldConfig>
}

export interface PreferenceSchema {
  sections: PreferenceSection[]
  // For quick lookups by path (e.g., "minecraft.defaultVersion")
  fieldConfigMap?: Map<string, FieldConfig>
}

/**
 * Helper to get field config from a path like "minecraft.defaultVersion"
 */
export function getFieldConfig(schema: PreferenceSchema, path: string): FieldConfig | undefined {
  if (!schema.fieldConfigMap) {
    buildFieldConfigMap(schema)
  }
  return schema.fieldConfigMap?.get(path)
}

/**
 * Helper to build a quick lookup map from the schema
 */
export function buildFieldConfigMap(schema: PreferenceSchema): void {
  schema.fieldConfigMap = new Map()
  
  for (const section of schema.sections) {
    for (const [fieldKey, fieldConfig] of Object.entries(section.fields)) {
      const path = `${section.id}.${fieldKey}`
      schema.fieldConfigMap.set(path, fieldConfig)
    }
  }
}

/**
 * Get all visible fields for a section
 */
export function getSectionFields(section: PreferenceSection): Record<string, FieldConfig> {
  return Object.fromEntries(
    Object.entries(section.fields).filter(([, config]) => !config.hidden)
  )
}

/**
 * Helper to create field configs with better type safety
 */
export const fieldConfigs = {
  text: (label: string, config?: Partial<TextFieldConfig>): TextFieldConfig => ({
    type: 'text',
    label,
    ...config,
  }),

  number: (label: string, config?: Partial<NumberFieldConfig>): NumberFieldConfig => ({
    type: 'number',
    label,
    ...config,
  }),

  checkbox: (label: string, config?: Partial<CheckboxFieldConfig>): CheckboxFieldConfig => ({
    type: 'checkbox',
    label,
    ...config,
  }),

  dropdown: (
    label: string,
    options: DropdownOption[] | (() => Promise<DropdownOption[]>),
    config?: Partial<DropdownFieldConfig>
  ): DropdownFieldConfig => ({
    type: 'dropdown',
    label,
    options,
    ...config,
  }),

  select: (
    label: string,
    options: DropdownOption[] | (() => Promise<DropdownOption[]>),
    config?: Partial<DropdownFieldConfig>
  ): DropdownFieldConfig => ({
    type: 'select',
    label,
    options,
    ...config,
  }),

  color: (label: string, config?: Partial<ColorFieldConfig>): ColorFieldConfig => ({
    type: 'color',
    label,
    ...config,
  }),

  textarea: (label: string, config?: Partial<TextareaFieldConfig>): TextareaFieldConfig => ({
    type: 'textarea',
    label,
    ...config,
  }),

  button: (label: string, config: Omit<Partial<ButtonFieldConfig>, 'actionId'> & { actionId: string }): ButtonFieldConfig => ({
    type: 'button',
    label,
    ...config,
  }),
}
