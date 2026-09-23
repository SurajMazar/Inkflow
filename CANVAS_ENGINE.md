# Inkflow canvas engine

The canvas engine is split into the **editor core** (`packages/canvas-engine`, framework-agnostic)
and the **rendering pipeline** (`packages/renderer`). React only renders chrome around the editor
and subscribes to its state; it never draws on the canvas.

## Editor core

`Editor` (`packages/canvas-engine/src/editor.ts`) owns:

| Part | Purpose |
| --- | --- |
| `scene` (`@inkflow/scene`) | All elements (including tombstones), z-order, spatial/binding/group/frame indexes |
| `history` | Undo/redo stacks of property-level deltas |
| `store` (zustand vanilla) | UI-facing `EditorState`: tool, selection, viewport, style defaults, grid, snapping, text editing, collaborators, presentation… |
| `tools` | One state machine per tool (selection, hand, shapes, linear, freedraw, eraser, text, image, comment, laser) |
| `InteractionController` | Normalizes pointer/touch/pen/wheel/gesture/keyboard input into tool events, panning and pinch-zoom |
| `ShortcutManager` | Layout-independent key combos → actions, user overrides, presentation keys |
| `ActionRegistry` | Every command (≈120): edit, arrange, align, view, text, navigation, diagram, frames, export |
| `ClipboardManager` | Copy/cut/paste via native clipboard events (no permission prompts), external content, style copy/paste |
| `RenderLoop` | rAF-batched redraws of the static and interactive canvases, only when dirty |
| `events` | `commit`, `transient`, `presence`, `appState`, `files`, `uiRequest`, `load` for persistence, collaboration and UI |

### Coordinates

World coordinates are infinite; the viewport is `{ x, y, zoom, width, height }` where
`screen = (world - viewport.xy) * zoom`. `screenToWorld`, `worldToScreen`, `screenRectToWorld`,
`worldRectToScreen`, `zoomAtPoint` (zoom around the cursor), `fitBounds`, `panBy` live in
`viewport.ts`. Zoom is clamped to 5 %–3000 %.

Input mapping:

| Input | Behavior |
| --- | --- |
| Wheel | Pan (Shift = horizontal); zoom when "zoom with wheel" is enabled |
| Ctrl/⌘ + wheel, trackpad pinch | Zoom around the cursor (Safari gesture events supported) |
| Space + drag, middle mouse, Hand tool | Pan |
| Two fingers | Pinch zoom + pan (any in-progress tool gesture is cancelled) |
| Long press (touch) | Context menu |
| Pen mode | Touch pans, only the stylus draws |

### Transactions and history

Every mutation goes through a `Transaction`. Gestures (`beginGesture` → pointer moves → `commitGesture`)
apply changes live, emit `transient` states for collaborators, and commit as **one** history entry
and **one** batch of operations. One-shot changes use `editor.mutate(label, fn)`. Continuous style
edits (dragging a color or slider) and repeated nudges coalesce into a single undo step.

History stores per-property `before`/`after` values (plus a snapshot to recreate elements), so undo
only reverts what the user changed and never clobbers a collaborator's concurrent edit to other
properties. Creations/deletions are `isDeleted` flips on tombstones.

### Selection & transforms

- Click selects the top-most hittable element; groups select as a unit (double-click enters a
  group; Esc exits). Shift toggles, Mod+click deep-selects inside groups, Alt+click cycles through
  overlapping elements (click-through). Dragging on empty canvas draws a marquee (elements fully
  inside are selected).
- Transparent shapes are hit by their outline, filled/labelled ones by their area; frames by their
  border and title; children of clipping frames only inside the frame.
- Resize (`transform/resize.ts`) works in the element's rotated frame and keeps the opposite handle
  fixed in world space; Shift locks aspect (images/text lock by default), Alt resizes from the
  center; dragging past the anchor flips. Multi-selection scales each element relative to the
  selection box (uniformly when rotated elements are involved). Text scales its font on corner
  drags and re-wraps on side drags; structured diagram elements never shrink below their content.
- Rotation snaps to 15° with Shift; flips mirror positions and geometry.
- Moving updates bound connectors and frame membership in the same transaction; Alt+drag duplicates;
  Shift constrains to an axis.
- Linear elements show point handles (drag, insert via midpoints, delete with ⌫) and endpoint
  binding with port snapping; images have a crop mode (double-click).

### Snapping

`snapping.ts` provides object snapping to edges and centers of nearby elements (with alignment
guides and markers), grid snapping, point snapping while drawing/resizing and angle snapping.
Thresholds are screen-constant (8 px). Holding Mod while dragging temporarily inverts object snapping.

### Text editing

Text, shape labels, edge labels and frame names are edited in a real `<textarea>` overlaid on the
canvas (`getTextEditorLayout()` provides screen position, rotation and font metrics). This gives
native caret movement, selection, IME and accessibility. Enter inserts a newline; Esc or Mod+Enter
commits; Mod+B/I/U toggle styles. Text width measurement uses the canvas `measureText` with the
bundled fonts, which are loaded before the editor mounts.

### Performance

- Spatial index (uniform grid hash with an oversized-element list) for culling, hit testing,
  marquee, eraser and snapping queries.
- Scene arrays are patched in place when z-order is unchanged (no re-sort per drag frame).
- The static canvas only redraws when the scene, viewport or theme changes; the overlay redraws on
  interaction changes. Large scenes switch to low-fidelity rendering while panning.
- Freehand points are simplified (RDP) on pointer up; coalesced pointer events keep strokes smooth.
- A 10,000-element scene loads and queries within the test budget (`test/editor.test.ts`).

### Tests

`packages/canvas-engine/test`: viewport math, rotation-aware resize, multi-resize, rotate/flip,
handles, snapping, shortcut parsing, search, and behavior tests that drive tools with synthetic
pointer events (drawing, moving, marquee + grouping, resizing, arrows binding and following shapes,
freedraw, eraser, text editing, clipboard, frames, presentation, read-only mode, remote changes,
style coalescing, 10k-element scenes).

## Rendering pipeline

The rendering engine lives in `packages/renderer` (`@inkflow/renderer`); file exporters live in
`packages/exporters` (`@inkflow/exporters`). The public contracts are in
`packages/renderer/src/types.ts`. The viewport convention everywhere is
`screen = (world - viewport.xy) * zoom`.

### Overview

```
SceneElement ──► generateElementDrawable ──► ElementDrawable (display list, element-local)
                     (DrawableCache: id+version)        │
                                                        ├─► canvas  (drawElement / StaticRenderer / renderSceneToCanvas)
                                                        ├─► SVG     (renderSceneToSvg)
                                                        └─► PDF     (exporters: vector mode)
```

Every backend draws the **same** display list, so an element looks identical on screen, in PNG,
SVG and vector PDF exports, and for every collaborator.

### Determinism

All jitter comes from `new SeededRandom(element.seed)` (Park–Miller, integer arithmetic) and
sub-seeds derived with `deriveSeed(seed, salt)` (a 32-bit integer hash) for independent parts
(fill vs. outline, arrowheads, diagram sub-shapes). The outline never changes when a fill is added
because fills use their own sub-seed. `Math.random` is never used (a test enforces this).

### Hand-drawn generator (`rough/`)

`roughPath(path, options, fill)`, `roughLine`, `roughEllipse` return `DrawOpSet[]`
(`stroke` | `fill` | `fillSketch`) built from normalized `PathCommand`s (M/L/C/Z):

- **Lines** are bowed cubics (rough.js-style): random divergence point, bowing perpendicular to the
  line, endpoint/control jitter scaled by `roughness` and a length-dependent gain; two passes
  ("double stroke") unless `disableMultiStroke` (used for dashed/dotted strokes).
- **Curves** jitter control points twice, with the jitter scaled down for short curves so rounded
  corners stay rounded.
- **Ellipses** sample jittered points around a slightly randomized radius with an overlapping
  closing stroke and fit a Catmull-Rom curve through them (two passes).
- **roughness 0** returns the exact input geometry (single pass, no jitter); small shapes get
  damped roughness (`effectiveRoughness`).
- **Fills**: `solid` → a single jittered copy of the closed outline (`fill` set). `hachure` →
  polygon scanline hatching: the rings (flattened outline incl. holes) are rotated by the hatch
  angle (default −41°), intersected with horizontal scanlines every `hachureGap` (default
  4 × strokeWidth), paired even-odd (holes stay empty) and rotated back. Sketch lines keep their
  endpoints exactly on the outline (only interior control points are jittered) so fills never
  leak. `cross-hatch` adds a second family at +90°. `zigzag` is a continuous back-and-forth
  scribble clipped against the rings with exact segment/polygon clipping.

Dash patterns scale with the stroke width (`dashed`: `[4w+4, 3w+4]`, `dotted`: `[0.5, 2.5w+2]`
with round caps); arrowheads are always solid.

### Element drawables (`drawable/`)

`generateElementDrawable(el)` returns an `ElementDrawable` in element-local coordinates (origin at
`x, y`, unrotated): `sets` (all op sets), `layers` (shape / text / image / group-with-clip
layers), `labelLayers` (embedded label, skipped while edited), `localBounds`, `complexity`.

- Shapes: rectangles (adaptive corner radius), ellipses, diamonds/triangles/polygons/stars with
  rounded corners, flips applied geometrically; labels wrapped to a per-shape label box with
  `label.color ?? strokeColor`.
- Linear elements: sharp/curved (shared Catmull-Rom conversion)/elbow paths, rounded orthogonal
  bends, closed lines filled. Arrowheads (arrow, triangle(-outline), dot, circle-outline, bar,
  diamond(-outline), ER crow's foot notations) are oriented along the exact end tangent and sized
  by stroke width; hollow heads trim the shaft; ER circles and edge labels knock the line out via
  an even-odd clip group.
- Freedraw: `getFreedrawOutline` — own perfect-freehand-like algorithm (streamlining, recorded or
  speed-simulated pressure → radius, left/right offsets, round caps, round joins at sharp turns)
  rendered as a filled smooth outline (pencil, wider/smoother brush, flat translucent highlighter).
- Text (wrapping via `layoutText`, alignment, decorations, letter spacing, background box), images
  (crop in natural pixels, flips; bitmaps resolved at draw time), frames (background + thin
  border; the name is drawn separately at constant screen size).
- Diagram elements use `@inkflow/diagram-engine` for all geometry and layout: nodes
  (`getNodeGeometry` outline/details/fills, `iconRegistry` icons, label box, subtitle), ER tables
  (`computeTableLayout`, PK/FK/UQ badges), UML classes (`computeUmlClassLayout`) and sequence
  diagrams (`computeSequenceLayout`: participant symbols, dashed lifelines, message kinds, self
  loops, activation bars, notes).

`measureRenderPadding(el)` is the zoom-independent extra extent beyond `getElementBounds`
(stroke, jitter, arrowheads, text overhang, edge labels) used for culling and export bounds.

### Canvas rendering (`canvas/`)

- `drawElement(ctx, el, env)`: world-space ctx; applies translate + rotation around the box
  centre, opacity, and draws the layers (cached `Path2D` per op set when available).
- `StaticRenderer`: HiDPI backing store (`viewport × pixelRatio`), clear + background, grid,
  then `planRender` (culling with cached `getElementBounds + measureRenderPadding` per element
  version, frames first, children clipped to `clip` frames, frame names last).
  Two cache levels: drawables by id+version (+ Path2D), and an LRU **bitmap cache** (default
  96 MB budget) for expensive drawables (heavy freedraw, sketch fills, long text) keyed by
  id+version+zoom bucket (√2 steps, always ≥ target resolution). `lowFidelity` reuses bitmaps of
  any bucket and skips hachure of uncached elements. Call `invalidate()` after web fonts load.
- Dark mode: the app applies `invert(93%) hue-rotate(180deg)` to the static canvas, so the static
  renderer always draws the light palette and draws images with
  `invert(100%) hue-rotate(180deg)` (pre-inverted pixels where `ctx.filter` is unsupported).
- `InteractiveRenderer`: unfiltered overlay with theme-aware palettes; constant screen-size
  chrome (selection, handles, marquee, lasso, snapping, binding, ports, remote cursors and
  selections, eraser, crop editor, linear editor, comment pins, search, laser).
- `drawGrid`: dot / square / isometric grids aligned to world multiples; spacing below 6px
  coarsens ×5 (up to 3 levels), then hides.
- `ImageCache`: lazy decoding (`ensure`), statuses for placeholders, `onLoad` re-render hook.

Measured (Node, recording context, 10,000 mixed elements): drawable generation ≈ 150 ms, first
culled render ≈ 11 ms, re-render from cache ≈ 4 ms, all 10k visible from cache ≈ 50 ms.

### SVG

`renderSceneToSvg` emits the same op sets as `<path>`s, text as escaped `<text>` (font-family
from `FONT_FAMILIES`), images as `<image href="data:…">` (crop via `<clipPath>`), `<g transform>`
for rotation, frame clip paths, optional `@font-face` (data URLs only), optional `<metadata>`, and
dark mode through an SVG filter (`feComponentTransfer` + `hueRotate`) with counter-filtered images.
All text and attribute values are escaped; colors and URLs are validated.

### Exporters

- `getExportBounds`: element render bounds + padding (frame names included), exact frame box
  (`frameId`) or exact viewport rectangle (`bounds`).
- `exportToCanvas` / `exportToPngBlob`: scale clamped to `maxPixels` (default 32 MP) and the max
  canvas side; `embedScene` writes the scene JSON into a zlib-compressed PNG `iTXt` chunk with the
  keyword `inkflow` (CompressionStream); `extractSceneFromPng` reads it back.
- `exportToSvgString`: embeds images (data URLs), used fonts (`fontSources`) and scene metadata.
- `exportToPdfBlob` (jsPDF): `pages: 'frames'` → one page per frame in presentation order
  (`orderedFrames`), sized to the frame (1 world unit = 0.75 pt, capped at 14 400 pt).
  `vector` walks the display lists with jsPDF's advanced API (per-element `cm` transforms,
  moveTo/lineTo/curveTo, fill/stroke, dash, opacity via cached GStates, clips, standard fonts,
  images); `raster` embeds a PNG per page.
- `exportToJson` (pretty `serializeDocument`), `downloadBlob`, `downloadText`,
  `copyBlobToClipboard`, `suggestFileName`.
