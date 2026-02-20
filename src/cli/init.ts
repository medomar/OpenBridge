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
    workspacePath: answers.workspacePath,
    channels: [
      {
        type: 'whatsapp',
        enabled: true,
      },
    ],
    auth: {
      whitelist: answers.whitelist,
      prefix: answers.prefix,
    },
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

    // Question 1: Workspace path
    const workspacePath = await ask(rl, '  Workspace path (absolute path to your project): ');
    if (!workspacePath) {
      write('  Error: workspace path is required.\n');
      return;
    }

    // Question 2: Phone whitelist
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

    // Question 3: Command prefix
    const prefixAnswer = await ask(rl, '  Command prefix (default: /ai): ');
    const prefix = prefixAnswer || '/ai';

    const config = buildConfig({
      workspacePath,
      whitelist,
      prefix,
    });

    await writeFile(outputPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

    write(`\n  Config written to ${outputPath}\n`);
    write('  Run `npm run dev` to start OpenBridge.\n\n');
  } finally {
    rl.close();
  }
}
