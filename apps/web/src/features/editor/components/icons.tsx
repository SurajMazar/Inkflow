import type { ToolType } from '@inkflow/canvas-engine';
import {
  Brush,
  Circle,
  Diamond,
  Eraser,
  Frame,
  Hand,
  Hexagon,
  Highlighter,
  ImagePlus,
  MessageSquarePlus,
  Minus,
  MousePointer2,
  MoveUpRight,
  Pencil,
  RectangleHorizontal,
  Shapes,
  Sparkles,
  Spline,
  Square,
  Star,
  Triangle,
  Type,
  type LucideIcon,
} from 'lucide-react';

export interface ToolMeta {
  id: ToolType;
  label: string;
  icon: LucideIcon;
  /** Primary shortcut shown in tooltips. */
  shortcut?: string;
}

export const TOOL_META: Record<ToolType, ToolMeta> = {
  selection: { id: 'selection', label: 'Select', icon: MousePointer2, shortcut: 'V' },
  hand: { id: 'hand', label: 'Hand (pan)', icon: Hand, shortcut: 'H' },
  rectangle: { id: 'rectangle', label: 'Rectangle', icon: Square, shortcut: 'R' },
  roundedRectangle: {
    id: 'roundedRectangle',
    label: 'Rounded rectangle',
    icon: RectangleHorizontal,
    shortcut: '⇧R',
  },
  ellipse: { id: 'ellipse', label: 'Ellipse', icon: Circle, shortcut: 'E' },
  diamond: { id: 'diamond', label: 'Diamond', icon: Diamond, shortcut: 'D' },
  triangle: { id: 'triangle', label: 'Triangle', icon: Triangle, shortcut: '⇧T' },
  polygon: { id: 'polygon', label: 'Polygon', icon: Hexagon, shortcut: '⇧P' },
  star: { id: 'star', label: 'Star', icon: Star, shortcut: '⇧S' },
  line: { id: 'line', label: 'Line', icon: Minus, shortcut: 'L' },
  arrow: { id: 'arrow', label: 'Arrow', icon: MoveUpRight, shortcut: 'A' },
  connector: { id: 'connector', label: 'Connector', icon: Spline, shortcut: 'C' },
  pencil: { id: 'pencil', label: 'Pencil', icon: Pencil, shortcut: 'P' },
  brush: { id: 'brush', label: 'Brush', icon: Brush, shortcut: 'B' },
  highlighter: { id: 'highlighter', label: 'Highlighter', icon: Highlighter, shortcut: '⇧B' },
  eraser: { id: 'eraser', label: 'Eraser', icon: Eraser, shortcut: 'X' },
  text: { id: 'text', label: 'Text', icon: Type, shortcut: 'T' },
  image: { id: 'image', label: 'Image', icon: ImagePlus, shortcut: 'I' },
  frame: { id: 'frame', label: 'Frame', icon: Frame, shortcut: 'F' },
  node: { id: 'node', label: 'Diagram node', icon: Shapes, shortcut: 'N' },
  comment: { id: 'comment', label: 'Comment', icon: MessageSquarePlus, shortcut: 'M' },
  laser: { id: 'laser', label: 'Laser pointer', icon: Sparkles, shortcut: 'K' },
};
