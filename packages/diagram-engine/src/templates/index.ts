import type { TemplateDefinition } from '../types';
import {
  buildCiCd,
  buildCloudArchitecture,
  buildComponentDiagram,
  buildEventDriven,
  buildFrontendBackend,
  buildKubernetes,
  buildMicroservices,
  buildNetworkDiagram,
  buildOAuthSequence,
  buildPaymentSystem,
  buildRestApi,
} from './architecture';
import { buildKanban, buildMindMap, buildOrgChart, buildRetrospective } from './planning';
import {
  buildActivityDiagram,
  buildAuthFlow,
  buildDataFlow,
  buildDatabaseErd,
  buildFlowchartBasics,
  buildStateMachine,
  buildUmlClassDiagram,
  buildUseCaseDiagram,
  buildUserFlow,
  buildUserRegistration,
} from './software';

export {
  DiagramBuilder,
  PALETTE,
  centerElements,
  type PaletteColor,
  type TextOptions,
} from './builder';

/** Built-in, editable diagram templates (synced into the `templates` table by the API). */
export const SYSTEM_TEMPLATES: TemplateDefinition[] = [
  {
    key: 'microservices',
    name: 'Microservice architecture',
    description: 'Clients, API gateway, services with their own databases and an event bus.',
    category: 'architecture',
    build: buildMicroservices,
  },
  {
    key: 'rest-api',
    name: 'REST API',
    description:
      'Request lifecycle through gateway, middleware, route handlers, service layer and storage.',
    category: 'software',
    build: buildRestApi,
  },
  {
    key: 'auth-flow',
    name: 'Authentication flow',
    description: 'Sign-in flowchart with lockout, MFA and session issuance.',
    category: 'flowchart',
    build: buildAuthFlow,
  },
  {
    key: 'oauth2-authorization-code',
    name: 'OAuth 2.0 authorization code flow',
    description: 'Sequence diagram of the authorization code grant with PKCE.',
    category: 'software',
    build: buildOAuthSequence,
  },
  {
    key: 'ci-cd-pipeline',
    name: 'CI/CD pipeline',
    description: 'From git push through build, tests, registry, staging, approval and production.',
    category: 'architecture',
    build: buildCiCd,
  },
  {
    key: 'database-erd',
    name: 'Database ERD',
    description: 'Users, orders, order items, products and categories with PK/FK relationships.',
    category: 'database',
    build: buildDatabaseErd,
  },
  {
    key: 'cloud-architecture',
    name: 'Cloud architecture',
    description:
      'VPC with public/private subnets, load balancer, autoscaling group, database, cache and CDN.',
    category: 'architecture',
    build: buildCloudArchitecture,
  },
  {
    key: 'kubernetes',
    name: 'Kubernetes deployment',
    description:
      'Cluster with ingress, services, worker nodes, pods, stateful database and config.',
    category: 'architecture',
    build: buildKubernetes,
  },
  {
    key: 'event-driven',
    name: 'Event-driven architecture',
    description: 'Producers publishing to broker topics consumed by independent services.',
    category: 'architecture',
    build: buildEventDriven,
  },
  {
    key: 'frontend-backend',
    name: 'Frontend / backend architecture',
    description: 'SPA, state and API client talking to an API server, workers and storage.',
    category: 'architecture',
    build: buildFrontendBackend,
  },
  {
    key: 'payment-system',
    name: 'Payment system',
    description: 'Checkout, payment service, fraud checks, PSP, ledger, events and reconciliation.',
    category: 'architecture',
    build: buildPaymentSystem,
  },
  {
    key: 'user-registration',
    name: 'User registration flow',
    description: 'Sign-up flowchart with validation, duplicate check and email verification.',
    category: 'flowchart',
    build: buildUserRegistration,
  },
  {
    key: 'flowchart-basics',
    name: 'Flowchart basics',
    description: 'Start, input, process, decision, loop and output symbols.',
    category: 'flowchart',
    build: buildFlowchartBasics,
  },
  {
    key: 'uml-class-diagram',
    name: 'UML class diagram',
    description: 'Inheritance, realization, association, composition and dependency.',
    category: 'uml',
    build: buildUmlClassDiagram,
  },
  {
    key: 'state-machine',
    name: 'State machine',
    description: 'Order lifecycle states and transitions.',
    category: 'uml',
    build: buildStateMachine,
  },
  {
    key: 'activity-diagram',
    name: 'Activity diagram',
    description: 'Swimlanes with decision, fork and join for order fulfilment.',
    category: 'uml',
    build: buildActivityDiagram,
  },
  {
    key: 'use-case-diagram',
    name: 'Use case diagram',
    description: 'Actors and use cases inside a system boundary with «include» relations.',
    category: 'uml',
    build: buildUseCaseDiagram,
  },
  {
    key: 'component-diagram',
    name: 'Component diagram',
    description: 'Components in a package with «use» dependencies.',
    category: 'uml',
    build: buildComponentDiagram,
  },
  {
    key: 'network-diagram',
    name: 'Network diagram',
    description: 'Internet edge, firewall, DMZ, core and access switches, office LAN.',
    category: 'architecture',
    build: buildNetworkDiagram,
  },
  {
    key: 'data-flow-diagram',
    name: 'Data flow diagram',
    description: 'Level-1 DFD with external entities, processes and data stores.',
    category: 'software',
    build: buildDataFlow,
  },
  {
    key: 'org-chart',
    name: 'Org chart',
    description: 'Company hierarchy laid out as a tidy tree.',
    category: 'planning',
    build: buildOrgChart,
  },
  {
    key: 'mind-map',
    name: 'Mind map',
    description: 'Central topic with branches on both sides.',
    category: 'brainstorm',
    build: buildMindMap,
  },
  {
    key: 'user-flow',
    name: 'User flow',
    description: 'Screens and decisions from landing page to first project.',
    category: 'software',
    build: buildUserFlow,
  },
  {
    key: 'kanban-board',
    name: 'Kanban board',
    description: 'Columns as frames with sticky-note cards.',
    category: 'planning',
    build: buildKanban,
  },
  {
    key: 'retrospective',
    name: 'Retrospective',
    description: 'What went well, what to improve and action items.',
    category: 'brainstorm',
    build: buildRetrospective,
  },
];

/** Example boards created by the seed script for the demo workspace. */
export const SEED_BOARDS: TemplateDefinition[] = [
  {
    key: 'seed-flowchart',
    name: 'Onboarding flowchart',
    description: 'Registration flowchart example.',
    category: 'flowchart',
    build: buildUserRegistration,
  },
  {
    key: 'seed-er-diagram',
    name: 'Store database',
    description: 'Entity-relationship diagram example.',
    category: 'database',
    build: buildDatabaseErd,
  },
  {
    key: 'seed-architecture',
    name: 'Platform architecture',
    description: 'Microservice architecture example.',
    category: 'architecture',
    build: buildMicroservices,
  },
  {
    key: 'seed-uml-class',
    name: 'Domain model',
    description: 'UML class diagram example.',
    category: 'uml',
    build: buildUmlClassDiagram,
  },
  {
    key: 'seed-mind-map',
    name: 'Launch brainstorm',
    description: 'Mind map example.',
    category: 'brainstorm',
    build: buildMindMap,
  },
  {
    key: 'seed-kanban',
    name: 'Sprint board',
    description: 'Kanban board example.',
    category: 'planning',
    build: buildKanban,
  },
];

/** System template or seed board by key. */
export function getTemplate(key: string): TemplateDefinition | undefined {
  return SYSTEM_TEMPLATES.find((t) => t.key === key) ?? SEED_BOARDS.find((t) => t.key === key);
}
