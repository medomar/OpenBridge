#!/usr/bin/env node

import { createRequire } from 'node:module';
import { runAccess } from './access.js';
import { runDoctor } from './doctor.js';
import { runInit } from './init.js';
import { runStats } from './stats.js';

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
} else if (command === 'access') {
  try {
    runAccess(process.argv.slice(3));
  } catch (error: unknown) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
} else if (command === 'stats') {
  try {
    runStats();
  } catch (error: unknown) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
} else if (command === 'doctor') {
  try {
    runDoctor();
  } catch (error: unknown) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
} else if (command === '--help' || command === '-h') {
  console.log(`${pkg.name} v${pkg.version}`);
  console.log(pkg.description);
  console.log('');
  console.log('Usage: openbridge <command>');
  console.log('');
  console.log('Commands:');
  console.log('  init      Generate a config.json interactively');
  console.log('  access    Manage per-user access control (add/remove/list)');
  console.log('  stats     Show exploration ROI: tokens spent vs tokens saved');
  console.log('  doctor    Run system health checks and diagnose your setup');
  process.exit(0);
} else if (command === '--version' || command === '-v') {
  console.log(pkg.version);
  process.exit(0);
} else {
  console.log('Usage: openbridge <command>\n');
  console.log('Commands:');
  console.log('  init      Generate a config.json interactively');
  console.log('  access    Manage per-user access control (add/remove/list)');
  console.log('  stats     Show exploration ROI: tokens spent vs tokens saved');
  console.log('  doctor    Run system health checks and diagnose your setup\n');
  process.exit(command === undefined ? 0 : 1);
}
