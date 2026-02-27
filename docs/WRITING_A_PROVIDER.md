# Writing a Provider or CLIAdapter

> Step-by-step guide to adding a new AI backend to OpenBridge.

---

## Overview

OpenBridge has two distinct extension points for AI tools:

| Extension      | Interface                 | Purpose                                                                                                                                                                |
| -------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AIProvider** | `src/types/provider.ts`   | **Master capability** — the long-lived AI that receives user messages, explores the workspace, and orchestrates workers. One per session.                              |
| **CLIAdapter** | `src/core/cli-adapter.ts` | **Worker capability** — translates provider-neutral `SpawnOptions` into tool-specific binary + args + env for spawning short-lived worker processes via `AgentRunner`. |

**Most additions only need a CLIAdapter.** A new `AIProvider` is only needed if you want an AI to act as the Master (the top-level orchestrator). Workers are always spawned via `AgentRunner` → `CLIAdapter`, regardless of which tool is the Master.

In **V2** (current), AI tools are auto-discovered at startup. The `AgentRunner` (`src/core/agent-runner.ts`) is the unified CLI executor that handles spawning, retries, model fallback, and tool restrictions. Add a CLIAdapter and the tool is immediately available for worker tasks.

---

## When Do You Need What?

### You need a CLIAdapter if:

- The AI tool is a **standard CLI** (like `codex`, `aider`, a custom LLM CLI)
- You want workers to use the tool for delegated tasks
- The CLI has **unique flags** that differ from Claude's interface (`--sandbox` vs `--allowedTools`, `--json` vs streaming, etc.)
- The tool needs **environment variable cleanup** before spawn

### You need an AIProvider if:

- The AI tool needs to act as the **Master** (not just a worker)
- The AI service is **not a CLI** (e.g., an HTTP API like OpenAI or Gemini without a local CLI)
- The tool needs **special lifecycle management** beyond simple CLI spawning (sessions, streaming, checkpointing)

### You need both if:

- You're adding a new AI tool that should work as **both Master and worker** (like Codex — it has `CodexProvider` for Master use and `CodexAdapter` for worker use)

---

## Option A: Add a CLIAdapter (preferred for CLI tools)

This is the right path for any CLI-based AI tool. A CLIAdapter teaches `AgentRunner` how to translate abstract `SpawnOptions` (model, tools, prompt, session) into this tool's specific binary and flags.

### Step 1: Create the adapter file

```
src/core/adapters/your-tool-adapter.ts
```

### Step 2: Implement the CLIAdapter interface

```typescript
// src/core/adapters/your-tool-adapter.ts

import type { CLIAdapter, CLISpawnConfig, CapabilityLevel } from '../cli-adapter.js';
import type { SpawnOptions } from '../agent-runner.js';
import { sanitizePrompt } from '../agent-runner.js';

export class YourToolAdapter implements CLIAdapter {
  readonly name = 'your-tool';

  buildSpawnConfig(opts: SpawnOptions): CLISpawnConfig {
    const args: string[] = [];

    // Map SpawnOptions fields to your tool's specific flags
    if (opts.model) args.push('--model', opts.model);
    if (opts.systemPrompt) args.push('--system', opts.systemPrompt);

    // Prompt is positional (most CLIs)
    args.push(sanitizePrompt(opts.prompt));

    return {
      binary: 'your-tool',
      args,
      env: this.cleanEnv({ ...process.env }),
      // Optional: parse structured output (e.g. JSONL) into plain text
      // parseOutput: (stdout) => extractLastMessage(stdout),
    };
  }

  cleanEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
    const cleaned = { ...env };
    // Remove env vars that would interfere with your tool
    // e.g. delete cleaned['CLAUDE_CODE_...'] if Claude and your tool are both installed
    return cleaned;
  }

  mapCapabilityLevel(level: CapabilityLevel): string[] | undefined {
    // Map OpenBridge's capability tiers to your tool's access control mechanism.
    // Claude uses --allowedTools lists; Codex uses --sandbox modes; Aider uses --yes.
    // Return undefined if your tool has no capability restriction mechanism.
    switch (level) {
      case 'read-only':
        return ['--read-only'];
      case 'code-edit':
        return ['--limited'];
      case 'full-access':
        return ['--full'];
    }
  }

  isValidModel(model: string): boolean {
    // Return true if this model string can be passed to your CLI.
    // Can also return true for all strings (pass-through) if the CLI validates itself.
    const knownModels = ['your-model-v1', 'your-model-v2'];
    return knownModels.includes(model);
  }
}
```

**CLISpawnConfig fields:**

| Field         | Type                                  | Required | Purpose                                           |
| ------------- | ------------------------------------- | -------- | ------------------------------------------------- |
| `binary`      | `string`                              | ✅       | Command name or absolute path                     |
| `args`        | `string[]`                            | ✅       | CLI argument array                                |
| `env`         | `Record<string, string \| undefined>` | ✅       | Cleaned environment variables                     |
| `stdin`       | `'ignore' \| 'pipe'`                  | optional | stdin behavior (default: `'ignore'`)              |
| `parseOutput` | `(stdout: string) => string`          | optional | Post-processor for structured output (e.g. JSONL) |

**Lossy translation is intentional.** If the CLI doesn't support a feature (e.g. Codex has no `--max-turns`), silently drop it and log at `debug` level. AgentRunner accepts missing features gracefully.

### Step 3: Register in AdapterRegistry

Add the adapter to the built-in map in `src/core/adapter-registry.ts`:

```typescript
// src/core/adapter-registry.ts

import { YourToolAdapter } from './adapters/your-tool-adapter.js';

const BUILT_IN_ADAPTERS: Record<string, () => CLIAdapter> = {
  claude: () => new ClaudeAdapter(),
  codex: () => new CodexAdapter(),
  aider: () => new AiderAdapter(),
  'your-tool': () => new YourToolAdapter(), // ← add here
};
```

Custom adapters can also be registered at runtime without modifying the built-in map:

```typescript
const registry = createAdapterRegistry();
registry.register('your-tool', new YourToolAdapter());
```

### Step 4: Register in AI discovery

Add the tool to `src/discovery/tool-scanner.ts` so OpenBridge auto-discovers it:

```typescript
const KNOWN_AI_TOOLS = [
  {
    name: 'claude',
    command: 'claude',
    priority: 1,
    capabilities: ['code-generation', 'file-editing', 'conversation', 'tool-use'],
  },
  {
    name: 'codex',
    command: 'codex',
    priority: 2,
    capabilities: ['code-generation', 'file-editing'],
  },
  {
    name: 'aider',
    command: 'aider',
    priority: 3,
    capabilities: ['code-generation', 'file-editing'],
  },
  // Add your tool:
  { name: 'your-tool', command: 'your-tool', priority: 6, capabilities: ['code-generation'] },
];
```

The `AdapterRegistry` will automatically resolve the discovered tool name to your `YourToolAdapter`.

### Step 5: Write tests

```typescript
// tests/core/adapters/your-tool-adapter.test.ts

import { describe, it, expect } from 'vitest';
import { YourToolAdapter } from '../../../src/core/adapters/your-tool-adapter.js';

describe('YourToolAdapter', () => {
  const adapter = new YourToolAdapter();

  it('has correct name', () => {
    expect(adapter.name).toBe('your-tool');
  });

  it('includes model flag when set', () => {
    const config = adapter.buildSpawnConfig({ prompt: 'hello', model: 'your-model-v1' });
    expect(config.args).toContain('--model');
    expect(config.args).toContain('your-model-v1');
  });

  it('validates known models', () => {
    expect(adapter.isValidModel('your-model-v1')).toBe(true);
    expect(adapter.isValidModel('unknown-model')).toBe(false);
  });
});
```

---

## Real-world Example: CodexAdapter vs ClaudeAdapter

Codex and Claude expose very different CLI interfaces. The adapter pattern isolates these differences so `AgentRunner` can treat them uniformly.

| Capability  | ClaudeAdapter                          | CodexAdapter                                               |
| ----------- | -------------------------------------- | ---------------------------------------------------------- |
| Binary      | `claude`                               | `codex`                                                    |
| Mode flag   | `--print` (single-turn)                | `exec --skip-git-repo-check`                               |
| Session     | `--session-id` / `--resume`            | `--ephemeral` / `exec resume --last`                       |
| Tool access | `--allowedTools Read Edit ...`         | `--sandbox read-only\|workspace-write\|danger-full-access` |
| Model       | `--model claude-sonnet-4-6`            | `--model gpt-5.2-codex`                                    |
| Max turns   | `--max-turns 5`                        | dropped (not supported)                                    |
| Budget      | `--max-budget-usd 0.5`                 | dropped (not supported)                                    |
| Output      | streaming stdout                       | `--json` JSONL + `-o` temp file                            |
| Auth        | local Claude auth                      | `OPENAI_API_KEY` env var                                   |
| MCP         | `--mcp-config` / `--strict-mcp-config` | `-c` config file                                           |

**CodexAdapter highlights:**

- **OPENAI_API_KEY guard** — validates the key before spawn; throws with a clear error so AgentRunner classifies it as `'auth'` failure rather than a timeout.
- **`--skip-git-repo-check`** — always present; prevents exit code 1 from non-git workspace directories.
- **Sandbox inference** — maps Claude-style `allowedTools` (`Read`, `Edit`, `Write`, `Bash(*)`) to Codex sandbox modes (`read-only`, `workspace-write`, `danger-full-access`).
- **JSONL output + temp file** — `--json` emits structured events; `-o <tempfile>` captures the final answer reliably. `parseOutput()` reads the temp file first, falls back to JSONL parsing, cleans up after read.
- **System prompt prepending** — Codex has no `--append-system-prompt`; the adapter prepends `systemPrompt` to the prompt text instead.

---

## Option B: Write a Custom AIProvider (for non-CLI tools or Master use)

Only needed when the AI tool should act as the Master, or when it's not a local CLI.

### Step 1: Create the directory

```
src/providers/your-provider/
├── your-provider.ts          # Main provider class
├── your-provider-config.ts   # Config schema (optional)
└── index.ts                  # Barrel export
```

### Step 2: Implement the AIProvider interface

```typescript
import type { AIProvider, ProviderResult } from '../../types/provider.js';
import type { InboundMessage } from '../../types/message.js';

export class YourProvider implements AIProvider {
  readonly name = 'your-provider';

  async initialize(): Promise<void> {
    // Validate API keys, test connectivity
  }

  async processMessage(message: InboundMessage): Promise<ProviderResult> {
    const aiResponse = await this.callAI(message.content);
    return {
      content: aiResponse,
      metadata: { model: 'your-model-name' },
    };
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async shutdown(): Promise<void> {
    // Clean up connections
  }

  private async callAI(prompt: string): Promise<string> {
    // Your AI service integration here
    return 'AI response';
  }
}
```

### Step 3: Register the provider

Add your factory to `src/providers/index.ts`:

```typescript
import { YourProvider } from './your-provider/index.js';

export function registerBuiltInProviders(registry: PluginRegistry): void {
  registry.registerProvider('your-provider', (config) => {
    return new YourProvider(config.options);
  });
}
```

Configure in `config.json` (V0 format):

```json
{
  "providers": [
    {
      "type": "your-provider",
      "enabled": true,
      "options": {
        "apiKey": "sk-..."
      }
    }
  ],
  "defaultProvider": "your-provider"
}
```

### Step 4: Wire provider selection (V2)

In V2 startup (`src/index.ts`), the selected Master tool is matched to a provider. Add a branch for your provider:

```typescript
if (selectedMaster.name === 'your-tool') {
  provider = new YourProvider({ workspacePath, timeout });
} else if (selectedMaster.name === 'codex') {
  provider = new CodexProvider({ workspacePath, timeout });
} else {
  provider = new ClaudeCodeProvider({ workspacePath, timeout });
}
```

### Step 5: Write tests

```typescript
import { describe, it, expect } from 'vitest';
import { YourProvider } from '../../../src/providers/your-provider/index.js';

describe('YourProvider', () => {
  it('should implement the AIProvider interface', () => {
    const provider = new YourProvider({});
    expect(provider.name).toBe('your-provider');
  });

  it('should process messages and return results', async () => {
    const provider = new YourProvider({ apiKey: 'test-key' });
    const result = await provider.processMessage({
      id: '1',
      source: 'test',
      sender: '+1234567890',
      rawContent: 'hello',
      content: 'hello',
      timestamp: new Date(),
    });
    expect(result.content).toBeDefined();
  });
});
```

---

## Key Considerations

### Workspace Scoping

If your provider or adapter accesses the filesystem, always scope access to the configured `workspacePath`. Never allow the AI to access files outside this boundary.

### Timeout Handling

Long-running AI requests should respect the configured timeout. The Claude Code provider uses `options.timeout` (default: 120000ms). `AgentRunner` enforces timeouts for all spawned workers.

### Error Handling

- Return meaningful error messages in `ProviderResult.content` so the user gets feedback
- Throw errors only for unrecoverable failures (the router will catch and report them)
- Log errors with context using the shared Pino logger
- For CLIAdapters: throw early (e.g. missing API key) so AgentRunner can classify and retry

---

## Checklist

### CLIAdapter checklist

- [ ] Implements all four `CLIAdapter` methods
- [ ] `buildSpawnConfig()` always sets `binary`, `args`, and `env`
- [ ] `cleanEnv()` removes conflicting environment variables
- [ ] Drops unsupported `SpawnOptions` fields silently (log at `debug`)
- [ ] Registered in `BUILT_IN_ADAPTERS` in `adapter-registry.ts`
- [ ] Registered in `KNOWN_AI_TOOLS` in `tool-scanner.ts`
- [ ] Has unit tests covering flag generation and model validation

### AIProvider checklist

- [ ] Implements `AIProvider` interface fully
- [ ] `processMessage()` returns valid `ProviderResult`
- [ ] `isAvailable()` performs a real health check
- [ ] Cleans up resources in `shutdown()`
- [ ] Respects `workspacePath` scoping (if applicable)
- [ ] Handles timeouts gracefully
- [ ] Has unit tests
