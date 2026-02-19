import React from 'react'
import datapackSchema from '../../resources/datapackschema/94.1.json'
import { ContextMenu, useContextMenu } from './contextmenu'
import type { MenuItem } from './menuitem'

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
}

type TreeNode = {
  name: string
  children?: Map<string, TreeNode>
  isFile?: boolean
  // Schema metadata
  schemaNode?: any
  description?: string
  experimental?: boolean
  contentType?: string
  allowedChildren?: string[]
  // Root-level metadata
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
const findMatchingSchemaNode = (nodeName: string, schemaChildren: any[] | undefined): any => {
  if (!schemaChildren) return undefined

  // Try exact name match first
  for (const child of schemaChildren) {
    if (child.name === nodeName) {
      return child
    }
  }

  // Try placeholder match (like <namespace>, <registry_name>, etc.)
  for (const child of schemaChildren) {
    if (child.name.startsWith('<') && child.name.endsWith('>')) {
      return child
    }
  }

  return undefined
}

// Enrich tree nodes with schema metadata
const enrichTreeWithSchema = (node: TreeNode, schemaNode?: any, isRoot: boolean = false): void => {
  if (!schemaNode) return

  node.schemaNode = schemaNode
  node.description = schemaNode.description
  node.experimental = schemaNode.experimental ?? false
  node.contentType = schemaNode.contentType
  node.allowedChildren = schemaNode.children?.map((child: any) => child.name)

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

export function DatapackTree({ paths, className, folderName, rootId, rootName, rootPackVersion, basePath, onSelect, onFolderCreated }: DataPackTreeProps) {
  const tree = React.useMemo(() => {
    const builtTree = buildTree(paths, folderName)
    // Enrich with schema starting from the root schema node
    enrichTreeWithSchema(builtTree, datapackSchema, true)
    return builtTree
  }, [paths, folderName])
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null)
  const [contextItems, setContextItems] = React.useState<MenuItem[]>([])
  const contextMenu = useContextMenu()
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

  React.useEffect(() => {
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
  }, [tree])

  const toggleExpanded = (pathKey: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(pathKey)) {
        next.delete(pathKey)
      } else {
        next.add(pathKey)
      }
      return next
    })
  }

  const handleSelect = (pathKey: string, isFile: boolean, hasChildren: boolean) => {
    setSelectedPath(pathKey)
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
              await (window as any).electron.createFolder(targetPath)
              if (onFolderCreated) {
                onFolderCreated()
              }
            } catch (error) {
              console.error('Failed to create folder:', error)
            }
          }
        },
        disabled: isTemplate || isFile || folderExists,
        existingFolder: folderExists,
      }
    })

    setContextItems([
      {label: 'Cut', onClick: () => {}},
      {label: 'Copy', onClick: () => {}},
      {label: 'Paste', onClick: () => {}},
      {},
      {
        label: 'Create Datapack Directory',
        children: submenuItems.length ? submenuItems : undefined,
        disabled: submenuItems.length === 0,
      },
    ])
    contextMenu.openContextMenu(e)
  }

  const renderNode = (node: TreeNode, depth: number, pathKey: string): React.ReactNode => {
    const hasChildren = node.children && node.children.size > 0
    const isExpanded = hasChildren && expandedPaths.has(pathKey)
    const padding = depth * 12
    const isSelected = selectedPath === pathKey
    const isRoot = depth === 0

    return (
      <li key={pathKey}>
        <div
          className={`flex items-center cursor-pointer rounded px-1  ${isSelected ? 'bg-codemirror-select' : 'hover:bg-codemirror-highlight'} ${isRoot ? 'py-2' : ''}`}
          style={{ paddingLeft: padding }}
          onClick={() => handleSelect(pathKey, !!node.isFile, !!hasChildren)}
          onContextMenu={(e) => handleRightClick(e, node, pathKey)}
          title={node.description || ''}
        >
          <span className={`mr-2 flex items-center text-codemirror-100 h-4 ${isRoot ? 'w-auto' : 'w-4'}`}>
            {hasChildren ? (
              isExpanded ? (
                <i className="codicon codicon-chevron-down" />
              ) : (
                <i className="codicon codicon-chevron-right" />
              )
            ) : (
              <i className="codicon codicon-file" />
            )}
            {/* Datapack ID */}
            {isRoot ? (
              <span className="pillbox px-2 pt-1 pb-0.5 bg-emerald-800 text-sm font-mono font-bold text-codemirror-50">
                {rootId || 'ID'}
              </span>
            ) : (<div></div>)}
          </span>

          {/* Name */}
          <span className={`
            ${node.isFile ? 'font-normal' : (isRoot ? 'font-bold' : 'font-semibold')}
            ${node.schemaNode ? 'text-emerald-300' : 'text-codemirror-100'}
            ${node.experimental ? 'italic' : ''}
          `}>
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
          {/*isRoot && node.minMinecraftVersion && (
            <span className="pillbox">
              {node.minMinecraftVersion}
            </span>
          )*/}
          {/*isRoot && node.maxMinecraftVersion && (
            <span className="pillbox">
              {node.maxMinecraftVersion}
            </span>
          )*/}
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
    <div className={`${className} overflow-x-hidden`}>
      <ul className="space-y-1">
        {renderNode(tree, 0, tree.name)}
      </ul>
      <ContextMenu
        items={contextItems}
        x={contextMenu.position.x}
        y={contextMenu.position.y}
        isOpen={contextMenu.isOpen}
        onClose={contextMenu.closeContextMenu}
      />
    </div>
  )
}
