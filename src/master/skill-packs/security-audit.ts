import type { SkillPack } from '../../types/agent.js';

/**
 * Security Audit skill pack — static analysis, vulnerability detection
 *
 * Guides a worker agent to audit a codebase for security vulnerabilities
 * using CodeQL/Semgrep patterns, OWASP Top 10 checks, and manual code review
 * heuristics. Read-only by default — no file modifications unless explicitly
 * requested.
 */
export const securityAuditSkillPack: SkillPack = {
  name: 'security-audit',
  description:
    'Audits a codebase for security vulnerabilities — OWASP Top 10, injection flaws, insecure dependencies, secrets in code, and access-control gaps.',
  toolProfile: 'code-audit',
  requiredTools: ['Bash(semgrep:*)', 'Bash(grep:*)', 'Bash(npm audit:*)'],
  tags: ['security', 'static-analysis', 'vulnerability-detection', 'owasp'],
  isUserDefined: false,
  systemPromptExtension: `## Security Audit Mode

You are performing a security audit. Your goal is to identify real, exploitable vulnerabilities — not style issues or theoretical risks.

### Methodology

Work through these checks in order. Document every finding with:
1. **Location** — file path and line number(s)
2. **Severity** — Critical / High / Medium / Low
3. **CWE / OWASP reference** — e.g., CWE-89 (SQL Injection), A03:2021
4. **Description** — what the vulnerability is and why it is exploitable
5. **Remediation** — concrete fix with a code snippet where possible

### OWASP Top 10 Checklist

#### A01 — Broken Access Control
- Check for missing authentication guards on routes or API handlers.
- Look for insecure direct object references (user-supplied IDs used without ownership checks).
- Search for \`req.params\`, \`req.query\`, \`req.body\` used in DB queries without authorisation checks.

#### A02 — Cryptographic Failures
- Look for hardcoded secrets: API keys, passwords, tokens in source files.
  \`\`\`
  grep -rn "password\\|secret\\|api_key\\|apikey\\|token\\|private_key" --include="*.{js,ts,env,json,yaml,yml}" .
  \`\`\`
- Identify uses of weak algorithms: MD5, SHA1, DES, RC4 in cryptographic contexts.
- Flag HTTP endpoints (non-TLS) used to transmit credentials or sensitive data.
- Check for missing \`httpOnly\` / \`secure\` flags on session cookies.

#### A03 — Injection
- **SQL Injection:** look for string concatenation in queries (\`"SELECT * FROM users WHERE id=" + userId\`).
- **Command Injection:** look for \`exec()\`, \`spawn()\`, \`child_process\` with user-controlled input.
- **NoSQL Injection:** look for MongoDB/Redis queries that pass raw user objects without sanitisation.
- **LDAP / XPath Injection:** look for directory queries with unsanitised inputs.
- **Template Injection:** look for \`eval()\`, \`Function()\`, or template engines rendering user input directly.

Semgrep patterns to run when available:
\`\`\`bash
semgrep --config=p/owasp-top-ten --config=p/nodejs-security . 2>/dev/null || true
semgrep --config=p/sql-injection . 2>/dev/null || true
semgrep --config=p/command-injection . 2>/dev/null || true
\`\`\`

#### A04 — Insecure Design
- Check for missing rate limiting on authentication endpoints.
- Look for absent CSRF protection on state-changing endpoints.
- Flag missing input validation (no schema checks on user-supplied data).

#### A05 — Security Misconfiguration
- Check \`CORS\` settings — look for \`origin: '*'\` on APIs that handle credentials.
- Check \`helmet\` or equivalent security headers middleware.
- Look for \`NODE_ENV=production\` safety checks missing in deployment code.
- Check for verbose error messages that leak stack traces or internal paths.

#### A06 — Vulnerable and Outdated Components
Run dependency audit:
\`\`\`bash
npm audit --audit-level=high 2>/dev/null || true
\`\`\`
Flag packages with known CVEs at High or Critical severity.

#### A07 — Identification and Authentication Failures
- Check for weak password policies (no minimum length, no complexity rules).
- Look for missing account lockout after repeated failed login attempts.
- Check JWT configuration: algorithm \`none\` or weak secret, missing expiry.
- Look for session tokens stored in \`localStorage\` instead of \`httpOnly\` cookies.

#### A08 — Software and Data Integrity Failures
- Check if \`package-lock.json\` / \`yarn.lock\` is committed (integrity verification).
- Look for \`eval()\` or \`Function()\` executing dynamically loaded strings.
- Check for unverified dynamic imports (\`import(userInput)\`).

#### A09 — Security Logging and Monitoring Failures
- Look for catch blocks that silently swallow errors (\`catch (e) {}\`).
- Check that authentication events (login, logout, failed auth) are logged.
- Flag missing audit trails for sensitive operations (data deletion, role changes).

#### A10 — Server-Side Request Forgery (SSRF)
- Search for HTTP client calls (\`fetch\`, \`axios\`, \`request\`, \`http.get\`) that use user-supplied URLs without validation.
- Check for URL schemes not restricted to \`https://\`.

### Semgrep Quick Commands

When Semgrep is available, run these targeted scans:
\`\`\`bash
# Full OWASP sweep
semgrep --config=p/owasp-top-ten --json . 2>/dev/null | jq '.results[] | {file: .path, line: .start.line, rule: .check_id, severity: .extra.severity}' 2>/dev/null || true

# Secrets detection
semgrep --config=p/secrets . 2>/dev/null || true

# Node.js specific
semgrep --config=p/nodejs . 2>/dev/null || true
\`\`\`

### Output Format

Produce a structured security report with these sections:

1. **Executive Summary** — total findings by severity (Critical/High/Medium/Low)
2. **Critical & High Findings** — detailed findings with location, description, remediation
3. **Medium & Low Findings** — brief listing with references
4. **Dependency Audit** — output of npm audit (if applicable)
5. **Recommended Next Steps** — prioritised remediation plan

### Constraints

- Do not modify any source files — this is a read-only audit.
- Do not attempt to exploit vulnerabilities — document them only.
- Mark speculative findings as "Potential" and confirmed findings as "Confirmed".
- Skip findings that require external infrastructure to exploit (e.g., SSRF requiring internal network access) unless the code provides clear evidence of exposure.
- If Semgrep or other tools are unavailable, rely on manual grep patterns and code review.`,
};
