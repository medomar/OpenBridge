import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { type SettingsTabProps } from '../Settings';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type McpServerStatus = 'healthy' | 'error' | 'unknown';

interface McpServer {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
  status: McpServerStatus;
}

interface McpCatalogEntry {
  name: string;
  description?: string;
  command: string;
  args?: string[];
  requiredEnv?: string[];
  category?: string;
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: McpServerStatus }) {
  const colors: Record<McpServerStatus, string> = {
    healthy: 'var(--color-success)',
    error: 'var(--color-error)',
    unknown: 'var(--color-text-muted)',
  };
  const labels: Record<McpServerStatus, string> = {
    healthy: 'Healthy',
    error: 'Error',
    unknown: 'Unknown',
  };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--font-size-sm)',
        color: colors[status],
        border: `1px solid ${colors[status]}`,
        opacity: 0.85,
      }}
    >
      {labels[status]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// MCP Settings Tab
// ---------------------------------------------------------------------------

export default function McpSettings(_props: SettingsTabProps) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bridgeOffline, setBridgeOffline] = useState(false);

  // Add custom server form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCommand, setNewCommand] = useState('');
  const [newArgs, setNewArgs] = useState('');
  const [newEnv, setNewEnv] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Catalog modal
  const [showCatalog, setShowCatalog] = useState(false);
  const [catalog, setCatalog] = useState<McpCatalogEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [connectingEntry, setConnectingEntry] = useState<McpCatalogEntry | null>(null);
  const [connectEnv, setConnectEnv] = useState<Record<string, string>>({});
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Per-server action state
  const [toggling, setToggling] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const loadServers = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setBridgeOffline(false);
    try {
      const result = (await window.openbridge.mcpGetServers()) as
        | { servers: McpServer[] }
        | { bridgeOffline: true };
      if ('bridgeOffline' in result) {
        setBridgeOffline(true);
      } else {
        setServers(result.servers);
      }
    } catch {
      setLoadError('Failed to load MCP servers.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadServers();
  }, [loadServers]);

  // ---------------------------------------------------------------------------
  // Toggle / Remove
  // ---------------------------------------------------------------------------

  async function handleToggle(name: string, enabled: boolean) {
    setToggling(name);
    try {
      await window.openbridge.mcpToggleServer(name, enabled);
      setServers((prev) => prev.map((s) => (s.name === name ? { ...s, enabled } : s)));
    } finally {
      setToggling(null);
    }
  }

  async function handleRemove(name: string) {
    if (!window.confirm(`Remove MCP server "${name}"?`)) return;
    setRemoving(name);
    try {
      await window.openbridge.mcpRemoveServer(name);
      setServers((prev) => prev.filter((s) => s.name !== name));
    } finally {
      setRemoving(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Add custom server
  // ---------------------------------------------------------------------------

  function parseArgs(raw: string): string[] {
    return raw.split(/\s+/).filter(Boolean);
  }

  function parseEnvLines(raw: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) {
        const key = line.slice(0, eq).trim();
        const value = line.slice(eq + 1).trim();
        if (key) result[key] = value;
      }
    }
    return result;
  }

  async function handleAddCustom() {
    if (!newName.trim() || !newCommand.trim()) {
      setAddError('Name and command are required.');
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const body: { name: string; command: string; args?: string[]; env?: Record<string, string> } =
        { name: newName.trim(), command: newCommand.trim() };
      const parsedArgs = parseArgs(newArgs);
      if (parsedArgs.length > 0) body.args = parsedArgs;
      const parsedEnv = parseEnvLines(newEnv);
      if (Object.keys(parsedEnv).length > 0) body.env = parsedEnv;

      const result = await window.openbridge.mcpAddServer(body);
      if (!result.success) {
        setAddError(result.error ?? 'Failed to add server.');
      } else {
        setNewName('');
        setNewCommand('');
        setNewArgs('');
        setNewEnv('');
        setShowAddForm(false);
        await loadServers();
      }
    } finally {
      setAdding(false);
    }
  }

  function resetAddForm() {
    setShowAddForm(false);
    setAddError(null);
    setNewName('');
    setNewCommand('');
    setNewArgs('');
    setNewEnv('');
  }

  // ---------------------------------------------------------------------------
  // Catalog
  // ---------------------------------------------------------------------------

  async function handleOpenCatalog() {
    setShowCatalog(true);
    setCatalogLoading(true);
    setConnectingEntry(null);
    setCatalogSearch('');
    try {
      const result = (await window.openbridge.mcpGetCatalog()) as { entries: McpCatalogEntry[] };
      setCatalog(Array.isArray(result.entries) ? result.entries : []);
    } finally {
      setCatalogLoading(false);
    }
  }

  function closeCatalog() {
    setShowCatalog(false);
    setConnectingEntry(null);
    setCatalogSearch('');
    setConnectError(null);
  }

  function handleSelectCatalogEntry(entry: McpCatalogEntry) {
    const envInit: Record<string, string> = {};
    for (const key of entry.requiredEnv ?? []) envInit[key] = '';
    setConnectEnv(envInit);
    setConnectError(null);
    setConnectingEntry(entry);
  }

  async function handleConnectFromCatalog() {
    if (!connectingEntry) return;
    setConnecting(true);
    setConnectError(null);
    try {
      const result = await window.openbridge.mcpConnectFromCatalog(
        connectingEntry.name,
        connectEnv,
      );
      if (!result.success) {
        setConnectError(result.error ?? 'Failed to connect.');
      } else {
        closeCatalog();
        await loadServers();
      }
    } finally {
      setConnecting(false);
    }
  }

  const filteredCatalog = catalog.filter(
    (e) =>
      catalogSearch === '' ||
      e.name.toLowerCase().includes(catalogSearch.toLowerCase()) ||
      (e.description ?? '').toLowerCase().includes(catalogSearch.toLowerCase()),
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {/* Section header */}
      <section>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            marginBottom: 'var(--space-4)',
            gap: 'var(--space-4)',
          }}
        >
          <div>
            <h2
              style={{
                fontSize: 'var(--font-size-base)',
                fontWeight: 600,
                color: 'var(--color-text)',
                marginBottom: 4,
              }}
            >
              MCP Servers
            </h2>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
              Manage Model Context Protocol servers. Requires the bridge to be running.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
            <Button variant="secondary" onClick={() => void handleOpenCatalog()}>
              Browse Catalog
            </Button>
            <Button onClick={() => setShowAddForm((v) => !v)}>Add Custom</Button>
          </div>
        </div>

        {/* Bridge offline notice */}
        {bridgeOffline && (
          <div
            style={{
              padding: 'var(--space-3) var(--space-4)',
              backgroundColor: 'rgba(234,179,8,0.08)',
              border: '1px solid var(--color-warning)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-warning)',
              fontSize: 'var(--font-size-sm)',
              marginBottom: 'var(--space-4)',
            }}
          >
            Bridge is not running. Start the bridge from the Dashboard to manage MCP servers.
          </div>
        )}

        {/* Load error */}
        {loadError != null && !bridgeOffline && (
          <div
            style={{
              padding: 'var(--space-3) var(--space-4)',
              backgroundColor: 'rgba(243,139,168,0.08)',
              border: '1px solid var(--color-error)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-error)',
              fontSize: 'var(--font-size-sm)',
              marginBottom: 'var(--space-4)',
            }}
          >
            {loadError}{' '}
            <button
              onClick={() => void loadServers()}
              style={{
                background: 'none',
                border: 'none',
                color: 'inherit',
                textDecoration: 'underline',
                cursor: 'pointer',
                fontSize: 'inherit',
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
            Loading…
          </div>
        )}

        {/* Empty state */}
        {!loading && !bridgeOffline && servers.length === 0 && loadError == null && (
          <div
            style={{
              padding: 'var(--space-5)',
              border: '1px dashed var(--color-border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--font-size-sm)',
              textAlign: 'center',
            }}
          >
            No MCP servers configured. Use &ldquo;Browse Catalog&rdquo; or &ldquo;Add Custom&rdquo;
            to get started.
          </div>
        )}

        {/* Server list */}
        {!loading && servers.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {servers.map((server) => (
              <div
                key={server.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-3) var(--space-4)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-surface)',
                }}
              >
                {/* Enable/disable toggle */}
                <input
                  type="checkbox"
                  checked={server.enabled}
                  disabled={toggling === server.name || bridgeOffline}
                  onChange={(e) => void handleToggle(server.name, e.target.checked)}
                  style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
                />

                {/* Server info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)',
                      marginBottom: 2,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 600,
                        color: 'var(--color-text)',
                        fontSize: 'var(--font-size-sm)',
                      }}
                    >
                      {server.name}
                    </span>
                    <StatusBadge status={server.status} />
                    {!server.enabled && (
                      <span
                        style={{
                          fontSize: 'var(--font-size-sm)',
                          color: 'var(--color-text-muted)',
                        }}
                      >
                        (disabled)
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {server.command}
                    {server.args && server.args.length > 0 ? ' ' + server.args.join(' ') : ''}
                  </div>
                </div>

                {/* Remove */}
                <button
                  onClick={() => void handleRemove(server.name)}
                  disabled={removing === server.name || bridgeOffline}
                  title="Remove server"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-text-muted)',
                    cursor: removing === server.name ? 'not-allowed' : 'pointer',
                    fontSize: 20,
                    lineHeight: 1,
                    padding: '2px 6px',
                    borderRadius: 'var(--radius-sm)',
                    flexShrink: 0,
                    opacity: removing === server.name ? 0.4 : 1,
                  }}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Add custom form */}
      {showAddForm && (
        <section
          style={{
            padding: 'var(--space-4)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--color-surface)',
          }}
        >
          <h3
            style={{
              fontSize: 'var(--font-size-base)',
              fontWeight: 600,
              color: 'var(--color-text)',
              marginBottom: 'var(--space-4)',
            }}
          >
            Add Custom MCP Server
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <Input
              label="Name *"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="my-mcp-server"
            />
            <Input
              label="Command *"
              value={newCommand}
              onChange={(e) => setNewCommand(e.target.value)}
              placeholder="npx"
            />
            <Input
              label="Arguments"
              value={newArgs}
              onChange={(e) => setNewArgs(e.target.value)}
              placeholder="-y @modelcontextprotocol/server-filesystem /path/to/dir"
              hint="Space-separated arguments"
            />
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 500,
                  color: 'var(--color-text)',
                  marginBottom: 'var(--space-1)',
                }}
              >
                Environment Variables
              </label>
              <textarea
                value={newEnv}
                onChange={(e) => setNewEnv(e.target.value)}
                placeholder={'API_KEY=your-key\nANOTHER_VAR=value'}
                rows={3}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  fontSize: 'var(--font-size-sm)',
                  fontFamily: 'monospace',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
              <p
                style={{
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-text-muted)',
                  marginTop: 'var(--space-1)',
                }}
              >
                One KEY=value per line
              </p>
            </div>

            {addError != null && (
              <div style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)' }}>
                {addError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <Button
                onClick={() => void handleAddCustom()}
                disabled={adding || !newName.trim() || !newCommand.trim()}
              >
                {adding ? 'Adding…' : 'Add Server'}
              </Button>
              <Button variant="secondary" onClick={resetAddForm}>
                Cancel
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* Catalog modal */}
      {showCatalog && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeCatalog();
          }}
        >
          <div
            style={{
              width: 560,
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
            }}
          >
            {/* Modal header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 'var(--space-4)',
                borderBottom: '1px solid var(--color-border)',
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  fontWeight: 600,
                  color: 'var(--color-text)',
                  fontSize: 'var(--font-size-base)',
                }}
              >
                {connectingEntry != null ? connectingEntry.name : 'MCP Catalog'}
              </span>
              <button
                onClick={closeCatalog}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                  fontSize: 22,
                  lineHeight: 1,
                  padding: '0 4px',
                }}
              >
                &times;
              </button>
            </div>

            {/* Connect env form */}
            {connectingEntry != null ? (
              <div
                style={{
                  padding: 'var(--space-4)',
                  overflowY: 'auto',
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-3)',
                }}
              >
                <button
                  onClick={() => setConnectingEntry(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-accent)',
                    cursor: 'pointer',
                    fontSize: 'var(--font-size-sm)',
                    padding: 0,
                    alignSelf: 'flex-start',
                  }}
                >
                  ← Back to catalog
                </button>
                {connectingEntry.description && (
                  <p
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {connectingEntry.description}
                  </p>
                )}
                {(connectingEntry.requiredEnv ?? []).length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 'var(--space-3)',
                    }}
                  >
                    <p
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text)',
                        fontWeight: 500,
                      }}
                    >
                      Required configuration:
                    </p>
                    {(connectingEntry.requiredEnv ?? []).map((key) => (
                      <Input
                        key={key}
                        label={key}
                        value={connectEnv[key] ?? ''}
                        onChange={(e) =>
                          setConnectEnv((prev) => ({ ...prev, [key]: e.target.value }))
                        }
                        placeholder={key}
                      />
                    ))}
                  </div>
                )}
                {connectError != null && (
                  <div style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)' }}>
                    {connectError}
                  </div>
                )}
                <Button onClick={() => void handleConnectFromCatalog()} disabled={connecting}>
                  {connecting ? 'Connecting…' : 'Connect'}
                </Button>
              </div>
            ) : (
              <>
                {/* Search bar */}
                <div
                  style={{
                    padding: 'var(--space-3) var(--space-4)',
                    borderBottom: '1px solid var(--color-border)',
                    flexShrink: 0,
                  }}
                >
                  <input
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                    placeholder="Search catalog…"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--color-border)',
                      backgroundColor: 'var(--color-bg)',
                      color: 'var(--color-text)',
                      fontSize: 'var(--font-size-sm)',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                {/* Catalog entries */}
                <div style={{ overflowY: 'auto', flex: 1 }}>
                  {catalogLoading && (
                    <div
                      style={{
                        padding: 'var(--space-5)',
                        color: 'var(--color-text-muted)',
                        fontSize: 'var(--font-size-sm)',
                        textAlign: 'center',
                      }}
                    >
                      Loading catalog…
                    </div>
                  )}
                  {!catalogLoading && filteredCatalog.length === 0 && (
                    <div
                      style={{
                        padding: 'var(--space-5)',
                        color: 'var(--color-text-muted)',
                        fontSize: 'var(--font-size-sm)',
                        textAlign: 'center',
                      }}
                    >
                      {catalog.length === 0
                        ? 'Catalog not available — bridge may be offline.'
                        : 'No results.'}
                    </div>
                  )}
                  {!catalogLoading &&
                    filteredCatalog.map((entry) => (
                      <button
                        key={entry.name}
                        onClick={() => handleSelectCatalogEntry(entry)}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: 'var(--space-3) var(--space-4)',
                          border: 'none',
                          borderBottom: '1px solid var(--color-border)',
                          backgroundColor: 'transparent',
                          cursor: 'pointer',
                          color: 'var(--color-text)',
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLElement).style.backgroundColor =
                            'rgba(255,255,255,0.05)';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: 'var(--font-size-sm)',
                            marginBottom: entry.description ? 2 : 0,
                          }}
                        >
                          {entry.name}
                        </div>
                        {entry.description && (
                          <div
                            style={{
                              fontSize: 'var(--font-size-sm)',
                              color: 'var(--color-text-muted)',
                            }}
                          >
                            {entry.description}
                          </div>
                        )}
                      </button>
                    ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
