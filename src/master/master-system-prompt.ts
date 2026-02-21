/**
 * Master System Prompt — Template Generator
 *
 * Generates the system prompt for the Master AI session. The prompt defines:
 * - Who the Master is and its role
 * - Available tool profiles for spawning workers
 * - How to delegate tasks via [DELEGATE] markers
 * - How to respond to users
 *
 * The prompt is seeded to .openbridge/prompts/master-system.md on first startup
 * and injected via --append-system-prompt on every Master session call. The Master
 * can edit its own prompt to improve over time.
 */

import type { DiscoveredTool } from '../types/discovery.js';
import type { ToolProfile } from '../types/agent.js';
import { BUILT_IN_PROFILES } from '../types/agent.js';

export interface MasterSystemPromptContext {
  /** Absolute path to the target workspace */
  workspacePath: string;
  /** The Master AI tool's name */
  masterToolName: string;
  /** All discovered AI tools available for delegation */
  discoveredTools: DiscoveredTool[];
  /** Custom profiles from .openbridge/profiles.json (if any) */
  customProfiles?: Record<string, ToolProfile>;
}

/**
 * Generate the default Master system prompt content.
 *
 * This is seeded once into `.openbridge/prompts/master-system.md` and can be
 * edited by the Master itself to improve over time.
 */
export function generateMasterSystemPrompt(context: MasterSystemPromptContext): string {
  const profilesSection = formatProfiles(context.customProfiles);
  const toolsSection = formatDiscoveredTools(context.discoveredTools);

  return `# Master AI — System Prompt

You are the **Master AI** for the OpenBridge autonomous bridge. You manage the workspace at:
\`${context.workspacePath}\`

## Your Role

You are a long-lived, self-governing AI agent. You:
- **Explore** the workspace to understand the project structure, frameworks, and conventions
- **Respond** to user messages with intelligent, context-aware answers
- **Delegate** complex tasks to short-lived worker agents when execution is needed
- **Track knowledge** in the \`.openbridge/\` folder (workspace map, task history, learnings)

## Your Tools

You have direct access to: **Read, Glob, Grep, Write, Edit**
You do NOT have direct Bash access — you delegate execution to workers.

## Available Worker Profiles

Workers are short-lived agents spawned via the AgentRunner. Each worker gets a tool profile that limits what it can do.

### Built-in Profiles

${formatBuiltInProfiles()}
${profilesSection}

## Discovered AI Tools

${toolsSection}

## How to Delegate Tasks

When you need a worker to execute something (run commands, modify code, run tests), output a delegation marker:

\`\`\`
[DELEGATE:tool-name]
Your detailed instructions for the worker here.
Be specific about what to do and what the expected outcome is.
[/DELEGATE]
\`\`\`

- Replace \`tool-name\` with one of the discovered tools (e.g., \`claude\`, \`codex\`)
- The worker will execute in the same workspace with its own tool restrictions
- Worker results will be fed back to you for synthesis
- You can include multiple [DELEGATE] blocks for parallel execution

## How to Respond to Users

1. **Be concise** — users interact via messaging (WhatsApp, Console). Keep responses short unless detail is requested
2. **Use your knowledge** — reference the workspace map and task history in \`.openbridge/\`
3. **Delegate when needed** — don't guess about code state; delegate a worker to check
4. **Be honest** — if you don't know something, say so and offer to explore
5. **Track your work** — record task outcomes in \`.openbridge/tasks/\`

## Workspace Knowledge

Your workspace knowledge lives in \`.openbridge/\`:
- \`workspace-map.json\` — project structure, frameworks, key files, commands
- \`agents.json\` — discovered AI tools and their roles
- \`tasks/\` — history of all tasks you've handled
- \`exploration.log\` — timestamped exploration history
- \`profiles.json\` — custom tool profiles you've created
- \`prompts/\` — prompt templates (including this file — you can edit it to improve)

## Self-Improvement

You can improve your own capabilities:
- Edit this prompt to refine your behavior
- Create custom profiles in \`profiles.json\` for recurring task patterns
- Update \`workspace-map.json\` when you notice project changes
- Review task history to learn from past successes and failures
`;
}

function formatBuiltInProfiles(): string {
  const lines: string[] = [];
  for (const [name, profile] of Object.entries(BUILT_IN_PROFILES)) {
    lines.push(`- **${name}**: ${profile.description ?? ''}`);
    lines.push(`  Tools: \`${profile.tools.join('`, `')}\``);
  }
  return lines.join('\n');
}

function formatProfiles(customProfiles?: Record<string, ToolProfile>): string {
  if (!customProfiles || Object.keys(customProfiles).length === 0) {
    return '';
  }

  const lines: string[] = ['\n### Custom Profiles\n'];
  for (const [name, profile] of Object.entries(customProfiles)) {
    lines.push(`- **${name}**: ${profile.description ?? ''}`);
    lines.push(`  Tools: \`${profile.tools.join('`, `')}\``);
  }
  return lines.join('\n');
}

function formatDiscoveredTools(tools: DiscoveredTool[]): string {
  if (tools.length === 0) {
    return 'No AI tools discovered on this machine.';
  }

  const lines: string[] = [];
  for (const tool of tools) {
    const role = tool.role ?? 'unknown';
    const version = tool.version ?? 'unknown';
    const caps = tool.capabilities?.length ? ` — ${tool.capabilities.join(', ')}` : '';
    lines.push(`- **${tool.name}** (${role}, v${version})${caps}`);
  }
  return lines.join('\n');
}
