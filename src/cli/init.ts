import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Interface as ReadlineInterface } from 'node:readline';
import { createInterface } from 'node:readline';
import { runHealthCheck } from '../core/health.js';
import { DEFAULT_EXCLUDE_PATTERNS } from '../types/config.js';
import {
  detectOS,
  getNodeVersion,
  isCommandAvailable,
  meetsNodeVersion,
  printError,
  printStep,
  printSuccess,
  printWarning,
  runCommand,
} from './utils.js';

const TOTAL_STEPS = 13;

export interface InitOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  outputPath?: string;
}

interface McpServerEntry {
  name: string;
  command: string;
}

interface Answers {
  connector: string;
  workspacePath: string;
  whitelist?: string[];
  prefix?: string;
  defaultRole?: string;
  trustLevel?: string;
  mcpServers?: McpServerEntry[];
  mcpConfigPath?: string;
  connectorOptions?: Record<string, unknown>;
  autoHideSensitiveFiles?: boolean;
}

type ConnectorType = 'console' | 'whatsapp' | 'webchat' | 'telegram' | 'discord';

export interface AIToolStatus {
  claude: boolean;
  codex: boolean;
  aider: boolean;
}

export async function detectAITools(): Promise<AIToolStatus> {
  const [claude, codex, aider] = await Promise.all([
    isCommandAvailable('claude'),
    isCommandAvailable('codex'),
    isCommandAvailable('aider'),
  ]);

  if (claude) {
    printSuccess('claude — found');
  } else {
    printWarning('claude — not found');
  }

  if (codex) {
    printSuccess('codex — found');
  } else {
    printWarning('codex — not found');
  }

  if (aider) {
    printSuccess('aider — found');
  } else {
    printWarning('aider — not found');
  }

  return { claude, codex, aider };
}

function ask(rl: ReadlineInterface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

export async function checkPrerequisites(): Promise<boolean> {
  if (!meetsNodeVersion('22')) {
    printError(`Node.js >= 22 is required. You have ${getNodeVersion()}.`);
    printError('Download the latest version at https://nodejs.org');
    process.exit(1);
  }
  printSuccess(`Node.js ${getNodeVersion()} — OK`);

  const npmAvailable = await isCommandAvailable('npm');
  if (!npmAvailable) {
    printError('npm is not available. Please reinstall Node.js from https://nodejs.org');
    process.exit(1);
  }
  printSuccess('npm — OK');

  const gitAvailable = await isCommandAvailable('git');
  if (!gitAvailable) {
    printWarning('git is not installed — recommended but not required');
  } else {
    printSuccess('git — OK');
  }

  return true;
}

async function appendToEnv(envPath: string, key: string, value: string): Promise<void> {
  let existing = '';
  try {
    existing = await readFile(envPath, 'utf-8');
  } catch {
    // file doesn't exist yet
  }
  const lines = existing.split('\n').filter((l) => l !== '' && !l.startsWith(`${key}=`));
  lines.push(`${key}=${value}`);
  await writeFile(envPath, lines.join('\n') + '\n', 'utf-8');
}

export async function setupCodexAuth(
  rl: ReadlineInterface,
  write: (text: string) => void,
  dotEnvPath = resolve('.env'),
): Promise<void> {
  const codexAvailable = await isCommandAvailable('codex');
  if (!codexAvailable) return;

  write('\n  Codex — Authentication Check\n');

  if (process.env['OPENAI_API_KEY']) {
    printSuccess('Codex — already authenticated (OPENAI_API_KEY set)');
    return;
  }

  const statusResult = await runCommand('codex', ['auth', 'status']);
  if (statusResult.exitCode === 0) {
    printSuccess('Codex — already authenticated');
    return;
  }

  write('\n  Codex requires an OpenAI account to function.\n');
  write('  Create or sign in at https://platform.openai.com/api-keys\n');
  write('\n  Bonus: your OPENAI_API_KEY also enables Whisper voice transcription\n');
  write('  (no local Whisper install needed — $0.006/min, zero local setup).\n\n');
  write('    1. Sign in via browser  (codex login — opens browser)\n');
  write('    2. Paste API key        (saves OPENAI_API_KEY to .env)\n');
  write('    3. Skip — set up later\n\n');

  const choice = await ask(rl, '  Your choice (1/2/3): ');

  if (choice === '1') {
    write('\n  Opening browser for OpenAI sign-in...\n');
    const result = await runCommand('codex', ['login']);
    if (result.exitCode === 0) {
      printSuccess('Codex — authenticated successfully');
    } else {
      printWarning('Authentication may not have completed. Run: codex login');
      if (result.stderr) write(result.stderr + '\n');
    }
  } else if (choice === '2') {
    const key = await ask(rl, '  Paste your OpenAI API key (sk-...): ');
    if (!key) {
      printWarning('No API key entered — skipping');
    } else if (!key.startsWith('sk-')) {
      printWarning('Invalid key format — OpenAI API keys start with sk-');
    } else {
      await appendToEnv(dotEnvPath, 'OPENAI_API_KEY', key);
      printSuccess(`OPENAI_API_KEY written to ${dotEnvPath}`);
      printSuccess('Voice transcription via Whisper API is now enabled.');
    }
  } else {
    write('  Skipping Codex auth setup.\n');
  }
}

export async function setupClaudeAuth(
  rl: ReadlineInterface,
  write: (text: string) => void,
  dotEnvPath = resolve('.env'),
): Promise<void> {
  const claudeAvailable = await isCommandAvailable('claude');
  if (!claudeAvailable) return;

  write('\n  Claude Code — Authentication Check\n');

  const statusResult = await runCommand('claude', ['auth', 'status']);
  if (statusResult.exitCode === 0) {
    printSuccess('Claude Code — already authenticated');
    return;
  }

  write('\n  Claude Code requires an Anthropic account to function.\n');
  write('  Create or sign in at https://console.anthropic.com\n\n');
  write('    1. Sign in via browser  (claude auth login — opens browser)\n');
  write('    2. Paste API key        (saves ANTHROPIC_API_KEY to .env)\n');
  write('    3. Skip — set up later\n\n');

  const choice = await ask(rl, '  Your choice (1/2/3): ');

  if (choice === '1') {
    write('\n  Opening browser for Anthropic sign-in...\n');
    const result = await runCommand('claude', ['auth', 'login']);
    if (result.exitCode === 0) {
      printSuccess('Claude Code — authenticated successfully');
    } else {
      printWarning('Authentication may not have completed. Run: claude auth login');
      if (result.stderr) write(result.stderr + '\n');
    }
  } else if (choice === '2') {
    const key = await ask(rl, '  Paste your Anthropic API key (sk-ant-...): ');
    if (key) {
      await appendToEnv(dotEnvPath, 'ANTHROPIC_API_KEY', key);
      printSuccess(`ANTHROPIC_API_KEY written to ${dotEnvPath}`);
    } else {
      printWarning('No API key entered — skipping');
    }
  } else {
    write('  Skipping Claude Code auth setup.\n');
  }
}

export function buildConfig(answers: Answers): Record<string, unknown> {
  const channel: Record<string, unknown> = { type: answers.connector, enabled: true };
  if (answers.connectorOptions && Object.keys(answers.connectorOptions).length > 0) {
    channel['options'] = answers.connectorOptions;
  }
  const config: Record<string, unknown> = {
    workspacePath: answers.workspacePath,
    channels: [channel],
  };

  if (answers.whitelist !== undefined) {
    const auth: Record<string, unknown> = {
      whitelist: answers.whitelist,
      prefix: answers.prefix ?? '/ai',
    };
    if (answers.defaultRole !== undefined) {
      auth['defaultRole'] = answers.defaultRole;
    }
    config['auth'] = auth;
  }

  if (answers.mcpServers?.length || answers.mcpConfigPath) {
    const mcp: Record<string, unknown> = {
      enabled: true,
      servers: answers.mcpServers ?? [],
    };
    if (answers.mcpConfigPath) {
      mcp['configPath'] = answers.mcpConfigPath;
    }
    config['mcp'] = mcp;
  }

  if (answers.autoHideSensitiveFiles) {
    config['workspace'] = {
      exclude: [...DEFAULT_EXCLUDE_PATTERNS],
    };
  }

  if (answers.trustLevel !== undefined && answers.trustLevel !== 'standard') {
    config['security'] = { trustLevel: answers.trustLevel };
  }

  return config;
}

/**
 * Validate whitelist entries and compute an auto-fixed list.
 * Issues:
 *   - "non-numeric characters": entry has chars other than digits and a leading +
 *   - "duplicate": entry normalizes to the same digits as an earlier entry
 * Fixed list: non-numeric chars stripped, duplicates removed (first occurrence kept).
 */
export function validateAndFixWhitelist(numbers: string[]): {
  issues: Array<{ entry: string; reason: string }>;
  fixed: string[];
} {
  const issues: Array<{ entry: string; reason: string }> = [];
  const fixed: string[] = [];
  const seen = new Set<string>();

  for (const n of numbers) {
    const hasPlus = n.startsWith('+');
    const digitsOnly = n.replace(/\D/g, '');
    const isValid = /^\+?\d+$/.test(n);

    if (!isValid) {
      issues.push({ entry: n, reason: 'non-numeric characters' });
    }

    if (digitsOnly.length === 0) {
      continue;
    }

    if (seen.has(digitsOnly)) {
      issues.push({ entry: n, reason: 'duplicate' });
    } else {
      seen.add(digitsOnly);
      fixed.push((hasPlus ? '+' : '') + digitsOnly);
    }
  }

  return { issues, fixed };
}

export async function promptWhitelist(
  rl: ReadlineInterface,
  write: (text: string) => void,
): Promise<string[] | undefined> {
  write('\n  Whitelist — Only these phone numbers can send commands\n');
  write('  Enter numbers with country code, e.g. +1234567890,+0987654321\n');
  write('  Type "skip" to allow all users (not recommended for production)\n\n');

  for (;;) {
    const raw = await ask(rl, '  Phone numbers (comma-separated) or "skip": ');

    if (raw.toLowerCase() === 'skip') {
      printWarning('Whitelist skipped — ALL users can send commands. Use only for testing!');
      return undefined;
    }

    const numbers = raw
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n.length > 0);

    if (numbers.length === 0) {
      write('  Error: at least one phone number is required or type "skip".\n');
      continue;
    }

    const { issues, fixed } = validateAndFixWhitelist(numbers);

    if (issues.length > 0) {
      for (const { entry, reason } of issues) {
        if (reason === 'duplicate') {
          write(`  Warning: '${entry}' is a duplicate — will be ignored\n`);
        } else {
          write(`  Warning: '${entry}' has ${reason} — only digits and a leading + are allowed\n`);
        }
      }

      const fixAnswer = await ask(rl, '  Fix automatically? (Y/n): ');
      if (fixAnswer.toLowerCase() === 'n') {
        write('  Re-entering numbers...\n');
        continue;
      }

      if (fixed.length === 0) {
        write('  Error: no valid numbers remain after fixes. Please re-enter.\n');
        continue;
      }

      write('\n  Phone numbers to whitelist (fixed):\n');
      fixed.forEach((n, i) => {
        write(`    ${i + 1}. ${n}\n`);
      });
      write('\n');

      const confirm = await ask(rl, '  Confirm? (Y/n): ');
      if (confirm.toLowerCase() === 'n') {
        write('  Re-entering numbers...\n');
        continue;
      }

      return fixed;
    }

    write('\n  Phone numbers to whitelist:\n');
    numbers.forEach((n, i) => {
      write(`    ${i + 1}. ${n}\n`);
    });
    write('\n');

    const confirm = await ask(rl, '  Confirm? (Y/n): ');
    if (confirm.toLowerCase() === 'n') {
      write('  Re-entering numbers...\n');
      continue;
    }

    return numbers;
  }
}

export async function promptDefaultRole(
  rl: ReadlineInterface,
  write: (text: string) => void,
): Promise<string> {
  write('\n  Default Role — Role assigned to whitelisted users on first message\n\n');
  write('    1. owner      Full access — run agents, deploy, manage roles, all commands\n');
  write('    2. developer  Run agents + read operations; cannot manage roles or deploy\n');
  write('    3. viewer     Read-only — /whoami, /history, status queries only\n\n');

  for (;;) {
    const choice = await ask(rl, '  Default role (1/2/3) [default: 1 — owner]: ');
    const normalized = choice.trim().toLowerCase();

    if (normalized === '' || normalized === '1' || normalized === 'owner') {
      printSuccess('Default role: owner');
      return 'owner';
    } else if (normalized === '2' || normalized === 'developer') {
      printSuccess('Default role: developer');
      return 'developer';
    } else if (normalized === '3' || normalized === 'viewer') {
      printSuccess('Default role: viewer');
      return 'viewer';
    } else {
      write('  Error: enter 1, 2, or 3.\n');
    }
  }
}

export async function promptTrustLevel(
  rl: ReadlineInterface,
  write: (text: string) => void,
): Promise<string> {
  write('\n  Trust Level — Controls how much autonomy AI agents have within the workspace\n\n');
  write('    1. sandbox  — Read-only agents, safe for demos and evaluation\n');
  write('    2. standard — AI asks before risky actions (recommended)\n');
  write('    3. trusted  — Full AI autonomy within workspace, no permission prompts\n\n');

  for (;;) {
    const choice = await ask(rl, '  Trust level (1/2/3) [default: 2 — standard]: ');
    const normalized = choice.trim().toLowerCase();

    if (normalized === '' || normalized === '2' || normalized === 'standard') {
      printSuccess('Trust level: standard');
      return 'standard';
    } else if (normalized === '1' || normalized === 'sandbox') {
      printSuccess('Trust level: sandbox');
      return 'sandbox';
    } else if (normalized === '3' || normalized === 'trusted') {
      printSuccess('Trust level: trusted');
      return 'trusted';
    } else {
      write('  Error: enter 1, 2, or 3.\n');
    }
  }
}

export async function promptAIToolInstallation(
  rl: ReadlineInterface,
  toolStatus: AIToolStatus,
  write: (text: string) => void,
): Promise<void> {
  const { claude, codex, aider } = toolStatus;
  const anyInstalled = claude || codex || aider;

  if (anyInstalled) {
    const installed: string[] = [];
    if (claude) installed.push('claude');
    if (codex) installed.push('codex');
    if (aider) installed.push('aider');
    write(`\n  AI tools found — ${installed.join(', ')}\n`);
    const addMore = await ask(rl, '  Install additional AI tools? (y/N): ');
    if (addMore.toLowerCase() !== 'y') return;
  } else {
    write('\n  No AI tools detected. OpenBridge requires at least one to run.\n');
  }

  write('\n    1. Claude Code    npm install -g @anthropic-ai/claude-code\n');
  write('    2. OpenAI Codex   npm install -g @openai/codex\n');
  write('    3. Both\n');
  write('    4. Skip — install later\n\n');

  const choice = await ask(rl, '  Your choice (1/2/3/4): ');

  const toInstall: Array<{ name: string; pkg: string }> = [];
  if (choice === '1' || choice === '3') {
    toInstall.push({ name: 'Claude Code', pkg: '@anthropic-ai/claude-code' });
  }
  if (choice === '2' || choice === '3') {
    toInstall.push({ name: 'OpenAI Codex', pkg: '@openai/codex' });
  }

  let anyNewlyInstalled = false;
  const os = detectOS();

  for (const tool of toInstall) {
    write(`\n  Installing ${tool.name}...\n`);
    const result = await runCommand('npm', ['install', '-g', tool.pkg]);
    if (result.exitCode === 0) {
      printSuccess(`${tool.name} installed successfully`);
      anyNewlyInstalled = true;
    } else {
      printError(`Failed to install ${tool.name}`);
      if (result.stderr) {
        write(result.stderr + '\n');
      }
      write('\n  Suggestions to fix this:\n');
      let n = 1;
      if (os !== 'windows') {
        write(`    ${n++}. Retry with sudo:  sudo npm install -g ${tool.pkg}\n`);
      }
      write(`    ${n++}. Use npx instead:  npx ${tool.pkg} (no install needed, runs on demand)\n`);
      write(`    ${n}. Manual install:   https://www.npmjs.com/package/${tool.pkg}\n`);
      write('\n  Continuing setup — you can install later.\n');
    }
  }

  if (toInstall.length > 0 && !anyNewlyInstalled && !anyInstalled) {
    printWarning('No AI tools installed. OpenBridge needs at least one to function.');
    printWarning('Install one later and restart: npm install -g @anthropic-ai/claude-code');
  }
}

export async function runInit(options: InitOptions = {}): Promise<void> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const outputPath = options.outputPath ?? resolve('config.json');

  const rl = createInterface({ input, output });

  const write = (text: string): void => {
    output.write(text);
  };

  const handleSigint = (): void => {
    write('\n\n  Setup cancelled.\n');
    rl.close();
    process.exit(0);
  };

  process.on('SIGINT', handleSigint);

  try {
    // Step 1: Welcome banner + OS detection
    printStep(1, TOTAL_STEPS, 'Welcome');
    const os = detectOS();
    const osLabel = os === 'macos' ? 'macOS' : os === 'windows' ? 'Windows' : 'Linux';
    const nodeVer = getNodeVersion();
    write(`\n  Welcome to OpenBridge Setup! (${osLabel} ${process.arch}, Node ${nodeVer})\n\n`);

    // Step 2: Prerequisite check
    printStep(2, TOTAL_STEPS, 'Prerequisites');
    write('\n');
    await checkPrerequisites();

    // Step 3: AI tool detection + install
    printStep(3, TOTAL_STEPS, 'AI Tools');
    write('\n');
    const toolStatus = await detectAITools();
    await promptAIToolInstallation(rl, toolStatus, write);

    // Step 4: Account/API key setup
    printStep(4, TOTAL_STEPS, 'Account Setup');
    await setupClaudeAuth(rl, write);
    await setupCodexAuth(rl, write);

    // Step 5: Workspace path
    printStep(5, TOTAL_STEPS, 'Workspace Path');
    write('\n');
    if (existsSync(outputPath)) {
      const overwrite = await ask(rl, '  config.json already exists. Overwrite? (y/N): ');
      if (overwrite.toLowerCase() !== 'y') {
        write('  Aborted.\n');
        return;
      }
    }

    const defaultWorkspace = process.cwd();
    const rawWorkspacePath = await ask(
      rl,
      `  Path to your project [default: ${defaultWorkspace}]: `,
    );
    const workspacePath = resolve(rawWorkspacePath || defaultWorkspace);
    write(`  Resolved path: ${workspacePath}\n`);

    if (!existsSync(workspacePath)) {
      const createIt = await ask(rl, '  Path does not exist. Create it? (y/N): ');
      if (createIt.toLowerCase() === 'y') {
        await mkdir(workspacePath, { recursive: true });
        printSuccess(`Created: ${workspacePath}`);
      } else {
        write('  Error: workspace path does not exist.\n');
        return;
      }
    }

    // Step 6: Connector selection + config
    printStep(6, TOTAL_STEPS, 'Connector Selection');
    write('\n');
    write('    1. WhatsApp — Connect via WhatsApp Web (scans QR code on first run)\n');
    write(
      '    2. Telegram — Connect via Telegram Bot (needs bot token from @BotFather)  \u26a0 requires token\n',
    );
    write(
      '    3. Discord  — Connect via Discord Bot (needs bot token + app ID)           \u26a0 requires token\n',
    );
    write('    4. WebChat  — Built-in web interface (opens in browser)\n');
    write('    5. Console  — Terminal chat (for testing)\n\n');

    const connectorChoice = await ask(rl, '  Your choice (1-5) [default: 5]: ');

    const CONNECTOR_MENU: Record<string, ConnectorType> = {
      '1': 'whatsapp',
      '2': 'telegram',
      '3': 'discord',
      '4': 'webchat',
      '5': 'console',
    };

    const connector = CONNECTOR_MENU[connectorChoice] ?? 'console';
    if (connectorChoice && !CONNECTOR_MENU[connectorChoice]) {
      write(`  Error: invalid connector "${connectorChoice}". Enter a number from 1 to 5.\n`);
      return;
    }

    let connectorOptions: Record<string, unknown> | undefined;
    let prefix = '/ai';

    if (connector === 'whatsapp') {
      write('\n  WhatsApp — First-run setup\n');
      write(
        '  On first run, a QR code will be printed in the terminal. Scan it with\n' +
          '  WhatsApp on your phone (Linked Devices → Link a device). No token needed.\n\n',
      );
      const prefixAnswer = await ask(rl, '  Command prefix (default: /ai): ');
      prefix = prefixAnswer || '/ai';
    } else if (connector === 'telegram') {
      const botToken = await ask(rl, '  Telegram bot token (from @BotFather): ');
      if (!botToken) {
        write('  Error: bot token is required for Telegram.\n');
        return;
      }
      if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
        write(
          '  Warning: token format looks unexpected. Expected format: 123456789:ABCDEFabcdef\n',
        );
      }
      connectorOptions = { token: botToken };
    } else if (connector === 'discord') {
      const botToken = await ask(rl, '  Discord bot token (from Developer Portal): ');
      if (!botToken) {
        write('  Error: bot token is required for Discord.\n');
        return;
      }
      const appId = await ask(rl, '  Discord application ID (from Developer Portal): ');
      connectorOptions = { token: botToken };
      if (appId) {
        connectorOptions['applicationId'] = appId;
      }
    } else if (connector === 'webchat') {
      const portAnswer = await ask(rl, '  HTTP port for WebChat server (default: 3000): ');
      const port = portAnswer ? parseInt(portAnswer, 10) : 3000;
      connectorOptions = { port };
    }
    // console: no extra config needed

    // Step 7: Whitelist setup
    printStep(7, TOTAL_STEPS, 'Whitelist Setup');
    let whitelist: string[] | undefined;
    if (connector === 'whatsapp') {
      whitelist = await promptWhitelist(rl, write);
    } else {
      write(`\n  Whitelist — not required for ${connector} connector\n`);
    }

    // Step 8: Default role
    printStep(8, TOTAL_STEPS, 'Default Role');
    const defaultRole = await promptDefaultRole(rl, write);

    // After default role: trust level
    const trustLevel = await promptTrustLevel(rl, write);

    // Step 9: MCP setup
    printStep(9, TOTAL_STEPS, 'MCP Setup');
    write('\n');
    const mcpServers: McpServerEntry[] = [];
    let mcpConfigPath: string | undefined;
    const mcpAnswer = await ask(rl, '  Enable MCP servers for external service access? (y/N): ');
    if (mcpAnswer.toLowerCase() === 'y') {
      write("  Add MCP servers. Enter 'done' as server name to finish.\n");
      for (;;) {
        const serverName = await ask(rl, "  Server name (or 'done' to finish): ");
        if (!serverName || serverName.toLowerCase() === 'done') break;
        const command = await ask(rl, '  Command (e.g. npx -y @anthropic/canva-mcp-server): ');
        if (command) {
          mcpServers.push({ name: serverName, command });
        }
      }
      const configPathAnswer = await ask(
        rl,
        '  Import MCP config from Claude Desktop? (path or skip): ',
      );
      if (configPathAnswer) {
        mcpConfigPath = configPathAnswer;
      }
    }

    // Step 10: Visibility preferences
    printStep(10, TOTAL_STEPS, 'Visibility Preferences');
    write('\n');
    write('  Sensitive files (.env, *.pem, *.key, credentials.*, etc.) can be\n');
    write('  automatically hidden from AI workers to prevent accidental exposure.\n\n');
    const hideAnswer = await ask(
      rl,
      '  Auto-detect and hide sensitive files? (recommended) (Y/n): ',
    );
    const autoHideSensitiveFiles = hideAnswer.toLowerCase() !== 'n';
    if (autoHideSensitiveFiles) {
      printSuccess('Sensitive files will be hidden from AI workers');
    } else {
      printWarning('Sensitive file hiding disabled — all files visible to AI');
    }

    // Step 11: Config generation
    printStep(11, TOTAL_STEPS, 'Config Generation');
    write('\n');
    const config = buildConfig({
      connector,
      workspacePath,
      whitelist: connector === 'whatsapp' ? whitelist : undefined,
      prefix: connector === 'whatsapp' ? prefix : undefined,
      defaultRole,
      trustLevel,
      mcpServers,
      mcpConfigPath,
      connectorOptions,
      autoHideSensitiveFiles,
    });

    await writeFile(outputPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    write(`  Config written to ${outputPath}\n`);

    // Step 12: Health check
    printStep(12, TOTAL_STEPS, 'Health Check');
    write('\n');
    const healthResult = runHealthCheck(outputPath);
    for (const check of healthResult.checks) {
      if (check.passed) {
        printSuccess(`${check.name} — ${check.message}`);
      } else {
        printError(`${check.name} — ${check.message}`);
      }
    }
    write('\n');
    if (healthResult.passed) {
      printSuccess("All checks passed — you're ready!");
    } else {
      const issueCount = healthResult.checks.filter((c) => !c.passed).length;
      printWarning(`${issueCount} issue${issueCount === 1 ? '' : 's'} found — see above`);
    }
    write('\n');

    // Step 13: Summary
    printStep(13, TOTAL_STEPS, 'Quick Start Summary');
    printQuickStartSummary(write, outputPath, toolStatus, connector, workspacePath);
  } finally {
    rl.close();
    process.removeListener('SIGINT', handleSigint);
  }
}

export function printQuickStartSummary(
  write: (text: string) => void,
  configPath: string,
  toolStatus: AIToolStatus,
  connector: string,
  workspacePath: string,
): void {
  const installedTools: string[] = [];
  if (toolStatus.claude) installedTools.push('claude');
  if (toolStatus.codex) installedTools.push('codex');
  if (toolStatus.aider) installedTools.push('aider');
  const toolsStr = installedTools.length > 0 ? installedTools.join(', ') : 'none detected';

  const divider = '  ' + '═'.repeat(44);
  write('\n');
  write(divider + '\n');
  write('  OpenBridge — Quick Start Summary\n');
  write(divider + '\n');
  write(`  Config:     ${configPath}\n`);
  write(`  AI tools:   ${toolsStr}\n`);
  write(`  Connector:  ${connector}\n`);
  write(`  Workspace:  ${workspacePath}\n`);
  write(divider + '\n');
  write('  Next step:  npm run dev\n');
  write('  Dev mode:   npm run dev:watch\n');
  write(divider + '\n');
  write('\n');
}
