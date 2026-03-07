# Demo 08: Security & Access Control

> **Audience:** CISOs / Compliance teams | **Duration:** 10 min | **Difficulty:** Intermediate
> Show the security model — least-privilege workers, role-based access, env protection, Docker sandbox.

---

## Key Message

"Every worker runs with minimal permissions. Every user has a role. Secrets are protected. And for maximum isolation, run workers in Docker containers."

## What This Demo Shows

- Tool profiles: read-only, code-edit, code-audit, full-access
- Role-based access control (admin, developer, viewer)
- Phone whitelist authentication
- Environment variable protection (deny-list for secrets)
- Document visibility controls (hidden files: .env, \*.pem, secrets/)
- Docker sandbox for worker isolation
- Runtime permission escalation with user consent

---

## Setup (Before the Demo)

1. Copy the config:
   ```bash
   cp demos/08-security-access-control/config.json config.json
   ```
2. Run `npm run dev`

## Demo Script

### Step 1: Show Tool Profiles (90s)

Explain the 4 profiles:

```
read-only:   Read, Glob, Grep
code-edit:   Read, Edit, Write, Glob, Grep, Bash(git:*), Bash(npm:*)
code-audit:  Read, Glob, Grep, Bash(npm:test), Bash(npx:vitest:*)
full-access: Everything (used sparingly)
```

**Talking Point:** "Every worker gets a profile that restricts its tools at the CLI level. A read-only worker literally cannot write files — it's not a policy, it's a hard restriction passed via `--allowedTools`. The AI can't bypass it."

### Step 2: Show Access Control (60s)

```bash
npx openbridge access list
```

Show roles:

- **admin**: Can use all commands, manage access, full-access workers
- **developer**: Code-edit workers, can trigger Deep Mode
- **viewer**: Read-only workers, can ask questions but not modify code

**Talking Point:** "Role-based access. Your team lead gets admin. Developers get code-edit. Interns get viewer — they can ask questions but can't modify anything."

### Step 3: Show Env Var Protection (60s)

Show the protection in action:

```
/ai what's in my .env file?
```

Response: "I can't access `.env` directly — it's hidden for security."

**Talking Point:** "Hidden files are enforced at the system level. `.env`, `*.pem`, `secrets/`, credentials — all invisible to the AI. Workers can't read them even with full-access profile."

### Step 4: Show Runtime Escalation (90s)

Trigger a task that needs elevated permissions:

```
/ai run the test suite and fix any failures
```

Show the escalation prompt:

```
Worker needs Bash access to run tests.
Profile: read-only → code-audit
Allow? [yes/no]
```

**Talking Point:** "If a worker needs tools beyond its profile, it asks YOU for permission. No silent escalation. You see exactly what tools it needs and why."

### Step 5: Show Docker Sandbox (Optional, 90s)

If Docker is available:

```
/ai run this code in a sandbox
```

Show the worker running inside a Docker container with:

- No network access (optional)
- Resource limits (CPU, memory)
- Temporary filesystem (destroyed after task)

**Talking Point:** "For maximum isolation, workers run in Docker containers. No access to the host system beyond the mounted workspace. The container is destroyed when the worker finishes."

---

## Talking Points Summary

| Point                 | Message                                      |
| --------------------- | -------------------------------------------- |
| **Least-privilege**   | CLI-enforced tool restrictions per worker.   |
| **Role-based access** | Admin, developer, viewer — per phone number. |
| **Secret protection** | .env, keys, credentials are invisible to AI. |
| **User consent**      | Escalation requires explicit approval.       |
| **Docker sandbox**    | Container isolation for untrusted tasks.     |

---

## Common Questions

**Q: Can the AI access my AWS keys?**
A: No. Environment variables are filtered through a deny-list. AWS_SECRET_ACCESS_KEY, GITHUB_TOKEN, and similar are blocked by default. You can customize the deny-list.

**Q: What if a worker goes rogue?**
A: Workers are bounded: `--max-turns` limits how long they run, `--allowedTools` limits what they can do, and they can be stopped anytime with `/stop`. Docker sandbox adds full OS-level isolation.

**Q: Is this SOC 2 compliant?**
A: OpenBridge runs entirely on your infrastructure. Nothing leaves your machine except what your AI tool sends to its API (e.g., Claude → Anthropic). Audit logs capture every message and worker action.
