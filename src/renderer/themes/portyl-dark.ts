import {EditorView} from "@codemirror/view"
import {Extension} from "@codemirror/state"
import {HighlightStyle, syntaxHighlighting} from "@codemirror/language"
import {tags as t} from "@lezer/highlight"

const invalid = "#ffffff",
  blood = "#ff4040",
  coral = "#e06c75",
  ember = "#ff8f70",
  aurora = "#f1cb01",
  warning = "#ffdc40",
  golden = "#ffe066",
  chalky = "#d5b06b",
  whiskey = "#d19a66",
  terracotta = "#ce8c8d",
  sage = "#98d379",
  mint = "#7cc9a2",
  minty = "#9ce9c2",
  cyan = "#56b6c2",
  malibu = "#61afef",
  cafe = "#42cafe",
  sky = "#90d5ff",
  ice = "#86d6f2",
  lilac = "#b392f0",
  violet = "#c678dd",
  magenta = "#ff87f0",
  stone = "#7d8799",
  ivory = "#abb2bf",
  light = "#e5e0ee",
  darkBackground = "#21252b",
  highlightBackground = "#2f343d",
  background = "#1a1d23",
  tooltipBackground = "#353a42",
  selection = "#333946"

type LintSquiggleOptions = {
  wavelength?: number
  amplitude?: number
  strokeWidth?: number
  baseline?: number
  backgroundPosition?: string
  paddingBottom?: string
}

const createLintSquiggleStyle = (color: string, options: LintSquiggleOptions = {}) => {
  const {
    wavelength = 15,
    amplitude = 3,
    strokeWidth = 1,
    baseline = 3,
    backgroundPosition = "left bottom",
    paddingBottom = "3px",
  } = options

  const height = Math.max(1, baseline + 1)
  const halfWave = wavelength / 2
  const quarterWave = wavelength / 4
  const threeQuarterWave = (wavelength * 3) / 4
  const peakY = Math.max(0, baseline - amplitude)

  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${wavelength} ${height}'><path d='M0 ${baseline} L${quarterWave} ${peakY} L${halfWave} ${baseline} L${threeQuarterWave} ${peakY} L${wavelength} ${baseline}' stroke='${color}' fill='none' stroke-width='${strokeWidth}'/></svg>`
  const encodedSvg = encodeURIComponent(svg)

  return {
    backgroundImage: `url("data:image/svg+xml,${encodedSvg}")`,
    backgroundPosition,
    backgroundRepeat: "repeat-x",
    backgroundSize: `${wavelength}px ${height}px`,
    boxShadow: "none",
    textDecoration: "none",
    paddingBottom,
  }
}

export const portylDarkEditorTheme = EditorView.theme({
  "&": {
    color: ivory,
    backgroundColor: background
  },

  ".cm-content": {
    caretColor: cafe
  },

  ".cm-cursor, .cm-dropCursor": {borderLeftColor: cafe},
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {backgroundColor: selection},

  ".cm-panels": {backgroundColor: darkBackground, color: ivory},
  ".cm-panels.cm-panels-top": {borderBottom: "2px solid black"},
  ".cm-panels.cm-panels-bottom": {borderTop: "2px solid black"},

  ".cm-searchMatch": {
    backgroundColor: `${sky}20`,
    outline: `1px solid ${sky}ee`,
    borderRadius: "1px"
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: `${light}20`,
    outline: `1px solid ${light}`,
  },

  ".cm-activeLine": {backgroundColor: `${light}20`},
  ".cm-selectionMatch": {backgroundColor: `${light}20`},

  "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: `${light}60`
  },

  ".cm-gutters": {
    backgroundColor: background,
    color: stone,
    border: "none"
  },

  ".cm-activeLineGutter": {
    backgroundColor: highlightBackground
  },

  ".cm-foldPlaceholder": {
    backgroundColor: "transparent",
    border: "none",
    color: `${light}`
  },

  ".cm-tooltip": {
    border: "none",
    backgroundColor: tooltipBackground
  },
  ".cm-tooltip .cm-tooltip-arrow:before": {
    borderTopColor: "transparent",
    borderBottomColor: "transparent"
  },
  ".cm-tooltip .cm-tooltip-arrow:after": {
    borderTopColor: tooltipBackground,
    borderBottomColor: tooltipBackground
  },
  ".cm-tooltip-autocomplete": {
    "& > ul > li[aria-selected]": {
      backgroundColor: highlightBackground,
      color: ivory
    }
  },

  ".cm-lintRange-error": {
    ...createLintSquiggleStyle(blood)
  },

  ".cm-lintRange-warning": {
    ...createLintSquiggleStyle(warning)
  },

  ".cm-diagnostic-error": {
    background: "#2a313d",
    borderLeft: `3px solid ${blood}`,
  },

  ".cm-diagnostic-warning": {
    background: "#2a313d",
    borderLeft: `3px solid ${warning}`
  },

  ".cm-context": {
    textDecorationLine: "none",
    textDecorationStyle: "solid",
    textDecorationColor: light,
    textDecorationThickness: "from-font",
    textDecorationSkipInk: "none",
  },
  ".cm-context-mcfunction-holder": {
    color: coral,
  },
  ".cm-context-mcfunction-objective": {
    fontWeight: "bold",
    color: ivory,
  },
  ".cm-context-mcfunction-objective:hover": {
    textDecorationLine: "underline",
    textDecorationColor: ivory,
  },
  ".cm-context-mcfunction-resource": {
    color: sage,
    textDecorationLine: "underline",
    textDecorationColor: sage,
  },
  ".cm-context-mcfunction-tag": {
    fontStyle: "italic",
  },
  
}, {dark: true})

export const portylHighlightStyle = HighlightStyle.define([
  // --- Comments ---
  { tag: t.comment, color: "#7d8799" },
  { tag: t.lineComment, color: "#7d8799" },
  { tag: t.blockComment, color: "#7d8799" },
  { tag: t.docComment, color: "#7d8799" },

  // --- Names and Identifiers ---
  { tag: t.name, color: "#e06c75" },
  { tag: t.variableName, color: "#ff8f70" },
  { tag: t.typeName, color: "#e5c07b" },
  { tag: t.tagName, color: "#e06c75" },
  { tag: t.propertyName, color: "#b392f0" },
  { tag: t.attributeName, color: "#b392f0" },
  { tag: t.className, color: "#e5c07b" },
  { tag: t.labelName, color: "#ff8f70" },
  { tag: t.namespace, color: "#98d379" },
  { tag: t.macroName, color: "#e06c75" },

  // --- Literals ---
  { tag: t.literal, color: "#d19a66" },
  { tag: t.string, color: "#ce8c8d" },
  { tag: t.docString, color: "#ce8c8d" },
  { tag: t.character, color: "#ce8c8d" },
  { tag: t.attributeValue, color: "#a2c9ff" },
  { tag: t.number, color: "#8cc9b2" },
  { tag: t.integer, color: "#8cc9b2" },
  { tag: t.float, color: "#8cc9b2" },
  { tag: t.bool, color: "#d19a66" },
  { tag: t.regexp, color: "#56b6c2" },
  { tag: t.escape, color: "#abb2bf" },
  { tag: t.color, color: "#8cd9b2" },
  { tag: t.url, color: "#56b6c2" },

  // --- Keywords ---
  { tag: t.keyword, color: "#c678dd" },
  { tag: t.self, color: "#e5c07b" },
  { tag: t.null, color: "#c678dd" },
  { tag: t.atom, color: "#90d5ff" },
  { tag: t.unit, color: "#c678dd" },
  { tag: t.modifier, color: "#e5c07b" },
  { tag: t.operatorKeyword, color: "#56b6c2" },
  { tag: t.controlKeyword, color: "#e5c07b" },
  { tag: t.definitionKeyword, color: "#c678dd" },
  { tag: t.moduleKeyword, color: "#c678dd" },

  // --- Operators ---
  { tag: t.operator, color: "#56b6d2" },
  { tag: t.derefOperator, color: "#56b6d2" },
  { tag: t.arithmeticOperator, color: "#56b6d2" },
  { tag: t.logicOperator, color: "#56b6d2" },
  { tag: t.bitwiseOperator, color: "#56b6d2" },
  { tag: t.compareOperator, color: "#56b6d2" },
  { tag: t.updateOperator, color: "#56b6d2" },
  { tag: t.definitionOperator, color: "#56b6d2" },
  { tag: t.typeOperator, color: "#56b6d2" },
  { tag: t.controlOperator, color: "#56b6d2" },

  // --- Punctuation & Brackets ---
  { tag: t.punctuation, color: "#abb2bf" },
  { tag: t.separator, color: "#abb2bf" },
  { tag: t.bracket, color: "#f1cb01" },
  { tag: t.angleBracket, color: "#f1cb01" },
  { tag: t.squareBracket, color: "#f1cb01" },
  { tag: t.paren, color: "#f1cb01" },
  { tag: t.brace, color: "#f1cb01" },

  // --- Markup / Content ---
  { tag: t.content, color: "#abb2bf" },
  { tag: t.heading, color: "#e06c75", fontWeight: "bold" },
  { tag: [t.heading1, t.heading2, t.heading3], color: "#e06c75" },
  { tag: [t.heading4, t.heading5, t.heading6], color: "#e06c75" },
  { tag: t.contentSeparator, color: "#abb2bf" },
  { tag: t.list, color: "#abb2bf" },
  { tag: t.quote, color: "#7d8799" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.link, textDecoration: "underline" },
  { tag: t.monospace, color: "#abb2bf" },
  { tag: t.strikethrough, textDecoration: "line-through" },

  // --- Changes & Metadata ---
  { tag: t.inserted, color: "#98c379" },
  { tag: t.deleted, color: "#e06c75" },
  { tag: t.changed, color: "#e5c07b" },
  { tag: t.invalid, color: "#ffffff" },
  { tag: t.meta, color: "#7d8799" },
  { tag: t.documentMeta, color: "#7d8799" },
  { tag: t.annotation, color: "#e5c07b" },
  { tag: t.processingInstruction, color: "#98c379" },

  // --- Modifiers ---
  { tag: t.function(t.variableName), color: "#61afef" },
  { tag: t.constant(t.name), color: "#d19a66" },
  { tag: t.definition(t.variableName), color: "#abb2bf" },
  { tag: t.standard(t.name), color: "#d19a66" },
  { tag: t.local(t.variableName), color: "#e06c75" },
  { tag: t.special(t.string), color: "#56b6c2" },
]);

export const portylDarkTheme: Extension = [portylDarkEditorTheme, syntaxHighlighting(portylHighlightStyle)]