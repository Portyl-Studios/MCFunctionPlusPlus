import React from 'react'
import type { DatapackMetadata, DatapackExportSettings } from '../main/datapack-parser'
import { fieldConfigs, getSectionFields, type PreferenceSchema, type PreferenceSection } from './preferences-schema'
import { PreferenceFieldRenderer } from './preference-field-renderer'
import { getDatapackContextIndex } from './mcfunction-language'
import type { McfunctionContextIndex } from './mcfunction-language/context'
import {
  applyExportFileNameTemplate,
  sanitizeExportFileName,
  formatExportDateStamp,
  DEFAULT_EXPORT_FILENAME_TEMPLATE,
  EXPORT_TEMPLATE_TOKENS,
} from '../shared/export-utils'

type DatapackInspectorDatapack = {
  dir: string
  name: string
  version?: number
  id?: string
  displayName?: string
  packVersion?: string
  minecraftVersion?: string
  lastOpened?: string
  author?: string
  description?: string
  packFormatVersionMin?: number
  packFormatVersionMax?: number
  tags?: string[]
  export?: DatapackExportSettings
}

type ExportSettingFieldKey = 'outputDir' | 'fileNameTemplate' | 'autoIncrementVersion' | 'excludeGlobs'

type DatapackInspectorPanelProps = {
  datapack: DatapackInspectorDatapack | null
  contextRevision: number
  onMetadataChange: (fieldKey: keyof DatapackMetadata, value: unknown) => void | Promise<void>
  onExportSettingChange: (fieldKey: ExportSettingFieldKey, value: unknown) => void | Promise<void>
  onExportNow: () => void | Promise<void>
  sectionExpansionById: Record<string, boolean>
  onSectionExpansionChange: (sectionId: string, expanded: boolean) => void
}

const metadataSchema: PreferenceSchema = {
  sections: [
    {
      id: 'core',
      title: 'Metadata',
      description: 'Stored directly in the datapack metadata file.',
      fields: {
        version: fieldConfigs.text('Schema Version', { readOnly: true }),
        id: fieldConfigs.text('Datapack Id', { placeholder: 'Datapack id' }),
        name: fieldConfigs.text('Display Name', { placeholder: 'Datapack name' }),
        packVersion: fieldConfigs.text('Pack Version', { placeholder: 'Pack version' }),
        minecraftVersion: fieldConfigs.text('Minecraft Version', { placeholder: 'Minecraft version' }),
        lastOpened: fieldConfigs.text('Last Opened', { readOnly: true }),
      },
    },
    {
      id: 'details',
      title: 'Details',
      description: 'Editable datapack description and ownership metadata.',
      fields: {
        author: fieldConfigs.text('Author', { placeholder: 'Author' }),
        description: fieldConfigs.textarea('Description', { placeholder: 'Datapack description' }),
        tags: fieldConfigs.textarea('Tags', { placeholder: 'Comma-separated tags' }),
      },
    },
    {
      id: 'pack-format',
      title: 'Pack Format',
      description: 'Controls the pack format range written into the metadata file.',
      fields: {
        packFormatVersionMin: fieldConfigs.number('Minimum Pack Format', { min: 0, step: 1 }),
        packFormatVersionMax: fieldConfigs.number('Maximum Pack Format', { min: 0, step: 1 }),
      },
    },
  ],
}

const renderPills = (items: string[], emptyLabel: string) => {
  if (items.length === 0) {
    return <div className="text-xs text-codemirror-400 italic">{emptyLabel}</div>
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span key={item} className="pillbox">
          {item}
        </span>
      ))}
    </div>
  )
}

function CollapsibleInspectorSection({
  sectionId,
  title,
  description,
  children,
  sectionExpansionById,
  onSectionExpansionChange,
}: {
  sectionId: string
  title: string
  description?: string
  children: React.ReactNode
  sectionExpansionById: Record<string, boolean>
  onSectionExpansionChange: (sectionId: string, expanded: boolean) => void
}) {
  const isExpanded = sectionExpansionById[sectionId] ?? true

  return (
    <div className="inspector-panel-section">
      <button
        onClick={() => onSectionExpansionChange(sectionId, !isExpanded)}
        className="inspector-panel-section-button"
      >
        <span
          className={`codicon codicon-chevron-right text-codemirror-400 transform transition-transform ${
            isExpanded ? 'rotate-90' : ''
          }`}
        />
        <div className="flex-1 text-left">
          <div className="inspector-panel-section-title">{title}</div>
          {description && <div className="inspector-panel-section-description">{description}</div>}
        </div>
      </button>

      {isExpanded && <div className="inspector-panel-section-content">{children}</div>}
    </div>
  )
}

function InspectorFieldSection({
  section,
  datapack,
  onMetadataChange,
  sectionExpansionById,
  onSectionExpansionChange,
}: {
  section: PreferenceSection
  datapack: DatapackInspectorDatapack
  onMetadataChange: (fieldKey: keyof DatapackMetadata, value: unknown) => void | Promise<void>
  sectionExpansionById: Record<string, boolean>
  onSectionExpansionChange: (sectionId: string, expanded: boolean) => void
}) {
  const fields = getSectionFields(section)

  return (
    <CollapsibleInspectorSection
      sectionId={`metadata:${section.id}`}
      title={section.title}
      description={section.description}
      sectionExpansionById={sectionExpansionById}
      onSectionExpansionChange={onSectionExpansionChange}
    >
      {Object.entries(fields).map(([fieldKey, config]) => {
        const currentValue = fieldKey === 'version'
          ? String(datapack.version ?? '')
          : fieldKey === 'id'
            ? datapack.id ?? ''
            : fieldKey === 'name'
              ? datapack.displayName ?? datapack.name
              : fieldKey === 'packVersion'
                ? datapack.packVersion ?? ''
                : fieldKey === 'minecraftVersion'
                  ? datapack.minecraftVersion ?? ''
                  : fieldKey === 'lastOpened'
                    ? datapack.lastOpened ?? ''
                    : fieldKey === 'author'
                      ? datapack.author ?? ''
                      : fieldKey === 'description'
                        ? datapack.description ?? ''
                        : fieldKey === 'packFormatVersionMin'
                          ? datapack.packFormatVersionMin
                          : fieldKey === 'packFormatVersionMax'
                            ? datapack.packFormatVersionMax
                            : fieldKey === 'tags'
                              ? (datapack.tags ?? []).join(', ')
                              : undefined

        return (
          <div key={fieldKey} className="inspector-panel-field">
            <label className="inspector-panel-field-label">
              <span>{config.label}</span>
              {config.readOnly && (
                <span className="inspector-panel-readonly-pill">
                  Read only
                </span>
              )}
            </label>

            {config.description && <p className="inspector-panel-field-description">{config.description}</p>}

            <div className="inspector-panel-field-input">
              <PreferenceFieldRenderer
                fieldKey={fieldKey}
                config={config}
                value={currentValue}
                onChange={(newValue) => void onMetadataChange(fieldKey as keyof DatapackMetadata, newValue)}
                disabled={config.readOnly}
              />
            </div>
          </div>
        )
      })}
    </CollapsibleInspectorSection>
  )
}

function ExportSettingsSection({
  datapack,
  onExportSettingChange,
  onExportNow,
  sectionExpansionById,
  onSectionExpansionChange,
}: {
  datapack: DatapackInspectorDatapack
  onExportSettingChange: (fieldKey: ExportSettingFieldKey, value: unknown) => void | Promise<void>
  onExportNow: () => void | Promise<void>
  sectionExpansionById: Record<string, boolean>
  onSectionExpansionChange: (sectionId: string, expanded: boolean) => void
}) {
  const [isExporting, setIsExporting] = React.useState(false)
  // Defend against a hand-edited / older-format .mpp-datapack: the renderer reads
  // the file directly and bypasses the main-process sanitizer, so coerce each
  // field to its expected shape before use.
  const settings = datapack.export ?? {}
  const outputDirValue = typeof settings.outputDir === 'string' ? settings.outputDir : ''
  const autoIncrementValue = typeof settings.autoIncrementVersion === 'boolean' ? settings.autoIncrementVersion : true
  const excludeGlobsValue = Array.isArray(settings.excludeGlobs)
    ? settings.excludeGlobs.filter((entry): entry is string => typeof entry === 'string')
    : []
  const template = (typeof settings.fileNameTemplate === 'string' ? settings.fileNameTemplate.trim() : '') || DEFAULT_EXPORT_FILENAME_TEMPLATE

  const previewFileName = sanitizeExportFileName(
    applyExportFileNameTemplate(template, {
      projectName: datapack.displayName ?? datapack.name,
      mcVersion: datapack.minecraftVersion ?? '',
      packVersion: datapack.packVersion ?? '',
      datapackId: datapack.id ?? '',
      author: datapack.author ?? '',
      packFormat: datapack.packFormatVersionMax != null ? String(datapack.packFormatVersionMax) : '',
      date: formatExportDateStamp(new Date()),
    }),
  )

  const outputDirConfig = fieldConfigs.text('Output Folder', {
    placeholder: 'Default (~/dist)',
    description: 'Saved relative to the datapack folder (leave blank for ~/dist).',
    browseAction: 'pickExportFolder',
    browseButtonLabel: 'Browse',
    browseRelativeTo: datapack.dir,
  })
  const templateConfig = fieldConfigs.text('File Name Template', {
    placeholder: DEFAULT_EXPORT_FILENAME_TEMPLATE,
  })
  const autoIncrementConfig = fieldConfigs.checkbox('Auto-increment patch version on export')
  const excludeConfig = fieldConfigs.textarea('Exclude Patterns', {
    placeholder: 'One glob per line, e.g. data/**/*.test.mcfunction',
    rows: 3,
  })

  const lastExportedLabel = settings.lastExportedAt
    ? new Date(settings.lastExportedAt).toLocaleString()
    : null

  const handleExport = async () => {
    if (isExporting) return
    try {
      setIsExporting(true)
      await onExportNow()
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <CollapsibleInspectorSection
      sectionId="export:settings"
      title="Export"
      description="Package this datapack into a Minecraft-ready .zip."
      sectionExpansionById={sectionExpansionById}
      onSectionExpansionChange={onSectionExpansionChange}
    >
      <div className="inspector-panel-field">
        <label className="inspector-panel-field-label">
          <span>{outputDirConfig.label}</span>
        </label>
        <p className="inspector-panel-field-description">{outputDirConfig.description}</p>
        <div className="inspector-panel-field-input">
          <PreferenceFieldRenderer
            fieldKey="outputDir"
            config={outputDirConfig}
            value={outputDirValue}
            onChange={(value) => void onExportSettingChange('outputDir', value)}
          />
        </div>
      </div>

      <div className="inspector-panel-field">
        <label className="inspector-panel-field-label">
          <span>{templateConfig.label}</span>
        </label>
        <p className="inspector-panel-field-description">Variables: {EXPORT_TEMPLATE_TOKENS.join(', ')}</p>
        <div className="inspector-panel-field-input">
          <PreferenceFieldRenderer
            fieldKey="fileNameTemplate"
            config={templateConfig}
            value={template}
            onChange={(value) => void onExportSettingChange('fileNameTemplate', value)}
          />
        </div>
        <p className="inspector-panel-field-description">Preview: {previewFileName}</p>
      </div>

      <div className="inspector-panel-field">
        <label className="inspector-panel-field-label">
          <span>{autoIncrementConfig.label}</span>
        </label>
        <div className="inspector-panel-field-input">
          <PreferenceFieldRenderer
            fieldKey="autoIncrementVersion"
            config={autoIncrementConfig}
            value={autoIncrementValue}
            onChange={(value) => void onExportSettingChange('autoIncrementVersion', value)}
          />
        </div>
      </div>

      <div className="inspector-panel-field">
        <label className="inspector-panel-field-label">
          <span>{excludeConfig.label}</span>
        </label>
        <div className="inspector-panel-field-input">
          <PreferenceFieldRenderer
            fieldKey="excludeGlobs"
            config={excludeConfig}
            value={excludeGlobsValue.join('\n')}
            onChange={(value) => void onExportSettingChange('excludeGlobs', value)}
          />
        </div>
      </div>

      {lastExportedLabel && (
        <div className="inspector-panel-field">
          <div className="inspector-panel-field-description">
            Last exported {lastExportedLabel}
            {settings.lastExportPath ? ` → ${settings.lastExportPath}` : ''}
          </div>
        </div>
      )}

      <div className="inspector-panel-field">
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={isExporting}
          className="button border-codemirror-400 text-sm"
        >
          {isExporting ? 'Exporting...' : 'Export Now'}
        </button>
      </div>
    </CollapsibleInspectorSection>
  )
}

function ContextListSection({
  sectionId,
  title,
  description,
  values,
  emptyLabel,
  sectionExpansionById,
  onSectionExpansionChange,
}: {
  sectionId: string
  title: string
  description?: string
  values: string[]
  emptyLabel: string
  sectionExpansionById: Record<string, boolean>
  onSectionExpansionChange: (sectionId: string, expanded: boolean) => void
}) {
  return (
    <CollapsibleInspectorSection
      sectionId={sectionId}
      title={title}
      description={description}
      sectionExpansionById={sectionExpansionById}
      onSectionExpansionChange={onSectionExpansionChange}
    >
      {renderPills(values, emptyLabel)}
    </CollapsibleInspectorSection>
  )
}

function ObjectiveBindingsSection({
  contextIndex,
  sectionExpansionById,
  onSectionExpansionChange,
}: {
  contextIndex: McfunctionContextIndex
  sectionExpansionById: Record<string, boolean>
  onSectionExpansionChange: (sectionId: string, expanded: boolean) => void
}) {
  const holdersByObjective = new Map<string, Set<string>>()

  for (const [holder, objectives] of contextIndex.objectivesByHolder.entries()) {
    for (const objective of objectives) {
      const existing = holdersByObjective.get(objective)
      if (existing) {
        existing.add(holder)
      } else {
        holdersByObjective.set(objective, new Set([holder]))
      }
    }
  }

  const entries = [...holdersByObjective.entries()]
    .map(([objective, holders]) => ({
      objective,
      holders: [...holders].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.objective.localeCompare(right.objective))

  return (
    <CollapsibleInspectorSection
      sectionId="context:bindings"
      title="Scoreboard Bindings"
      description="Resolved holder/objective relationships used by diagnostics."
      sectionExpansionById={sectionExpansionById}
      onSectionExpansionChange={onSectionExpansionChange}
    >
      {entries.length === 0 ? (
        <div className="text-xs text-codemirror-400 italic">No objective bindings recorded.</div>
      ) : (
        <div className="space-y-2">
          {entries.map(({ objective, holders }) => (
            <div key={objective} className="rounded border border-codemirror-600 bg-codemirror-800/40 px-2 py-1.5">
              <div className="text-[11px] uppercase tracking-wide text-codemirror-400 mb-1">{objective}</div>
              {renderPills(holders, 'No bound holders')}
            </div>
          ))}
        </div>
      )}
    </CollapsibleInspectorSection>
  )
}

export function DatapackInspectorPanel({
  datapack,
  contextRevision,
  onMetadataChange,
  onExportSettingChange,
  onExportNow,
  sectionExpansionById,
  onSectionExpansionChange,
}: DatapackInspectorPanelProps) {
  const contextIndex = datapack ? getDatapackContextIndex(datapack.dir) : null
  void contextRevision

  if (!datapack) {
    return (
      <div className="inspector-panel-loading">
        <div className="inspector-panel-loading-text">Open a datapack to inspect its metadata and diagnostic context.</div>
      </div>
    )
  }

  const objectiveValues = [...(contextIndex?.objectives ?? new Set<string>())].sort((left, right) => left.localeCompare(right))
  const holderValues = [...(contextIndex?.holders ?? new Set<string>())].sort((left, right) => left.localeCompare(right))
  const macroVariableValues = [...(contextIndex?.macroVariables ?? new Set<string>())].sort((left, right) => left.localeCompare(right))
  const tagValues = [...(contextIndex?.tags ?? new Set<string>())].sort((left, right) => left.localeCompare(right))

  const contextCountLabel = `${objectiveValues.length} objectives, ${holderValues.length} holders, ${macroVariableValues.length} variables, ${tagValues.length} tags`

  return (
    <div className="inspector-panel-root">
      <div className="inspector-panel-header">
        <div>
          <div className="inspector-panel-header-title">{datapack.displayName ?? datapack.name}</div>
          <div className="inspector-panel-header-path">{datapack.dir}/.mpp-datapack</div>
        </div>
        <div className="inspector-panel-header-summary">{contextIndex ? contextCountLabel : 'No diagnostic context available yet.'}</div>
      </div>

      <div className="inspector-panel-scroll">
        {metadataSchema.sections.map((section) => (
          <InspectorFieldSection
            key={section.id}
            section={section}
            datapack={datapack}
            onMetadataChange={onMetadataChange}
            sectionExpansionById={sectionExpansionById}
            onSectionExpansionChange={onSectionExpansionChange}
          />
        ))}

        <ExportSettingsSection
          datapack={datapack}
          onExportSettingChange={onExportSettingChange}
          onExportNow={onExportNow}
          sectionExpansionById={sectionExpansionById}
          onSectionExpansionChange={onSectionExpansionChange}
        />

        {contextIndex ? (
          <>
            <ContextListSection
              sectionId="context:scoreboards"
              title="Scoreboards"
              description="Objectives discovered from the active diagnostic context."
              values={objectiveValues}
              emptyLabel="No objectives recorded."
              sectionExpansionById={sectionExpansionById}
              onSectionExpansionChange={onSectionExpansionChange}
            />
            <ContextListSection
              sectionId="context:variables"
              title="Variables"
              description="Macro variables discovered from $(...) placeholders."
              values={macroVariableValues}
              emptyLabel="No macro variables recorded."
              sectionExpansionById={sectionExpansionById}
              onSectionExpansionChange={onSectionExpansionChange}
            />
            <ContextListSection
              sectionId="context:tags"
              title="Tags"
              description="Tags discovered in selectors, commands, and entity NBT context."
              values={tagValues}
              emptyLabel="No tags recorded."
              sectionExpansionById={sectionExpansionById}
              onSectionExpansionChange={onSectionExpansionChange}
            />
            <ContextListSection
              sectionId="context:holders"
              title="Scoreboard Holders"
              description="All holders referenced by diagnostic context."
              values={holderValues}
              emptyLabel="No holders recorded."
              sectionExpansionById={sectionExpansionById}
              onSectionExpansionChange={onSectionExpansionChange}
            />
            <ObjectiveBindingsSection
              contextIndex={contextIndex}
              sectionExpansionById={sectionExpansionById}
              onSectionExpansionChange={onSectionExpansionChange}
            />
          </>
        ) : (
          <div className="px-3 py-3 text-sm text-codemirror-400">Diagnostic context is not available for this datapack.</div>
        )}
      </div>
    </div>
  )
}