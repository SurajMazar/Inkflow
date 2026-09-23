import type { NodeElement } from '@inkflow/elements';
import type { TemplateContent } from '../types';
import { DiagramBuilder, PALETTE, type PaletteColor } from './builder';

export function buildOrgChart(): TemplateContent {
  const b = new DiagramBuilder();
  b.text(0, -90, 'Organization chart', { fontSize: 28, fontWeight: 'bold' });
  const person = (name: string, title: string, color: PaletteColor) =>
    b.node('org-card', 0, 0, name, {
      metadata: { subtitle: title },
      strokeColor: PALETTE[color].stroke,
      backgroundColor: '#ffffff',
      width: 210,
      height: 70,
    });
  const ceo = person('Alex Morgan', 'Chief Executive Officer', 'violet');
  const cto = person('Priya Shah', 'Chief Technology Officer', 'blue');
  const cfo = person('Daniel Kim', 'Chief Financial Officer', 'green');
  const coo = person('Maria Lopez', 'Chief Operating Officer', 'orange');
  const eng = person('Sam Carter', 'Engineering Manager', 'blue');
  const design = person('Lena Fischer', 'Head of Design', 'blue');
  const fe = person('Tom Nguyen', 'Frontend Lead', 'blue');
  const be = person('Aisha Bello', 'Backend Lead', 'blue');
  const fin = person('Omar Haddad', 'Finance Manager', 'green');
  const ops = person('Grace Liu', 'Operations Manager', 'orange');
  const support = person('Noah Evans', 'Support Lead', 'orange');
  const tree = {
    routing: 'orthogonal' as const,
    endArrowhead: 'none' as const,
    startArrowhead: 'none' as const,
  };
  const edges: [NodeElement, NodeElement][] = [
    [ceo, cto],
    [ceo, cfo],
    [ceo, coo],
    [cto, eng],
    [cto, design],
    [eng, fe],
    [eng, be],
    [cfo, fin],
    [coo, ops],
    [coo, support],
  ];
  for (const [p, c] of edges) b.connect(p, c, { ...tree, fromPort: 'bottom', toPort: 'top' });
  b.layout(
    [ceo, cto, cfo, coo, eng, design, fe, be, fin, ops, support],
    'tree',
    { direction: 'TB', nodeSpacing: 30, rankSpacing: 70 },
    { x: 0, y: 0 },
  );
  return b.build();
}

export function buildMindMap(): TemplateContent {
  const b = new DiagramBuilder();
  const topic = (label: string, color: PaletteColor, size: 'root' | 'branch' | 'leaf') =>
    b.node('mind-map-topic', 0, 0, label, {
      backgroundColor: size === 'leaf' ? '#ffffff' : PALETTE[color].bg,
      strokeColor: PALETTE[color].stroke,
      strokeWidth: size === 'root' ? 3 : 2,
      width: size === 'root' ? 200 : size === 'branch' ? 160 : 140,
      height: size === 'root' ? 70 : size === 'branch' ? 50 : 40,
    });
  const root = topic('Product launch', 'violet', 'root');
  const branches: [string, PaletteColor, string[]][] = [
    ['Marketing', 'orange', ['Social campaign', 'Email sequence', 'Launch blog post']],
    ['Engineering', 'blue', ['Feature freeze', 'QA & bug bash', 'Scale infrastructure']],
    ['Sales', 'green', ['Pricing tiers', 'Partner deals']],
    ['Support', 'teal', ['Help center docs', 'Team training', 'Status page']],
  ];
  const nodes: NodeElement[] = [root];
  for (const [name, color, leaves] of branches) {
    const branch = topic(name, color, 'branch');
    nodes.push(branch);
    b.connect(root, branch, {
      routing: 'bezier',
      endArrowhead: 'none',
      strokeColor: PALETTE[color].stroke,
      strokeWidth: 2.5,
      fromPort: null,
      toPort: null,
    });
    for (const leaf of leaves) {
      const l = topic(leaf, color, 'leaf');
      nodes.push(l);
      b.connect(branch, l, {
        routing: 'bezier',
        endArrowhead: 'none',
        strokeColor: PALETTE[color].stroke,
        strokeWidth: 1.5,
      });
    }
  }
  b.layout(
    nodes,
    'tree',
    { direction: 'LR', mindMap: true, nodeSpacing: 18, rankSpacing: 70 },
    { x: 0, y: 0 },
  );
  return b.build();
}

function boardColumn(
  b: DiagramBuilder,
  x: number,
  title: string,
  cards: string[],
  color: string,
  width = 260,
) {
  const stickies = cards.map((text, i) =>
    b.node('sticky', x + 20, 40 + i * 130, text, {
      width: width - 40,
      height: 110,
      backgroundColor: color,
      strokeColor: '#d9a300',
    }),
  );
  const height = Math.max(420, 60 + cards.length * 130);
  const frame = b.frameRect(title, x, 0, width, height);
  b.adopt(frame, stickies);
  return frame;
}

export function buildKanban(): TemplateContent {
  const b = new DiagramBuilder();
  b.text(0, -90, 'Sprint board', { fontSize: 28, fontWeight: 'bold' });
  const columns: [string, string[], string][] = [
    [
      'Backlog',
      ['Dark mode', 'Export to PDF', 'SSO with Okta', 'Keyboard shortcuts help'],
      '#f1f3f5',
    ],
    ['To do', ['Onboarding checklist', 'Rate-limit public API'], '#ffec99'],
    ['In progress', ['Realtime cursors', 'Billing webhooks'], '#a5d8ff'],
    ['Review', ['Template gallery'], '#d0bfff'],
    ['Done', ['Invite by link', 'Image uploads', 'Undo / redo'], '#b2f2bb'],
  ];
  columns.forEach(([title, cards, color], i) => boardColumn(b, i * 300, title, cards, color));
  return b.build();
}

export function buildRetrospective(): TemplateContent {
  const b = new DiagramBuilder();
  b.text(0, -110, 'Sprint 24 retrospective', { fontSize: 28, fontWeight: 'bold' });
  b.text(0, -64, 'Add a sticky per idea, then dot-vote the top three action items.', {
    fontSize: 16,
    color: '#868e96',
  });
  boardColumn(
    b,
    0,
    'What went well',
    [
      'Shipped realtime collaboration on time',
      'Great pairing on the routing engine',
      'Zero incidents',
    ],
    '#b2f2bb',
    320,
  );
  boardColumn(
    b,
    360,
    'What could be improved',
    ['Flaky end-to-end tests', 'Too many meetings mid-sprint', 'Late design hand-off'],
    '#ffc9c9',
    320,
  );
  boardColumn(
    b,
    720,
    'Action items',
    ['Quarantine flaky tests (Sam)', 'No-meeting Wednesdays', 'Design review at sprint start'],
    '#a5d8ff',
    320,
  );
  return b.build();
}
