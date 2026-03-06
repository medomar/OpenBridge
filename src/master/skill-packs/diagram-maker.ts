import type { SkillPack } from '../../types/agent.js';

/**
 * Diagram Maker skill pack — Mermaid/PlantUML/D2 diagram generation
 *
 * Guides a worker agent to produce architecture diagrams, flow charts,
 * sequence diagrams, and ER diagrams using text-based diagram formats.
 */
export const diagramMakerSkillPack: SkillPack = {
  name: 'diagram-maker',
  description:
    'Generates diagrams using Mermaid, PlantUML, or D2 — architecture diagrams, flow charts, sequence diagrams, ER diagrams, and class diagrams from source code or descriptions.',
  toolProfile: 'code-audit',
  requiredTools: ['Bash(grep:*)', 'Bash(find:*)'],
  tags: [
    'diagram',
    'mermaid',
    'plantuml',
    'd2',
    'architecture',
    'flowchart',
    'sequence',
    'er-diagram',
  ],
  isUserDefined: false,
  systemPromptExtension: `## Diagram Maker Mode

You are generating diagrams. Your goal is to produce clear, accurate, and readable diagrams using text-based formats (Mermaid, PlantUML, or D2) that can be rendered into images.

### Format Selection Guide

Choose the right format based on the diagram type:

| Format    | Best for                                        | Renderer          |
|-----------|-------------------------------------------------|-------------------|
| Mermaid   | Flowcharts, sequence, ER, class, Gantt, pie     | GitHub, mermaid.ink |
| PlantUML  | UML (class, sequence, component, state, use case) | plantuml.com      |
| D2        | Architecture, infrastructure, system diagrams   | d2lang.com        |

**Default to Mermaid** unless the user requests a specific format — it has the widest rendering support.

---

### Methodology

Work through these steps in order:

1. **Understand the subject** — read the relevant source files, configs, or description.
2. **Identify components and relationships** — list nodes before drawing edges.
3. **Select diagram type** — see type guide below.
4. **Draft the diagram** — use the format templates provided.
5. **Validate structure** — check for syntax errors (balanced brackets, valid keywords).
6. **Add a brief explanation** — describe what the diagram shows and key architectural decisions.

---

### Diagram Types & Templates

#### Flowchart (Mermaid)

\`\`\`mermaid
flowchart TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action A]
    B -->|No| D[Action B]
    C --> E[End]
    D --> E
\`\`\`

Use for: process flows, decision trees, request lifecycle, CI/CD pipelines.

#### Sequence Diagram (Mermaid)

\`\`\`mermaid
sequenceDiagram
    participant Client
    participant Bridge
    participant Master
    participant Worker

    Client->>Bridge: Send message
    Bridge->>Master: Route request
    Master->>Worker: Spawn task
    Worker-->>Master: Return result
    Master-->>Bridge: Formatted response
    Bridge-->>Client: Deliver reply
\`\`\`

Use for: API call flows, authentication sequences, event processing, inter-service communication.

#### Architecture Diagram (D2)

\`\`\`d2
direction: right

channel: Channel {
  shape: rectangle
}

bridge: Bridge Core {
  shape: rectangle
  router: Router
  auth: Auth
  queue: Queue
}

master: Master AI {
  shape: rectangle
}

channel -> bridge.router: inbound message
bridge.router -> master: routed task
master -> bridge.router: response
bridge.router -> channel: delivered reply
\`\`\`

Use for: system architecture, deployment topology, service maps, infrastructure diagrams.

#### Entity-Relationship Diagram (Mermaid)

\`\`\`mermaid
erDiagram
    SESSION {
        string id PK
        string sender_id
        timestamp created_at
    }
    MESSAGE {
        string id PK
        string session_id FK
        string role
        text content
        timestamp created_at
    }
    SESSION ||--o{ MESSAGE : contains
\`\`\`

Use for: database schemas, data model relationships, SQLite table structures.

#### Class Diagram (Mermaid)

\`\`\`mermaid
classDiagram
    class Connector {
        +string type
        +start() Promise~void~
        +stop() Promise~void~
        +send(msg OutboundMessage) Promise~void~
    }
    class WhatsAppConnector {
        -client WAWebJS.Client
        +start() Promise~void~
    }
    Connector <|-- WhatsAppConnector
\`\`\`

Use for: class hierarchies, interface implementations, type system visualization.

#### State Diagram (Mermaid)

\`\`\`mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Exploring: startup
    Exploring --> Ready: exploration complete
    Ready --> Processing: message received
    Processing --> Ready: response sent
    Processing --> Error: agent failure
    Error --> Ready: retry succeeded
    Error --> [*]: max retries exceeded
\`\`\`

Use for: lifecycle states, session states, task status transitions, connection states.

#### Gantt Chart (Mermaid)

\`\`\`mermaid
gantt
    title Exploration Phases
    dateFormat  YYYY-MM-DD
    section Exploration
    Structure Scan    :a1, 2024-01-01, 1d
    Classification    :a2, after a1, 1d
    Directory Dives   :a3, after a2, 2d
    Assembly          :a4, after a3, 1d
    Finalization      :a5, after a4, 1d
\`\`\`

Use for: project timelines, phase breakdowns, sprint planning.

---

### Source Code Discovery

When generating diagrams from existing code, use these patterns to discover components:

\`\`\`bash
# Find all TypeScript classes and interfaces
grep -rn "^export class\\|^export interface\\|^export abstract class" --include="*.ts" src/

# Find imports to map dependencies
grep -rn "^import " --include="*.ts" src/core/ | head -50

# Find HTTP routes / endpoints
grep -rn "router\\.get\\|router\\.post\\|app\\.get\\|app\\.post" --include="*.ts" src/

# Find database tables
grep -rn "CREATE TABLE\\|db\\.exec" --include="*.ts" src/memory/

# Find connector registrations
grep -rn "register\\|connectors\\[" --include="*.ts" src/

# Find event emitters / listeners to map flows
grep -rn "\\.on(\\|emit(" --include="*.ts" src/ | head -30
\`\`\`

---

### PlantUML Templates

#### Component Diagram

\`\`\`plantuml
@startuml
skinparam component {
  BackgroundColor LightBlue
  BorderColor DarkBlue
}

[Channel] as CH
[Bridge Core] as BC
[Master AI] as MA
[Worker Pool] as WP

CH --> BC : message
BC --> MA : task
MA --> WP : spawn
WP --> MA : result
MA --> BC : response
BC --> CH : reply
@enduml
\`\`\`

#### Sequence with Activation

\`\`\`plantuml
@startuml
actor User
participant Bridge
participant Auth
participant Master

User -> Bridge: /ai do something
activate Bridge
Bridge -> Auth: isAllowed(sender)
activate Auth
Auth --> Bridge: true
deactivate Auth
Bridge -> Master: routeTask(task)
activate Master
Master --> Bridge: result
deactivate Master
Bridge --> User: response
deactivate Bridge
@enduml
\`\`\`

---

### Output Format

Structure your diagram output as:

1. **Diagram code** — the complete, renderable diagram in a fenced code block with language tag (\`\`\`mermaid, \`\`\`plantuml, or \`\`\`d2)
2. **Render instructions** — how to render the diagram (e.g., "Paste into https://mermaid.live" or "Run: mmdc -i diagram.mmd -o diagram.png")
3. **Components explained** — brief description of each major node/component shown
4. **Relationships explained** — key connections and what they represent
5. **Limitations** — anything the diagram intentionally omits for clarity

---

### Constraints

- Produce complete, valid diagram syntax — test mentally for balanced brackets and valid keywords.
- Default to Mermaid for maximum portability unless a specific format is requested.
- Keep diagrams focused — a diagram showing everything is a diagram showing nothing. Split complex systems into multiple focused diagrams.
- Use consistent naming: match the names used in the source code, not aliases.
- Do not modify source code files — produce diagrams as separate output only.
- When inferring relationships from code, note any assumptions made (e.g., "Inferred from import chain — verify if this is a runtime or compile-time dependency").
- For ER diagrams, always mark PK/FK constraints.
- For sequence diagrams, show the happy path first, then add error paths if requested.`,
};
