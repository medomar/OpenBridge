import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
  Bridge,
  loadConfig,
  resolveConfigPath,
  createLogger,
  setLogLevel,
  isV2Config,
} from './core/index.js';
import { injectDevConnectors } from './core/config.js';
import { WorkspaceManager } from './core/workspace-manager.js';
import { V2ConfigSchema } from './types/config.js';
// whatsapp-web.js / puppeteer registers multiple exit handlers — raise the limit to avoid the warning
process.setMaxListeners(20);
import { registerBuiltInConnectors } from './connectors/index.js';
import { registerBuiltInProviders } from './providers/index.js';
import { scanForAITools } from './discovery/index.js';
import { MasterManager } from './master/index.js';
import { createAdapterRegistry } from './core/adapter-registry.js';
import { McpRegistry } from './core/mcp-registry.js';
import type { V2Config } from './types/config.js';
import { runHealthCheck } from './core/health.js';

interface PackageJson {
  version: string;
}
const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as PackageJson;
const OPENBRIDGE_VERSION = _pkg.version;

const logger = createLogger('main');

// Module-level flag prevents double-shutdown when SIGINT and SIGTERM arrive together
let shutdownInProgress = false;

// Safety net: log unhandled rejections so they don't disappear silently
process.on('unhandledRejection', (reason: unknown) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});

// Safety net: log and exit on uncaught exceptions — the process is in an unknown state
process.on('uncaughtException', (error: Error) => {
  logger.fatal({ err: error }, 'Uncaught exception — exiting');
  process.exit(1);
});

/**
 * V0 startup flow (legacy)
 * - Load config
 * - Create bridge
 * - Register plugins
 * - Start bridge
 */
async function startV0Flow(configPath: string): Promise<Bridge> {
  logger.info('Starting V0 flow (legacy mode)');

  const config = await loadConfig();
  setLogLevel(process.env['LOG_LEVEL'] ?? config.logLevel);
  injectDevConnectors(config);
  const bridge = new Bridge(config, { configPath });

  // Register built-in plugins (manual fallback)
  const registry = bridge.getRegistry();
  registerBuiltInConnectors(registry);
  registerBuiltInProviders(registry);

  // Auto-discover additional plugins from connector/provider directories
  const srcDir = path.dirname(fileURLToPath(import.meta.url));
  await registry.discoverPlugins(srcDir);

  await bridge.start();

  const connectorNames = bridge.getActiveConnectorNames();
  if (process.env['OPENBRIDGE_HEADLESS'] === 'true') {
    process.stdout.write(
      JSON.stringify({
        event: 'ready',
        version: OPENBRIDGE_VERSION,
        mode: 'v0',
        connectors: connectorNames,
      }) + '\n',
    );
  } else {
    process.stdout.write(
      `OpenBridge v${OPENBRIDGE_VERSION} | Connectors: ${connectorNames.join(', ') || 'none'}\n`,
    );
    logger.info('OpenBridge (V0) is running. Press Ctrl+C to stop.');
  }

  return bridge;
}

/**
 * V2 startup flow (autonomous AI bridge)
 * - Load config
 * - Discover AI tools
 * - Create bridge
 * - Register plugins
 * - Start bridge
 * - Launch Master AI
 * - Explore workspace autonomously
 */
async function startV2Flow(
  configPath: string,
  v2Config: V2Config,
): Promise<{ bridge: Bridge; workspaceManager: WorkspaceManager }> {
  logger.info('Starting V2 flow (autonomous AI bridge)');

  // Step 0: Resolve workspace path — clone remote repo if needed
  const workspaceManager = new WorkspaceManager(v2Config.workspacePath, {
    pullIntervalSeconds: v2Config.workspace?.pullInterval,
  });
  const resolvedWorkspacePath = await workspaceManager.init();
  if (WorkspaceManager.isRemoteUrl(v2Config.workspacePath)) {
    logger.info({ localPath: resolvedWorkspacePath }, 'Using cloned remote workspace');
  }

  // Step 1: Discover AI tools on the machine
  logger.info('Discovering AI tools...');
  const scanResult = await scanForAITools();

  // --verbose flag enables full tool selection trace logs
  const isVerbose = process.argv.includes('--verbose');

  // Step 1a: Exclude tools if configured — removes them from discovery results entirely
  const excludeTools = v2Config.master?.excludeTools;
  if (excludeTools && excludeTools.length > 0) {
    const excludeSet = new Set(excludeTools.map((t) => t.toLowerCase()));

    // Log reason for each tool that will be excluded
    if (isVerbose) {
      for (const tool of scanResult.cliTools) {
        if (excludeSet.has(tool.name.toLowerCase())) {
          logger.info(`${tool.name} excluded: listed in config.excludeTools`);
        }
      }
    }

    const before = scanResult.cliTools.length;
    scanResult.cliTools = scanResult.cliTools.filter(
      (tool) => !excludeSet.has(tool.name.toLowerCase()),
    );
    if (isVerbose) {
      logger.info(
        { excludeTools, removed: before - scanResult.cliTools.length },
        'Excluded tools from discovery',
      );
    }

    // Re-select master if the current master was excluded
    if (scanResult.master && excludeSet.has(scanResult.master.name.toLowerCase())) {
      scanResult.master = scanResult.cliTools[0] ?? null;
      if (isVerbose && scanResult.master) {
        logger.info(
          { newMaster: scanResult.master.name },
          'Previous master was excluded — auto-selected next available tool',
        );
      }
    }
  }

  // Step 1b: Apply master tool override if configured
  let selectedMaster = scanResult.master;
  // Capture the post-exclusion auto-selected master to detect redundant overrides
  const autoSelectedMaster = scanResult.master;

  if (v2Config.master?.tool) {
    if (isVerbose) {
      logger.info({ override: v2Config.master.tool }, 'Master tool override specified in config');
    }

    // Try to find the tool in discovered tools by name or path
    const overrideTool = scanResult.cliTools.find(
      (tool) =>
        tool.name === v2Config.master?.tool ||
        tool.path === v2Config.master?.tool ||
        tool.path.endsWith(`/${v2Config.master?.tool}`),
    );

    if (overrideTool) {
      selectedMaster = overrideTool;
      // Only log the override selection if it actually changed from the auto-selected master
      if (isVerbose && autoSelectedMaster?.name !== overrideTool.name) {
        logger.info(
          { tool: overrideTool.name },
          'Using overridden Master tool from discovered tools',
        );
      }
    } else {
      logger.warn(
        { requested: v2Config.master.tool },
        'Overridden tool not found in discovered tools — falling back to auto-detected Master',
      );
    }
  }

  if (!selectedMaster) {
    logger.error('No Master AI tool found. V2 flow requires at least one CLI AI tool.');
    logger.error(
      'Install Claude Code CLI (https://claude.ai/download) or another supported AI tool.',
    );
    throw new Error('No Master AI tool available for V2 flow');
  }

  // Provider-aware master selection: map the discovered master tool name to the registered
  // provider factory that will handle its processMessage() calls.
  // Supported: 'claude' / 'claude-code' → 'claude-code', 'codex' → 'codex'.
  // Fail early with a clear error if the selected master has no matching provider.
  const MASTER_PROVIDER_MAP: Record<string, string> = {
    claude: 'claude-code',
    'claude-code': 'claude-code',
    codex: 'codex',
  };
  const masterProviderName = MASTER_PROVIDER_MAP[selectedMaster.name];
  if (masterProviderName === undefined) {
    throw new Error(
      `No AI provider available for master tool '${selectedMaster.name}'. ` +
        `Supported options: 'claude' (requires Claude Code CLI) or 'codex' (requires Codex CLI — authenticate via 'codex login' or OPENAI_API_KEY).`,
    );
  }

  // Single summary log — always shown regardless of verbosity
  {
    const summaryParts: string[] = [];
    if (excludeTools?.length) {
      summaryParts.push(`${excludeTools.join(', ')} excluded per config.excludeTools`);
    }
    // Only note the override if it actually changed the selection from auto-detected
    if (
      v2Config.master?.tool &&
      selectedMaster.name === v2Config.master.tool &&
      autoSelectedMaster?.name !== v2Config.master.tool
    ) {
      summaryParts.push('override: config.master.tool');
    }
    const suffix = summaryParts.length ? ` (${summaryParts.join('; ')})` : '';
    logger.info(`Master AI: ${selectedMaster.name}${suffix}`);
  }
  if (isVerbose) {
    logger.info(
      {
        master: selectedMaster.name,
        provider: masterProviderName,
        totalTools: scanResult.cliTools.length + scanResult.vscodeExtensions.length,
        cliTools: scanResult.cliTools.length,
        vscodeExtensions: scanResult.vscodeExtensions.length,
      },
      'AI tool discovery complete',
    );
  }

  // Step 2: Load config and create bridge
  const config = await loadConfig();
  setLogLevel(process.env['LOG_LEVEL'] ?? config.logLevel);
  injectDevConnectors(config);

  // Create MCP registry from config — only when MCP is enabled and servers are configured
  const mcpServers = v2Config.mcp?.enabled !== false ? (v2Config.mcp?.servers ?? []) : [];
  const mcpRegistry = new McpRegistry(configPath, mcpServers);

  const bridge = new Bridge(config, {
    configPath,
    workspacePath: resolvedWorkspacePath,
    mcpRegistry,
    securityConfig: v2Config.security,
    workspaceInclude: v2Config.workspace?.include,
    workspaceExclude: v2Config.workspace?.exclude,
    discoveredTools: scanResult.cliTools,
  });

  // Register built-in plugins
  const registry = bridge.getRegistry();
  registerBuiltInConnectors(registry);
  registerBuiltInProviders(registry);

  // Auto-discover additional plugins
  const srcDir = path.dirname(fileURLToPath(import.meta.url));
  await registry.discoverPlugins(srcDir);

  // Step 3: Create Master AI and wire into bridge BEFORE starting
  logger.info({ workspacePath: resolvedWorkspacePath }, 'Launching Master AI...');

  // Resolve CLI adapter based on the discovered master tool
  const adapterRegistry = createAdapterRegistry();
  const cliAdapter = adapterRegistry.getForTool(selectedMaster);

  const masterManager = new MasterManager({
    workspacePath: resolvedWorkspacePath,
    masterTool: selectedMaster,
    discoveredTools: scanResult.cliTools,
    memory: bridge.getMemory() ?? undefined,
    adapter: cliAdapter,
    adapterRegistry,
    mcpServers: v2Config.mcp?.enabled !== false ? (v2Config.mcp?.servers ?? []) : [],
    deepConfig: v2Config.deep,
    workspaceExclude: v2Config.workspace?.exclude,
    workspaceInclude: v2Config.workspace?.include,
    workerMaxFixIterations: v2Config.worker?.maxFixIterations,
  });

  // Wire workspace polling callback — triggers re-exploration on new commits
  workspaceManager.setOnChangesDetected(() => {
    logger.info('Remote workspace changes detected — scheduling re-exploration');
    void masterManager.reExplore().catch((err: unknown) => {
      logger.error({ err }, 'Re-exploration after remote pull failed');
    });
  });

  // Wire Master into the bridge router (must happen before start)
  bridge.setMaster(masterManager);

  // Wire email config if provided
  if (v2Config.email) {
    bridge.setEmailConfig(v2Config.email);
    logger.info('Email config wired into bridge');
  }

  // Wire AppServer with resource limits from config
  {
    const { AppServer } = await import('./core/app-server.js');
    const appsConfig = v2Config.apps;
    const appServer = new AppServer({
      maxConcurrent: appsConfig?.maxConcurrent,
      maxMemoryMB: appsConfig?.maxMemoryMB,
      idleTimeoutMs:
        appsConfig?.idleTimeoutMinutes !== undefined
          ? appsConfig.idleTimeoutMinutes * 60 * 1000
          : undefined,
    });
    await appServer.scanUsedPorts();
    bridge.setAppServer(appServer);
    logger.info(
      {
        maxConcurrent: appServer.maxConcurrent,
        maxMemoryMB: appServer.maxMemoryMB,
        idleTimeoutMinutes: appsConfig?.idleTimeoutMinutes ?? 30,
      },
      'AppServer wired into bridge',
    );
  }

  // Step 4: Start bridge first — this initializes MemoryManager (SQLite) via memory.init().
  // MasterManager holds a reference to the MemoryManager but must not use it until init() completes.
  // Running bridge.start() first eliminates the race condition where MasterManager reads from
  // the DB before it is open (this.db would be null, causing 'MemoryManager not initialised' errors).
  await bridge.start();

  // Re-sync MasterManager's memory reference after bridge.start() —
  // if MemoryManager.init() failed, bridge.start() sets bridge.memory to null,
  // but MasterManager still holds the old (uninitialised) reference.
  masterManager.memory = bridge.getMemory();

  // Inform MasterManager which connectors are active — included in the Master system prompt
  // so the Master knows which SHARE targets are available (e.g. whatsapp, telegram, console).
  masterManager.setActiveConnectorNames(bridge.getActiveConnectorNames());

  // Inform MasterManager of the file server port — included in the Master system prompt
  // so the Master knows it can reference generated files via http://localhost:<port>/shared/<filename>.
  const fileServerPort = bridge.getFileServerPort();
  if (fileServerPort !== null) {
    masterManager.setFileServerPort(fileServerPort);
  }

  // Inform MasterManager of the tunnel public URL — included in the Master system prompt
  // so the Master knows generated files are publicly accessible (not just on localhost).
  const tunnelUrl = bridge.getTunnelUrl();
  if (tunnelUrl !== null) {
    masterManager.setTunnelUrl(tunnelUrl);
  }

  // Wire MCP servers into the health endpoint (runs after bridge.start() initialises the health server)
  if (v2Config.mcp?.enabled !== false && (v2Config.mcp?.servers ?? []).length > 0) {
    bridge.setMcpServers(v2Config.mcp?.servers ?? []);
  }

  // Step 5: Start Master AI in the background — bridge is already serving messages.
  // This loads workspace-map.json and transitions from 'idle' to 'ready'.
  // masterManager.start() can take minutes (workspace exploration) so we don't await it.
  masterManager.start().catch((error: unknown) => {
    logger.error(
      { err: error },
      'Master AI exploration failed — bridge continues running without workspace context',
    );
  });

  // Step 6: Start remote workspace polling (no-op for local workspaces)
  workspaceManager.startPolling();

  const connectorNames = bridge.getActiveConnectorNames();
  const webChatInfo = bridge.getWebChatInfo();
  if (process.env['OPENBRIDGE_HEADLESS'] === 'true') {
    const payload: Record<string, unknown> = {
      event: 'ready',
      version: OPENBRIDGE_VERSION,
      mode: 'v2',
      master: selectedMaster.name,
      connectors: connectorNames,
    };
    if (webChatInfo) {
      payload['webChatUrl'] = webChatInfo.url;
      payload['webChatToken'] = webChatInfo.token;
    }
    process.stdout.write(JSON.stringify(payload) + '\n');
  } else {
    process.stdout.write(
      `OpenBridge v${OPENBRIDGE_VERSION} | Master: ${selectedMaster.name} | Connectors: ${connectorNames.join(', ') || 'none'}\n`,
    );
    if (webChatInfo) {
      process.stdout.write(`WebChat URL:   ${webChatInfo.url}\n`);
      process.stdout.write(`WebChat token: ${webChatInfo.token}\n`);
      // QR code for phone scanning is displayed by the WebChat connector
      // during initialize() using the LAN URL (or tunnel URL if active).
    }
    logger.info('OpenBridge (V2) is running. Master AI is exploring workspace...');
    logger.info('Press Ctrl+C to stop.');
  }

  return { bridge, workspaceManager };
}

/**
 * Detect config version and route to appropriate startup flow
 */
async function detectConfigVersion(configPath: string): Promise<'v0' | 'v2'> {
  try {
    const raw = await readFile(configPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);

    if (isV2Config(parsed)) {
      return 'v2';
    }

    return 'v0';
  } catch (error) {
    // ENOENT: rethrow without logging — main() will show an actionable message
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.error({ err: error }, 'Failed to detect config version');
    }
    throw error;
  }
}

async function main(): Promise<void> {
  // Detect headless mode: --headless CLI flag or OPENBRIDGE_HEADLESS env var
  const isHeadless =
    process.argv.includes('--headless') || process.env['OPENBRIDGE_HEADLESS'] === 'true';
  if (isHeadless) {
    process.env['OPENBRIDGE_HEADLESS'] = 'true';
  }

  logger.info({ headless: isHeadless }, 'OpenBridge starting...');

  let bridge: Bridge | null = null;
  let workspaceManager: WorkspaceManager | null = null;
  let configPath: string | undefined;

  try {
    configPath = resolveConfigPath();

    // Detect config version
    const version = await detectConfigVersion(configPath);

    if (version === 'v2') {
      // V2 flow: autonomous AI bridge with Master
      const raw = await readFile(configPath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      const v2Config = V2ConfigSchema.parse(parsed);
      const result = await startV2Flow(configPath, v2Config);
      bridge = result.bridge;
      workspaceManager = result.workspaceManager;
    } else {
      // V0 flow: legacy mode (backward compatibility)
      bridge = await startV0Flow(configPath);
    }

    // Graceful shutdown — guarded against concurrent SIGINT + SIGTERM
    const shutdown = async (): Promise<void> => {
      if (shutdownInProgress) {
        logger.warn('Shutdown already in progress — ignoring duplicate signal');
        return;
      }
      shutdownInProgress = true;
      console.log('\nShutting down gracefully... please wait');
      logger.info('Shutting down...');
      workspaceManager?.stopPolling();
      if (bridge) {
        await Promise.race([
          bridge.stop(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Shutdown timeout')), 10_000),
          ),
        ]).catch((err: unknown) => {
          if (err instanceof Error && err.message === 'Shutdown timeout') {
            console.error('Shutdown timeout exceeded (10s) — forcing exit');
            process.exit(1);
          }
          throw err;
        });
      }
      process.exit(0);
    };

    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
    // SIGHUP: reload is handled by ConfigWatcher (file-change events) — ignore gracefully
    process.on('SIGHUP', () => {
      logger.info('SIGHUP received — config hot-reload is file-driven, ignoring signal');
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const resolvedPath = configPath ?? 'config.json';
      logger.error(
        `Config file not found: ${resolvedPath}. Create one by running: npx openbridge init`,
      );
    } else {
      logger.fatal({ err: error }, 'Failed to start OpenBridge');
    }
    process.exit(1);
  }
}

// Handle --version flag for the packaged binary entry point
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  process.stdout.write(OPENBRIDGE_VERSION + '\n');
  // Defer exit to let Pino's sonic-boom stream finish initialization
  setTimeout(() => process.exit(0), 50);
} else if (process.argv.includes('--health')) {
  // Handle --health flag for the packaged binary entry point
  const result = runHealthCheck();
  process.stdout.write(JSON.stringify(result) + '\n');
  setTimeout(() => process.exit(result.passed ? 0 : 1), 50);
} else {
  void main();
}
