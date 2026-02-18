import React from 'react'
import datapackSchema from '../../resources/datapackschema/94.1.json'

interface DataPackTreeProps {
  paths: string[]
  className?: string
  folderName?: string
  onSelect?: (path: string, isFile: boolean) => void
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
      if (isLeaf) {
        child.isFile = true
      }

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

const collectDirectoryPaths = (node: TreeNode, pathKey: string, output: string[]) => {
  const hasChildren = node.children && node.children.size > 0
  if (!hasChildren) return

  output.push(pathKey)
  for (const child of node.children!.values()) {
    collectDirectoryPaths(child, `${pathKey}/${child.name}`, output)
  }
}

export function DatapackTree({ paths, className, folderName, onSelect }: DataPackTreeProps) {
  const tree = React.useMemo(() => {
    const builtTree = buildTree(paths, folderName)
    // Enrich with schema starting from the root schema node
    enrichTreeWithSchema(builtTree, datapackSchema, true)
    return builtTree
  }, [paths, folderName])
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null)
  const [expandedPaths, setExpandedPaths] = React.useState<Set<string>>(() => {
    const dirs: string[] = []
    // Expand root by default
    dirs.push(tree.name)
    if (tree.children) {
      for (const child of tree.children.values()) {
        collectDirectoryPaths(child, `${tree.name}/${child.name}`, dirs)
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
        collectDirectoryPaths(child, `${tree.name}/${child.name}`, dirs)
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

  const handleRightClick = (e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault()
    console.log(`Right-clicked: ${node.name}`)
    console.log('Allowed children:', node.allowedChildren)
    console.log('Schema node:', node.schemaNode)
  }

  const renderNode = (node: TreeNode, depth: number, pathKey: string): React.ReactNode => {
    const hasChildren = node.children && node.children.size > 0
    const isExpanded = hasChildren && expandedPaths.has(pathKey)
    const padding = depth * 12
    const isSelected = selectedPath === pathKey

    return (
      <li key={pathKey}>
        <div
          className={`flex items-center cursor-pointer rounded px-1 ${isSelected ? 'bg-codemirror-select' : 'hover:bg-codemirror-highlight'}`}
          style={{ paddingLeft: padding }}
          onClick={() => handleSelect(pathKey, !!node.isFile, !!hasChildren)}
          onContextMenu={(e) => handleRightClick(e, node)}
          title={node.description || ''}
        >
          <span className="mr-2 flex items-center text-codemirror-100 w-4 h-4">
            {hasChildren ? (
              isExpanded ? (
                <i className="codicon codicon-chevron-down" />
              ) : (
                <i className="codicon codicon-chevron-right" />
              )
            ) : (
              <i className="codicon codicon-file" />
            )}
          </span>
          <span className={`${node.isFile ? 'text-codemirror-100' : 'text-codemirror-100 font-medium'} ${node.experimental ? 'italic opacity-75' : ''} ${node.schemaNode ? 'text-emerald-300' : ''}`}>
            {node.name}
          </span>
          {node.experimental && (
            <span className="ml-2 text-xs text-amber-400 bg-amber-900 bg-opacity-30 px-1 rounded">
              exp
            </span>
          )}
          {node.contentType && (
            <span className="pillbox">
              {node.contentType}
            </span>
          )}
          {depth === 0 && node.packFormatVersion && (
            <span className="pillbox">
              {node.packFormatVersion}
            </span>
          )}
          {/*depth === 0 && node.minMinecraftVersion && (
            <span className="pillbox">
              {node.minMinecraftVersion}
            </span>
          )}
          {depth === 0 && node.maxMinecraftVersion && (
            <span className="pillbox">
              {node.maxMinecraftVersion}
            </span>
          )*/}
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
    </div>
  )
}
