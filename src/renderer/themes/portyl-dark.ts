import {EditorView} from "@codemirror/view"
import {Extension} from "@codemirror/state"
import {HighlightStyle, syntaxHighlighting} from "@codemirror/language"
import {tags as t} from "@lezer/highlight"

const chalky = "#e5c07b",
  coral = "#e06c75",
  cyan = "#56b6c2",
  invalid = "#ffffff",
  ivory = "#abb2bf",
  stone = "#7d8799",
  malibu = "#61afef",
  sage = "#98c379",
  whiskey = "#d19a66",
  violet = "#c678dd",
  aurora = "#f2c86e",
  ice = "#86d6f2",
  ember = "#ff8f70",
  lilac = "#b392f0",
  mint = "#7cc9a2",
  steel = "#afb2cf",
  lightBlue = "#90d5ff",
  fadedBrown = "#ce8c8d",
  darkBackground = "#21252b",
  highlightBackground = "#2f343d",
  background = "#1b1d25",
  tooltipBackground = "#353a42",
  selection = "#434956",
  cursor = "#528bff"

export const portylDarkEditorTheme = EditorView.theme({
  "&": {
    color: ivory,
    backgroundColor: background
  },

  ".cm-content": {
    caretColor: cursor
  },

  ".cm-cursor, .cm-dropCursor": {borderLeftColor: cursor},
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {backgroundColor: selection},

  ".cm-panels": {backgroundColor: darkBackground, color: ivory},
  ".cm-panels.cm-panels-top": {borderBottom: "2px solid black"},
  ".cm-panels.cm-panels-bottom": {borderTop: "2px solid black"},

  ".cm-searchMatch": {
    backgroundColor: "#72a1ff59",
    outline: "1px solid #457dff"
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "#6199ff2f"
  },

  ".cm-activeLine": {backgroundColor: "#6699ff0b"},
  ".cm-selectionMatch": {backgroundColor: "#aafe661a"},

  "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: "#bad0f847"
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
    color: "#ddd"
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
  }
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
  { tag: t.namespace, color: "#e5c07b" },
  { tag: t.macroName, color: "#e06c75" },

  // --- Literals ---
  { tag: t.literal, color: "#d19a66" },
  { tag: t.string, color: "#ce8c8d" },
  { tag: t.docString, color: "#ce8c8d" },
  { tag: t.character, color: "#ce8c8d" },
  { tag: t.attributeValue, color: "#a2c9ff" },
  { tag: t.number, color: "#7cc9a2" },
  { tag: t.integer, color: "#7cc9a2" },
  { tag: t.float, color: "#7cc9a2" },
  { tag: t.bool, color: "#d19a66" },
  { tag: t.regexp, color: "#56b6c2" },
  { tag: t.escape, color: "#56b6c2" },
  { tag: t.color, color: "#d19a66" },
  { tag: t.url, color: "#56b6c2" },

  // --- Keywords ---
  { tag: t.keyword, color: "#c678dd" },
  { tag: t.self, color: "#e5c07b" },
  { tag: t.null, color: "#c678dd" },
  { tag: t.atom, color: "#90d5ff" },
  { tag: t.unit, color: "#c678dd" },
  { tag: t.modifier, color: "#e5c07b" },
  { tag: t.operatorKeyword, color: "#56b6c2" },
  { tag: t.controlKeyword, color: "#98c379" },
  { tag: t.definitionKeyword, color: "#c678dd" },
  { tag: t.moduleKeyword, color: "#c678dd" },

  // --- Operators ---
  { tag: t.operator, color: "#56b6c2" },
  { tag: t.derefOperator, color: "#56b6c2" },
  { tag: t.arithmeticOperator, color: "#56b6c2" },
  { tag: t.logicOperator, color: "#56b6c2" },
  { tag: t.bitwiseOperator, color: "#56b6c2" },
  { tag: t.compareOperator, color: "#56b6c2" },
  { tag: t.updateOperator, color: "#56b6c2" },
  { tag: t.definitionOperator, color: "#56b6c2" },
  { tag: t.typeOperator, color: "#56b6c2" },
  { tag: t.controlOperator, color: "#56b6c2" },

  // --- Punctuation & Brackets ---
  { tag: t.punctuation, color: "#abb2bf" },
  { tag: t.separator, color: "#abb2bf" },
  { tag: t.bracket, color: "#abb2bf" },
  { tag: t.angleBracket, color: "#abb2bf" },
  { tag: t.squareBracket, color: "#abb2bf" },
  { tag: t.paren, color: "#abb2bf" },
  { tag: t.brace, color: "#abb2bf" },

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