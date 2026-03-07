# Demo 06: MCP External Services

> **Audience:** Integration architects | **Duration:** 15 min | **Difficulty:** Advanced
> Show how OpenBridge connects AI workers to external services via MCP.

---

## Key Message

"Your AI workers can read emails, query databases, post to Slack — all through the Model Context Protocol. No custom integrations needed."

## What This Demo Shows

- MCP (Model Context Protocol) server configuration
- Per-worker MCP isolation (each worker only sees the servers it needs)
- Master-driven MCP assignment (Master decides which workers get which servers)
- Built-in MCP registry with 12 pre-configured servers
- Hot-reload when MCP config changes

---

## Prerequisites

- At least one MCP server available (e.g., filesystem, Slack, GitHub)
- Understanding of MCP protocol basics

## Setup (Before the Demo)

1. Copy the config with MCP servers:
   ```bash
   cp demos/06-mcp-external-services/config.json config.json
   ```
2. Configure your MCP server credentials (API keys in env vars, not in config)
3. Run `npm run dev`

## Demo Script

### Step 1: Show MCP Config (60s)

Open `config.json` and show the `mcp` section:

```json
{
  "mcp": {
    "servers": {
      "filesystem": {
        "command": "npx",
        "args": ["-y", "@anthropic-ai/mcp-filesystem"],
        "env": {}
      },
      "github": {
        "command": "npx",
        "args": ["-y", "@anthropic-ai/mcp-github"],
        "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
      }
    }
  }
}
```

**Talking Point:** "MCP servers are declared in config. Each one is a separate process that provides tools to AI workers. Filesystem access, GitHub, Slack, databases — anything with an MCP server."

### Step 2: Show Master's MCP Awareness (60s)

Show the Master AI's system prompt section:

```
## Available MCP Servers
- filesystem: File system access
- github: GitHub API (issues, PRs, code search)
```

**Talking Point:** "The Master AI sees all available MCP servers. When it spawns a worker, it decides which servers that worker needs — and only those servers are attached. A worker reviewing code doesn't get Slack access."

### Step 3: Trigger an MCP-Using Task (120s)

```
/ai check if there are any open GitHub issues for this project and summarize them
```

Show the Master spawning a worker with `mcpServers: ["github"]`.

**Talking Point:** "The Master decided this task needs GitHub access, so it attached only the GitHub MCP server to the worker. The filesystem server wasn't included — least-privilege."

### Step 4: Show Per-Worker Isolation (90s)

Point to logs showing:

```
Worker 1: MCP config written to /tmp/openbridge-mcp-xxx.json (servers: github)
Worker 1: --mcp-config /tmp/openbridge-mcp-xxx.json --strict-mcp-config
```

**Talking Point:** "Each worker gets a temporary MCP config file with only its assigned servers. The `--strict-mcp-config` flag means the worker can't access any MCP server not in its config. After the worker finishes, the temp file is deleted."

### Step 5: Show Built-in Registry (60s)

```
/ai what MCP servers are available?
```

**Talking Point:** "OpenBridge ships with a registry of 12 popular MCP servers. You can add custom ones in config. Hot-reload means you can add servers while the bridge is running."

---

## Talking Points Summary

| Point                    | Message                                               |
| ------------------------ | ----------------------------------------------------- |
| **Standards-based**      | MCP is an open protocol — not proprietary.            |
| **Per-worker isolation** | Each worker gets only the MCP servers it needs.       |
| **Master-driven**        | The AI decides which services each worker requires.   |
| **12 built-in servers**  | GitHub, Slack, filesystem, and more — out of the box. |
| **Hot-reload**           | Add MCP servers without restarting.                   |

---

## Common Questions

**Q: What MCP servers are available?**
A: Any MCP-compatible server. The ecosystem is growing — filesystem, GitHub, Slack, PostgreSQL, Google Drive, and many more.

**Q: Is this only for Claude?**
A: Currently yes — `--mcp-config` is a Claude CLI feature. Codex has native MCP support via `codex mcp`. Other tools will gain support as the protocol matures.

**Q: How are API keys handled?**
A: Via environment variables, never in config files. OpenBridge has env var protection that prevents workers from accessing sensitive environment variables not explicitly allowed.
