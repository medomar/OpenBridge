import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Interface as ReadlineInterface } from 'node:readline';
import { createInterface } from 'node:readline';
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

const TOTAL_STEPS = 7;

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
  mcpServers?: McpServerEntry[];
  mcpConfigPath?: string;
  connectorOptions?: Record<string, unknown>;
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
    config['auth'] = {
      whitelist: answers.whitelist,
      prefix: answers.prefix ?? '/ai',
    };
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

  return config;
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

  try {
    const os = detectOS();
    const osLabel = os === 'macos' ? 'macOS' : os === 'windows' ? 'Windows' : 'Linux';
    const nodeVer = getNodeVersion();
    write(`\n  OpenBridge Setup Wizard\n`);
    write(
      `  Welcome to OpenBridge Setup! (${osLabel} ${process.arch}, Node ${nodeVer}) — ${TOTAL_STEPS} steps\n\n`,
    );

    await checkPrerequisites();

    const toolStatus = await detectAITools();
    await promptAIToolInstallation(rl, toolStatus, write);
    await setupClaudeAuth(rl, write);
    await setupCodexAuth(rl, write);

    write('\n  OpenBridge — Configuration Setup\n\n');

    // Check if config.json already exists
    if (existsSync(outputPath)) {
      const overwrite = await ask(rl, '  config.json already exists. Overwrite? (y/N): ');
      if (overwrite.toLowerCase() !== 'y') {
        write('  Aborted.\n');
        return;
      }
    }

    // Question 1: Connector selection
    printStep(4, TOTAL_STEPS, 'Connector Selection');
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

    // Question 2: Workspace path
    printStep(5, TOTAL_STEPS, 'Workspace Path');
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

    let config: Record<string, unknown>;

    if (connector === 'whatsapp') {
      write('\n  WhatsApp — First-run setup\n');
      write(
        '  On first run, a QR code will be printed in the terminal. Scan it with\n' +
          '  WhatsApp on your phone (Linked Devices → Link a device). No token needed.\n\n',
      );

      // Question 3: Phone whitelist (WhatsApp only)
      const whitelistRaw = await ask(
        rl,
        '  Phone whitelist (comma-separated, e.g. +1234567890,+0987654321): ',
      );
      const whitelist = whitelistRaw
        .split(',')
        .map((n) => n.trim())
        .filter((n) => n.length > 0);

      if (whitelist.length === 0) {
        write('  Error: at least one phone number is required.\n');
        return;
      }

      // Question 4: Command prefix (WhatsApp only)
      const prefixAnswer = await ask(rl, '  Command prefix (default: /ai): ');
      const prefix = prefixAnswer || '/ai';

      config = buildConfig({ connector, workspacePath, whitelist, prefix });
    } else if (connector === 'telegram') {
      const botToken = await ask(rl, '  Telegram bot token (from @BotFather): ');
      if (!botToken) {
        write('  Error: bot token is required for Telegram.\n');
        return;
      }
      // Validate Telegram bot token format: digits:alphanumeric
      if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
        write(
          '  Warning: token format looks unexpected. Expected format: 123456789:ABCDEFabcdef\n',
        );
      }
      config = buildConfig({ connector, workspacePath, connectorOptions: { token: botToken } });
    } else if (connector === 'discord') {
      const botToken = await ask(rl, '  Discord bot token (from Developer Portal): ');
      if (!botToken) {
        write('  Error: bot token is required for Discord.\n');
        return;
      }
      const appId = await ask(rl, '  Discord application ID (from Developer Portal): ');
      const connectorOptions: Record<string, unknown> = { token: botToken };
      if (appId) {
        connectorOptions['applicationId'] = appId;
      }
      config = buildConfig({ connector, workspacePath, connectorOptions });
    } else if (connector === 'webchat') {
      const portAnswer = await ask(rl, '  HTTP port for WebChat server (default: 3000): ');
      const port = portAnswer ? parseInt(portAnswer, 10) : 3000;
      const connectorOptions: Record<string, unknown> = { port };
      config = buildConfig({ connector, workspacePath, connectorOptions });
    } else {
      config = buildConfig({ connector, workspacePath });
    }

    // Optional: MCP server configuration
    write('\n');
    const mcpAnswer = await ask(rl, '  Enable MCP servers for external service access? (y/N): ');
    if (mcpAnswer.toLowerCase() === 'y') {
      const servers: McpServerEntry[] = [];
      write("  Add MCP servers. Enter 'done' as server name to finish.\n");
      for (;;) {
        const serverName = await ask(rl, "  Server name (or 'done' to finish): ");
        if (!serverName || serverName.toLowerCase() === 'done') break;
        const command = await ask(rl, '  Command (e.g. npx -y @anthropic/canva-mcp-server): ');
        if (command) {
          servers.push({ name: serverName, command });
        }
      }
      const configPathAnswer = await ask(
        rl,
        '  Import MCP config from Claude Desktop? (path or skip): ',
      );
      if (servers.length > 0 || configPathAnswer) {
        const mcp: Record<string, unknown> = {
          enabled: true,
          servers,
        };
        if (configPathAnswer) {
          mcp['configPath'] = configPathAnswer;
        }
        config['mcp'] = mcp;
      }
    }

    await writeFile(outputPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

    write(`\n  Config written to ${outputPath}\n`);
    write('  To start OpenBridge:\n');
    write('    - Cloned from repo:    npm run dev\n');
    write('    - Installed via npm:   node dist/index.js\n\n');
  } finally {
    rl.close();
  }
}
