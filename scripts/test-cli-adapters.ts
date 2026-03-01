/**
 * Smoke test: Full CLI adapter pipeline — discovery → adapter → spawn config → execution.
 *
 * Run with:  npx tsx scripts/test-cli-adapters.ts
 *
 * Tests 3 things:
 * 1. Discovery: which AI tools are installed?
 * 2. Adapter resolution: does each tool get the right adapter?
 * 3. Spawn config: what binary + args would each adapter produce?
 * 4. Live execution: actually run a simple prompt with each available tool
 */

import { scanForCLITools, selectMaster } from '../src/discovery/tool-scanner.js';
import { createAdapterRegistry } from '../src/core/adapter-registry.js';
import { createModelRegistry } from '../src/core/model-registry.js';
import { AgentRunner } from '../src/core/agent-runner.js';
import type { SpawnOptions } from '../src/core/agent-runner.js';

const SEP = '─'.repeat(60);

// ── Step 1: Discover tools ──────────────────────────────────────
console.log(`\n${SEP}`);
console.log('STEP 1: Tool Discovery');
console.log(SEP);

const tools = scanForCLITools();
if (tools.length === 0) {
  console.log('  No AI tools found on PATH. Install claude, codex, or aider.');
  process.exit(1);
}
for (const t of tools) {
  console.log(`  ✓ ${t.name} (v${t.version}) at ${t.path}`);
}

const master = selectMaster(tools);
console.log(`\n  Master: ${master?.name ?? 'NONE'}`);

// ── Step 2: Adapter resolution ──────────────────────────────────
console.log(`\n${SEP}`);
console.log('STEP 2: Adapter Resolution');
console.log(SEP);

const adapterRegistry = createAdapterRegistry();
for (const tool of tools) {
  const adapter = adapterRegistry.getForTool(tool);
  if (adapter) {
    console.log(`  ✓ ${tool.name} → ${adapter.constructor.name} (binary: "${adapter.name}")`);
  } else {
    console.log(`  ✗ ${tool.name} → no adapter (would fall back to Claude)`);
  }
}

// ── Step 3: Spawn config comparison ─────────────────────────────
console.log(`\n${SEP}`);
console.log('STEP 3: Spawn Config Comparison');
console.log(SEP);

const testOpts: SpawnOptions = {
  prompt: 'What is 2+2? Reply with just the number.',
  workspacePath: process.cwd(),
  model: 'fast',
  allowedTools: ['Read', 'Glob', 'Grep'],
  maxTurns: 5,
  systemPrompt: 'Be concise.',
};

for (const tool of tools) {
  const adapter = adapterRegistry.getForTool(tool);
  if (!adapter) continue;

  // Resolve model via registry
  const registry = createModelRegistry(tool.name);
  const resolvedModel = registry.resolveModelOrTier('fast');
  const opts = { ...testOpts, model: resolvedModel };

  const config = adapter.buildSpawnConfig(opts);
  console.log(`\n  ${tool.name.toUpperCase()} (model: ${resolvedModel}):`);
  console.log(`    binary: ${config.binary}`);
  console.log(`    args:   ${JSON.stringify(config.args).slice(0, 200)}`);
}

// ── Step 4: Live execution ──────────────────────────────────────
console.log(`\n${SEP}`);
console.log('STEP 4: Live Execution (simple prompt with each tool)');
console.log(SEP);

const livePrompt = 'What is 2+2? Reply with only the number, nothing else.';

for (const tool of tools) {
  const adapter = adapterRegistry.getForTool(tool);
  if (!adapter) {
    console.log(`\n  ${tool.name}: skipped (no adapter)`);
    continue;
  }

  const registry = createModelRegistry(tool.name);
  const resolvedModel = registry.resolveModelOrTier('fast');

  console.log(`\n  ${tool.name.toUpperCase()} (model: ${resolvedModel}):`);

  const runner = new AgentRunner(adapter);
  try {
    const result = await runner.spawn({
      prompt: livePrompt,
      workspacePath: process.cwd(),
      model: resolvedModel,
      maxTurns: 3,
      timeout: 30_000,
      retries: 0,
    });

    const output = result.stdout.trim().slice(0, 200);
    console.log(`    exit: ${result.exitCode}`);
    console.log(`    time: ${result.durationMs}ms`);
    console.log(`    output: "${output}"`);
    console.log(`    ✓ SUCCESS`);
  } catch (err) {
    console.log(`    ✗ FAILED: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
  }
}

console.log(`\n${SEP}`);
console.log('Done.');
console.log(SEP);
