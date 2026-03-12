import React from 'react'
import datapackSchema from '../../resources/datapackschema/94.1.json'
import type { MenuItem } from './menuitem'
import { Dialog, useDialog } from './overlays/dialog'
import { Tooltip } from './overlays/tooltip'
import { detectEditorLanguage, type DiagnosticSummary } from './language-handler'

interface DataPackTreeProps {
  paths: string[]
  className?: string
  folderName?: string
  rootId?: string
  rootName?: string
  rootPackVersion?: string
  basePath?: string
  onSelect?: (path: string, isFile: boolean) => void
  onFolderCreated?: () => void
  onFileRenamed?: (oldRelativePath: string, newName: string) => Promise<boolean>
  onFileDeleted?: (relativePath: string) => Promise<boolean>
  onContextMenuRequest?: (event: React.MouseEvent, items: MenuItem[]) => void
  modifiedFileKeys?: Set<string>
  fileDiagnosticSummaries?: Record<string, DiagnosticSummary>
  externalSelectedPath?: string | null
  externalSelectedFileKey?: string | null
  externalExpandedPaths?: Set<string>
  onExpandedPathsChange?: (paths: Set<string>) => void
  treeContainerRef?: React.RefObject<HTMLDivElement | null>
}

type TreeNode = {
  name: string
  children?: Map<string, TreeNode>
  isFile?: boolean
  // Schema metadata
  schemaNode?: DatapackSchemaNode
  description?: string
  experimental?: boolean
  contentType?: string
  allowedChildren?: string[]
  // Root-level metadata
  packFormatVersion?: string
  minMinecraftVersion?: string
  maxMinecraftVersion?: string
}

type DatapackSchemaNode = {
  name?: string
  description?: string
  experimental?: boolean
  contentType?: string
  children?: DatapackSchemaNode[]
  packFormatVersion?: string
  minMinecraftVersion?: string
  maxMinecraftVersion?: string
}

const buildTree = (paths: string[], rootName: string = 'root'): TreeNode => {
  const root: TreeNode = { name: rootName, children: new Map() }

  for (const rawPath of paths) {
    const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!normalized) continue

    const parts = normalized.split('/').filter(Boolean)
    let current = root

    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i]
      if (!current.children) current.children = new Map()

      let child = current.children.get(part)
      if (!child) {
        child = { name: part, children: new Map() }
        current.children.set(part, child)
      }

      const isLeaf = i === parts.length - 1
      child.isFile = isLeaf

      current = child
    }
  }

  return root
}

// Find matching schema node for a given physical node name
const findMatchingSchemaNode = (nodeName: string, schemaChildren: DatapackSchemaNode[] | undefined): DatapackSchemaNode | undefined => {
  if (!schemaChildren) return undefined

  // Try exact name match first
  for (const child of schemaChildren) {
    if (child.name === nodeName) {
      return child
    }
  }

  // Try placeholder match (like <namespace>, <registry_name>, etc.)
  for (const child of schemaChildren) {
    if (typeof child.name === 'string' && child.name.startsWith('<') && child.name.endsWith('>')) {
      return child
    }
  }

  return undefined
}

// Enrich tree nodes with schema metadata
const enrichTreeWithSchema = (node: TreeNode, schemaNode?: DatapackSchemaNode, isRoot: boolean = false): void => {
  if (!schemaNode) return

  node.schemaNode = schemaNode
  node.description = schemaNode.description
  node.experimental = schemaNode.experimental ?? false
  node.contentType = schemaNode.contentType
  node.allowedChildren = schemaNode.children
    ?.map((child) => child.name)
    .filter((name): name is string => typeof name === 'string')

  // Add root-level version metadata only for root node
  if (isRoot) {
    node.packFormatVersion = schemaNode.packFormatVersion
    node.minMinecraftVersion = schemaNode.minMinecraftVersion
    node.maxMinecraftVersion = schemaNode.maxMinecraftVersion
  }

  // Recursively enrich children
  if (node.children && schemaNode.children) {
    for (const [childName, childNode] of node.children) {
      const matchingSchema = findMatchingSchemaNode(childName, schemaNode.children)
      enrichTreeWithSchema(childNode, matchingSchema, false)
    }
  }
}

const sortChildren = (children: Map<string, TreeNode>): TreeNode[] => {
  const nodes = Array.from(children.values())
  nodes.sort((a, b) => {
    const aIsDir = a.children && a.children.size > 0
    const bIsDir = b.children && b.children.size > 0

    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return nodes
}

const collectDirectoryPaths = (node: TreeNode, pathKey: string, output: string[], depth: number) => {
  const hasChildren = node.children && node.children.size > 0
  if (!hasChildren) return

  // Only expand nodes at depth < 3
  if (depth < 3) {
    output.push(pathKey)
    for (const child of node.children!.values()) {
      collectDirectoryPaths(child, `${pathKey}/${child.name}`, output, depth + 1)
    }
  }
}

export function DatapackTree({ paths, className, folderName, rootId, rootName, rootPackVersion, basePath, onSelect, onFolderCreated, onFileRenamed, onFileDeleted, onContextMenuRequest, modifiedFileKeys, fileDiagnosticSummaries, externalSelectedPath, externalSelectedFileKey, externalExpandedPaths, onExpandedPathsChange, treeContainerRef }: DataPackTreeProps) {
  const tree = React.useMemo(() => {
    const builtTree = buildTree(paths, folderName)
    // Enrich with schema starting from the root schema node
    enrichTreeWithSchema(builtTree, datapackSchema as DatapackSchemaNode, true)
    return builtTree
  }, [paths, folderName])
  const [selectedPath, setSelectedPath] = React.useState<string | null>(externalSelectedPath ?? null)
  const dialog = useDialog()
  const [expandedPaths, setExpandedPaths] = React.useState<Set<string>>(() => {
    const dirs: string[] = []
    // Expand root by default
    dirs.push(tree.name)
    if (tree.children) {
      for (const child of tree.children.values()) {
        collectDirectoryPaths(child, `${tree.name}/${child.name}`, dirs, 2)
      }
    }
    return new Set(dirs)
  })

  // Use external values if provided
  const effectiveSelectedPath = externalSelectedPath !== undefined ? externalSelectedPath : selectedPath
  const effectiveExpandedPaths = externalExpandedPaths ?? expandedPaths
  const isExternalExpanded = externalExpandedPaths !== undefined

  const setExpandedPathsSafe = (next: Set<string>) => {
    if (onExpandedPathsChange) {
      onExpandedPathsChange(next)
    }
    if (!isExternalExpanded) {
      setExpandedPaths(next)
    }
  }

  const setSelectedPathSafe = (next: string | null) => {
    if (externalSelectedPath !== undefined) return
    setSelectedPath(next)
  }

  React.useEffect(() => {
    if (externalSelectedPath !== undefined) {
      setSelectedPath(externalSelectedPath)
    }
  }, [externalSelectedPath])

  React.useEffect(() => {
    if (isExternalExpanded || !onExpandedPathsChange) return
    onExpandedPathsChange(expandedPaths)
  }, [expandedPaths, isExternalExpanded, onExpandedPathsChange])

  React.useEffect(() => {
    if (isExternalExpanded || externalSelectedPath !== undefined) return
    const dirs: string[] = []
    // Expand root by default
    dirs.push(tree.name)
    if (tree.children) {
      for (const child of tree.children.values()) {
        collectDirectoryPaths(child, `${tree.name}/${child.name}`, dirs, 2)
      }
    }
    setExpandedPaths(new Set(dirs))
    setSelectedPath(null)
  }, [tree, isExternalExpanded, externalSelectedPath])

  const modifiedPathKeys = React.useMemo(() => {
    const next = new Set<string>()
    if (!basePath || !modifiedFileKeys?.size) return next

    for (const fileKey of modifiedFileKeys) {
      const separatorIndex = fileKey.indexOf('|')
      if (separatorIndex === -1) continue

      const datapackDir = fileKey.slice(0, separatorIndex)
      if (datapackDir !== basePath) continue

      const relativePath = fileKey
        .slice(separatorIndex + 1)
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')

      next.add(tree.name)

      const segments = relativePath.split('/').filter(Boolean)
      let currentPath = tree.name
      for (const segment of segments) {
        currentPath = `${currentPath}/${segment}`
        next.add(currentPath)
      }
    }

    return next
  }, [basePath, modifiedFileKeys, tree.name])

  const diagnosticPathSummaries = React.useMemo(() => {
    const next: Record<string, DiagnosticSummary> = {}
    if (!basePath || !fileDiagnosticSummaries) return next

    for (const [fileKey, summary] of Object.entries(fileDiagnosticSummaries)) {
      const errors = summary?.errors ?? 0
      const warnings = summary?.warnings ?? 0
      if (errors <= 0 && warnings <= 0) continue

      const separatorIndex = fileKey.indexOf('|')
      if (separatorIndex === -1) continue

      const datapackDir = fileKey.slice(0, separatorIndex)
      if (datapackDir !== basePath) continue

      const relativePath = fileKey
        .slice(separatorIndex + 1)
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')

      const pathKeys = [tree.name]
      const segments = relativePath.split('/').filter(Boolean)
      let currentPath = tree.name
      for (const segment of segments) {
        currentPath = `${currentPath}/${segment}`
        pathKeys.push(currentPath)
      }

      for (const pathKey of pathKeys) {
        const existingSummary = next[pathKey]
        if (existingSummary) {
          existingSummary.errors += errors
          existingSummary.warnings += warnings
        } else {
          next[pathKey] = { errors, warnings }
        }
      }
    }

    return next
  }, [basePath, fileDiagnosticSummaries, tree.name])

  const toggleExpanded = (pathKey: string) => {
    const next = new Set(effectiveExpandedPaths)
    if (next.has(pathKey)) {
      next.delete(pathKey)
    } else {
      next.add(pathKey)
    }
    setExpandedPathsSafe(next)
  }

  const handleSelect = (pathKey: string, isFile: boolean, hasChildren: boolean) => {
    setSelectedPathSafe(pathKey)
    if (hasChildren) {
      toggleExpanded(pathKey)
    }
    if (isFile && onSelect) {
      onSelect(pathKey, true)
    } else if (!isFile && onSelect) {
      onSelect(pathKey, false)
    }
  }

  const normalizePath = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '')

  const getRelativePathFromPathKey = (pathKey: string) => {
    const normalizedKey = pathKey.replace(/\\/g, '/')
    const rootPrefix = `${tree.name}/`
    if (normalizedKey === tree.name) return ''
    if (normalizedKey.startsWith(rootPrefix)) {
      return normalizedKey.slice(rootPrefix.length)
    }
    return normalizedKey
  }

  const resolveTargetPath = (rootPath: string, key: string, childName: string) => {
    const normalizedBase = normalizePath(rootPath)
    const normalizedKey = key.replace(/\\/g, '/')
    const rootPrefix = `${tree.name}/`
    const relative = normalizedKey === tree.name
      ? ''
      : normalizedKey.startsWith(rootPrefix)
        ? normalizedKey.slice(rootPrefix.length)
        : normalizedKey

    const parts = [normalizedBase]
    if (relative) parts.push(relative)
    parts.push(childName)
    return parts.join('/')
  }

  const getActualPath = (pathKey: string): string | null => {
    if (!basePath) return null
    
    const normalizedBase = normalizePath(basePath)
    const normalizedKey = pathKey.replace(/\\/g, '/')
    const rootPrefix = `${tree.name}/`
    
    // Root node
    if (normalizedKey === tree.name) {
      return normalizedBase
    }
    
    // Child nodes
    if (normalizedKey.startsWith(rootPrefix)) {
      const relative = normalizedKey.slice(rootPrefix.length)
      return `${normalizedBase}/${relative}`
    }
    
    return null
  }

  const handleRename = async (pathKey: string, currentName: string) => {
    const actualPath = getActualPath(pathKey)
    if (!actualPath) {
      console.error('Cannot determine actual path')
      await dialog.showAlert('Error', 'Cannot determine actual path')
      return
    }

    // Get relative path for the file being renamed
    const normalizedKey = pathKey.replace(/\\/g, '/')
    const rootPrefix = `${tree.name}/`
    const relativePath = normalizedKey === tree.name
      ? ''
      : normalizedKey.startsWith(rootPrefix)
        ? normalizedKey.slice(rootPrefix.length)
        : normalizedKey

    // If there's a callback to check if the file is open and modified, ask for confirmation
    if (onFileRenamed && relativePath) {
      const canProceed = await onFileRenamed(relativePath, '')
      if (!canProceed) {
        return // User cancelled
      }
    }

    const newName = await dialog.showPrompt('Rename', 'Enter new name:', currentName)
    if (!newName || newName === currentName) {
      return
    }

    try {
      await window.electron.renameFileOrFolder(actualPath, newName)
      
      // Notify parent about the rename so it can update open files
      if (onFileRenamed && relativePath) {
        await onFileRenamed(relativePath, newName)
      }
      
      if (onFolderCreated) {
        onFolderCreated() // Trigger refresh
      }
    } catch (error) {
      console.error('Failed to rename:', error)
      await dialog.showAlert('Error', `Failed to rename: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const handleDelete = async (pathKey: string, itemName: string, isFile: boolean) => {
    const actualPath = getActualPath(pathKey)
    if (!actualPath) {
      console.error('Cannot determine actual path')
      await dialog.showAlert('Error', 'Cannot determine actual path')
      return
    }

    // Get relative path for the file being deleted
    const normalizedKey = pathKey.replace(/\\/g, '/')
    const rootPrefix = `${tree.name}/`
    const relativePath = normalizedKey === tree.name
      ? ''
      : normalizedKey.startsWith(rootPrefix)
        ? normalizedKey.slice(rootPrefix.length)
        : normalizedKey

    // If there's a callback to check if the file is open and modified, ask for confirmation
    if (onFileDeleted && relativePath && isFile) {
      const canProceed = await onFileDeleted(relativePath)
      if (!canProceed) {
        return // User cancelled
      }
    }

    const itemType = isFile ? 'file' : 'folder'
    const confirmed = await dialog.showConfirm('Delete', `Are you sure you want to delete the ${itemType} "${itemName}"?${isFile ? '' : ' This will delete all contents.'}`)
    if (!confirmed) {
      return
    }

    try {
      await window.electron.deleteFileOrFolder(actualPath)
      if (onFolderCreated) {
        onFolderCreated() // Trigger refresh
      }
    } catch (error) {
      console.error('Failed to delete:', error)
      await dialog.showAlert('Error', `Failed to delete: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const handleRightClick = (e: React.MouseEvent, node: TreeNode, pathKey: string) => {
    const allowedChildren = node.allowedChildren ?? []
    const submenuItems: MenuItem[] = allowedChildren.map((child) => {
      const isTemplate = child.startsWith('<') && child.endsWith('>')
      const isFile = child.includes('.')
      const folderExists = node.children?.has(child) ?? false
      return {
        label: child,
        onClick: async () => {
          if (!isTemplate && !isFile && !folderExists) {
            const targetPath = basePath
              ? resolveTargetPath(basePath, pathKey, child)
              : `${pathKey}/${child}`
            try {
              await window.electron.createFolder(targetPath)
              if (onFolderCreated) {
                onFolderCreated()
              }
            } catch (error) {
              console.error('Failed to create folder:', error)
              await dialog.showAlert('Error', `Failed to create folder: ${error instanceof Error ? error.message : 'Unknown error'}`)
            }
          }
        },
        disabled: isTemplate || isFile || folderExists,
        existingFolder: folderExists,
      }
    })

    const isRootNode = pathKey === tree.name
    const canRenameOrDelete = !isRootNode && basePath !== undefined

    const items: MenuItem[] = [
      {label: 'Cut', onClick: undefined, disabled: true},
      {label: 'Copy', onClick: undefined, disabled: true},
      {label: 'Paste', onClick: undefined, disabled: true},
      {},
      {
        label: 'Rename',
        onClick: () => handleRename(pathKey, node.name),
        disabled: !canRenameOrDelete
      },
      {
        label: 'Delete',
        onClick: () => handleDelete(pathKey, node.name, !!node.isFile),
        disabled: !canRenameOrDelete
      },
      {},
      {
        label: 'Create Datapack Directory',
        children: submenuItems.length ? submenuItems : undefined,
        disabled: submenuItems.length === 0,
      },
    ]

    onContextMenuRequest?.(e, items)
  }

  const renderNode = (node: TreeNode, depth: number, pathKey: string): React.ReactNode => {
    const hasChildren = node.children && node.children.size > 0
    const isExpanded = hasChildren && effectiveExpandedPaths.has(pathKey)
    const padding = depth * 12
    const relativePath = getRelativePathFromPathKey(pathKey)
    const languageIconClass = node.isFile
      ? detectEditorLanguage(relativePath || node.name).codicon
      : 'codicon-file'
    const nodeFileKey = basePath && relativePath ? `${basePath}|${relativePath}` : null
    const nodeDiagnosticSummary = diagnosticPathSummaries[pathKey]
    const hasDiagnosticError = (nodeDiagnosticSummary?.errors ?? 0) > 0
    const hasDiagnosticWarning = !hasDiagnosticError && (nodeDiagnosticSummary?.warnings ?? 0) > 0
    const isModified = modifiedPathKeys.has(pathKey)
    const isSelected = node.isFile && externalSelectedFileKey && nodeFileKey
      ? externalSelectedFileKey === nodeFileKey
      : effectiveSelectedPath === pathKey
    const isRoot = depth === 0
    const nodeNameWeightClass = node.isFile ? 'font-normal' : (isRoot ? 'font-bold' : 'font-semibold')
    const nodeNameColorClass = node.schemaNode
      ? 'text-emerald-300'
      : isModified
        ? 'text-orange-300'
        : 'text-codemirror-100'
    const nodeNameStyleClass = node.experimental ? 'italic' : ''

    return (
      <li key={pathKey}>
        <Tooltip content={node.description} disabled={!node.description}>
          <div
            ref={isSelected ? (el) => {
              if (el && treeContainerRef?.current) {
                el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
              }
            } : null}
            className={`flex min-w-0 items-center cursor-pointer rounded px-1  ${isSelected ? 'bg-codemirror-select' : 'hover:bg-codemirror-highlight'} ${isRoot ? 'py-2' : ''}`}
            style={{ paddingLeft: padding }}
            onClick={() => handleSelect(pathKey, !!node.isFile, !!hasChildren)}
            onContextMenu={(e) => handleRightClick(e, node, pathKey)}
          >
            <span className={`mr-2 flex items-center text-codemirror-100 h-4 ${isRoot ? 'w-auto' : 'w-4'}`}>
              {hasChildren ? (
                isExpanded ? (
                  <i className="codicon codicon-chevron-down" />
                ) : (
                  <i className="codicon codicon-chevron-right" />
                )
              ) : (
                <i className={`codicon ${languageIconClass}`} />
              )}
              {/* Datapack ID */}
              {isRoot ? (
                <span className="pillbox px-2 pt-1 pb-0.5 bg-emerald-800 text-sm font-mono font-bold text-codemirror-50">
                  {rootId || 'ID'}
                </span>
              ) : (<div></div>)}
            </span>

            <div className="flex min-w-0 flex-1 items-center overflow-hidden">
              {/* Name */}
              <span className={`min-w-0 truncate
                ${nodeNameWeightClass} ${nodeNameColorClass} ${nodeNameStyleClass}`}
              >
                {isRoot ? rootName || node.name : node.name}
              </span>

              {/* Pillboxes */}
              {isRoot && rootPackVersion && (
                <span className="pillbox bg-indigo-800 text-indigo-100">
                  v{rootPackVersion}
                </span>
              )}
              {isRoot && node.packFormatVersion && (
                <span className="pillbox">
                  {node.packFormatVersion}
                </span>
              )}
              {node.contentType && (
                <span className="pillbox">
                  {node.contentType}
                </span>
              )}
              {node.experimental && (
                <span className="pillbox bg-amber-900 text-amber-400">
                  exp
                </span>
              )}
            </div>

            <div className="ml-auto flex shrink-0 items-center">
              {hasDiagnosticError && (
                <i className="codicon codicon-error text-red-400 ml-1 shrink-0" />
              )}
              {hasDiagnosticWarning && (
                <i className="codicon codicon-warning text-amber-400 ml-1 shrink-0" />
              )}
              {isModified && (
                <i className="codicon codicon-circle-filled text-orange-300 ml-1 shrink-0" />
              )}
            </div>

          </div>
        </Tooltip>
        {hasChildren && isExpanded && (
          <ul className="mt-1 space-y-1">
            {sortChildren(node.children!).map((child) =>
              renderNode(child, depth + 1, `${pathKey}/${child.name}`)
            )}
          </ul>
        )}
      </li>
    )
  }

  return (
    <>
      <div ref={treeContainerRef} className={`${className} overflow-x-hidden overflow-y-auto`}>
        <ul className="space-y-1">
          {renderNode(tree, 0, tree.name)}
        </ul>
      </div>
      {dialog.dialogConfig && (
        <Dialog
          isOpen={dialog.isOpen}
          title={dialog.dialogConfig.title}
          message={dialog.dialogConfig.message}
          buttons={dialog.dialogConfig.buttons}
          autoCloseMs={dialog.dialogConfig.autoCloseMs}
          inputValue={dialog.dialogConfig.inputValue}
          onInputChange={dialog.dialogConfig.onInputChange}
          onClose={dialog.closeDialog}
        />
      )}
    </>
  )
}
