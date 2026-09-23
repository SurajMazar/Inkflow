import type { UmlClassElement } from '@inkflow/elements';
import type { UmlClassLayout } from '../types';
import { textWidth } from './measure';

export const UML_PADDING_X = 10;
export const UML_PADDING_Y = 6;
export const UML_MIN_WIDTH = 140;

/**
 * Member text conventions (Mermaid-compatible): a trailing `$` marks a static member (underlined),
 * a trailing `*` marks an abstract member (italic). Markers are stripped from the displayed text.
 */
export function parseUmlMember(raw: string): {
  text: string;
  isStatic: boolean;
  isAbstract: boolean;
} {
  let text = raw.trim();
  let isStatic = false;
  let isAbstract = false;
  for (let i = 0; i < 2; i++) {
    if (text.endsWith('$')) {
      isStatic = true;
      text = text.slice(0, -1).trimEnd();
    } else if (text.endsWith('*')) {
      isAbstract = true;
      text = text.slice(0, -1).trimEnd();
    }
  }
  return { text, isStatic, isAbstract };
}

function natural(
  el: Pick<
    UmlClassElement,
    'name' | 'stereotype' | 'attributes' | 'methods' | 'isAbstract' | 'fontFamily' | 'fontSize'
  >,
) {
  const lineHeight = Math.round(el.fontSize * 1.45);
  const family = el.fontFamily;
  const nameLines: UmlClassLayout['nameLines'] = [];
  let y = UML_PADDING_Y;
  if (el.stereotype) {
    nameLines.push({ text: `«${el.stereotype}»`, y, bold: false, italic: false });
    y += lineHeight;
  }
  nameLines.push({ text: el.name, y, bold: true, italic: el.isAbstract });
  const nameHeight = UML_PADDING_Y * 2 + nameLines.length * lineHeight;
  const attributesY = nameHeight;
  const attributeLines = el.attributes.map((a, i) => {
    const m = parseUmlMember(a);
    return { text: m.text, y: attributesY + UML_PADDING_Y + i * lineHeight, underline: m.isStatic };
  });
  const attributesHeight = UML_PADDING_Y * 2 + el.attributes.length * lineHeight;
  const methodsY = attributesY + attributesHeight;
  const methodLines = el.methods.map((a, i) => {
    const m = parseUmlMember(a);
    return {
      text: m.text,
      y: methodsY + UML_PADDING_Y + i * lineHeight,
      underline: m.isStatic,
      italic: m.isAbstract,
    };
  });
  const methodsHeight = UML_PADDING_Y * 2 + el.methods.length * lineHeight;
  let textMax = 0;
  for (const l of nameLines)
    textMax = Math.max(
      textMax,
      textWidth(l.text, {
        fontFamily: family,
        fontSize: el.fontSize,
        bold: l.bold,
        italic: l.italic,
      }),
    );
  for (const l of attributeLines)
    textMax = Math.max(textMax, textWidth(l.text, { fontFamily: family, fontSize: el.fontSize }));
  for (const l of methodLines)
    textMax = Math.max(
      textMax,
      textWidth(l.text, { fontFamily: family, fontSize: el.fontSize, italic: l.italic }),
    );
  return {
    lineHeight,
    nameLines,
    nameHeight,
    attributesY,
    attributesHeight,
    attributeLines,
    methodsY,
    methodsHeight,
    methodLines,
    width: Math.ceil(Math.max(UML_MIN_WIDTH, textMax + UML_PADDING_X * 2)),
    height: Math.ceil(methodsY + methodsHeight),
  };
}

/** Minimum size fitting the name compartment, attributes and methods. */
export function measureUmlClass(el: UmlClassElement): { width: number; height: number } {
  const n = natural(el);
  return { width: n.width, height: n.height };
}

/**
 * Compartment layout (local coordinates): name compartment (optional «stereotype» line, bold name,
 * italic when abstract), attributes, then methods. Extra box height goes to the methods compartment.
 */
export function computeUmlClassLayout(el: UmlClassElement): UmlClassLayout {
  const n = natural(el);
  const height = Math.max(el.height, 0);
  return {
    width: Math.max(el.width, 0),
    height,
    lineHeight: n.lineHeight,
    nameHeight: n.nameHeight,
    attributesY: n.attributesY,
    attributesHeight: n.attributesHeight,
    methodsY: n.methodsY,
    methodsHeight: Math.max(n.methodsHeight, height - n.methodsY),
    nameLines: n.nameLines,
    attributeLines: n.attributeLines,
    methodLines: n.methodLines,
    paddingX: UML_PADDING_X,
    fontSize: el.fontSize,
  };
}
