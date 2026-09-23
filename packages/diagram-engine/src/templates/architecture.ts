import { createSequenceDiagram } from '../builders';
import { sequenceOps } from '../sequence-ops';
import type { TemplateContent } from '../types';
import { DiagramBuilder, PALETTE } from './builder';

const card = { width: 170, height: 90 };
const ortho = { routing: 'orthogonal' as const };
const dashed = { routing: 'orthogonal' as const, strokeStyle: 'dashed' as const };

export function buildMicroservices(): TemplateContent {
  const b = new DiagramBuilder();
  b.text(0, -110, 'Microservice architecture', { fontSize: 28, fontWeight: 'bold' });
  const web = b.node('browser', 0, 40, 'Web app');
  const mobile = b.node('mobile', 45, 230, 'Mobile app');
  const gateway = b.node('api-gateway', 300, 180, 'API gateway');
  const auth = b.node('rounded-rectangle', 305, 20, 'Auth service', { ...card, icon: 'lock', color: 'yellow' });
  const users = b.node('hexagon', 600, 0, 'Users service', { ...card, icon: 'user', color: 'violet' });
  const orders = b.node('hexagon', 600, 160, 'Orders service', { ...card, icon: 'cart', color: 'violet' });
  const payments = b.node('hexagon', 600, 320, 'Payments service', { ...card, icon: 'credit-card', color: 'violet' });
  const usersDb = b.node('database', 880, -10, 'users-db');
  const ordersDb = b.node('database', 880, 150, 'orders-db');
  const paymentsDb = b.node('database', 880, 310, 'payments-db');
  const bus = b.node('queue', 590, 520, 'Event bus (Kafka)', { width: 200, height: 70 });
  const notify = b.node('hexagon', 880, 510, 'Notifications', { ...card, icon: 'bell', color: 'orange' });
  const email = b.node('rounded-rectangle', 1130, 510, 'Email provider', { ...card, icon: 'mail', color: 'gray' });
  b.connect(web, gateway, { ...ortho, label: 'HTTPS' });
  b.connect(mobile, gateway, { ...ortho, label: 'HTTPS' });
  b.connect(gateway, auth, { ...dashed, label: 'verify JWT', fromPort: 'top', toPort: 'bottom' });
  b.connect(gateway, users, ortho);
  b.connect(gateway, orders, ortho);
  b.connect(gateway, payments, ortho);
  b.connect(users, usersDb, ortho);
  b.connect(orders, ordersDb, ortho);
  b.connect(payments, paymentsDb, ortho);
  b.connect(orders, bus, { ...dashed, label: 'OrderPlaced', fromPort: 'bottom', toPort: 'top' });
  b.connect(payments, bus, { ...dashed, fromPort: 'bottom', toPort: 'top' });
  b.connect(bus, notify, { ...dashed, label: 'subscribe' });
  b.connect(notify, email, ortho);
  b.frame('Backend (Kubernetes)', [gateway, auth, users, orders, payments, usersDb, ordersDb, paymentsDb, bus, notify], 40);
  return b.build();
}

export function buildRestApi(): TemplateContent {
  const b = new DiagramBuilder();
  b.text(0, -100, 'REST API request lifecycle', { fontSize: 28, fontWeight: 'bold' });
  const client = b.node('browser', 0, 150, 'Client');
  const gw = b.node('api-gateway', 250, 170, 'API gateway /v1');
  const rate = b.node('rounded-rectangle', 500, 0, 'Rate limiter', { ...card, icon: 'filter', color: 'gray' });
  const auth = b.node('rounded-rectangle', 500, 160, 'Auth middleware', { ...card, icon: 'key', color: 'yellow' });
  const validate = b.node('rounded-rectangle', 500, 320, 'Validation', { ...card, icon: 'check', color: 'green' });
  const r1 = b.node('rounded-rectangle', 760, 0, 'GET /users/:id', { ...card, color: 'blue', width: 190 });
  const r2 = b.node('rounded-rectangle', 760, 160, 'POST /orders', { ...card, color: 'blue', width: 190 });
  const r3 = b.node('rounded-rectangle', 760, 320, 'DELETE /orders/:id', { ...card, color: 'blue', width: 190 });
  const svc = b.node('predefined-process', 1030, 165, 'Service layer');
  const db = b.node('database', 1290, 145, 'Database');
  const cache = b.node('cache', 1290, -60, 'Response cache');
  b.connect(client, gw, { ...ortho, label: 'HTTP request' });
  b.connect(gw, rate, { ...ortho, fromPort: 'top', toPort: 'left' });
  b.connect(rate, auth, { ...ortho, fromPort: 'bottom', toPort: 'top' });
  b.connect(auth, validate, { ...ortho, fromPort: 'bottom', toPort: 'top' });
  b.connect(validate, r1, { ...ortho, fromPort: 'right', toPort: 'left' });
  b.connect(validate, r2, { ...ortho, fromPort: 'right', toPort: 'left' });
  b.connect(validate, r3, { ...ortho, fromPort: 'right', toPort: 'left' });
  for (const r of [r1, r2, r3]) b.connect(r, svc, ortho);
  b.connect(svc, db, { ...ortho, label: 'SQL' });
  b.connect(svc, cache, { ...dashed, label: 'cache GET', fromPort: 'top', toPort: 'left' });
  b.text(500, 460, '401 / 403 / 422 errors short-circuit the pipeline', { fontSize: 14, color: '#868e96' });
  b.frame('API server', [rate, auth, validate, r1, r2, r3, svc], 36);
  return b.build();
}

export function buildOAuthSequence(): TemplateContent {
  const b = new DiagramBuilder();
  b.text(0, -70, 'OAuth 2.0 authorization code flow (with PKCE)', { fontSize: 28, fontWeight: 'bold' });
  let seq = createSequenceDiagram(
    [
      { name: 'User', kind: 'actor' },
      { name: 'Client app' },
      { name: 'Authorization server', kind: 'control' },
      { name: 'Resource server', kind: 'entity' },
    ],
    [
      { from: 0, to: 1, label: 'Click “Sign in”' },
      { from: 1, to: 2, label: 'GET /authorize?response_type=code&code_challenge' },
      { from: 2, to: 0, label: 'Login & consent page' },
      { from: 0, to: 2, label: 'Authenticate and approve', kind: 'return' },
      { from: 2, to: 1, label: '302 redirect_uri?code&state', kind: 'return' },
      { from: 1, to: 2, label: 'POST /token (code, code_verifier)' },
      { from: 2, to: 1, label: 'access_token, refresh_token', kind: 'return' },
      { from: 1, to: 3, label: 'GET /api/me (Bearer access_token)' },
      { from: 3, to: 3, label: 'Validate token & scopes', kind: 'async' },
      { from: 3, to: 1, label: '200 OK { profile }', kind: 'return' },
      { from: 1, to: 0, label: 'Show signed-in UI', kind: 'return' },
    ],
    { x: 0, y: 0, participantSpacing: 260, messageSpacing: 52 },
  );
  seq = sequenceOps.addNote(seq, [seq.participants[1]!.id], 'Verify the state parameter', 4);
  seq = sequenceOps.addNote(seq, [seq.participants[1]!.id, seq.participants[2]!.id], 'Tokens never pass through the browser URL', 6);
  b.add(seq);
  b.node('note', seq.width + 60, 40, 'Solid arrows: requests\nDashed arrows: responses\nBars: active processing', { width: 230, height: 100 });
  b.node('note', seq.width + 60, 170, 'PKCE: the client sends a hash of a random code_verifier with /authorize and proves possession at /token.', { width: 230, height: 130 });
  return b.build();
}

export function buildCiCd(): TemplateContent {
  const b = new DiagramBuilder();
  b.text(0, -120, 'CI/CD pipeline', { fontSize: 28, fontWeight: 'bold' });
  const dev = b.node('user', 0, 0, 'Developer');
  const repo = b.node('rounded-rectangle', 180, 10, 'Git repository', { ...card, icon: 'git-branch', color: 'orange' });
  const build = b.node('rounded-rectangle', 430, 10, 'Build', { ...card, icon: 'package', color: 'blue' });
  const test = b.node('rounded-rectangle', 650, 10, 'Unit tests', { ...card, icon: 'check', color: 'green' });
  const scan = b.node('rounded-rectangle', 870, 10, 'Lint & security scan', { ...card, icon: 'shield', color: 'red', width: 190 });
  const image = b.node('rounded-rectangle', 1110, 10, 'Build image', { ...card, icon: 'container', color: 'cyan' });
  const registry = b.node('database', 1120, 230, 'Container registry', { width: 150 });
  const staging = b.node('rounded-rectangle', 870, 240, 'Deploy to staging', { ...card, icon: 'upload', color: 'violet', width: 190 });
  const e2e = b.node('rounded-rectangle', 650, 240, 'Integration tests', { ...card, icon: 'terminal', color: 'green' });
  const approve = b.node('decision', 420, 235, 'Approved?');
  const prod = b.node('rounded-rectangle', 180, 240, 'Deploy to production', { ...card, icon: 'cloud', color: 'violet', width: 190 });
  const monitor = b.node('rounded-rectangle', 180, 440, 'Monitoring & alerts', { ...card, icon: 'chart', color: 'grape', width: 190 });
  b.connect(dev, repo, { ...ortho, label: 'git push' });
  b.connect(repo, build, { ...ortho, label: 'webhook' });
  b.connect(build, test, ortho);
  b.connect(test, scan, ortho);
  b.connect(scan, image, ortho);
  b.connect(image, registry, { ...ortho, label: 'push' });
  b.connect(registry, staging, ortho);
  b.connect(staging, e2e, ortho);
  b.connect(e2e, approve, ortho);
  b.connect(approve, prod, { ...ortho, label: 'yes' });
  b.connect(approve, repo, { ...dashed, label: 'no: fix', fromPort: 'top', toPort: 'bottom' });
  b.connect(prod, monitor, ortho);
  b.frame('Continuous integration', [build, test, scan, image], 30);
  b.frame('Continuous delivery', [registry, staging, e2e, approve, prod], 30);
  return b.build();
}

export function buildCloudArchitecture(): TemplateContent {
  const b = new DiagramBuilder();
  b.text(0, -170, 'Cloud architecture (3-tier on a VPC)', { fontSize: 28, fontWeight: 'bold' });
  const users = b.node('user', 0, 290, 'Users');
  const cdn = b.node('cdn', 150, 110, 'CDN');
  const assets = b.node('storage-bucket', 175, -60, 'Static assets');
  const dns = b.node('rounded-rectangle', 150, 470, 'DNS', { ...card, icon: 'globe', color: 'teal' });
  const pub = b.node('container', 440, 30, 'Public subnet', { width: 240, height: 580, color: 'green' });
  const lb = b.node('load-balancer', 470, 285, 'Load balancer');
  const nat = b.node('router', 505, 460, 'NAT');
  const app = b.node('container', 720, 30, 'Private subnet — app', { width: 320, height: 580, color: 'blue' });
  const asg = b.node('container', 750, 90, 'Auto Scaling group', { width: 260, height: 490, color: 'gray', strokeStyle: 'dashed' });
  const servers = [0, 1, 2].map((i) => b.node('rounded-rectangle', 795, 150 + i * 140, `App server ${i + 1}`, { ...card, icon: 'server', color: 'blue' }));
  const data = b.node('container', 1080, 30, 'Private subnet — data', { width: 340, height: 580, color: 'violet' });
  const primary = b.node('database', 1110, 120, 'Primary DB');
  const replica = b.node('database', 1270, 120, 'Read replica');
  const cache = b.node('cache', 1190, 380, 'Redis cache');
  b.connect(users, dns, { ...dashed, label: 'resolve' });
  b.connect(users, cdn, { ...ortho, label: 'static' });
  b.connect(cdn, assets, { ...ortho, label: 'origin' });
  b.connect(users, lb, { ...ortho, label: 'HTTPS' });
  for (const s of servers) b.connect(lb, s, ortho);
  b.connect(asg, primary, { ...ortho, label: 'SQL' });
  b.connect(asg, cache, ortho);
  b.connect(primary, replica, { ...dashed, label: 'replication' });
  b.connect(asg, nat, { ...dashed, label: 'egress', fromPort: 'bottom', toPort: 'right' });
  b.frame('VPC 10.0.0.0/16', [pub, lb, nat, app, asg, ...servers, data, primary, replica, cache], 30);
  return b.build();
}

export function buildKubernetes(): TemplateContent {
  const b = new DiagramBuilder();
  b.text(-240, -130, 'Kubernetes deployment', { fontSize: 28, fontWeight: 'bold' });
  const user = b.node('user', -240, 250, 'Users');
  const ingress = b.node('api-gateway', 0, 265, 'Ingress (nginx)');
  const webSvc = b.node('rounded-rectangle', 250, 120, 'Service: web', { ...card, icon: 'network', color: 'teal' });
  const apiSvc = b.node('rounded-rectangle', 250, 400, 'Service: api', { ...card, icon: 'network', color: 'teal' });
  const node1 = b.node('container', 520, 0, 'Worker node 1', { width: 260, height: 300, color: 'gray' });
  const node2 = b.node('container', 520, 340, 'Worker node 2', { width: 260, height: 300, color: 'gray' });
  const pod = (x: number, y: number, name: string, color: 'blue' | 'violet') => b.node('rounded-rectangle', x, y, name, { ...card, width: 190, icon: 'kubernetes', color });
  const web1 = pod(555, 55, 'web-7d9f-abc', 'blue');
  const api1 = pod(555, 180, 'api-5c6b-x1', 'violet');
  const web2 = pod(555, 395, 'web-7d9f-def', 'blue');
  const api2 = pod(555, 520, 'api-5c6b-y2', 'violet');
  const pg = b.node('database', 880, 250, 'postgres-0 (StatefulSet)', { width: 150, height: 120 });
  const cfg = b.node('rounded-rectangle', 860, 470, 'ConfigMap & Secrets', { ...card, icon: 'key', color: 'yellow', width: 190 });
  const hpa = b.node('rounded-rectangle', 860, 40, 'HorizontalPodAutoscaler', { ...card, icon: 'chart', color: 'grape', width: 210 });
  b.connect(user, ingress, { ...ortho, label: 'HTTPS' });
  b.connect(ingress, webSvc, { ...ortho, label: '/' });
  b.connect(ingress, apiSvc, { ...ortho, label: '/api' });
  b.connect(webSvc, web1, ortho);
  b.connect(webSvc, web2, ortho);
  b.connect(apiSvc, api1, ortho);
  b.connect(apiSvc, api2, ortho);
  b.connect(api1, pg, ortho);
  b.connect(api2, pg, ortho);
  b.connect(cfg, api2, { ...dashed, label: 'mount' });
  b.connect(hpa, node1, { ...dashed, label: 'scales' });
  b.frame('Cluster: production', [ingress, webSvc, apiSvc, node1, node2, web1, api1, web2, api2, pg, cfg, hpa], 40);
  return b.build();
}

export function buildEventDriven(): TemplateContent {
  const b = new DiagramBuilder();
  b.text(0, -100, 'Event-driven architecture', { fontSize: 28, fontWeight: 'bold' });
  const producers = [
    b.node('hexagon', 0, 0, 'Order service', { ...card, icon: 'cart', color: 'violet' }),
    b.node('hexagon', 0, 150, 'Payment service', { ...card, icon: 'credit-card', color: 'violet' }),
    b.node('hexagon', 0, 300, 'Inventory service', { ...card, icon: 'package', color: 'violet' }),
  ];
  const topics = [
    b.node('queue', 330, 10, 'orders.v1', { width: 200, height: 70 }),
    b.node('queue', 330, 160, 'payments.v1', { width: 200, height: 70 }),
    b.node('queue', 330, 310, 'inventory.v1', { width: 200, height: 70 }),
  ];
  const consumers = [
    b.node('rounded-rectangle', 700, -40, 'Email notifier', { ...card, icon: 'mail', color: 'orange' }),
    b.node('rounded-rectangle', 700, 100, 'Shipping service', { ...card, icon: 'map-pin', color: 'orange' }),
    b.node('rounded-rectangle', 700, 240, 'Analytics', { ...card, icon: 'pie-chart', color: 'orange' }),
    b.node('rounded-rectangle', 700, 380, 'Search indexer', { ...card, icon: 'search', color: 'orange' }),
  ];
  const dlq = b.node('queue', 330, 470, 'dead-letter', { width: 200, height: 60, color: 'red' });
  producers.forEach((p, i) => b.connect(p, topics[i]!, { ...ortho, label: 'publish' }));
  b.connect(topics[0]!, consumers[0]!, ortho);
  b.connect(topics[0]!, consumers[1]!, ortho);
  b.connect(topics[1]!, consumers[0]!, ortho);
  b.connect(topics[1]!, consumers[2]!, ortho);
  b.connect(topics[2]!, consumers[2]!, ortho);
  b.connect(topics[2]!, consumers[3]!, ortho);
  b.connect(consumers[3]!, dlq, { ...dashed, label: 'on failure', fromPort: 'bottom', toPort: 'right' });
  b.frame('Producers', producers, 30);
  b.frame('Event broker', [...topics, dlq], 30);
  b.frame('Consumers', consumers, 30);
  return b.build();
}

export function buildFrontendBackend(): TemplateContent {
  const b = new DiagramBuilder();
  b.text(0, -230, 'Frontend / backend architecture', { fontSize: 28, fontWeight: 'bold' });
  const ui = b.node('browser', 0, 0, 'React SPA', { width: 190, height: 120 });
  const store = b.node('rounded-rectangle', 10, 190, 'State store', { ...card, icon: 'layers', color: 'blue' });
  const client = b.node('rounded-rectangle', 10, 340, 'API client', { ...card, icon: 'code', color: 'blue' });
  const cdn = b.node('cdn', 330, -120, 'CDN (static bundle)', { width: 200 });
  const api = b.node('rounded-rectangle', 420, 340, 'API server', { ...card, icon: 'api', color: 'violet' });
  const auth = b.node('rounded-rectangle', 700, 190, 'Auth', { ...card, icon: 'lock', color: 'yellow' });
  const logic = b.node('rounded-rectangle', 700, 340, 'Business logic', { ...card, icon: 'gear', color: 'violet' });
  const jobs = b.node('rounded-rectangle', 700, 490, 'Background jobs', { ...card, icon: 'worker', color: 'orange' });
  const db = b.node('database', 980, 330, 'PostgreSQL');
  const cache = b.node('cache', 980, 150, 'Redis');
  const files = b.node('storage-bucket', 980, 500, 'Uploads (S3)');
  b.connect(ui, store, { ...ortho, fromPort: 'bottom', toPort: 'top' });
  b.connect(store, client, { ...ortho, fromPort: 'bottom', toPort: 'top' });
  b.connect(cdn, ui, { ...dashed, label: 'serves', fromPort: 'left', toPort: 'top' });
  b.connect(client, api, { ...ortho, label: 'REST / JSON' });
  b.connect(api, auth, ortho);
  b.connect(api, logic, ortho);
  b.connect(logic, jobs, { ...ortho, fromPort: 'bottom', toPort: 'top' });
  b.connect(logic, db, ortho);
  b.connect(logic, cache, ortho);
  b.connect(jobs, files, ortho);
  b.frame('Frontend', [ui, store, client], 30);
  b.frame('Backend', [api, auth, logic, jobs, db, cache, files], 30);
  return b.build();
}

export function buildPaymentSystem(): TemplateContent {
  const b = new DiagramBuilder();
  b.text(0, -100, 'Payment system', { fontSize: 28, fontWeight: 'bold' });
  const customer = b.node('user', 0, 120, 'Customer');
  const checkout = b.node('browser', 170, 110, 'Checkout page');
  const paySvc = b.node('hexagon', 440, 120, 'Payment service', { ...card, icon: 'credit-card', color: 'violet', width: 190 });
  const fraud = b.node('rounded-rectangle', 445, -80, 'Fraud detection', { ...card, icon: 'shield', color: 'red', width: 180 });
  const psp = b.node('rounded-rectangle', 750, 120, 'Payment gateway (PSP)', { ...card, icon: 'globe', color: 'green', width: 210 });
  const bank = b.node('cloud', 1040, 105, 'Card networks & banks');
  const ledger = b.node('database', 480, 330, 'Ledger (double-entry)', { width: 150, height: 120 });
  const events = b.node('queue', 750, 350, 'payment.events', { width: 210, height: 70 });
  const orders = b.node('rounded-rectangle', 1040, 290, 'Order service', { ...card, icon: 'cart', color: 'violet' });
  const receipts = b.node('rounded-rectangle', 1040, 430, 'Receipts & email', { ...card, icon: 'mail', color: 'orange' });
  const recon = b.node('rounded-rectangle', 750, 540, 'Reconciliation job', { ...card, icon: 'refresh', color: 'gray', width: 210 });
  b.connect(customer, checkout, ortho);
  b.connect(checkout, paySvc, { ...ortho, label: 'tokenized card' });
  b.connect(paySvc, fraud, { ...ortho, label: 'risk score', fromPort: 'top', toPort: 'bottom' });
  b.connect(paySvc, psp, { ...ortho, label: 'authorize' });
  b.connect(psp, bank, ortho);
  b.connect(paySvc, ledger, { ...ortho, label: 'record', fromPort: 'bottom', toPort: 'top' });
  b.connect(paySvc, events, { ...dashed, label: 'PaymentCaptured', fromPort: 'right', toPort: 'left' });
  b.connect(events, orders, dashed);
  b.connect(events, receipts, dashed);
  b.connect(recon, ledger, { ...dashed, label: 'daily settlement' });
  b.connect(psp, recon, { ...dashed, fromPort: 'bottom', toPort: 'right' });
  b.frame('PCI scope', [paySvc, fraud, psp, ledger], 30, { strokeColor: PALETTE.red.stroke });
  return b.build();
}

export function buildNetworkDiagram(): TemplateContent {
  const b = new DiagramBuilder();
  b.text(0, -230, 'Office network', { fontSize: 28, fontWeight: 'bold' });
  const internet = b.node('cloud', 0, 180, 'Internet');
  const router = b.node('router', 250, 180, 'Edge router');
  const fw = b.node('firewall', 440, 185, 'Firewall');
  const core = b.node('rounded-rectangle', 660, 200, 'Core switch', { ...card, icon: 'network', color: 'green' });
  const web = b.node('server', 660, -230, 'Web server');
  const mail = b.node('server', 820, -230, 'Mail server');
  const access = b.node('rounded-rectangle', 930, 200, 'Access switch', { ...card, icon: 'network', color: 'green' });
  const ws = [0, 1, 2].map((i) => b.node('rounded-rectangle', 1200, 40 + i * 130, `Workstation ${i + 1}`, { ...card, icon: 'laptop', color: 'gray' }));
  const printer = b.node('rounded-rectangle', 930, 420, 'Printer', { ...card, icon: 'printer', color: 'gray' });
  const nas = b.node('rounded-rectangle', 660, 420, 'File server (NAS)', { ...card, icon: 'hard-drive', color: 'blue', width: 180 });
  const ap = b.node('rounded-rectangle', 1200, 460, 'Wi-Fi access point', { ...card, icon: 'wifi', color: 'teal', width: 180 });
  const phone = b.node('mobile', 1460, 440, 'Phone');
  b.connect(internet, router, ortho);
  b.connect(router, fw, ortho);
  b.connect(fw, core, ortho);
  b.connect(core, web, { ...ortho, fromPort: 'top', toPort: 'bottom' });
  b.connect(core, mail, { ...ortho, fromPort: 'top', toPort: 'bottom' });
  b.connect(core, access, { ...ortho, label: '10 GbE' });
  for (const w of ws) b.connect(access, w, ortho);
  b.connect(access, printer, { ...ortho, fromPort: 'bottom', toPort: 'top' });
  b.connect(core, nas, { ...ortho, fromPort: 'bottom', toPort: 'top' });
  b.connect(access, ap, ortho);
  b.connect(ap, phone, { routing: 'straight', strokeStyle: 'dotted', label: '802.11ax' });
  b.frame('DMZ', [web, mail], 30);
  b.frame('Office LAN (192.168.1.0/24)', [core, access, ...ws, printer, nas, ap, phone], 30);
  return b.build();
}

export function buildComponentDiagram(): TemplateContent {
  const b = new DiagramBuilder();
  b.text(0, -100, 'Component diagram', { fontSize: 28, fontWeight: 'bold' });
  const webUi = b.node('component', 0, 150, 'Web UI');
  b.node('package', 260, 0, 'backend', { width: 600, height: 420 });
  const api = b.node('component', 300, 150, 'API');
  const authC = b.node('component', 560, 50, 'Auth');
  const billing = b.node('component', 560, 170, 'Billing');
  const notify = b.node('component', 560, 290, 'Notifications');
  const db = b.node('database', 960, 150, 'Database');
  const ext = b.node('cloud', 930, 330, 'Stripe API');
  const dep = { routing: 'orthogonal' as const, strokeStyle: 'dashed' as const, edgeKind: 'dependency' as const, endArrowhead: 'arrow' as const };
  b.connect(webUi, api, { ...dep, label: '«use» REST' });
  b.connect(api, authC, dep);
  b.connect(api, billing, dep);
  b.connect(api, notify, dep);
  b.connect(billing, db, dep);
  b.connect(authC, db, dep);
  b.connect(billing, ext, { ...dep, label: '«use»' });
  b.text(300, 440, 'Dashed arrows: dependencies («use»)', { fontSize: 14, color: '#868e96' });
  return b.build();
}
