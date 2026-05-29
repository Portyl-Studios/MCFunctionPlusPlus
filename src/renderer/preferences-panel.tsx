/**
 * Preferences Panel Component
 * 
 * Displays all application preferences in an inspector-like interface
 * similar to Unity's Inspector panel. Uses the preferences schema to
 * automatically render fields based on their configuration.
 */

import React, { useState } from 'react'
import type { AppPreferences } from '../main/preferences'
import type { PreferenceSchema, PreferenceSection } from './preferences-schema'
import { getSectionFields } from './preferences-schema'
import { PreferenceFieldRenderer } from './preference-field-renderer'

interface PreferencesPanelProps {
  preferences: AppPreferences
  schema: PreferenceSchema
  onPreferenceChange: (sectionId: string, fieldKey: string, value: unknown) => void
  onPreferenceAction?: (actionId: string) => void | Promise<void>
  isLoading?: boolean
}

interface CollapsibleSectionProps {
  section: PreferenceSection
  preferences: AppPreferences
  onFieldChange: (fieldKey: string, value: unknown) => void
  onAction?: (actionId: string) => void | Promise<void>
}

/**
 * Individual collapsible section for a preference category
 */
function CollapsiblePreferenceSection({
  section,
  preferences,
  onFieldChange,
  onAction,
}: CollapsibleSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const fields = getSectionFields(section)
  const sectionData = (preferences as any)[section.id] || {}

  // If no visible fields, don't render section
  if (Object.keys(fields).length === 0) {
    return null
  }

  return (
    <div className="inspector-panel-section">
      {/* Section Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="inspector-panel-section-button"
      >
        <span
          className={`codicon codicon-chevron-right text-codemirror-400 transform transition-transform ${
            isExpanded ? 'rotate-90' : ''
          }`}
        />
        <div className="flex-1 text-left">
          <div className="inspector-panel-section-title">{section.title}</div>
          {section.description && (
            <div className="inspector-panel-section-description">{section.description}</div>
          )}
        </div>
      </button>

      {/* Section Content */}
      {isExpanded && (
        <div className="inspector-panel-section-content">
          {Object.entries(fields).map(([fieldKey, config]) => {
            const currentValue = sectionData[fieldKey]

            return (
              <div key={fieldKey} className="inspector-panel-field">
                {/* Field Label */}
                <label className="inspector-panel-field-label">
                  <span>{config.label}</span>
                  {config.readOnly && (
                    <span className="inspector-panel-readonly-pill">
                      Read only
                    </span>
                  )}
                </label>

                {/* Field Description */}
                {config.description && (
                  <p className="inspector-panel-field-description">{config.description}</p>
                )}

                {/* Field Input */}
                <div className="inspector-panel-field-input">
                  <PreferenceFieldRenderer
                    fieldKey={fieldKey}
                    config={config}
                    value={currentValue}
                    onChange={(newValue) => onFieldChange(fieldKey, newValue)}
                    disabled={config.readOnly}
                    onAction={onAction}
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
  onPreferenceAction,
  isLoading,
}: PreferencesPanelProps) {
  if (isLoading) {
    return (
      <div className="inspector-panel-loading">
        <div className="inspector-panel-loading-text">Loading preferences...</div>
      </div>
    )
  }

  return (
    <div className="inspector-panel-root">
      {/* Content */}
      <div className="inspector-panel-scroll">
        {schema.sections.map((section) => (
          <CollapsiblePreferenceSection
            key={section.id}
            section={section}
            preferences={preferences}
            onFieldChange={(fieldKey, value) =>
              onPreferenceChange(section.id, fieldKey, value)
            }
            onAction={onPreferenceAction}
          />
        ))}
      </div>
    </div>
  )
}
