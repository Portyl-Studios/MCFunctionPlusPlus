import { tags as t } from "@lezer/highlight";
import { HighlightStyle } from "@codemirror/language";

export const portylHighlightStyle = HighlightStyle.define([
  // --- Comments ---
  { tag: t.comment, color: "" },
  { tag: t.lineComment, color: "" },
  { tag: t.blockComment, color: "" },
  { tag: t.docComment, color: "" },

  // --- Names and Identifiers ---
  { tag: t.name, color: "" },
  { tag: t.variableName, color: "" },
  { tag: t.typeName, color: "" },
  { tag: t.tagName, color: "" },
  { tag: t.propertyName, color: "" },
  { tag: t.attributeName, color: "" },
  { tag: t.className, color: "" },
  { tag: t.labelName, color: "" },
  { tag: t.namespace, color: "" },
  { tag: t.macroName, color: "" },

  // --- Literals ---
  { tag: t.literal, color: "" },
  { tag: t.string, color: "" },
  { tag: t.docString, color: "" },
  { tag: t.character, color: "" },
  { tag: t.attributeValue, color: "" },
  { tag: t.number, color: "" },
  { tag: t.integer, color: "" },
  { tag: t.float, color: "" },
  { tag: t.bool, color: "" },
  { tag: t.regexp, color: "" },
  { tag: t.escape, color: "" },
  { tag: t.color, color: "" },
  { tag: t.url, color: "" },

  // --- Keywords ---
  { tag: t.keyword, color: "" },
  { tag: t.self, color: "" },
  { tag: t.null, color: "" },
  { tag: t.atom, color: "" },
  { tag: t.unit, color: "" },
  { tag: t.modifier, color: "" },
  { tag: t.operatorKeyword, color: "" },
  { tag: t.controlKeyword, color: "" },
  { tag: t.definitionKeyword, color: "" },
  { tag: t.moduleKeyword, color: "" },

  // --- Operators ---
  { tag: t.operator, color: "" },
  { tag: t.derefOperator, color: "" },
  { tag: t.arithmeticOperator, color: "" },
  { tag: t.logicOperator, color: "" },
  { tag: t.bitwiseOperator, color: "" },
  { tag: t.compareOperator, color: "" },
  { tag: t.updateOperator, color: "" },
  { tag: t.definitionOperator, color: "" },
  { tag: t.typeOperator, color: "" },
  { tag: t.controlOperator, color: "" },

  // --- Punctuation & Brackets ---
  { tag: t.punctuation, color: "" },
  { tag: t.separator, color: "" },
  { tag: t.bracket, color: "" },
  { tag: t.angleBracket, color: "" },
  { tag: t.squareBracket, color: "" },
  { tag: t.paren, color: "" },
  { tag: t.brace, color: "" },

  // --- Markup / Content ---
  { tag: t.content, color: "" },
  { tag: t.heading, color: "", fontWeight: "bold" },
  { tag: [t.heading1, t.heading2, t.heading3], color: "" },
  { tag: [t.heading4, t.heading5, t.heading6], color: "" },
  { tag: t.contentSeparator, color: "" },
  { tag: t.list, color: "" },
  { tag: t.quote, color: "" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.link, textDecoration: "underline" },
  { tag: t.monospace, color: "" },
  { tag: t.strikethrough, textDecoration: "line-through" },

  // --- Changes & Metadata ---
  { tag: t.inserted, color: "" },
  { tag: t.deleted, color: "" },
  { tag: t.changed, color: "" },
  { tag: t.invalid, color: "red" },
  { tag: t.meta, color: "" },
  { tag: t.documentMeta, color: "" },
  { tag: t.annotation, color: "" },
  { tag: t.processingInstruction, color: "" },

  // --- Modifier Examples (Using the functions you listed) ---
  { tag: t.definition(t.variableName), color: "" },
  { tag: t.constant(t.variableName), color: "" },
  { tag: t.function(t.variableName), color: "" },
  { tag: t.standard(t.name), color: "" },
  { tag: t.local(t.variableName), color: "" },
  { tag: t.special(t.string), color: "" },
]);