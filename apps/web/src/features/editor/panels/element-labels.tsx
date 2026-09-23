import { shapeRegistry } from '@inkflow/diagram-engine';
import {
  getShapeLabel,
  isLinearElement,
  type ElementType,
  type SceneElement,
} from '@inkflow/elements';
import {
  ArrowRight,
  Boxes,
  Circle,
  Diamond,
  Frame,
  Hexagon,
  Image,
  ListOrdered,
  Minus,
  Pencil,
  Shapes,
  Spline,
  Square,
  Star,
  Table,
  Triangle,
  Type,
  type LucideIcon,
} from 'lucide-react';

export const ELEMENT_ICONS: Record<ElementType, LucideIcon> = {
  rectangle: Square,
  ellipse: Circle,
  diamond: Diamond,
  triangle: Triangle,
  polygon: Hexagon,
  star: Star,
  line: Minus,
  arrow: ArrowRight,
  connector: Spline,
  freedraw: Pencil,
  text: Type,
  image: Image,
  frame: Frame,
  node: Shapes,
  table: Table,
  'uml-class': Boxes,
  sequence: ListOrdered,
};

const TYPE_LABELS: Record<ElementType, string> = {
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
  triangle: 'Triangle',
  polygon: 'Polygon',
  star: 'Star',
  line: 'Line',
  arrow: 'Arrow',
  connector: 'Connector',
  freedraw: 'Drawing',
  text: 'Text',
  image: 'Image',
  frame: 'Frame',
  node: 'Node',
  table: 'Table',
  'uml-class': 'Class',
  sequence: 'Sequence diagram',
};

export function elementTypeLabel(type: ElementType): string {
  return TYPE_LABELS[type];
}

function snippet(text: string, max = 48): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Human-readable name of an element for lists (layers, comments, search). */
export function elementDisplayName(el: SceneElement): string {
  switch (el.type) {
    case 'text':
      return snippet(el.text) || 'Empty text';
    case 'frame':
      return snippet(el.name) || 'Untitled frame';
    case 'table':
      return snippet(el.name) || 'Table';
    case 'uml-class':
      return snippet(el.name) || 'Class';
    case 'sequence': {
      const names = el.participants.map((p) => p.name).filter(Boolean);
      return names.length ? `Sequence: ${snippet(names.join(', '), 40)}` : 'Sequence diagram';
    }
    case 'node': {
      const label = el.label?.text ? snippet(el.label.text) : '';
      return label || shapeRegistry.get(el.shape)?.label || 'Node';
    }
    case 'freedraw':
      return el.brush === 'highlighter' ? 'Highlight' : 'Drawing';
    default: {
      if (isLinearElement(el))
        return (el.label?.text ? snippet(el.label.text) : '') || TYPE_LABELS[el.type];
      const label = getShapeLabel(el);
      return (label?.text ? snippet(label.text) : '') || TYPE_LABELS[el.type];
    }
  }
}
