import type { NodeElement, TableElement } from '@inkflow/elements';
import { createErRelationship, createErTable, createUmlClass, createUmlRelation } from '../builders';
import type { TemplateContent } from '../types';
import { DiagramBuilder, PALETTE } from './builder';

const ortho = { routing: 'orthogonal' as const };
const red = { backgroundColor: PALETTE.red.bg, strokeColor: PALETTE.red.stroke };

/** Lays out a flowchart top-to-bottom with the Sugiyama layout, below a title. */
function layoutFlow(b: DiagramBuilder, nodes: NodeElement[], direction: 'TB' | 'LR' = 'TB') {
  b.layout(nodes, 'hierarchical', { direction, nodeSpacing: 60, rankSpacing: 60 }, { x: 0, y: 0 });
}

export function buildFlowchartBasics(): TemplateContent {
  const b = new DiagramBuilder();
  b.text(-40, -90, 'Flowchart basics', { fontSize: 28, fontWeight: 'bold' });
  const start = b.node('terminator', 0, 0, 'Start');
  const input = b.node('parallelogram', 0, 0, 'Read input');
  const process = b.node('process', 0, 0, 'Process data');
  const decision = b.node('decision', 0, 0, 'Valid?');
  const fix = b.node('process', 0, 0, 'Adjust parameters', { color: 'yellow' });
  const output = b.node('document', 0, 0, 'Write report');
  const end = b.node('terminator', 0, 0, 'End', red);
  b.connect(start, input, ortho);
  b.connect(input, process, ortho);
  b.connect(process, decision, ortho);
  b.connect(decision, output, { ...ortho, label: 'Yes' });
  b.connect(decision, fix, { ...ortho, label: 'No' });
  b.connect(fix, process, { ...ortho, strokeStyle: 'dashed', label: 'retry', fromPort: 'right', toPort: 'right' });
  b.connect(output, end, ortho);
  layoutFlow(b, [start, input, process, decision, fix, output, end]);
  return b.build();
}

export function buildAuthFlow(): TemplateContent {
  const b = new DiagramBuilder();
  b.text(-40, -90, 'Authentication flow', { fontSize: 28, fontWeight: 'bold' });
  const start = b.node('terminator', 0, 0, 'Open sign-in');
  const creds = b.node('manual-input', 0, 0, 'Enter email & password');
  const valid = b.node('decision', 0, 0, 'Credentials valid?', { width: 180, height: 110 });
  const locked = b.node('decision', 0, 0, '5 failed attempts?', { width: 180, height: 110 });
  const lock = b.node('process', 0, 0, 'Lock account 15 min', red);
  const error = b.node('process', 0, 0, 'Show error', { color: 'yellow' });
  const mfa = b.node('decision', 0, 0, 'MFA enabled?', { width: 170, height: 100 });
  const code = b.node('manual-input', 0, 0, 'Enter one-time code');
  const codeOk = b.node('decision', 0, 0, 'Code valid?');
  const session = b.node('process', 0, 0, 'Issue session & refresh token', { color: 'green', width: 190 });
  const done = b.node('terminator', 0, 0, 'Redirect to app', { color: 'green' });
  b.connect(start, creds, ortho);
  b.connect(creds, valid, ortho);
  b.connect(valid, mfa, { ...ortho, label: 'Yes' });
  b.connect(valid, locked, { ...ortho, label: 'No' });
  b.connect(locked, lock, { ...ortho, label: 'Yes' });
  b.connect(locked, error, { ...ortho, label: 'No' });
  b.connect(error, creds, { ...ortho, strokeStyle: 'dashed', label: 'retry', fromPort: 'left', toPort: 'left' });
  b.connect(mfa, code, { ...ortho, label: 'Yes' });
  b.connect(mfa, session, { ...ortho, label: 'No' });
  b.connect(code, codeOk, ortho);
  b.connect(codeOk, session, { ...ortho, label: 'Yes' });
  b.connect(codeOk, error, { ...ortho, label: 'No' });
  b.connect(session, done, ortho);
  layoutFlow(b, [start, creds, valid, locked, lock, error, mfa, code, codeOk, session, done]);
  return b.build();
}

export function buildUserRegistration(): TemplateContent {
  const b = new DiagramBuilder();
  b.text(-40, -90, 'User registration flow', { fontSize: 28, fontWeight: 'bold' });
  const start = b.node('terminator', 0, 0, 'Start');
  const form = b.node('manual-input', 0, 0, 'Fill sign-up form');
  const valid = b.node('decision', 0, 0, 'Input valid?');
  const fix = b.node('process', 0, 0, 'Show field errors', { color: 'yellow' });
  const exists = b.node('decision', 0, 0, 'Email registered?', { width: 170, height: 110 });
  const login = b.node('process', 0, 0, 'Suggest signing in');
  const create = b.node('predefined-process', 0, 0, 'Create pending account');
  const send = b.node('process', 0, 0, 'Send verification email', { icon: 'mail', height: 90 });
  const clicked = b.node('decision', 0, 0, 'Link clicked in 24 h?', { width: 180, height: 110 });
  const expire = b.node('process', 0, 0, 'Expire token', red);
  const activate = b.node('process', 0, 0, 'Activate account', { color: 'green' });
  const welcome = b.node('document', 0, 0, 'Welcome email');
  const end = b.node('terminator', 0, 0, 'End', red);
  b.connect(start, form, ortho);
  b.connect(form, valid, ortho);
  b.connect(valid, fix, { ...ortho, label: 'No' });
  b.connect(fix, form, { ...ortho, strokeStyle: 'dashed', fromPort: 'right', toPort: 'right' });
  b.connect(valid, exists, { ...ortho, label: 'Yes' });
  b.connect(exists, login, { ...ortho, label: 'Yes' });
  b.connect(exists, create, { ...ortho, label: 'No' });
  b.connect(create, send, ortho);
  b.connect(send, clicked, ortho);
  b.connect(clicked, activate, { ...ortho, label: 'Yes' });
  b.connect(clicked, expire, { ...ortho, label: 'No' });
  b.connect(activate, welcome, ortho);
  b.connect(welcome, end, ortho);
  b.connect(expire, end, ortho);
  b.connect(login, end, ortho);
  layoutFlow(b, [start, form, valid, fix, exists, login, create, send, clicked, expire, activate, welcome, end]);
  return b.build();
}

export function buildUserFlow(): TemplateContent {
  const b = new DiagramBuilder();
  b.text(0, -90, 'User flow: first project', { fontSize: 28, fontWeight: 'bold' });
  const landing = b.node('browser', 0, 0, 'Landing page');
  const hasAccount = b.node('decision', 0, 0, 'Has account?');
  const signup = b.node('browser', 0, 0, 'Sign up');
  const signin = b.node('browser', 0, 0, 'Sign in');
  const onboarding = b.node('browser', 0, 0, 'Onboarding (3 steps)');
  const dashboard = b.node('browser', 0, 0, 'Dashboard', { color: 'blue' });
  const create = b.node('browser', 0, 0, 'New project modal');
  const invite = b.node('browser', 0, 0, 'Invite teammates');
  const project = b.node('browser', 0, 0, 'Project board', { color: 'green' });
  b.connect(landing, hasAccount, ortho);
  b.connect(hasAccount, signin, { ...ortho, label: 'Yes' });
  b.connect(hasAccount, signup, { ...ortho, label: 'No' });
  b.connect(signup, onboarding, ortho);
  b.connect(onboarding, dashboard, ortho);
  b.connect(signin, dashboard, ortho);
  b.connect(dashboard, create, { ...ortho, label: '“New project”' });
  b.connect(create, invite, ortho);
  b.connect(invite, project, { ...ortho, label: 'skip or send' });
  b.layout([landing, hasAccount, signup, signin, onboarding, dashboard, create, invite, project], 'hierarchical', { direction: 'LR', nodeSpacing: 50, rankSpacing: 70 }, { x: 0, y: 0 });
  return b.build();
}

export function buildDataFlow(): TemplateContent {
  const b = new DiagramBuilder();
  b.text(0, -100, 'Data flow diagram (level 1)', { fontSize: 28, fontWeight: 'bold' });
  const customer = b.node('rectangle', 0, 170, 'Customer', { color: 'gray', roundness: 'sharp' });
  const bank = b.node('rectangle', 1080, 170, 'Bank', { color: 'gray', roundness: 'sharp' });
  const warehouse = b.node('rectangle', 1080, 460, 'Warehouse', { color: 'gray', roundness: 'sharp' });
  const p1 = b.node('circle', 300, 140, '1.0 Place order', { width: 130, height: 130, color: 'blue' });
  const p2 = b.node('circle', 700, 140, '2.0 Process payment', { width: 130, height: 130, color: 'blue' });
  const p3 = b.node('circle', 700, 430, '3.0 Fulfil order', { width: 130, height: 130, color: 'blue' });
  const d1 = b.node('data-store', 280, 440, 'D1 Orders');
  const d2 = b.node('data-store', 660, -60, 'D2 Payments');
  const flow = (from: NodeElement, to: NodeElement, label: string, fromPort?: string, toPort?: string) =>
    b.connect(from, to, { routing: 'curved', label, ...(fromPort ? { fromPort } : {}), ...(toPort ? { toPort } : {}) });
  flow(customer, p1, 'order details');
  flow(p1, d1, 'new order');
  flow(p1, p2, 'payment request');
  flow(p2, bank, 'charge');
  flow(bank, p2, 'confirmation', 'bottom', 'bottom');
  flow(p2, d2, 'receipt');
  flow(p2, p3, 'paid order');
  flow(d1, p3, 'order lines');
  flow(p3, warehouse, 'pick list');
  flow(p3, customer, 'shipping notice', 'bottom', 'bottom');
  return b.build();
}

export function buildDatabaseErd(): TemplateContent {
  const b = new DiagramBuilder();
  b.text(0, -90, 'E-commerce database', { fontSize: 28, fontWeight: 'bold' });
  const users = b.add(
    createErTable(
      'users',
      [
        { name: 'id', dataType: 'uuid', primaryKey: true },
        { name: 'email', dataType: 'varchar(255)', unique: true, nullable: false },
        { name: 'full_name', dataType: 'text' },
        { name: 'created_at', dataType: 'timestamptz', nullable: false },
      ],
      { x: 0, y: 40, headerColor: '#e7f5ff' },
    ),
  );
  const orders = b.add(
    createErTable(
      'orders',
      [
        { name: 'id', dataType: 'uuid', primaryKey: true },
        { name: 'user_id', dataType: 'uuid', foreignKey: true, nullable: false, references: 'users.id' },
        { name: 'status', dataType: 'order_status', nullable: false },
        { name: 'total_cents', dataType: 'bigint', nullable: false },
        { name: 'placed_at', dataType: 'timestamptz' },
      ],
      { x: 380, y: 0, headerColor: '#fff4e6' },
    ),
  );
  const items = b.add(
    createErTable(
      'order_items',
      [
        { name: 'id', dataType: 'uuid', primaryKey: true },
        { name: 'order_id', dataType: 'uuid', foreignKey: true, nullable: false, references: 'orders.id' },
        { name: 'product_id', dataType: 'uuid', foreignKey: true, nullable: false, references: 'products.id' },
        { name: 'quantity', dataType: 'integer', nullable: false },
        { name: 'unit_price_cents', dataType: 'bigint', nullable: false },
      ],
      { x: 780, y: 40, headerColor: '#ebfbee' },
    ),
  );
  const products = b.add(
    createErTable(
      'products',
      [
        { name: 'id', dataType: 'uuid', primaryKey: true },
        { name: 'sku', dataType: 'varchar(64)', unique: true, nullable: false },
        { name: 'name', dataType: 'text', nullable: false },
        { name: 'price_cents', dataType: 'bigint', nullable: false },
        { name: 'category_id', dataType: 'uuid', foreignKey: true, references: 'categories.id' },
      ],
      { x: 1220, y: 0, headerColor: '#f3f0ff' },
    ),
  );
  const categories = b.add(
    createErTable(
      'categories',
      [
        { name: 'id', dataType: 'uuid', primaryKey: true },
        { name: 'name', dataType: 'text', nullable: false },
      ],
      { x: 1220, y: 330, headerColor: '#f8f9fa' },
    ),
  );
  const col = (t: TableElement, name: string) => t.columns.find((c) => c.name === name)!.id;
  b.add(createErRelationship(users, col(users, 'id'), orders, col(orders, 'user_id'), 'one-to-many'));
  b.add(createErRelationship(orders, col(orders, 'id'), items, col(items, 'order_id'), 'one-to-many'));
  b.add(createErRelationship(products, col(products, 'id'), items, col(items, 'product_id'), 'one-to-many'));
  b.add(createErRelationship(categories, col(categories, 'id'), products, col(products, 'category_id'), 'one-to-many'));
  return b.build();
}

export function buildUmlClassDiagram(): TemplateContent {
  const b = new DiagramBuilder();
  b.text(0, -90, 'UML class diagram: online store', { fontSize: 28, fontWeight: 'bold' });
  const user = b.add(createUmlClass('User', ['- id: UUID', '- email: string', '# passwordHash: string'], ['+ login(password: string): boolean', '+ logout(): void'], { stereotype: 'abstract', isAbstract: true, x: 260, y: 0 }));
  const customer = b.add(createUmlClass('Customer', ['- shippingAddress: Address'], ['+ placeOrder(cart: Cart): Order'], { x: 60, y: 260 }));
  const admin = b.add(createUmlClass('Admin', ['- permissions: string[]'], ['+ refund(order: Order): void'], { x: 460, y: 260 }));
  const order = b.add(createUmlClass('Order', ['- id: UUID', '- status: OrderStatus', '- placedAt: Date'], ['+ total(): Money', '+ cancel(): void'], { x: 60, y: 480 }));
  const item = b.add(createUmlClass('OrderItem', ['- quantity: int', '- unitPrice: Money'], ['+ subtotal(): Money'], { x: 60, y: 760 }));
  const product = b.add(createUmlClass('Product', ['- sku: string', '- name: string', '- price: Money'], [], { x: 460, y: 760 }));
  const pay = b.add(createUmlClass('PaymentMethod', [], ['+ charge(amount: Money): Receipt'], { stereotype: 'interface', x: 520, y: 500 }));
  const card = b.add(createUmlClass('CreditCard', ['- last4: string'], ['+ charge(amount: Money): Receipt'], { x: 920, y: 380 }));
  const paypal = b.add(createUmlClass('PayPal', ['- account: string'], ['+ charge(amount: Money): Receipt'], { x: 920, y: 620 }));
  b.add(createUmlRelation(customer, user, 'inheritance', { fromPort: 'top', toPort: 'bottom' }));
  b.add(createUmlRelation(admin, user, 'inheritance', { fromPort: 'top', toPort: 'bottom' }));
  b.add(createUmlRelation(customer, order, 'association', { label: '1 places *', fromPort: 'bottom', toPort: 'top' }));
  b.add(createUmlRelation(order, item, 'composition', { label: '1..*', fromPort: 'bottom', toPort: 'top' }));
  b.add(createUmlRelation(item, product, 'association', { fromPort: 'right', toPort: 'left' }));
  b.add(createUmlRelation(order, pay, 'dependency', { label: 'pays with', fromPort: 'right', toPort: 'left' }));
  b.add(createUmlRelation(card, pay, 'realization', { fromPort: 'left', toPort: 'right' }));
  b.add(createUmlRelation(paypal, pay, 'realization', { fromPort: 'left', toPort: 'right' }));
  return b.build();
}

export function buildStateMachine(): TemplateContent {
  const b = new DiagramBuilder();
  b.text(0, -120, 'Order state machine', { fontSize: 28, fontWeight: 'bold' });
  const t = { routing: 'orthogonal' as const, edgeKind: 'transition' as const };
  const init = b.node('initial-state', 0, 25, null);
  const created = b.node('state', 90, 0, 'Created');
  const paid = b.node('state', 340, 0, 'Paid', { color: 'green' });
  const shipped = b.node('state', 590, 0, 'Shipped');
  const delivered = b.node('state', 840, 0, 'Delivered', { color: 'green' });
  const cancelled = b.node('state', 90, 220, 'Cancelled', red);
  const refunded = b.node('state', 590, 220, 'Refunded', { color: 'yellow' });
  const final = b.node('final-state', 1080, 18, null);
  const final2 = b.node('final-state', 348 - 17 + 75, 238, null);
  b.connect(init, created, t);
  b.connect(created, paid, { ...t, label: 'pay' });
  b.connect(paid, shipped, { ...t, label: 'ship' });
  b.connect(shipped, delivered, { ...t, label: 'deliver' });
  b.connect(delivered, final, t);
  b.connect(created, cancelled, { ...t, label: 'cancel / timeout', fromPort: 'bottom', toPort: 'top' });
  b.connect(paid, refunded, { ...t, label: 'refund', fromPort: 'bottom', toPort: 'top' });
  b.connect(delivered, refunded, { ...t, label: 'return', fromPort: 'bottom', toPort: 'right' });
  b.connect(cancelled, final2, t);
  b.connect(refunded, final2, t);
  return b.build();
}

export function buildActivityDiagram(): TemplateContent {
  const b = new DiagramBuilder();
  b.text(0, -90, 'Activity diagram: order fulfilment', { fontSize: 28, fontWeight: 'bold' });
  const laneW = 300;
  ['Customer', 'Order system', 'Warehouse'].forEach((name, i) =>
    b.node('swimlane', i * laneW, 0, name, { width: laneW, height: 900, color: (['blue', 'violet', 'orange'] as const)[i] }),
  );
  const cx = (lane: number) => lane * laneW + laneW / 2;
  const init = b.nodeAt('initial-state', cx(0), 80, null);
  const place = b.nodeAt('state', cx(0), 170, 'Place order');
  const validate = b.nodeAt('state', cx(1), 170, 'Validate order');
  const stock = b.nodeAt('decision', cx(1), 300, 'In stock?');
  const notify = b.nodeAt('state', cx(0), 300, 'Notify back-order', red);
  const fork = b.nodeAt('fork-join', cx(1) + laneW / 2, 420, null, { width: (laneW / 0.6) });
  const charge = b.nodeAt('state', cx(1), 520, 'Charge card');
  const pick = b.nodeAt('state', cx(2), 520, 'Pick & pack');
  const join = b.nodeAt('fork-join', cx(1) + laneW / 2, 630, null, { width: (laneW / 0.6) });
  const ship = b.nodeAt('state', cx(2), 730, 'Ship parcel');
  const receive = b.nodeAt('state', cx(0), 730, 'Receive parcel', { color: 'green' });
  const end = b.nodeAt('final-state', cx(0), 840, null);
  const endBackorder = b.nodeAt('final-state', cx(0), 400, null);
  const t = { routing: 'orthogonal' as const, edgeKind: 'flow' as const };
  b.connect(init, place, t);
  b.connect(place, validate, t);
  b.connect(validate, stock, t);
  b.connect(stock, notify, { ...t, label: 'no' });
  b.connect(notify, endBackorder, t);
  b.connect(stock, fork, { ...t, label: 'yes', fromPort: 'bottom', toPort: 'top-1' });
  b.connect(fork, charge, { ...t, fromPort: 'bottom-1', toPort: 'top' });
  b.connect(fork, pick, { ...t, fromPort: 'bottom-3', toPort: 'top' });
  b.connect(charge, join, { ...t, fromPort: 'bottom', toPort: 'top-1' });
  b.connect(pick, join, { ...t, fromPort: 'bottom', toPort: 'top-3' });
  b.connect(join, ship, { ...t, fromPort: 'bottom-3', toPort: 'top' });
  b.connect(ship, receive, t);
  b.connect(receive, end, t);
  return b.build();
}

export function buildUseCaseDiagram(): TemplateContent {
  const b = new DiagramBuilder();
  b.text(0, -90, 'Use case diagram: online store', { fontSize: 28, fontWeight: 'bold' });
  const customer = b.node('actor', 0, 160, 'Customer');
  const admin = b.node('actor', 0, 520, 'Admin');
  const psp = b.node('actor', 820, 300, 'Payment gateway');
  b.node('system-boundary', 180, 0, 'Online store', { width: 540, height: 640 });
  const uc = (y: number, x: number, name: string) => b.node('use-case', x, y, name, { width: 190, height: 80 });
  const browse = uc(60, 230, 'Browse catalog');
  const cart = uc(170, 230, 'Add to cart');
  const checkout = uc(280, 230, 'Checkout');
  const pay = uc(280, 480, 'Make payment');
  const track = uc(390, 230, 'Track order');
  const inventory = uc(470, 230, 'Manage inventory');
  const reports = uc(560, 480, 'View sales reports');
  const login = uc(130, 480, 'Sign in');
  const assoc = { routing: 'straight' as const, endArrowhead: 'none' as const, edgeKind: 'association' as const, fromPort: null, toPort: null };
  const include = { routing: 'straight' as const, strokeStyle: 'dashed' as const, endArrowhead: 'arrow' as const, edgeKind: 'dependency' as const, label: '«include»', fromPort: null, toPort: null };
  for (const u of [browse, cart, checkout, track]) b.connect(customer, u, assoc);
  for (const u of [inventory, reports]) b.connect(admin, u, assoc);
  b.connect(psp, pay, assoc);
  b.connect(checkout, pay, include);
  b.connect(checkout, login, include);
  return b.build();
}
