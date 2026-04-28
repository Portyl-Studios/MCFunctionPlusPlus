/**
 * Preference Field Renderer Components
 * 
 * Renders individual preference fields based on their configuration type.
 * Extensible for new field types.
 */

import React, { useState, useEffect } from 'react'
import type {
  FieldConfig,
  TextFieldConfig,
  NumberFieldConfig,
  CheckboxFieldConfig,
  DropdownFieldConfig,
  DropdownOption,
} from './preferences-schema'

interface FieldRendererProps {
  fieldKey: string
  config: FieldConfig
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
}

/**
 * Renders a text input field
 */
function TextFieldRenderer({
  config,
  value,
  onChange,
  disabled,
}: {
  config: TextFieldConfig
  value: unknown
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const stringValue = typeof value === 'string' ? value : ''
  const isReadOnly = !!disabled || !!config.readOnly

  if (config.multiline) {
    return (
      <textarea
        value={stringValue}
        onChange={(e) => onChange(e.target.value)}
        placeholder={config.placeholder}
        readOnly={isReadOnly}
        rows={4}
        className={`w-full px-2 py-1 bg-codemirror-600 border border-codemirror-500 rounded text-codemirror-100 text-sm font-mono focus:outline-none focus:border-codemirror-400 ${isReadOnly ? 'opacity-80' : ''}`}
      />
    )
  }

  return (
    <input
      type="text"
      value={stringValue}
      onChange={(e) => onChange(e.target.value)}
      placeholder={config.placeholder}
      readOnly={isReadOnly}
      className={`w-full px-2 py-1 bg-codemirror-600 border border-codemirror-500 rounded text-codemirror-100 text-sm font-mono focus:outline-none focus:border-codemirror-400 ${isReadOnly ? 'opacity-80' : ''}`}
    />
  )
}

/**
 * Renders a number input field
 */
function NumberFieldRenderer({
  config,
  value,
  onChange,
  disabled,
}: {
  config: NumberFieldConfig
  value: unknown
  onChange: (value: number) => void
  disabled?: boolean
}) {
  const numValue = typeof value === 'number' ? value : config.min ?? 0
  const isReadOnly = !!disabled || !!config.readOnly

  return (
    <input
      type="number"
      value={numValue}
      onChange={(e) => onChange(e.target.valueAsNumber)}
      min={config.min}
      max={config.max}
      step={config.step}
      readOnly={isReadOnly}
      className={`w-full px-2 py-1 bg-codemirror-600 border border-codemirror-500 rounded text-codemirror-100 text-sm font-mono focus:outline-none focus:border-codemirror-400 ${isReadOnly ? 'opacity-80' : ''}`}
    />
  )
}

/**
 * Renders a checkbox field
 */
function CheckboxFieldRenderer({
  config,
  value,
  onChange,
  disabled,
}: {
  config: CheckboxFieldConfig
  value: unknown
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  const boolValue = typeof value === 'boolean' ? value : false
  const isReadOnly = !!disabled || !!config.readOnly

  return (
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={boolValue}
        onChange={(e) => onChange(e.target.checked)}
        disabled={isReadOnly}
        className="w-4 h-4 cursor-pointer"
      />
    </div>
  )
}

/**
 * Renders a dropdown/select field
 */
function DropdownFieldRenderer({
  config,
  value,
  onChange,
  disabled,
}: {
  config: DropdownFieldConfig
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
}) {
  const [options, setOptions] = useState<DropdownOption[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const isReadOnly = !!disabled || !!config.readOnly

  useEffect(() => {
    if (typeof config.options === 'function') {
      setIsLoading(true)
      config
        .options()
        .then((opts) => {
          setOptions(opts)
          setIsLoading(false)
        })
        .catch((error) => {
          console.error('Failed to load dropdown options:', error)
          setIsLoading(false)
        })
    } else {
      setOptions(config.options)
    }
  }, [config.options])

  if (isLoading) {
    return (
      <div className="px-2 py-1 text-codemirror-400 text-sm">Loading options...</div>
    )
  }

  const stringValue = String(value ?? '')

  return (
    <select
      value={stringValue}
      onChange={(e) => {
        if (isReadOnly) return
        const selectedOption = options.find((opt) => String(opt.value) === e.target.value)
        if (selectedOption) {
          onChange(selectedOption.value)
        }
      }}
      disabled={isReadOnly}
      className="w-full px-2 py-1 bg-codemirror-600 border border-codemirror-500 rounded text-codemirror-100 text-sm font-mono focus:outline-none focus:border-codemirror-400"
    >
      <option value="">-- Select --</option>
      {options.map((option) => (
        <option key={String(option.value)} value={String(option.value)}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

/**
 * Renders a color input field
 */
function ColorFieldRenderer({
  config,
  value,
  onChange,
  disabled,
}: {
  config: { allowAlpha?: boolean }
  value: unknown
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const stringValue = typeof value === 'string' ? value : '#000000'
  const isReadOnly = !!disabled || !!config.readOnly

  return (
    <input
      type="color"
      value={stringValue}
      onChange={(e) => onChange(e.target.value)}
      disabled={isReadOnly}
      className="w-full h-8 cursor-pointer"
    />
  )
}

/**
 * Main field renderer that dispatches to specific renderers based on field type
 */
export function PreferenceFieldRenderer({
  fieldKey,
  config,
  value,
  onChange,
  disabled,
}: FieldRendererProps) {
  switch (config.type) {
    case 'text':
      return (
        <TextFieldRenderer
          config={config}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      )
    case 'number':
      return (
        <NumberFieldRenderer
          config={config}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      )
    case 'checkbox':
      return (
        <CheckboxFieldRenderer
          config={config}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      )
    case 'dropdown':
    case 'select':
      return (
        <DropdownFieldRenderer
          config={config}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      )
    case 'color':
      return (
        <ColorFieldRenderer
          config={config}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      )
    case 'textarea':
      return (
        <TextFieldRenderer
          config={{ ...config, multiline: true }}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      )
    default:
      return (
        <div className="text-codemirror-400 text-sm">
          Unknown field type: {(config as any).type}
        </div>
      )
  }
}
