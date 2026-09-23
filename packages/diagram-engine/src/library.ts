import type { SceneElement, TableElement } from '@inkflow/elements';
import type { Point } from '@inkflow/geometry';
import { createErRelationship, createErTable, createSequenceDiagram, createUmlClass } from './builders';
import { DiagramBuilder, PALETTE, centerElements, type PaletteColor } from './templates/builder';
import type { LibraryCategory, LibraryItem } from './types';

interface NodeSpec {
  id: string;
  name: string;
  category: LibraryCategory;
  shape: string;
  icon?: string;
  label?: string;
  keywords: string[];
  color?: PaletteColor;
  size?: [number, number];
}

const card: [number, number] = [170, 90];

const NODE_SPECS: NodeSpec[] = [
  // Basic
  { id: 'rectangle', name: 'Rectangle', category: 'basic', shape: 'rectangle', keywords: ['box', 'square'] },
  { id: 'rounded-rectangle', name: 'Rounded rectangle', category: 'basic', shape: 'rounded-rectangle', keywords: ['box', 'card'] },
  { id: 'circle', name: 'Circle', category: 'basic', shape: 'circle', keywords: ['round', 'node'] },
  { id: 'ellipse', name: 'Ellipse', category: 'basic', shape: 'ellipse', keywords: ['oval'] },
  { id: 'diamond', name: 'Diamond', category: 'basic', shape: 'diamond', keywords: ['rhombus'] },
  { id: 'triangle', name: 'Triangle', category: 'basic', shape: 'triangle', keywords: ['arrow'] },
  { id: 'hexagon', name: 'Hexagon', category: 'basic', shape: 'hexagon', keywords: ['polygon'] },
  { id: 'callout', name: 'Callout', category: 'basic', shape: 'callout', label: 'Comment', keywords: ['speech', 'bubble'] },
  { id: 'star', name: 'Star', category: 'basic', shape: 'star', keywords: ['highlight', 'favorite'], color: 'yellow' },
  { id: 'sticky-note', name: 'Sticky note', category: 'basic', shape: 'sticky', label: 'Idea', keywords: ['post-it', 'note', 'idea'] },
  // Flowchart
  { id: 'flow-process', name: 'Process', category: 'flowchart', shape: 'process', label: 'Process', keywords: ['step', 'action'] },
  { id: 'flow-decision', name: 'Decision', category: 'flowchart', shape: 'decision', label: 'Condition?', keywords: ['if', 'branch'] },
  { id: 'flow-terminator', name: 'Start / end', category: 'flowchart', shape: 'terminator', label: 'Start', keywords: ['terminator', 'begin', 'end'] },
  { id: 'flow-io', name: 'Input / output', category: 'flowchart', shape: 'parallelogram', label: 'Input', keywords: ['data', 'io', 'parallelogram'] },
  { id: 'flow-document', name: 'Document', category: 'flowchart', shape: 'document', label: 'Report', keywords: ['file', 'paper'] },
  { id: 'flow-multi-document', name: 'Documents', category: 'flowchart', shape: 'multi-document', label: 'Documents', keywords: ['files'] },
  { id: 'flow-subroutine', name: 'Predefined process', category: 'flowchart', shape: 'predefined-process', label: 'Subroutine', keywords: ['function', 'call'] },
  { id: 'flow-delay', name: 'Delay', category: 'flowchart', shape: 'delay', label: 'Wait', keywords: ['wait', 'pause'] },
  { id: 'flow-manual-input', name: 'Manual input', category: 'flowchart', shape: 'manual-input', label: 'Enter data', keywords: ['keyboard', 'form'] },
  { id: 'flow-off-page', name: 'Off-page connector', category: 'flowchart', shape: 'off-page-connector', label: 'A', keywords: ['reference', 'jump'] },
  { id: 'flow-preparation', name: 'Preparation', category: 'flowchart', shape: 'preparation', label: 'Setup', keywords: ['init', 'loop'] },
  // Infrastructure
  { id: 'server', name: 'Server', category: 'infrastructure', shape: 'server', label: 'Server', keywords: ['host', 'vm', 'machine'] },
  { id: 'app-server', name: 'Application server', category: 'infrastructure', shape: 'rounded-rectangle', icon: 'server', label: 'App server', keywords: ['backend', 'service'], color: 'blue', size: card },
  { id: 'database', name: 'Database', category: 'infrastructure', shape: 'database', label: 'Database', keywords: ['db', 'sql', 'postgres', 'mysql'] },
  { id: 'cache', name: 'Cache', category: 'infrastructure', shape: 'cache', label: 'Redis', keywords: ['redis', 'memcached'] },
  { id: 'queue', name: 'Message queue', category: 'infrastructure', shape: 'queue', label: 'Queue', keywords: ['kafka', 'rabbitmq', 'sqs', 'broker'] },
  { id: 'container', name: 'Container', category: 'infrastructure', shape: 'rounded-rectangle', icon: 'container', label: 'Container', keywords: ['docker', 'image'], color: 'cyan', size: card },
  { id: 'kubernetes-pod', name: 'Kubernetes pod', category: 'infrastructure', shape: 'rounded-rectangle', icon: 'kubernetes', label: 'Pod', keywords: ['k8s', 'pod', 'cluster'], color: 'blue', size: card },
  { id: 'worker', name: 'Worker', category: 'infrastructure', shape: 'rounded-rectangle', icon: 'worker', label: 'Worker', keywords: ['job', 'background', 'consumer'], color: 'orange', size: card },
  { id: 'vm', name: 'Virtual machine', category: 'infrastructure', shape: 'rounded-rectangle', icon: 'cpu', label: 'VM', keywords: ['compute', 'ec2', 'instance'], color: 'gray', size: card },
  { id: 'disk', name: 'Block storage', category: 'infrastructure', shape: 'rounded-rectangle', icon: 'hard-drive', label: 'Volume', keywords: ['disk', 'ebs', 'volume'], color: 'gray', size: card },
  { id: 'group-container', name: 'Group container', category: 'infrastructure', shape: 'container', label: 'Service group', keywords: ['boundary', 'group', 'vpc'] },
  // Network
  { id: 'load-balancer', name: 'Load balancer', category: 'network', shape: 'load-balancer', label: 'Load balancer', keywords: ['lb', 'nginx', 'alb'] },
  { id: 'firewall', name: 'Firewall', category: 'network', shape: 'firewall', label: 'Firewall', keywords: ['waf', 'security'] },
  { id: 'router', name: 'Router', category: 'network', shape: 'router', label: 'Router', keywords: ['gateway', 'nat'] },
  { id: 'switch', name: 'Network switch', category: 'network', shape: 'rounded-rectangle', icon: 'network', label: 'Switch', keywords: ['lan', 'network'], color: 'green', size: card },
  { id: 'dns', name: 'DNS', category: 'network', shape: 'rounded-rectangle', icon: 'globe', label: 'DNS', keywords: ['domain', 'route53', 'resolver'], color: 'teal', size: card },
  { id: 'wifi', name: 'Wireless access point', category: 'network', shape: 'rounded-rectangle', icon: 'wifi', label: 'Wi-Fi', keywords: ['wireless', 'access point'], color: 'green', size: card },
  { id: 'internet', name: 'Internet', category: 'network', shape: 'cloud', label: 'Internet', keywords: ['web', 'public', 'www'] },
  // Cloud
  { id: 'cloud', name: 'Cloud', category: 'cloud', shape: 'cloud', label: 'Cloud', keywords: ['aws', 'gcp', 'azure'] },
  { id: 'api-gateway', name: 'API gateway', category: 'cloud', shape: 'api-gateway', label: 'API gateway', keywords: ['gateway', 'ingress', 'kong'] },
  { id: 'function', name: 'Serverless function', category: 'cloud', shape: 'function', label: 'Function', keywords: ['lambda', 'faas'] },
  { id: 'bucket', name: 'Object storage', category: 'cloud', shape: 'storage-bucket', label: 'Bucket', keywords: ['s3', 'blob', 'gcs'] },
  { id: 'cdn', name: 'CDN', category: 'cloud', shape: 'cdn', label: 'CDN', keywords: ['cloudfront', 'edge', 'akamai'] },
  { id: 'event-bus', name: 'Event bus', category: 'cloud', shape: 'queue', label: 'Event bus', keywords: ['eventbridge', 'pubsub', 'stream'], color: 'grape' },
  { id: 'auth-service', name: 'Identity provider', category: 'cloud', shape: 'lock', label: 'Auth', keywords: ['iam', 'oauth', 'sso', 'identity'] },
  { id: 'monitoring', name: 'Monitoring', category: 'cloud', shape: 'rounded-rectangle', icon: 'chart', label: 'Monitoring', keywords: ['metrics', 'grafana', 'prometheus'], color: 'violet', size: card },
  { id: 'secrets', name: 'Secrets manager', category: 'cloud', shape: 'rounded-rectangle', icon: 'key', label: 'Secrets', keywords: ['vault', 'kms', 'keys'], color: 'yellow', size: card },
  { id: 'email-service', name: 'Email service', category: 'cloud', shape: 'rounded-rectangle', icon: 'mail', label: 'Email', keywords: ['smtp', 'ses', 'sendgrid'], color: 'blue', size: card },
  { id: 'notifications', name: 'Notification service', category: 'cloud', shape: 'rounded-rectangle', icon: 'bell', label: 'Notifications', keywords: ['push', 'sns', 'alerts'], color: 'orange', size: card },
  { id: 'search-service', name: 'Search service', category: 'cloud', shape: 'rounded-rectangle', icon: 'search', label: 'Search', keywords: ['elasticsearch', 'index', 'opensearch'], color: 'teal', size: card },
  { id: 'payment-provider', name: 'Payment provider', category: 'cloud', shape: 'rounded-rectangle', icon: 'credit-card', label: 'Payments', keywords: ['stripe', 'psp', 'billing'], color: 'green', size: card },
  // Software
  { id: 'microservice', name: 'Microservice', category: 'software', shape: 'hexagon', icon: 'microservice', label: 'Service', keywords: ['service', 'api', 'backend'], color: 'violet', size: [170, 100] },
  { id: 'api', name: 'API', category: 'software', shape: 'rounded-rectangle', icon: 'api', label: 'REST API', keywords: ['rest', 'graphql', 'endpoint'], color: 'violet', size: card },
  { id: 'web-client', name: 'Web client', category: 'software', shape: 'browser', label: 'Web app', keywords: ['browser', 'spa', 'frontend'] },
  { id: 'mobile-client', name: 'Mobile client', category: 'software', shape: 'mobile', label: 'Mobile app', keywords: ['ios', 'android', 'phone'] },
  { id: 'desktop-client', name: 'Desktop client', category: 'software', shape: 'rounded-rectangle', icon: 'laptop', label: 'Desktop app', keywords: ['laptop', 'electron'], color: 'gray', size: card },
  { id: 'cli', name: 'Command line', category: 'software', shape: 'rounded-rectangle', icon: 'terminal', label: 'CLI', keywords: ['terminal', 'shell'], color: 'gray', size: card },
  { id: 'repository', name: 'Repository', category: 'software', shape: 'rounded-rectangle', icon: 'git-branch', label: 'Repository', keywords: ['git', 'github', 'source'], color: 'orange', size: card },
  { id: 'pipeline', name: 'CI pipeline', category: 'software', shape: 'rounded-rectangle', icon: 'refresh', label: 'CI pipeline', keywords: ['ci', 'cd', 'build'], color: 'green', size: card },
  { id: 'component', name: 'Component', category: 'software', shape: 'component', label: 'Component', keywords: ['module', 'library'] },
  { id: 'package', name: 'Package', category: 'software', shape: 'rounded-rectangle', icon: 'package', label: 'Package', keywords: ['npm', 'library', 'dependency'], color: 'yellow', size: card },
  { id: 'config', name: 'Configuration', category: 'software', shape: 'rounded-rectangle', icon: 'settings', label: 'Config', keywords: ['settings', 'env'], color: 'gray', size: card },
  { id: 'webhook', name: 'Webhook', category: 'software', shape: 'rounded-rectangle', icon: 'link', label: 'Webhook', keywords: ['callback', 'http'], color: 'teal', size: card },
  { id: 'scheduler', name: 'Scheduler', category: 'software', shape: 'rounded-rectangle', icon: 'clock', label: 'Cron', keywords: ['cron', 'timer', 'schedule'], color: 'orange', size: card },
  // Data
  { id: 'data-warehouse', name: 'Data warehouse', category: 'data', shape: 'database', icon: 'layers', label: 'Warehouse', keywords: ['bigquery', 'snowflake', 'redshift'], color: 'violet' },
  { id: 'data-lake', name: 'Data lake', category: 'data', shape: 'storage-bucket', label: 'Data lake', keywords: ['lake', 'parquet', 'raw'], color: 'teal' },
  { id: 'analytics', name: 'Analytics', category: 'data', shape: 'rounded-rectangle', icon: 'pie-chart', label: 'Analytics', keywords: ['bi', 'dashboard', 'report'], color: 'grape', size: card },
  { id: 'etl', name: 'ETL job', category: 'data', shape: 'rounded-rectangle', icon: 'gear', label: 'ETL', keywords: ['transform', 'pipeline', 'batch'], color: 'orange', size: card },
  { id: 'stream', name: 'Data stream', category: 'data', shape: 'queue', label: 'Stream', keywords: ['kinesis', 'kafka', 'events'], color: 'cyan' },
  { id: 'file-store', name: 'File', category: 'data', shape: 'document', label: 'data.csv', keywords: ['csv', 'file', 'export'] },
  // People
  { id: 'user', name: 'User', category: 'people', shape: 'user', label: 'User', keywords: ['person', 'customer'] },
  { id: 'team', name: 'Team', category: 'people', shape: 'rounded-rectangle', icon: 'users', label: 'Team', keywords: ['group', 'people'], color: 'blue', size: card },
  { id: 'admin', name: 'Administrator', category: 'people', shape: 'rounded-rectangle', icon: 'shield', label: 'Admin', keywords: ['operator', 'staff'], color: 'red', size: card },
  { id: 'org-card', name: 'Org chart card', category: 'people', shape: 'org-card', label: 'Jane Doe', keywords: ['employee', 'org chart'] },
  // UML
  { id: 'uml-actor', name: 'Actor', category: 'uml', shape: 'actor', label: 'Actor', keywords: ['stick figure', 'use case'] },
  { id: 'uml-use-case', name: 'Use case', category: 'uml', shape: 'use-case', label: 'Use case', keywords: ['scenario', 'ellipse'] },
  { id: 'uml-state', name: 'State', category: 'uml', shape: 'state', label: 'State', keywords: ['state machine'] },
  { id: 'uml-initial', name: 'Initial state', category: 'uml', shape: 'initial-state', keywords: ['start'] },
  { id: 'uml-final', name: 'Final state', category: 'uml', shape: 'final-state', keywords: ['end'] },
  { id: 'uml-fork', name: 'Fork / join', category: 'uml', shape: 'fork-join', keywords: ['parallel', 'bar'] },
  { id: 'uml-package', name: 'Package', category: 'uml', shape: 'package', label: 'package', keywords: ['namespace', 'folder'] },
  { id: 'uml-note', name: 'Note', category: 'uml', shape: 'note', label: 'Note', keywords: ['comment', 'annotation'] },
  { id: 'uml-boundary', name: 'System boundary', category: 'uml', shape: 'system-boundary', label: 'System', keywords: ['subject', 'scope'] },
  { id: 'uml-swimlane', name: 'Swimlane', category: 'uml', shape: 'swimlane', label: 'Lane', keywords: ['activity', 'partition'] },
];

function nodeItem(spec: NodeSpec): LibraryItem {
  return {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    keywords: spec.keywords,
    create(center: Point) {
      const b = new DiagramBuilder();
      const colors = spec.color ? { backgroundColor: PALETTE[spec.color].bg, strokeColor: PALETTE[spec.color].stroke } : {};
      b.nodeAt(spec.shape, center.x, center.y, spec.label ?? null, {
        ...colors,
        ...(spec.icon ? { icon: spec.icon } : {}),
        ...(spec.size ? { width: spec.size[0], height: spec.size[1] } : {}),
      });
      return b.finish();
    },
  };
}

function composite(id: string, name: string, category: LibraryCategory, keywords: string[], build: (b: DiagramBuilder) => void): LibraryItem {
  return {
    id,
    name,
    category,
    keywords,
    create(center: Point): SceneElement[] {
      const b = new DiagramBuilder();
      build(b);
      return centerElements(b.finish(), center);
    },
  };
}

const COMPOSITES: LibraryItem[] = [
  composite('three-tier-web-app', '3-tier web app', 'software', ['architecture', 'web', 'frontend', 'backend', 'database'], (b) => {
    const web = b.node('browser', 0, 0, 'Web client');
    const lb = b.node('load-balancer', 260, 25, 'Load balancer');
    const app1 = b.node('rounded-rectangle', 520, -60, 'App server 1', { icon: 'server', color: 'blue', width: 170, height: 90 });
    const app2 = b.node('rounded-rectangle', 520, 120, 'App server 2', { icon: 'server', color: 'blue', width: 170, height: 90 });
    const db = b.node('database', 780, 10, 'PostgreSQL');
    b.connect(web, lb, { routing: 'orthogonal', label: 'HTTPS' });
    b.connect(lb, app1, { routing: 'orthogonal' });
    b.connect(lb, app2, { routing: 'orthogonal' });
    b.connect(app1, db, { routing: 'orthogonal' });
    b.connect(app2, db, { routing: 'orthogonal' });
  }),
  composite('client-server', 'Client / server', 'software', ['request', 'response', 'http'], (b) => {
    const client = b.node('browser', 0, 0, 'Client');
    const server = b.node('server', 300, 0, 'Server');
    b.connect(client, server, { routing: 'straight', label: 'request' });
  }),
  composite('pub-sub', 'Publish / subscribe', 'software', ['events', 'kafka', 'producer', 'consumer', 'broker'], (b) => {
    const producer = b.node('rounded-rectangle', 0, 70, 'Producer', { icon: 'upload', color: 'green', width: 160, height: 90 });
    const topic = b.node('queue', 240, 80, 'Topic');
    const c1 = b.node('rounded-rectangle', 500, 0, 'Consumer A', { icon: 'worker', color: 'orange', width: 160, height: 90 });
    const c2 = b.node('rounded-rectangle', 500, 150, 'Consumer B', { icon: 'worker', color: 'orange', width: 160, height: 90 });
    b.connect(producer, topic, { routing: 'orthogonal', label: 'publish' });
    b.connect(topic, c1, { routing: 'orthogonal' });
    b.connect(topic, c2, { routing: 'orthogonal' });
  }),
  composite('cache-aside', 'Cache-aside', 'data', ['cache', 'redis', 'read through'], (b) => {
    const app = b.node('rounded-rectangle', 0, 60, 'Service', { icon: 'server', color: 'blue', width: 160, height: 90 });
    const cache = b.node('cache', 260, -40, 'Cache');
    const db = b.node('database', 260, 140, 'Database');
    b.connect(app, cache, { routing: 'orthogonal', label: '1. get' });
    b.connect(app, db, { routing: 'orthogonal', label: '2. miss → query' });
  }),
  composite('load-balanced-servers', 'Load-balanced servers', 'infrastructure', ['scaling', 'lb', 'high availability'], (b) => {
    const lb = b.node('load-balancer', 150, 0, 'Load balancer');
    const servers = [0, 1, 2].map((i) => b.node('server', i * 170, 160, `Server ${i + 1}`));
    for (const s of servers) b.connect(lb, s, { routing: 'orthogonal' });
  }),
  composite('decision-block', 'Decision block', 'flowchart', ['if', 'else', 'branch', 'yes', 'no'], (b) => {
    const d = b.node('decision', 0, 0, 'Condition?');
    const yes = b.node('process', 220, 10, 'Do this');
    const no = b.node('process', -5, 170, 'Do that');
    b.connect(d, yes, { routing: 'orthogonal', label: 'Yes', fromPort: 'right', toPort: 'left' });
    b.connect(d, no, { routing: 'orthogonal', label: 'No', fromPort: 'bottom', toPort: 'top' });
  }),
  composite('flow-start-end', 'Start → process → end', 'flowchart', ['sequence', 'steps', 'flow'], (b) => {
    const s = b.node('terminator', 5, 0, 'Start');
    const p = b.node('process', 0, 120, 'Process');
    const e = b.node('terminator', 5, 260, 'End', { backgroundColor: PALETTE.red.bg, strokeColor: PALETTE.red.stroke });
    b.connect(s, p, { routing: 'orthogonal' });
    b.connect(p, e, { routing: 'orthogonal' });
  }),
  composite('er-table', 'ER table', 'er', ['entity', 'table', 'sql', 'schema'], (b) => {
    b.add(
      createErTable('users', [
        { name: 'id', dataType: 'uuid', primaryKey: true },
        { name: 'email', dataType: 'varchar(255)', unique: true, nullable: false },
        { name: 'name', dataType: 'text' },
        { name: 'created_at', dataType: 'timestamptz', nullable: false },
      ]),
    );
  }),
  composite('er-one-to-many', 'ER one-to-many', 'er', ['relationship', 'foreign key', 'crow foot'], (b) => {
    const users = b.add(createErTable('users', [{ name: 'id', dataType: 'uuid', primaryKey: true }, { name: 'email', dataType: 'text' }]));
    const orders = b.add(
      createErTable('orders', [{ name: 'id', dataType: 'uuid', primaryKey: true }, { name: 'user_id', dataType: 'uuid', foreignKey: true, references: 'users.id' }], { x: 320, y: 0 }),
    );
    b.add(createErRelationshipBetween(users, orders));
  }),
  composite('uml-class', 'UML class', 'uml', ['class', 'object', 'oop'], (b) => {
    b.add(createUmlClass('ClassName', ['- id: string', '- name: string'], ['+ getName(): string', '+ setName(name: string): void']));
  }),
  composite('uml-interface', 'UML interface', 'uml', ['interface', 'contract', 'abstract'], (b) => {
    b.add(createUmlClass('Repository', [], ['+ find(id: string): T', '+ save(entity: T): void'], { stereotype: 'interface' }));
  }),
  composite('uml-inheritance', 'UML inheritance', 'uml', ['extends', 'generalization', 'subclass'], (b) => {
    const base = b.add(createUmlClass('Animal', ['# name: string'], ['+ speak(): void'], { x: 90, y: 0 }));
    const dog = b.add(createUmlClass('Dog', [], ['+ speak(): void'], { x: 0, y: 200 }));
    const cat = b.add(createUmlClass('Cat', [], ['+ speak(): void'], { x: 200, y: 200 }));
    b.connect(dog, base, { routing: 'orthogonal', endArrowhead: 'triangle-outline', edgeKind: 'inheritance', fromPort: 'top', toPort: 'bottom' });
    b.connect(cat, base, { routing: 'orthogonal', endArrowhead: 'triangle-outline', edgeKind: 'inheritance', fromPort: 'top', toPort: 'bottom' });
  }),
  composite('sequence-diagram', 'Sequence diagram', 'uml', ['sequence', 'interaction', 'messages', 'lifeline'], (b) => {
    b.add(
      createSequenceDiagram(
        [{ name: 'Client', kind: 'actor' }, { name: 'Server' }, { name: 'Database', kind: 'database' }],
        [
          { from: 0, to: 1, label: 'request' },
          { from: 1, to: 2, label: 'query' },
          { from: 2, to: 1, label: 'rows', kind: 'return' },
          { from: 1, to: 0, label: 'response', kind: 'return' },
        ],
      ),
    );
  }),
  composite('state-machine-starter', 'State machine', 'uml', ['states', 'transitions', 'fsm'], (b) => {
    const start = b.node('initial-state', 0, 20, null);
    const idle = b.node('state', 80, 0, 'Idle');
    const busy = b.node('state', 320, 0, 'Busy');
    const end = b.node('final-state', 560, 18, null);
    b.connect(start, idle, { routing: 'straight', edgeKind: 'transition' });
    b.connect(idle, busy, { routing: 'curved', edgeKind: 'transition', label: 'start', fromPort: 'top', toPort: 'top' });
    b.connect(busy, idle, { routing: 'curved', edgeKind: 'transition', label: 'done', fromPort: 'bottom', toPort: 'bottom' });
    b.connect(busy, end, { routing: 'straight', edgeKind: 'transition' });
  }),
  composite('swimlanes', 'Swimlanes', 'flowchart', ['lanes', 'responsibility', 'cross-functional'], (b) => {
    b.node('swimlane', 0, 0, 'Customer', { height: 360 });
    b.node('swimlane', 280, 0, 'Support', { height: 360 });
  }),
  composite('microservice-with-db', 'Microservice with database', 'software', ['service', 'database per service'], (b) => {
    const svc = b.node('hexagon', 0, 0, 'Orders service', { icon: 'microservice', color: 'violet', width: 180, height: 100 });
    const db = b.node('database', 250, -5, 'orders-db');
    b.connect(svc, db, { routing: 'orthogonal' });
  }),
];

function createErRelationshipBetween(from: TableElement, to: TableElement) {
  const idCol = from.columns.find((c) => c.primaryKey)?.id ?? null;
  const fkCol = to.columns.find((c) => c.foreignKey)?.id ?? null;
  return createErRelationship(from, idCol, to, fkCol, 'one-to-many');
}

/** Technical diagram library: single symbols and composite starters. */
export const LIBRARY_ITEMS: LibraryItem[] = [...NODE_SPECS.map(nodeItem), ...COMPOSITES];

/** Case-insensitive search over name, id, category and keywords; ranks name matches first. */
export function searchLibrary(query: string): LibraryItem[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return LIBRARY_ITEMS.slice();
  const scored: { item: LibraryItem; score: number; order: number }[] = [];
  LIBRARY_ITEMS.forEach((item, order) => {
    let score = 0;
    const name = item.name.toLowerCase();
    for (const t of terms) {
      if (name === t) score += 10;
      else if (name.startsWith(t)) score += 6;
      else if (name.includes(t)) score += 4;
      else if (item.id.includes(t)) score += 3;
      else if (item.keywords.some((k) => k.toLowerCase().includes(t))) score += 2;
      else if (item.category.includes(t)) score += 1;
      else {
        score = 0;
        break;
      }
    }
    if (score > 0) scored.push({ item, score, order });
  });
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).map((s) => s.item);
}
