import type { Editor } from '../editor';
import type { ToolType } from '../types';
import type { Tool } from './base';
import { EraserTool } from './eraser';
import { FreedrawTool } from './freedraw';
import { HandTool } from './hand';
import { LinearTool } from './linear';
import { CommentTool, ImageTool, LaserTool } from './misc';
import { SelectionTool } from './selection';
import { ShapeTool } from './shape';
import { TextTool } from './text';

export type { Tool } from './base';

export function createTools(editor: Editor): Record<ToolType, Tool> {
  return {
    selection: new SelectionTool(editor),
    hand: new HandTool(editor),
    rectangle: new ShapeTool(editor, 'rectangle'),
    roundedRectangle: new ShapeTool(editor, 'roundedRectangle'),
    ellipse: new ShapeTool(editor, 'ellipse'),
    diamond: new ShapeTool(editor, 'diamond'),
    triangle: new ShapeTool(editor, 'triangle'),
    polygon: new ShapeTool(editor, 'polygon'),
    star: new ShapeTool(editor, 'star'),
    frame: new ShapeTool(editor, 'frame'),
    node: new ShapeTool(editor, 'node'),
    line: new LinearTool(editor, 'line'),
    arrow: new LinearTool(editor, 'arrow'),
    connector: new LinearTool(editor, 'connector'),
    pencil: new FreedrawTool(editor, 'pencil'),
    brush: new FreedrawTool(editor, 'brush'),
    highlighter: new FreedrawTool(editor, 'highlighter'),
    eraser: new EraserTool(editor),
    text: new TextTool(editor),
    image: new ImageTool(editor),
    comment: new CommentTool(editor),
    laser: new LaserTool(editor),
  };
}
