export * from './types';
// Shapes & icons
export { ShapeRegistry, shapeRegistry, getNodeGeometry, defaultIconSize } from './shapes/registry';
export { BUILTIN_SHAPES, CONTAINER_SHAPE_KEYS } from './shapes/catalog';
export { getCornerRadius, PathBuilder } from './shapes/path-builder';
export { IconRegistry, iconRegistry } from './icons/registry';
export { BUILTIN_ICONS } from './icons/icons';
// Element layouts
export {
  computeTableLayout,
  measureTable,
  getColumnKeyBadge,
  tableMetrics,
  TABLE_PADDING,
} from './layouts/table';
export { computeUmlClassLayout, measureUmlClass, parseUmlMember } from './layouts/uml-class';
export {
  computeSequenceLayout,
  measureSequence,
  ACTIVATION_WIDTH,
  ACTIVATION_OFFSET,
  SELF_LOOP_WIDTH,
} from './layouts/sequence';
// Ports & binding
export {
  getElementPorts,
  getOutlinePolygon,
  getLocalOutline,
  resolveBindingPoint,
  findBindingCandidate,
  floatingAttachment,
  canBindTo,
  sideForDirection,
  sideNormal,
  type FindBindingOptions,
} from './ports';
// Routing
export {
  computeConnectorRoute,
  computeArrowEndpoints,
  computeBoundLinearUpdates,
  elbowPath,
  ROUTING_MARGIN,
  ROUTING_BEND_PENALTY,
  type RouteResult,
  type BoundLinearUpdateOptions,
} from './routing/route';
export { findOrthogonalPath, simplifyOrthogonal } from './routing/orthogonal';
// Auto layout
export {
  autoLayout,
  selectConnectedComponent,
  DEFAULT_NODE_SPACING,
  DEFAULT_RANK_SPACING,
} from './layout';
export { removeOverlaps } from './layout/force';
// Builders & models
export {
  createNode,
  createConnector,
  createErTable,
  createErRelationship,
  createUmlClass,
  createUmlRelation,
  createSequenceDiagram,
  facingPort,
  DIAGRAM_LABEL_STYLE,
  type ErCardinality,
  type UmlRelationKind,
} from './builders';
export { sequenceOps } from './sequence-ops';
// Library
export { LIBRARY_ITEMS, searchLibrary } from './library';
export * from './templates';
