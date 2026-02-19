#!/usr/bin/env node

import { runInit } from './init.js';

const command = process.argv[2];

if (command === 'init') {
  runInit().catch((error: unknown) => {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
} else {
  console.log('Usage: openbridge <command>\n');
  console.log('Commands:');
  console.log('  init    Generate a config.json interactively\n');
  process.exit(command === undefined ? 0 : 1);
}
