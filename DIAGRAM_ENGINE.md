# Diagram engine & importers

`@inkflow/diagram-engine` turns the raw element model (`@inkflow/elements`) into a semantic
diagramming toolkit: node shapes, icons, element layouts, ports and bindings, connector routing,
auto layout, builders, a symbol library and system templates. `@inkflow/importers` converts
untrusted external formats (native JSON, Excalidraw, SVG, raster images, Mermaid) into native
elements. Both packages are pure TypeScript, DOM-free (except the typed `readImageFile` helper),
deterministic and dependency-free beyond the workspace packages.

```
            ┌───────────────────────── @inkflow/diagram-engine ─────────────────────────┐
 elements ─▶│ shapes/ (registry, catalog)   icons/ (registry, 77 icons)                  │
 geometry ─▶│ layouts/ (table, uml-class, sequence)  ports.ts (ports, outlines, binding) │
 scene    ─▶│ routing/ (route.ts, orthogonal.ts)     layout/ (sugiyama, tree, force…)    │
            │ builders.ts  sequence-ops.ts  library.ts  templates/ (DiagramBuilder + 25) │
            └───────────────────────────────▲────────────────────────────────────────────┘
                                            │ builders + autoLayout
            ┌──────────────── @inkflow/importers ─────────────────┐
            │ native · excalidraw · svg-tokenizer/sanitize/import  │
            │ image (magic bytes) · detect · mermaid/*             │
            └──────────────────────────────────────────────────────┘
```

Consumers: the renderer draws nodes with `getNodeGeometry` + `iconRegistry` and tables / classes /
sequences with the `compute*Layout` functions; the canvas engine uses ports, `findBindingCandidate`,
`resolveBindingPoint`, `computeBoundLinearUpdates` and `autoLayout`; the API seeds
`SYSTEM_TEMPLATES` / `SEED_BOARDS`.

## Shapes

A `NodeElement` stores a `shape` key. `shapeRegistry` holds `NodeShapeDefinition`s:

| field                                                                | meaning                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------ |
| `geometry(w, h, el?)`                                                | `ShapeGeometry` in the local box `0..w × 0..h`         |
| `defaultSize`, `defaultStyle`, `defaultIcon`, `keywords`, `category` | palette & builder defaults                             |
| `elliptical`                                                         | outline is an ellipse (smooth sampling for highlights) |
| `ports(w, h)`                                                        | default ports (default: four side midpoints)           |

`ShapeGeometry` contains the closed `outline` (filled, stroked, hit-tested), optional `details`
(extra strokes: cylinder rims, rack slots, bricks), `fills` (filled with the stroke colour: LEDs,
bullseye centre), `connectionOutline` (used for attachment when the drawn outline does not cover
the box — stick-figure actor, person silhouette, padlock), `labelBox`, `iconBox`, `subtitleBox`
(org card: renders `node.metadata.subtitle`).

`getNodeGeometry(node)` resolves the definition (unknown keys → `rectangle`; `custom` → the
sanitized `node.customPath` in a 0–100 box scaled to the node, invalid paths → rectangle), mirrors
everything for `flipX` / `flipY` (rotation is applied by the caller around the box centre), and,
when the node has an `icon` but the shape reserves no icon box, carves an icon area from the top of
the label box, so `labelBox` is always the final text area. Rounded boxes use `getCornerRadius`
(¼ of the short side up to 128, then 32) — renderers must use the same function.

Built-in shapes (61): basic (rectangle, rounded-rectangle, circle, ellipse, diamond, triangle,
trapezoid, hexagon, pentagon, octagon, star, callout), flowchart (process, predefined-process,
terminator, decision, parallelogram, document, multi-document, delay, manual-input,
manual-operation, off-page-connector, preparation, internal-storage, flag, data-store, card,
loop-limit), infrastructure (database, cache, server, queue, container, browser, mobile, lock),
network (load-balancer, firewall, router), cloud (cloud, api-gateway, function, storage-bucket,
cdn), UML (actor, component, package, note, state, initial-state, final-state, fork-join,
use-case, system-boundary, swimlane), people (user, org-card), misc (sticky, mind-map-topic,
custom). `CONTAINER_SHAPE_KEYS` (container, swimlane, system-boundary, package) are drawn beneath
their contents and are never routing obstacles.

### Adding a shape

```ts
import { shapeRegistry, PathBuilder } from '@inkflow/diagram-engine';
shapeRegistry.register({
  key: 'tag',
  label: 'Tag',
  category: 'misc',
  keywords: ['label'],
  defaultSize: { width: 140, height: 60 },
  geometry: (w, h) => ({
    outline: new PathBuilder()
      .moveTo(0, 0)
      .lineTo(w - h / 2, 0)
      .lineTo(w, h / 2)
      .lineTo(w - h / 2, h)
      .lineTo(0, h)
      .close()
      .build(),
    labelBox: { x: 8, y: 8, width: w - h / 2 - 8, height: h - 16 },
  }),
});
```

Rules: outlines are closed (`Z`) and stay inside the box; `PathBuilder.arc` emits ≤ 90° cubic
arcs. The shape test suite checks every registered shape at three sizes.

## Icons

`iconRegistry` holds 77 original Lucide-style icons (24×24 box, 2 px round strokes; `paths` are
stroked, optional `fills` filled). `register` validates keys and path characters (the data is
geometry only and is parsed with `parseSvgPath`, never evaluated). `search(query)` matches key,
label and keywords. To add an icon, register `{ key, label, category, keywords, paths }`.

## Element layouts

All layouts use `measureLineWidth`/`getFontString` from `@inkflow/elements` (DOM measurer in the
browser, heuristic in Node), so measurement and drawing agree.

- **Tables** — `computeTableLayout`: header (bold name, `headerFontSize = fontSize + 1`), rows of
  `rowHeight = 2 × fontSize`, key-badge column (`PK`, `FK`, `PK FK`, `UQ` from
  `getColumnKeyBadge`), name column (`nameColumnX`, PK names bold) and type column
  (`typeColumnX`). `measureTable` returns the minimum size (≥ 140 wide, one placeholder row when
  empty).
- **UML class** — `computeUmlClassLayout`: name compartment (optional `«stereotype»` line, bold
  name, italic when abstract), attributes, methods (extra box height goes to methods). Member
  suffixes follow Mermaid: `$` static (underlined), `*` abstract (italic); markers are stripped
  from the displayed text (`parseUmlMember`).
- **Sequence** — `computeSequenceLayout` (local coordinates): participant headers across the top
  (spacing = max(`participantSpacing`, header widths, message labels)), lifelines, messages in
  model order `messageSpacing` apart (self messages add a loop of ½ spacing), activation bars
  derived from call nesting — a `sync` message opens a bar on the receiver (nested bars offset by
  `ACTIVATION_OFFSET`), a `return` closes the sender's innermost bar, `destroy` closes all bars and
  ends the lifeline, `create` places the receiver's header at the message; message endpoints
  attach to bar edges. Notes are placed after `afterMessage` (−1 = before the first) spanning one
  or two participants. `measureSequence` gives the natural size; `sequenceOps.*` are pure model
  edits that re-measure (`addParticipant`, `removeParticipant`, `renameParticipant`,
  `setParticipantKind`, `moveParticipant`, `addMessage`, `updateMessage`, `removeMessage`,
  `moveMessage`, `addNote`, `updateNote`, `removeNote`, `resize`).

## Ports & binding model

`Binding = { elementId, portId, anchor, gap }` resolves in this order:

1. **Port** — `getElementPorts(el)` returns world-space `ResolvedPort`s `{ id, side, point,
normal }`. Nodes: shape default ports merged with `node.ports` (custom ports override ids);
   side points are projected inward onto non-rectangular outlines (a triangle's `left` port sits
   on its slanted edge). Shapes (rectangle/ellipse/…): projected side ports. Tables: side ports plus
   `col:<columnId>:left|right` per row. UML class, image, text, frame: side ports. Linear, freedraw
   and sequence elements have none. Flips mirror ports (a `left` port of a flipped node reports
   `side: 'right'`), then rotation is applied to points and normals.
2. **Anchor** — normalized point of the (flipped) box, rotated; anchors on the outline are pushed
   out by `gap` along the nearest side normal, interior anchors attach exactly.
3. **Floating** — intersection of the ray from the centre toward the other end with the outline
   (exact for ellipses, farthest crossing for concave polygons), pushed out by `gap`.

`getOutlinePolygon(el)` is the world outline (ellipses sampled with 64 points, rounded rectangles
flattened, node outlines from `connectionOutline ?? outline`).

`findBindingCandidate(candidates, point, tolerance, { excludeIds, portSnapDistance })` scans
candidates top-most first (array end), skips non-bindable, linear, freedraw, locked, hidden and
excluded elements, accepts elements containing the point or within `tolerance` of the outline
(frames only near their border), then snaps to the nearest port within `portSnapDistance`
(default `tolerance`), else returns an anchor at the closest outline point when near the edge, or a
floating binding when well inside.

## Routing

`computeConnectorRoute(connector, getElement, obstacles)` resolves both ends (fixed ports/anchors
first; floating ends aim at the nearest waypoint, the other fixed point, or the other target's
centre; for `orthogonal`/`elbow` floating ends snap to the side port facing that point, judged
relative to the target's aspect ratio), then:

- `straight` — start, waypoints, end.
- `curved` — control polyline for a Catmull-Rom curve: start, waypoints (or one control halfway
  between the two ends pushed 30 % along their normals), end.
- `bezier` — exactly `[start, c1, c2, end]`, controls along the normals at 40 % of the distance.
- `elbow` — one bend (perpendicular normals) or two bends (parallel normals, midpoint channel, or
  a C-shape when both normals point the same way). No obstacle avoidance.
- `orthogonal` — obstacle-avoiding orthogonal routing:
  1. Obstacles are the non-linear elements (containers, frames and freedraw excluded) inflated by
     `ROUTING_MARGIN` (16). Containers enclosing an endpoint are dropped.
  2. Stubs leave each target along its port normal until they exit the inflated target.
  3. A sparse orthogonal visibility grid is built from obstacle edges, stub coordinates, their
     midpoint and a padded frame. Grid edges running through an obstacle interior are blocked
     (rasterized per obstacle with binary search).
  4. A* over (node, heading) states: cost = length + `ROUTING_BEND_PENALTY` (36) per bend, no
     U-turns, admissible heuristic = Manhattan distance + a lower bound on remaining bends, arrival
     heading constrained to enter the target against its normal; deterministic tie-breaking
     (f, h, insertion order). Waypoints are routed leg by leg, keeping the heading.
  5. The search only uses obstacles near the endpoints; the result is checked against all
     obstacles and re-run with any clipped ones (and the region around the path) — so typical
     routes look at a handful of boxes (≈0.1–0.5 ms with 200 obstacles) while staying correct.
  6. Channel centring moves the middle segment of every Z step to the centre of its channel when
     that keeps the path clear and the stubs long enough; collinear points are removed.
  7. No path (or > 160 k grid nodes) → elbow fallback.

Routes are rounded to 0.01 and normalized (`RouteResult` points relative to `(x, y)`, min at 0,0).
`computeArrowEndpoints` moves bound ends of plain arrows (intermediate points kept, elbow arrows
re-elbowed); connectors delegate to `computeConnectorRoute`. `computeBoundLinearUpdates(scene,
changedIds, { obstacles })` returns patches for every arrow/connector attached to a changed element
(or changed itself); bindings to deleted/missing targets become `null` and the endpoint keeps its
last position; unchanged geometry produces no patch; obstacles default to `scene.queryBounds`
around the connector.

## Auto layout

`autoLayout(nodes, edges, kind, options)` returns new top-left positions (edges are linear
elements bound between the nodes). Sizes come from each node's rotated bounds; the laid-out block
is anchored at the original selection's top-left; all algorithms are deterministic.

- **hierarchical** (Sugiyama) — per connected component: DFS cycle breaking (back edges reversed),
  longest-path layering with sources pulled down next to their successors, dummy vertices for long
  edges, barycentric crossing minimization (alternating sweeps, best ordering kept, crossings
  counted with a Fenwick tree), then priority coordinate assignment: each sweep places a layer at
  the weighted barycentre of its neighbours subject to minimum separations, solved exactly as a
  weighted isotonic regression (pool-adjacent-violators); dummies weigh 8× so long edges stay
  straight; the final pass centres children under parents. Directions TB/BT/LR/RL; components are
  packed side by side.
- **tree** — Walker's tidy tree in Buchheim–Jünger–Leipert O(n) form with size-aware separations;
  roots are nodes without incoming edges (cycles fall back to the first unvisited node, forests
  packed side by side); children are ordered by their current position. Direction `LR` defaults
  to a mind map (`mindMap: false` for a plain LR tree): root subtrees are split between both sides
  balanced by subtree size.
- **grid** — near-square grid in reading order (rows by vertical overlap, then left to right) with
  per-column widths and per-row heights.
- **horizontal / vertical** — one row / column in current order, equal gaps, centred on a line.
- **force** — Fruchterman–Reingold: seeded random start (`seed`, default 1), repulsion k²/d,
  attraction d²/k, weak gravity, linear cooling (300/180/120 iterations for ≤100/≤300/larger
  graphs), followed by overlap removal (sweep-and-prune pairs pushed apart along the axis of least
  penetration until no overlap remains).

500-node selections: hierarchical ≈ 10 ms, force ≈ 40 ms, tree ≈ 2 ms (tested with generous
limits). `selectConnectedComponent(scene, ids)` walks bindings breadth first.

## Builders, ER/UML/sequence models

- `createNode(shape, props)` — registry defaults; `label` may be a string (sans 16 px).
- `createConnector(from, to, props)` — binds facing side ports (by box gaps; `fromPort: null` for
  floating) and routes with `computeConnectorRoute`.
- `createErTable` (sized with `measureTable`; PKs non-nullable), `createErRelationship` — orthogonal
  `relationship` edges bound to `col:<id>:left|right` ports (same side when tables are stacked);
  crow's-foot heads: one-to-one `er-one-only`/`er-one-only`, one-to-many
  `er-one-only`/`er-zero-many`, many-to-one mirrored, many-to-many `er-zero-many` both.
- `createUmlClass`, `createUmlRelation(from, to, kind)` — inheritance/realization point from subtype
  to supertype (hollow triangle, realization dashed), aggregation/composition put the hollow/filled
  diamond on `from` (the whole), dependency is dashed with an open arrow, association has an open
  arrow.
- `createSequenceDiagram(participants, messages)` — index-based messages, sized with
  `measureSequence`.

## Library and templates

`LIBRARY_ITEMS` (101: 85 symbols + 16 composites such as 3-tier web app, pub/sub, cache-aside,
decision block, ER table and one-to-many, UML class/interface/inheritance, sequence diagram, state
machine, swimlanes) create fresh elements centred on the given point; `searchLibrary` ranks name,
id, keyword and category matches.

Templates are written with `DiagramBuilder` (nodes, connectors, frames, text, groups, auto layout).
`finish()` re-picks automatically chosen ports after layout, routes every connector around the
placed nodes, orders elements (frames, containers, nodes, connectors, text) and assigns fresh
ascending indices with `generateNKeysBetween`. `SYSTEM_TEMPLATES` (25): microservices, REST API,
authentication flow, OAuth 2.0 code flow (sequence), CI/CD, database ERD, cloud architecture,
Kubernetes, event-driven, frontend/backend, payment system, user registration, flowchart basics,
UML class, state machine, activity diagram, use case, component, network, data-flow, org chart,
mind map, user flow, kanban board, retrospective. `SEED_BOARDS` (6) reuse the flowchart, ERD,
architecture, UML, mind-map and kanban builders. Every build passes `validateElement` and
`parseDocument` with zero issues (tested).

## Importers & security model

All input is untrusted data: nothing is evaluated, no network or file access happens, sizes and
counts are capped, and results always go through element validation.

- `importNativeJson(text)` — 50 MB cap, guarded `JSON.parse`, rejects non-objects and other
  formats, then `parseDocument` (migration + per-element validation, invalid elements dropped and
  reported).
- `importExcalidraw(json)` — converts shapes, lines/arrows (bindings → floating bindings, heads,
  elbow/curved styles), freedraw, text (font numbers → hand/sans/mono), bound text → shape/arrow
  labels, images + files map (only `data:image/(png|jpeg|webp|gif|svg+xml);base64` URLs, bytes
  checked against the declared type, SVGs re-sanitized), frames; z-order → fractional indices.
- `sanitizeSvg` — a local XML tokenizer (no DOMParser) builds a tree that is re-serialized from an
  allow-list of elements and attributes. Dropped: scripts, `foreignObject`, `<style>`, `<a>`,
  animation, DOCTYPE/ENTITY declarations (no entity expansion), comments, PIs, `on*` handlers,
  `javascript:`/`vbscript:`/`data:` values (checked after entity decoding and control-character
  stripping), non-local `url()`/`href`, CSS outside an allow-list; `<image>` only with raster data
  URLs; text is re-escaped. `svgToDataUrl` returns the sanitized SVG as a base64 data URL.
- `importSvgAsElements` — sanitized SVG → rectangles, ellipses, lines, closed polygons, sampled
  paths (one line element per subpath, closed on `Z`) and text; `translate/scale/rotate/skew/
matrix` transforms, nested groups, `viewBox` + `preserveAspectRatio`, inherited presentation
  attributes and `style`, opacity composition, `use` expansion with depth and node budgets.
- `readImageFile(blob)` — size limit (`MAX_UPLOAD_BYTES`), magic-byte sniffing (PNG, JPEG, GIF,
  WebP, SVG; the declared type is ignored), header-parsed dimensions, SVGs sanitized.
- `detectImportKind(fileName, mime, head)` — content first, then MIME, then extension.
- `importMermaid(text)` — `flowchart`/`graph` (TD/TB/BT/LR/RL; `[]`, `()`, `([])`, `[[]]`,
  `[()]`, `(())`, `((()))`, `{}`, `{{}}`, `[//]`, `[\\]`, `[/\]`, `[\/]`, `>]`; `-->`, `---`,
  `-.->`, `==>`, `--o`, `--x`, `<-->`, `~~~`; `|label|` and inline `-- label -->`; `&` groups;
  chains; `classDef`/`class`/`style` colours; subgraphs → frames with a clustered layout: each
  subgraph is laid out on its own and placed as one block), `sequenceDiagram` (participant kinds
  and aliases, `->>`, `-->>`, `->`, `-->`, `-x`, `-)`, `create`/`destroy`, autonumber, notes over /
  left of / right of, activations derived from call nesting, `loop/alt/opt/par/…` kept as notes),
  `erDiagram` (entity blocks with types and PK/FK/UK, `||--o{`-style cardinalities, identifying
  `--` vs non-identifying `..`), `classDiagram` (blocks, `Class : member`, annotations, generics,
  all relation arrows with cardinalities and labels, notes). Labels are cleaned to plain text
  (HTML stripped, entities decoded); `click`/`link`/`callback` statements are ignored with an
  issue. Layout: hierarchical auto layout; connectors are bound to their nodes.

## Known limitations

- Mermaid: nested subgraphs become overlapping frames (the scene model does not nest frames);
  node ids must be separated from relation tokens by whitespace when they end in `o`/`x`
  (`Foo o-- Bar`); `loop/alt/…` blocks become notes because the sequence model has no fragments;
  the `@{ shape: … }` node syntax is reported as unsupported.
- `Note left of / right of` import as notes over the participant (the sequence model only has
  "over" notes).
- Orthogonal routes are computed per connector; parallel connectors may share segments.
