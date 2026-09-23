import { describe, expect, it } from 'vitest';
import {
  validateElement,
  type ConnectorElement,
  type FrameElement,
  type NodeElement,
  type SceneElement,
  type SequenceElement,
  type TableElement,
  type UmlClassElement,
} from '@inkflow/elements';
import { CURRENT_DOCUMENT_VERSION, parseDocument } from '@inkflow/scene';
import { cleanLabel, formatMember, importMermaid, mermaidLines } from '../src';

function expectValid(elements: SceneElement[]) {
  for (const el of elements) {
    const r = validateElement(el);
    expect(r.success, r.success ? '' : r.error).toBe(true);
  }
  const parsed = parseDocument({ type: 'inkflow', version: CURRENT_DOCUMENT_VERSION, elements, appState: {}, files: {} });
  expect(parsed.issues).toEqual([]);
  for (const el of elements) {
    if (el.type !== 'connector') continue;
    for (const b of [el.startBinding, el.endBinding]) {
      expect(b).not.toBeNull();
      expect(elements.some((e) => e.id === b!.elementId)).toBe(true);
    }
  }
}

const nodesOf = (els: SceneElement[]) => els.filter((e): e is NodeElement => e.type === 'node');
const byLabel = (els: SceneElement[], text: string) => nodesOf(els).find((n) => n.label?.text === text)!;
const connectors = (els: SceneElement[]) => els.filter((e): e is ConnectorElement => e.type === 'connector');

describe('mermaid flowchart', () => {
  const src = `%% sample
flowchart LR
  A([Start]) --> B[Read input]
  B --> C{Valid?}
  C -->|Yes| D[(Database)]
  C -- No --> E[/Show error/]
  E -.-> B
  D ==> F((Done)) & G[[Audit]]
  H>Flag] --- A
  I{{Prep}} ~~~ A
  subgraph backend [Backend services]
    direction TB
    D
    G
  end
  classDef hot fill:#ffc9c9,stroke:#e03131
  class E hot
  style F fill:#b2f2bb
  click A "javascript:alert(1)"
`;
  it('parses nodes, shapes, edges, labels and styles', () => {
    const { elements, issues } = importMermaid(src);
    expectValid(elements);
    expect(byLabel(elements, 'Start').shape).toBe('terminator');
    expect(byLabel(elements, 'Read input').shape).toBe('process');
    expect(byLabel(elements, 'Valid?').shape).toBe('decision');
    expect(byLabel(elements, 'Database').shape).toBe('database');
    expect(byLabel(elements, 'Show error').shape).toBe('parallelogram');
    expect(byLabel(elements, 'Done').shape).toBe('circle');
    expect(byLabel(elements, 'Audit').shape).toBe('predefined-process');
    expect(byLabel(elements, 'Flag').shape).toBe('flag');
    expect(byLabel(elements, 'Prep').shape).toBe('hexagon');
    expect(byLabel(elements, 'Show error').backgroundColor).toBe('#ffc9c9');
    expect(byLabel(elements, 'Done').backgroundColor).toBe('#b2f2bb');
    const conns = connectors(elements);
    // 8 visible edges (the ~~~ link only influences layout).
    expect(conns.length).toBe(8);
    const labels = conns.map((c) => c.label?.text).filter(Boolean);
    expect(labels).toEqual(expect.arrayContaining(['Yes', 'No']));
    const dotted = conns.find((c) => c.strokeStyle === 'dashed')!;
    expect(dotted.startBinding!.elementId).toBe(byLabel(elements, 'Show error').id);
    expect(conns.filter((c) => c.strokeWidth === 3).length).toBe(2);
    const open = conns.find((c) => c.startBinding!.elementId === byLabel(elements, 'Flag').id)!;
    expect(open.endArrowhead).toBe('none');
    expect(issues.some((i) => i.includes('click'))).toBe(true);
    // Nothing from the click handler leaks into the elements.
    expect(JSON.stringify(elements)).not.toContain('javascript');
  });

  it('lays out left-to-right and turns subgraphs into frames', () => {
    const { elements } = importMermaid(src);
    const start = byLabel(elements, 'Start');
    const input = byLabel(elements, 'Read input');
    expect(input.x).toBeGreaterThan(start.x + start.width);
    const frame = elements.find((e): e is FrameElement => e.type === 'frame')!;
    expect(frame.name).toBe('Backend services');
    const db = byLabel(elements, 'Database');
    expect(db.frameId).toBe(frame.id);
    expect(db.x).toBeGreaterThanOrEqual(frame.x);
    expect(db.x + db.width).toBeLessThanOrEqual(frame.x + frame.width);
    const outside = byLabel(elements, 'Start');
    const inside = outside.x >= frame.x && outside.x <= frame.x + frame.width && outside.y >= frame.y && outside.y <= frame.y + frame.height;
    expect(inside).toBe(false);
  });

  it('supports graph TD, chains, & groups and nested subgraphs', () => {
    const { elements, issues } = importMermaid(`graph TD
      a --> b --> c
      a & b --> d
      subgraph outer
        subgraph inner
          x --> y
        end
        z
      end
      c --> x`);
    expect(issues).toEqual([]);
    expectValid(elements);
    expect(connectors(elements).length).toBe(6);
    const frames = elements.filter((e): e is FrameElement => e.type === 'frame');
    expect(frames.map((f) => f.name).sort()).toEqual(['inner', 'outer']);
    const outer = frames.find((f) => f.name === 'outer')!;
    const inner = frames.find((f) => f.name === 'inner')!;
    expect(inner.x).toBeGreaterThan(outer.x);
    expect(inner.y).toBeGreaterThan(outer.y);
    expect(inner.x + inner.width).toBeLessThan(outer.x + outer.width);
    const a = byLabel(elements, 'a');
    const c = byLabel(elements, 'c');
    expect(c.y).toBeGreaterThan(a.y);
    expect(byLabel(elements, 'x').frameId).toBe(inner.id);
    expect(byLabel(elements, 'z').frameId).toBe(outer.id);
  });

  it('reports unparseable lines instead of throwing', () => {
    const { elements, issues } = importMermaid('flowchart TB\n  A --> \n  B[ok]');
    expect(nodesOf(elements).map((n) => n.label?.text).sort()).toEqual(['A', 'ok']);
    expect(issues.length).toBe(1);
  });
});

describe('mermaid sequence', () => {
  it('parses participants, messages, activations and notes', () => {
    const { elements, issues } = importMermaid(`sequenceDiagram
      title Checkout
      autonumber
      actor U as User
      participant W as Web app
      participant A as API
      U->>W: Click pay
      W->>+A: POST /pay
      Note over W,A: TLS
      A-->>-W: 200
      W--)U: Receipt email
      loop Every minute
        W->>A: poll
      end
      Note right of U: happy`);
    expectValid(elements);
    const seq = elements.find((e): e is SequenceElement => e.type === 'sequence')!;
    expect(seq.participants.map((p) => [p.name, p.kind])).toEqual([
      ['User', 'actor'],
      ['Web app', 'participant'],
      ['API', 'participant'],
    ]);
    expect(seq.messages.map((m) => m.kind)).toEqual(['sync', 'sync', 'return', 'async', 'sync']);
    expect(seq.messages[0]!.label).toBe('1. Click pay');
    expect(seq.notes.length).toBe(3);
    expect(seq.notes[0]!.afterMessage).toBe(1);
    expect(seq.notes[0]!.participants.length).toBe(2);
    expect(elements.some((e) => e.type === 'text' && e.text === 'Checkout')).toBe(true);
    expect(issues.some((i) => i.includes('blocks'))).toBe(true);
  });
});

describe('mermaid ER', () => {
  it('parses entities, keys and crow-foot cardinalities', () => {
    const { elements, issues } = importMermaid(`erDiagram
      CUSTOMER ||--o{ ORDER : places
      ORDER ||--|{ LINE_ITEM : contains
      PRODUCT |o..o{ LINE_ITEM : "appears in"
      CUSTOMER {
        string id PK
        string email UK
        string name
      }
      ORDER {
        int id PK
        string customer_id FK
      }`);
    expect(issues).toEqual([]);
    expectValid(elements);
    const tables = elements.filter((e): e is TableElement => e.type === 'table');
    expect(tables.map((t) => t.name).sort()).toEqual(['CUSTOMER', 'LINE_ITEM', 'ORDER', 'PRODUCT']);
    const customer = tables.find((t) => t.name === 'CUSTOMER')!;
    expect(customer.columns.map((c) => [c.name, c.dataType, c.primaryKey, c.unique])).toEqual([
      ['id', 'string', true, false],
      ['email', 'string', false, true],
      ['name', 'string', false, false],
    ]);
    expect(tables.find((t) => t.name === 'ORDER')!.columns[1]!.foreignKey).toBe(true);
    const rels = connectors(elements);
    expect(rels.length).toBe(3);
    const places = rels.find((r) => r.label?.text === 'places')!;
    expect(places.startArrowhead).toBe('er-one-only');
    expect(places.endArrowhead).toBe('er-zero-many');
    expect(rels.find((r) => r.label?.text === 'contains')!.endArrowhead).toBe('er-one-many');
    const appears = rels.find((r) => r.label?.text === 'appears in')!;
    expect(appears.startArrowhead).toBe('er-zero-one');
    expect(appears.strokeStyle).toBe('dashed');
    expect(rels.every((r) => r.edgeKind === 'relationship')).toBe(true);
  });
});

describe('mermaid class diagram', () => {
  it('parses classes, members, annotations and relations', () => {
    const { elements, issues } = importMermaid(`classDiagram
      direction TB
      class Animal {
        <<abstract>>
        +String name
        +int age$
        +makeSound()* void
      }
      Animal <|-- Duck
      Animal <|-- Fish
      Duck : +swim() bool
      class Pond~T~
      Pond *-- Duck
      Pond o-- Fish
      Duck --> Food
      Duck ..> Water
      Swimmer <|.. Duck
      Duck "1" -- "*" Egg : lays
      <<interface>> Swimmer
      note for Duck "can fly"`);
    expect(issues).toEqual([]);
    expectValid(elements);
    const classes = elements.filter((e): e is UmlClassElement => e.type === 'uml-class');
    const animal = classes.find((c) => c.name === 'Animal')!;
    expect(animal.stereotype).toBe('abstract');
    expect(animal.isAbstract).toBe(true);
    expect(animal.attributes).toEqual(['+ name: String', '+ age: int$']);
    expect(animal.methods).toEqual(['+ makeSound(): void*']);
    expect(classes.find((c) => c.name === 'Pond<T>')).toBeDefined();
    expect(classes.find((c) => c.name === 'Swimmer')!.stereotype).toBe('interface');
    const rels = connectors(elements);
    const id = (name: string) => classes.find((c) => c.name === name)!.id;
    const rel = (from: string, to: string) => rels.find((r) => r.startBinding!.elementId === id(from) && r.endBinding!.elementId === id(to));
    expect(rel('Duck', 'Animal')!.edgeKind).toBe('inheritance');
    expect(rel('Duck', 'Animal')!.endArrowhead).toBe('triangle-outline');
    expect(rel('Pond', 'Duck') ?? rel('Pond<T>', 'Duck')).toBeDefined();
    const comp = rels.find((r) => r.edgeKind === 'composition')!;
    expect(comp.startArrowhead).toBe('diamond');
    expect(rels.find((r) => r.edgeKind === 'aggregation')!.startArrowhead).toBe('diamond-outline');
    expect(rel('Duck', 'Water')!.strokeStyle).toBe('dashed');
    expect(rel('Duck', 'Swimmer')!.edgeKind).toBe('realization');
    expect(rel('Duck', 'Egg')!.label?.text).toBe('1 lays *');
    expect(rel('Duck', 'Egg')!.endArrowhead).toBe('none');
    // Supertypes are laid out above subtypes.
    const duck = classes.find((c) => c.name === 'Duck')!;
    expect(animal.y + animal.height).toBeLessThan(duck.y);
    expect(nodesOf(elements).some((n) => n.shape === 'note' && n.label?.text === 'can fly')).toBe(true);
  });

  it('formats members as UML text', () => {
    expect(formatMember('+String name')).toEqual({ text: '+ name: String', method: false });
    expect(formatMember('-List~int~ ids')).toEqual({ text: '- ids: List<int>', method: false });
    expect(formatMember('+getId(key) int$')).toEqual({ text: '+ getId(key): int$', method: true });
    expect(formatMember('count')).toEqual({ text: 'count', method: false });
  });
});

describe('mermaid safety and helpers', () => {
  it('rejects unsupported types and oversize input', () => {
    expect(importMermaid('pie title Pets\n "Dogs" : 386').issues[0]).toContain('Unsupported');
    expect(importMermaid('').issues[0]).toContain('Empty');
    expect(() => importMermaid('graph TD\n' + 'A-->B\n'.repeat(200_000))).toThrow(/too large/);
  });
  it('treats labels as plain text', () => {
    expect(cleanLabel('"<b>Bold</b><br/>line #quot;x#quot; &lt;y&gt;"')).toBe('Bold\nline "x" <y>');
    const { elements } = importMermaid('flowchart TD\n  A["<img src=x onerror=alert(1)>Hi"]');
    expect(byLabel(elements, 'Hi')).toBeDefined();
    expect(JSON.stringify(elements)).not.toContain('onerror');
  });
  it('strips front matter, directives and comments', () => {
    expect(mermaidLines('---\ntitle: x\n---\n%%{init: {"theme":"dark"}}%%\ngraph TD\nA-->B %% note\n')).toEqual(['graph TD', 'A-->B']);
  });
  it('handles a 300-node flowchart quickly', () => {
    const lines = ['flowchart TD'];
    for (let i = 1; i < 300; i++) lines.push(`n${Math.floor((i - 1) / 2)} --> n${i}`);
    const t = performance.now();
    const { elements, issues } = importMermaid(lines.join('\n'));
    expect(performance.now() - t).toBeLessThan(5000);
    expect(issues).toEqual([]);
    expect(nodesOf(elements).length).toBe(300);
  });
});
