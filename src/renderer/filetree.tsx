import React from 'react'

interface FileTreeProps {
  paths: string[]
  className?: string
  onSelect?: (path: string, isFile: boolean) => void
}

type TreeNode = {
  name: string
  children?: Map<string, TreeNode>
  isFile?: boolean
}

const buildTree = (paths: string[]): TreeNode => {
  const root: TreeNode = { name: 'root', children: new Map() }

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

export function FileTree({ paths, className, onSelect }: FileTreeProps) {
  const tree = React.useMemo(() => buildTree(paths), [paths])
  const rootChildren = tree.children ? sortChildren(tree.children) : []
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null)
  const [expandedPaths, setExpandedPaths] = React.useState<Set<string>>(() => {
    const dirs: string[] = []
    if (tree.children) {
      for (const child of tree.children.values()) {
        collectDirectoryPaths(child, child.name, dirs)
      }
    }
    return new Set(dirs)
  })

  React.useEffect(() => {
    const dirs: string[] = []
    if (tree.children) {
      for (const child of tree.children.values()) {
        collectDirectoryPaths(child, child.name, dirs)
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
          <span className={node.isFile ? 'text-codemirror-100' : 'text-codemirror-100 font-medium'}>
            {node.name}
          </span>
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
        {rootChildren.map((child) => renderNode(child, 0, child.name))}
      </ul>
    </div>
  )
}
