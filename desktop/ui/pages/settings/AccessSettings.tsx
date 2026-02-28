import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { type SettingsTabProps } from '../Settings';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AccessEntry {
  user_id: string;
  channel: string;
  role: string;
  active: boolean;
}

type Config = Record<string, unknown>;

function getAuthConfig(config: Config): { whitelist: string[]; allowAll: boolean } {
  const auth = config['auth'];
  if (auth && typeof auth === 'object' && !Array.isArray(auth)) {
    const a = auth as Record<string, unknown>;
    const whitelist = Array.isArray(a['whitelist'])
      ? (a['whitelist'] as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];
    const allowAll = a['allowAll'] === true;
    return { whitelist, allowAll };
  }
  return { whitelist: [], allowAll: false };
}

/** Loose phone-number validation: optional leading +, then 7–15 digits. */
function isValidPhone(raw: string): boolean {
  return /^\+?\d{7,15}$/.test(raw.trim());
}

// ---------------------------------------------------------------------------
// Role / channel options
// ---------------------------------------------------------------------------

const ROLE_OPTIONS = [
  { value: 'owner', label: 'Owner' },
  { value: 'admin', label: 'Admin' },
  { value: 'developer', label: 'Developer' },
  { value: 'viewer', label: 'Viewer' },
  { value: 'custom', label: 'Custom' },
];

const CHANNEL_OPTIONS = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'discord', label: 'Discord' },
  { value: 'webchat', label: 'WebChat' },
  { value: 'console', label: 'Console' },
];

// ---------------------------------------------------------------------------
// Toggle component (reused from AccessStep pattern)
// ---------------------------------------------------------------------------

function AllowAllToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--space-3)',
        padding: 'var(--space-4)',
        borderRadius: 'var(--radius-lg)',
        border: `2px solid ${enabled ? 'var(--color-warning)' : 'var(--color-border)'}`,
        backgroundColor: enabled ? 'rgba(234,179,8,0.06)' : 'var(--color-surface)',
        cursor: 'pointer',
      }}
      onClick={onToggle}
      role="checkbox"
      aria-checked={enabled}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') onToggle();
      }}
    >
      {/* Custom toggle pill */}
      <div
        style={{
          flexShrink: 0,
          marginTop: 2,
          width: 40,
          height: 22,
          borderRadius: 11,
          backgroundColor: enabled ? 'var(--color-warning)' : 'var(--color-border)',
          position: 'relative',
          transition: 'background-color 0.2s',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 3,
            left: enabled ? 21 : 3,
            width: 16,
            height: 16,
            borderRadius: '50%',
            backgroundColor: '#ffffff',
            transition: 'left 0.2s',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }}
        />
      </div>

      <div>
        <div
          style={{
            fontSize: 'var(--font-size-base)',
            fontWeight: 600,
            color: enabled ? 'var(--color-warning)' : 'var(--color-text)',
          }}
        >
          Allow everyone
        </div>
        <div
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-muted)',
            lineHeight: 1.4,
            marginTop: 'var(--space-1)',
          }}
        >
          Any phone number can send commands — not recommended for production
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AccessSettings tab
// ---------------------------------------------------------------------------

export default function AccessSettings({ config, onUpdate }: SettingsTabProps) {
  const { whitelist: initialWhitelist, allowAll: initialAllowAll } = getAuthConfig(config);

  // Whitelist state
  const [whitelist, setWhitelist] = useState<string[]>(initialWhitelist);
  const [allowAll, setAllowAll] = useState(initialAllowAll);
  const [newNumber, setNewNumber] = useState('');
  const [numberError, setNumberError] = useState<string | null>(null);

  // Access rules state (from access_control table)
  const [entries, setEntries] = useState<AccessEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [entriesError, setEntriesError] = useState<string | null>(null);

  // Add access entry form
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [newEntryUserId, setNewEntryUserId] = useState('');
  const [newEntryRole, setNewEntryRole] = useState('viewer');
  const [newEntryChannel, setNewEntryChannel] = useState('whatsapp');
  const [addEntryError, setAddEntryError] = useState<string | null>(null);
  const [addingEntry, setAddingEntry] = useState(false);

  // Per-entry remove state
  const [removingEntry, setRemovingEntry] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Load access_control entries via IPC
  // ---------------------------------------------------------------------------

  const loadEntries = useCallback(async () => {
    setEntriesLoading(true);
    setEntriesError(null);
    try {
      const result = (await window.openbridge.accessList()) as
        | { entries: AccessEntry[] }
        | { error: string }
        | { bridgeNotInitialized: true };
      if ('bridgeNotInitialized' in result) {
        setEntriesError(
          'Bridge not initialized yet — start the bridge at least once to create the database.',
        );
        setEntries([]);
      } else if ('error' in result) {
        setEntriesError(result.error);
        setEntries([]);
      } else {
        setEntries(result.entries);
      }
    } catch {
      setEntriesError('Failed to load access rules.');
    } finally {
      setEntriesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  // ---------------------------------------------------------------------------
  // Whitelist helpers — notify parent via onUpdate
  // ---------------------------------------------------------------------------

  function applyWhitelistUpdate(nextWhitelist: string[], nextAllowAll: boolean) {
    const currentAuth =
      config['auth'] && typeof config['auth'] === 'object' && !Array.isArray(config['auth'])
        ? (config['auth'] as Record<string, unknown>)
        : {};
    onUpdate({ auth: { ...currentAuth, whitelist: nextWhitelist, allowAll: nextAllowAll } }, true);
  }

  function handleToggleAllowAll() {
    const next = !allowAll;
    setAllowAll(next);
    applyWhitelistUpdate(whitelist, next);
  }

  function handleAddNumber() {
    const trimmed = newNumber.trim();
    if (!trimmed) {
      setNumberError('Enter a phone number.');
      return;
    }
    if (!isValidPhone(trimmed)) {
      setNumberError('Invalid number — use digits with optional + prefix (e.g. +15551234567).');
      return;
    }
    if (whitelist.includes(trimmed)) {
      setNumberError('This number is already in the whitelist.');
      return;
    }
    setNumberError(null);
    const next = [...whitelist, trimmed];
    setWhitelist(next);
    setNewNumber('');
    applyWhitelistUpdate(next, allowAll);
  }

  function handleRemoveNumber(number: string) {
    const next = whitelist.filter((n) => n !== number);
    setWhitelist(next);
    applyWhitelistUpdate(next, allowAll);
  }

  function handleNumberKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddNumber();
    }
  }

  // ---------------------------------------------------------------------------
  // Access entries CRUD via IPC
  // ---------------------------------------------------------------------------

  async function handleAddEntry() {
    if (!newEntryUserId.trim()) {
      setAddEntryError('User ID is required.');
      return;
    }
    setAddingEntry(true);
    setAddEntryError(null);
    try {
      const result = await window.openbridge.accessAdd(
        newEntryUserId.trim(),
        newEntryRole,
        newEntryChannel,
      );
      if (!result.success) {
        setAddEntryError(result.error ?? 'Failed to add access entry.');
      } else {
        setNewEntryUserId('');
        setShowAddEntry(false);
        await loadEntries();
      }
    } finally {
      setAddingEntry(false);
    }
  }

  async function handleRemoveEntry(userId: string, channel: string) {
    const key = `${userId}:${channel}`;
    if (!window.confirm(`Remove access for "${userId}" on ${channel}?`)) return;
    setRemovingEntry(key);
    try {
      await window.openbridge.accessRemove(userId, channel);
      await loadEntries();
    } finally {
      setRemovingEntry(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {/* ------------------------------------------------------------------ */}
      {/* Section 1 — Phone Whitelist                                        */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h2
          style={{
            fontSize: 'var(--font-size-base)',
            fontWeight: 600,
            color: 'var(--color-text)',
            marginBottom: 4,
          }}
        >
          Phone Whitelist
        </h2>
        <p
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-muted)',
            marginBottom: 'var(--space-4)',
          }}
        >
          Only whitelisted numbers can send commands to OpenBridge. Changes require a bridge
          restart.
        </p>

        {/* Allow all toggle */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <AllowAllToggle enabled={allowAll} onToggle={handleToggleAllowAll} />
        </div>

        {/* Security warning */}
        {allowAll && (
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-2)',
              alignItems: 'flex-start',
              padding: 'var(--space-3) var(--space-4)',
              marginBottom: 'var(--space-4)',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'rgba(234,179,8,0.12)',
              border: '1px solid rgba(234,179,8,0.4)',
            }}
          >
            <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
            <div
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-text)',
                lineHeight: 1.5,
              }}
            >
              <strong>Security warning:</strong> Anyone who knows your phone number or bot handle
              can control your AI bridge and access your workspace. Enable the whitelist for shared
              or public environments.
            </div>
          </div>
        )}

        {/* Whitelist entries + add form */}
        {!allowAll && (
          <>
            {/* Current numbers */}
            {whitelist.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-2)',
                  marginBottom: 'var(--space-4)',
                }}
              >
                {whitelist.map((number) => (
                  <div
                    key={number}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                      padding: 'var(--space-2) var(--space-4)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'var(--color-surface)',
                    }}
                  >
                    <span
                      style={{
                        flex: 1,
                        fontFamily: 'monospace',
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text)',
                      }}
                    >
                      {number}
                    </span>
                    <button
                      onClick={() => handleRemoveNumber(number)}
                      title={`Remove ${number}`}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--color-text-muted)',
                        cursor: 'pointer',
                        fontSize: 18,
                        lineHeight: 1,
                        padding: '2px 6px',
                        borderRadius: 'var(--radius-sm)',
                        flexShrink: 0,
                      }}
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}

            {whitelist.length === 0 && (
              <div
                style={{
                  padding: 'var(--space-4)',
                  border: '1px dashed var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--color-text-muted)',
                  fontSize: 'var(--font-size-sm)',
                  textAlign: 'center',
                  marginBottom: 'var(--space-4)',
                }}
              >
                No numbers whitelisted. Add a number below.
              </div>
            )}

            {/* Add number */}
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <Input
                  label="Add Phone Number"
                  placeholder="+15551234567"
                  value={newNumber}
                  onChange={(e) => {
                    setNewNumber(e.target.value);
                    setNumberError(null);
                  }}
                  onKeyDown={handleNumberKeyDown}
                />
              </div>
              <Button
                onClick={handleAddNumber}
                disabled={!newNumber.trim()}
                style={{ flexShrink: 0 }}
              >
                Add
              </Button>
            </div>
            {numberError != null && (
              <p
                style={{
                  marginTop: 'var(--space-1)',
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-error)',
                }}
              >
                {numberError}
              </p>
            )}

            {/* Import from contacts — placeholder */}
            <div style={{ marginTop: 'var(--space-3)' }}>
              <button
                disabled
                title="Coming soon"
                style={{
                  background: 'none',
                  border: '1px dashed var(--color-border)',
                  color: 'var(--color-text-muted)',
                  cursor: 'not-allowed',
                  padding: 'var(--space-2) var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--font-size-sm)',
                  opacity: 0.6,
                }}
              >
                Import from contacts (coming soon)
              </button>
            </div>
          </>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Section 2 — Access Rules (access_control table)                   */}
      {/* ------------------------------------------------------------------ */}
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
              Role-Based Access Rules
            </h2>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
              Fine-grained role assignments per user per channel. Uses the{' '}
              <code style={{ fontFamily: 'monospace' }}>access_control</code> database table.
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => setShowAddEntry((v) => !v)}
            style={{ flexShrink: 0 }}
          >
            Add Rule
          </Button>
        </div>

        {/* Add entry form */}
        {showAddEntry && (
          <div
            style={{
              padding: 'var(--space-4)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--color-surface)',
              marginBottom: 'var(--space-4)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
            }}
          >
            <h3
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 600,
                color: 'var(--color-text)',
                margin: 0,
              }}
            >
              Add Access Rule
            </h3>
            <Input
              label="User ID (phone number or username)"
              placeholder="+15551234567"
              value={newEntryUserId}
              onChange={(e) => setNewEntryUserId(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <div style={{ flex: 1 }}>
                <Select
                  label="Role"
                  options={ROLE_OPTIONS}
                  value={newEntryRole}
                  onChange={(e) => setNewEntryRole(e.target.value)}
                />
              </div>
              <div style={{ flex: 1 }}>
                <Select
                  label="Channel"
                  options={CHANNEL_OPTIONS}
                  value={newEntryChannel}
                  onChange={(e) => setNewEntryChannel(e.target.value)}
                />
              </div>
            </div>
            {addEntryError != null && (
              <div style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)' }}>
                {addEntryError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <Button
                onClick={() => void handleAddEntry()}
                disabled={addingEntry || !newEntryUserId.trim()}
              >
                {addingEntry ? 'Adding…' : 'Add Rule'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setShowAddEntry(false);
                  setAddEntryError(null);
                  setNewEntryUserId('');
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Loading */}
        {entriesLoading && (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
            Loading…
          </div>
        )}

        {/* Error */}
        {entriesError != null && !entriesLoading && (
          <div
            style={{
              padding: 'var(--space-3) var(--space-4)',
              backgroundColor: 'rgba(234,179,8,0.08)',
              border: '1px solid var(--color-warning)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-warning)',
              fontSize: 'var(--font-size-sm)',
            }}
          >
            {entriesError}{' '}
            <button
              onClick={() => void loadEntries()}
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

        {/* Empty state */}
        {!entriesLoading && entriesError == null && entries.length === 0 && (
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
            No access rules configured. Use &ldquo;Add Rule&rdquo; to assign roles.
          </div>
        )}

        {/* Entries list */}
        {!entriesLoading && entries.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {entries.map((entry) => {
              const key = `${entry.user_id}:${entry.channel}`;
              const isRemoving = removingEntry === key;
              return (
                <div
                  key={key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-3) var(--space-4)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--color-surface)',
                    opacity: isRemoving ? 0.5 : 1,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-2)',
                        flexWrap: 'wrap',
                      }}
                    >
                      <span
                        style={{
                          fontFamily: 'monospace',
                          fontSize: 'var(--font-size-sm)',
                          fontWeight: 600,
                          color: 'var(--color-text)',
                        }}
                      >
                        {entry.user_id}
                      </span>
                      <span
                        style={{
                          fontSize: 'var(--font-size-sm)',
                          color: 'var(--color-text-muted)',
                        }}
                      >
                        on
                      </span>
                      <span
                        style={{
                          fontSize: 'var(--font-size-sm)',
                          color: 'var(--color-text)',
                          fontWeight: 500,
                        }}
                      >
                        {entry.channel}
                      </span>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '1px 6px',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: 'var(--font-size-sm)',
                          color:
                            entry.role === 'owner' || entry.role === 'admin'
                              ? 'var(--color-accent)'
                              : 'var(--color-text-muted)',
                          border: '1px solid currentColor',
                          opacity: 0.85,
                        }}
                      >
                        {entry.role}
                      </span>
                      {!entry.active && (
                        <span
                          style={{
                            fontSize: 'var(--font-size-sm)',
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          (inactive)
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => void handleRemoveEntry(entry.user_id, entry.channel)}
                    disabled={isRemoving}
                    title="Remove rule"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-text-muted)',
                      cursor: isRemoving ? 'not-allowed' : 'pointer',
                      fontSize: 18,
                      lineHeight: 1,
                      padding: '2px 6px',
                      borderRadius: 'var(--radius-sm)',
                      flexShrink: 0,
                    }}
                  >
                    &times;
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
