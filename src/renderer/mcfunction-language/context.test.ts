import { describe, it, expect } from 'vitest'
import {
  parseMcfunctionContextIndex,
  mergeMcfunctionContextIndexes,
  resolveDatapackObjectiveBindings,
} from './context'

/**
 * Mirrors how the renderer builds a datapack-wide context index: every .mcfunction
 * file is parsed in isolation, the per-file indexes are merged, then bindings are
 * re-resolved across the whole datapack.
 */
const buildDatapackBindings = (files: string[]) => {
  let merged = parseMcfunctionContextIndex('')
  for (const file of files) {
    merged = mergeMcfunctionContextIndexes(merged, parseMcfunctionContextIndex(file))
  }
  return resolveDatapackObjectiveBindings(files, merged)
}

/** Per-file merged bindings only — the pre-fix behaviour, kept to pin the regression. */
const mergedPerFileBindings = (files: string[]) => {
  let merged = parseMcfunctionContextIndex('')
  for (const file of files) {
    merged = mergeMcfunctionContextIndexes(merged, parseMcfunctionContextIndex(file))
  }
  return merged.objectivesByHolder
}

describe('resolveDatapackObjectiveBindings', () => {
  it('records a binding when the objective is declared and used in the same file', () => {
    const bindings = buildDatapackBindings([
      'scoreboard objectives add foo dummy\nscoreboard players set #global foo 1',
    ])

    expect([...(bindings.get('#global') ?? [])]).toEqual(['foo'])
  })

  it('records cross-file bindings when the declaration and usage are in different files', () => {
    const files = [
      'scoreboard objectives add foo dummy', // e.g. load.mcfunction
      'scoreboard players set #global foo 1', // e.g. tick.mcfunction
    ]

    // Pre-fix: per-file parsing never saw `foo` registered in the usage file, so the
    // binding was dropped from the inspector.
    expect(mergedPerFileBindings(files).get('#global')).toBeUndefined()

    // Post-fix: the datapack-wide resolve seeds the merged objective set.
    expect([...(buildDatapackBindings(files).get('#global') ?? [])]).toEqual(['foo'])
  })

  it('captures cross-file bindings from inline score usage (execute if score ...)', () => {
    const bindings = buildDatapackBindings([
      'scoreboard objectives add foo dummy',
      'execute if score #global foo matches 1.. run say hi',
    ])

    expect([...(bindings.get('#global') ?? [])]).toEqual(['foo'])
  })

  it('merges objectives from multiple usage files onto a single holder', () => {
    const bindings = buildDatapackBindings([
      'scoreboard objectives add foo dummy\nscoreboard objectives add bar dummy',
      'scoreboard players set #global foo 1',
      'scoreboard players add #global bar 2',
    ])

    expect([...(bindings.get('#global') ?? [])].sort()).toEqual(['bar', 'foo'])
  })

  it('does not record bindings for objectives never declared anywhere', () => {
    const bindings = buildDatapackBindings([
      'scoreboard players set #global undeclared 1',
    ])

    expect(bindings.get('#global')).toBeUndefined()
  })
})
