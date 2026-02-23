#!/usr/bin/env node

import { createRequire } from 'node:module';
import { runInit } from './init.js';

const require = createRequire(import.meta.url);

interface PackageJson {
  name: string;
  version: string;
  description: string;
}

const pkg = require('../../package.json') as PackageJson;

const command = process.argv[2];

if (command === 'init') {
  runInit().catch((error: unknown) => {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
} else if (command === '--help' || command === '-h') {
  console.log(`${pkg.name} v${pkg.version}`);
  console.log(pkg.description);
  console.log('');
  console.log('Usage: openbridge <command>');
  console.log('');
  console.log('Commands:');
  console.log('  init    Generate a config.json interactively');
  process.exit(0);
} else if (command === '--version' || command === '-v') {
  console.log(pkg.version);
  process.exit(0);
} else {
  console.log('Usage: openbridge <command>\n');
  console.log('Commands:');
  console.log('  init    Generate a config.json interactively\n');
  process.exit(command === undefined ? 0 : 1);
}
