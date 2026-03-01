/**
 * Quick smoke test: discover AI tools → create registry → show model mapping.
 *
 * Run with:  npx tsx scripts/test-model-registry.ts
 */

import { scanForCLITools, selectMaster } from '../src/discovery/tool-scanner.js';
import { createModelRegistry } from '../src/core/model-registry.js';
import { recommendByProfile, recommendByDescription } from '../src/core/model-selector.js';

// ── Step 1: Discover tools ──────────────────────────────────────
const tools = scanForCLITools();
console.log('=== Discovered Tools ===');
if (tools.length === 0) {
  console.log('  (none found)');
} else {
  for (const t of tools) {
    console.log(`  - ${t.name} (v${t.version}) at ${t.path}`);
  }
}

const master = selectMaster(tools);
console.log(`\nMaster tool: ${master?.name ?? 'NONE'}\n`);

// ── Step 2: Create registry from master tool ────────────────────
const providerName = master?.name ?? 'claude';
const registry = createModelRegistry(providerName);

console.log(`=== Model Registry (provider: ${providerName}) ===`);
for (const entry of registry.getAll()) {
  console.log(`  ${entry.tier.padEnd(10)} → ${entry.id} (${entry.provider})`);
}

// ── Step 3: Test recommendations ────────────────────────────────
console.log('\n=== Recommendations ===');
console.log(`  read-only profile → ${recommendByProfile('read-only', registry).model}`);
console.log(`  code-edit profile → ${recommendByProfile('code-edit', registry).model}`);
console.log(`  full-access profile → ${recommendByProfile('full-access', registry).model}`);
console.log(
  `  "Debug the auth"  → ${recommendByDescription('Debug the auth module', registry).model}`,
);
console.log(`  "List all files"  → ${recommendByDescription('List all files', registry).model}`);
console.log(`  "Fix the login"   → ${recommendByDescription('Fix the login bug', registry).model}`);
console.log(
  `  "Implement API"   → ${recommendByDescription('Implement the REST API', registry).model}`,
);

// ── Step 4: Show what happens with a different provider ─────────
console.log('\n=== Simulated: If codex were master ===');
const codexRegistry = createModelRegistry('codex');
for (const entry of codexRegistry.getAll()) {
  console.log(`  ${entry.tier.padEnd(10)} → ${entry.id}`);
}
console.log(`  read-only → ${recommendByProfile('read-only', codexRegistry).model}`);
console.log(`  "Debug"   → ${recommendByDescription('Debug the auth', codexRegistry).model}`);

console.log('\n=== Simulated: If aider were master ===');
const aiderRegistry = createModelRegistry('aider');
for (const entry of aiderRegistry.getAll()) {
  console.log(`  ${entry.tier.padEnd(10)} → ${entry.id}`);
}
console.log(`  read-only → ${recommendByProfile('read-only', aiderRegistry).model}`);
console.log(`  "Debug"   → ${recommendByDescription('Debug the auth', aiderRegistry).model}`);
