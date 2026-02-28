import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Interface as ReadlineInterface } from 'node:readline';
import { createInterface } from 'node:readline';
import {
  detectOS,
  getNodeVersion,
  isCommandAvailable,
  meetsNodeVersion,
  printError,
  printSuccess,
  printWarning,
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
}

const VALID_CONNECTORS = ['console', 'whatsapp', 'webchat', 'telegram', 'discord'] as const;

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

function ask(rl: ReadlineInterface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

export function buildConfig(answers: Answers): Record<string, unknown> {
  const config: Record<string, unknown> = {
    workspacePath: answers.workspacePath,
    channels: [{ type: answers.connector, enabled: true }],
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
    const connectorAnswer = await ask(
      rl,
      '  Connector type (console/whatsapp/webchat/telegram/discord) [default: console]: ',
    );
    const connector = connectorAnswer || 'console';

    if (!(VALID_CONNECTORS as readonly string[]).includes(connector)) {
      write(
        `  Error: invalid connector "${connector}". Choose console, whatsapp, webchat, telegram, or discord.\n`,
      );
      return;
    }

    // Question 2: Workspace path
    const workspacePath = await ask(rl, '  Workspace path (absolute path to your project): ');
    if (!workspacePath) {
      write('  Error: workspace path is required.\n');
      return;
    }

    let config: Record<string, unknown>;

    if (connector === 'whatsapp') {
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
      config = buildConfig({ connector, workspacePath });
      const telegramChannels = config['channels'] as Record<string, unknown>[];
      telegramChannels[0]!['botToken'] = botToken;
    } else if (connector === 'discord') {
      const botToken = await ask(rl, '  Discord bot token (from Developer Portal): ');
      if (!botToken) {
        write('  Error: bot token is required for Discord.\n');
        return;
      }
      config = buildConfig({ connector, workspacePath });
      const discordChannels = config['channels'] as Record<string, unknown>[];
      discordChannels[0]!['botToken'] = botToken;
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
