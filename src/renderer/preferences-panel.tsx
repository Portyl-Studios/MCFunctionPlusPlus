/**
 * Preferences Panel Component
 * 
 * Displays all application preferences in an inspector-like interface
 * similar to Unity's Inspector panel. Uses the preferences schema to
 * automatically render fields based on their configuration.
 */

import React, { useState, useEffect } from 'react'
import type { AppPreferences } from '../main/preferences'
import type { PreferenceSchema, PreferenceSection } from './preferences-schema'
import { getSectionFields } from './preferences-schema'
import { PreferenceFieldRenderer } from './preference-field-renderer'

interface PreferencesPanelProps {
  preferences: AppPreferences
  schema: PreferenceSchema
  onPreferenceChange: (sectionId: string, fieldKey: string, value: unknown) => void
  isLoading?: boolean
}

interface CollapsibleSectionProps {
  section: PreferenceSection
  preferences: AppPreferences
  onFieldChange: (fieldKey: string, value: unknown) => void
}

/**
 * Individual collapsible section for a preference category
 */
function CollapsiblePreferenceSection({
  section,
  preferences,
  onFieldChange,
}: CollapsibleSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const fields = getSectionFields(section)
  const sectionData = (preferences as any)[section.id] || {}

  // If no visible fields, don't render section
  if (Object.keys(fields).length === 0) {
    return null
  }

  return (
    <div className="border-b border-codemirror-600 last:border-b-0">
      {/* Section Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-codemirror-600 transition-colors group"
      >
        <span
          className={`codicon codicon-chevron-right text-codemirror-400 transform transition-transform ${
            isExpanded ? 'rotate-90' : ''
          }`}
        />
        <div className="flex-1 text-left">
          <div className="font-semibold text-codemirror-100 text-sm">{section.title}</div>
          {section.description && (
            <div className="text-xs text-codemirror-400 mt-0.5">{section.description}</div>
          )}
        </div>
      </button>

      {/* Section Content */}
      {isExpanded && (
        <div className="px-3 py-2 bg-codemirror-700 space-y-3">
          {Object.entries(fields).map(([fieldKey, config]) => {
            const currentValue = sectionData[fieldKey]

            return (
              <div key={fieldKey} className="space-y-1">
                {/* Field Label */}
                <label className="block text-xs font-medium text-codemirror-200">
                  <span>{config.label}</span>
                  {config.readOnly && (
                    <span className="ml-2 rounded border border-codemirror-500 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-codemirror-400">
                      Read only
                    </span>
                  )}
                </label>

                {/* Field Description */}
                {config.description && (
                  <p className="text-xs text-codemirror-400 mb-1.5">{config.description}</p>
                )}

                {/* Field Input */}
                <div className="pl-3 border-l border-codemirror-500">
                  <PreferenceFieldRenderer
                    fieldKey={fieldKey}
                    config={config}
                    value={currentValue}
                    onChange={(newValue) => onFieldChange(fieldKey, newValue)}
                    disabled={config.readOnly}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Main Preferences Panel Component
 */
export function PreferencesPanel({
  preferences,
  schema,
  onPreferenceChange,
  isLoading,
}: PreferencesPanelProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-codemirror-400 text-sm">Loading preferences...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-codemirror-700">
      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {schema.sections.map((section) => (
          <CollapsiblePreferenceSection
            key={section.id}
            section={section}
            preferences={preferences}
            onFieldChange={(fieldKey, value) =>
              onPreferenceChange(section.id, fieldKey, value)
            }
          />
        ))}
      </div>
    </div>
  )
}
