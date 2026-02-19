import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Interface as ReadlineInterface } from 'node:readline';
import { createInterface } from 'node:readline';

export interface InitOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  outputPath?: string;
}

interface Answers {
  workspacePath: string;
  whitelist: string[];
  prefix: string;
  sessionName: string;
  logLevel: string;
  rateLimit: boolean;
  healthCheck: boolean;
}

function ask(rl: ReadlineInterface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

export function buildConfig(answers: Answers): Record<string, unknown> {
  return {
    connectors: [
      {
        type: 'whatsapp',
        enabled: true,
        options: {
          sessionName: answers.sessionName,
          sessionPath: '.wwebjs_auth',
        },
      },
    ],
    providers: [
      {
        type: 'claude-code',
        enabled: true,
        options: {
          workspacePath: answers.workspacePath,
          maxTokens: 4096,
        },
      },
    ],
    defaultProvider: 'claude-code',
    auth: {
      whitelist: answers.whitelist,
      prefix: answers.prefix,
      rateLimit: {
        enabled: answers.rateLimit,
        maxMessages: 10,
        windowMs: 60000,
      },
    },
    queue: {
      maxRetries: 3,
      retryDelayMs: 1000,
    },
    health: {
      enabled: answers.healthCheck,
      port: 8080,
    },
    logLevel: answers.logLevel,
  };
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
    write('\n  OpenBridge — Configuration Setup\n\n');

    // Check if config.json already exists
    if (existsSync(outputPath)) {
      const overwrite = await ask(rl, '  config.json already exists. Overwrite? (y/N): ');
      if (overwrite.toLowerCase() !== 'y') {
        write('  Aborted.\n');
        return;
      }
    }

    // Workspace path
    const workspacePath = await ask(rl, '  Workspace path (absolute path to your project): ');
    if (!workspacePath) {
      write('  Error: workspace path is required.\n');
      return;
    }

    // Whitelist
    const whitelistRaw = await ask(
      rl,
      '  Phone whitelist (comma-separated, e.g. +1234567890,+0987654321): ',
    );
    const whitelist = whitelistRaw
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n.length > 0);

    // Prefix
    const prefixAnswer = await ask(rl, '  Command prefix (default: /ai): ');
    const prefix = prefixAnswer || '/ai';

    // Session name
    const sessionAnswer = await ask(rl, '  WhatsApp session name (default: openbridge-default): ');
    const sessionName = sessionAnswer || 'openbridge-default';

    // Log level
    const logLevelAnswer = await ask(
      rl,
      '  Log level (trace/debug/info/warn/error, default: info): ',
    );
    const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
    const logLevel = validLevels.includes(logLevelAnswer) ? logLevelAnswer : 'info';

    // Rate limiting
    const rateLimitAnswer = await ask(rl, '  Enable rate limiting? (Y/n): ');
    const rateLimit = rateLimitAnswer.toLowerCase() !== 'n';

    // Health check
    const healthAnswer = await ask(rl, '  Enable health check endpoint? (y/N): ');
    const healthCheck = healthAnswer.toLowerCase() === 'y';

    const config = buildConfig({
      workspacePath,
      whitelist,
      prefix,
      sessionName,
      logLevel,
      rateLimit,
      healthCheck,
    });

    await writeFile(outputPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

    write(`\n  Config written to ${outputPath}\n`);
    write('  Run `npm run dev` to start OpenBridge.\n\n');
  } finally {
    rl.close();
  }
}
