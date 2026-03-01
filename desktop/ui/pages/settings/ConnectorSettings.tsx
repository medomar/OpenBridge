import { useState } from 'react';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { type SettingsTabProps } from '../Settings';

// ---------------------------------------------------------------------------
// Connector definitions (mirrors ConnectorStep in the setup wizard)
// ---------------------------------------------------------------------------

interface ConfigField {
  key: string;
  label: string;
  placeholder: string;
  hint?: string;
  validate?: (value: string) => boolean;
  validationError?: string;
}

interface ConnectorDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  configFields?: ConfigField[];
}

const CONNECTOR_DEFS: ConnectorDef[] = [
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    icon: '📱',
    description: 'Scans QR code',
  },
  {
    id: 'telegram',
    name: 'Telegram',
    icon: '✈️',
    description: 'Enter bot token',
    configFields: [
      {
        key: 'botToken',
        label: 'Bot Token',
        placeholder: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
        hint: 'Get a token from @BotFather on Telegram',
        validate: (v) => /^\d+:[A-Za-z0-9_-]{35,}$/.test(v),
        validationError: 'Invalid bot token format (should be digits:alphanumeric)',
      },
    ],
  },
  {
    id: 'discord',
    name: 'Discord',
    icon: '🎮',
    description: 'Enter bot token',
    configFields: [
      {
        key: 'botToken',
        label: 'Bot Token',
        placeholder: 'MTExMjI…',
        hint: 'Get a token from the Discord Developer Portal',
        validate: (v) => v.trim().length >= 50,
        validationError: 'Bot token appears too short',
      },
      {
        key: 'applicationId',
        label: 'Application ID',
        placeholder: '1234567890123456789',
        hint: 'Found in the Discord Developer Portal under General Information',
        validate: (v) => /^\d{17,20}$/.test(v.trim()),
        validationError: 'Application ID should be a 17–20 digit number',
      },
    ],
  },
  {
    id: 'webchat',
    name: 'WebChat',
    icon: '🌐',
    description: 'Built-in web UI',
  },
  {
    id: 'console',
    name: 'Console',
    icon: '💻',
    description: 'For testing',
  },
];

function getConnectorDef(type: string): ConnectorDef | undefined {
  return CONNECTOR_DEFS.find((c) => c.id === type);
}

// ---------------------------------------------------------------------------
// Channel entry shape (from config.channels)
// ---------------------------------------------------------------------------

interface ChannelEntry {
  type: string;
  enabled: boolean;
  [key: string]: unknown;
}

function parseChannels(config: Record<string, unknown>): ChannelEntry[] {
  if (!Array.isArray(config.channels)) return [];
  return config.channels
    .filter(
      (ch): ch is Record<string, unknown> =>
        ch !== null &&
        typeof ch === 'object' &&
        typeof (ch as Record<string, unknown>).type === 'string',
    )
    .map((ch) => ({
      ...ch,
      type: ch.type as string,
      enabled: ch.enabled !== false,
    }));
}

/** Extract connector-specific field values from a channel entry. */
function extractFieldValues(channel: ChannelEntry, def: ConnectorDef): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of def.configFields ?? []) {
    const direct = channel[field.key];
    if (typeof direct === 'string') {
      result[field.key] = direct;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Modal for adding or editing a connector
// ---------------------------------------------------------------------------

interface ConnectorModalProps {
  /** null = add mode, ChannelEntry = edit mode */
  initial: ChannelEntry | null;
  onConfirm: (channel: ChannelEntry) => void;
  onCancel: () => void;
}

function isModalValid(selectedId: string | null, fieldValues: Record<string, string>): boolean {
  if (!selectedId) return false;
  const def = getConnectorDef(selectedId);
  if (!def) return false;
  for (const field of def.configFields ?? []) {
    const val = fieldValues[field.key] ?? '';
    if (!val.trim()) return false;
    if (field.validate && !field.validate(val)) return false;
  }
  return true;
}

function ConnectorModal({ initial, onConfirm, onCancel }: ConnectorModalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(initial?.type ?? null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(
    initial && selectedId
      ? extractFieldValues(
          initial,
          getConnectorDef(initial.type) ?? {
            id: initial.type,
            name: initial.type,
            icon: '',
            configFields: [],
          },
        )
      : {},
  );
  const [fieldDirty, setFieldDirty] = useState<Record<string, boolean>>({});

  const selectedDef = selectedId ? getConnectorDef(selectedId) : null;
  const valid = isModalValid(selectedId, fieldValues);

  function handleSelectType(id: string) {
    if (id === selectedId) return;
    setSelectedId(id);
    setFieldValues({});
    setFieldDirty({});
  }

  function handleFieldChange(key: string, value: string) {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
    setFieldDirty((prev) => ({ ...prev, [key]: true }));
  }

  function handleConfirm() {
    if (!selectedId || !valid) return;
    const channel: ChannelEntry = {
      type: selectedId,
      enabled: initial?.enabled ?? true,
      ...fieldValues,
    };
    onConfirm(channel);
  }

  return (
    /* Backdrop */
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: 'var(--space-6)',
      }}
    >
      {/* Dialog */}
      <div
        style={{
          backgroundColor: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-xl)',
          padding: 'var(--space-6)',
          width: '100%',
          maxWidth: 520,
          maxHeight: '80vh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-5)',
        }}
      >
        <h3
          style={{
            fontSize: 'var(--font-size-lg)',
            fontWeight: 700,
            color: 'var(--color-text)',
            margin: 0,
          }}
        >
          {initial ? 'Edit Connector' : 'Add Connector'}
        </h3>

        {/* Connector type grid — disabled in edit mode (can't change type) */}
        {!initial && (
          <div>
            <p
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 500,
                color: 'var(--color-text)',
                marginBottom: 'var(--space-3)',
              }}
            >
              Select connector type
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
                gap: 'var(--space-2)',
              }}
            >
              {CONNECTOR_DEFS.map((connector) => {
                const isSelected = selectedId === connector.id;
                return (
                  <button
                    key={connector.id}
                    onClick={() => handleSelectType(connector.id)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 'var(--space-1)',
                      padding: 'var(--space-3) var(--space-2)',
                      borderRadius: 'var(--radius-lg)',
                      border: `2px solid ${isSelected ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      backgroundColor: isSelected
                        ? 'rgba(59,130,246,0.06)'
                        : 'var(--color-surface)',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      outline: 'none',
                      textAlign: 'center',
                    }}
                  >
                    <span style={{ fontSize: 22, lineHeight: 1 }}>{connector.icon}</span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: isSelected ? 600 : 500,
                        color: isSelected ? 'var(--color-accent)' : 'var(--color-text)',
                      }}
                    >
                      {connector.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Config fields */}
        {selectedDef && (selectedDef.configFields ?? []).length > 0 && (
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-4)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-4)',
            }}
          >
            <span
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 600,
                color: 'var(--color-text)',
              }}
            >
              {selectedDef.name} Configuration
            </span>
            {selectedDef.configFields?.map((field) => {
              const value = fieldValues[field.key] ?? '';
              const dirty = fieldDirty[field.key] ?? false;
              const isInvalid = dirty && !!field.validate && !field.validate(value);
              const isValid = dirty && value.trim().length > 0 && !isInvalid;
              return (
                <Input
                  key={field.key}
                  label={field.label}
                  placeholder={field.placeholder}
                  value={value}
                  onChange={(e) => handleFieldChange(field.key, e.target.value)}
                  validationState={isValid ? 'valid' : isInvalid ? 'invalid' : 'default'}
                  errorMessage={isInvalid ? field.validationError : undefined}
                  hint={!dirty && field.hint ? field.hint : undefined}
                />
              );
            })}
          </div>
        )}

        {/* Info notes (same as ConnectorStep) */}
        {selectedId === 'whatsapp' && (
          <p
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-muted)',
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            A QR code will appear in the terminal on first run. Scan it with WhatsApp (Linked
            Devices) to connect.
          </p>
        )}
        {selectedId === 'console' && (
          <p
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-muted)',
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            Console mode runs in the terminal — useful for testing without a messaging platform.
          </p>
        )}
        {selectedId === 'webchat' && (
          <p
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-muted)',
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            A browser-based chat UI opens automatically when the bridge starts. No external accounts
            needed.
          </p>
        )}

        {/* Footer buttons */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 'var(--space-3)',
          }}
        >
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!valid}>
            {initial ? 'Save Changes' : 'Add Connector'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connector card
// ---------------------------------------------------------------------------

interface ConnectorCardProps {
  channel: ChannelEntry;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
}

function ConnectorCard({ channel, onToggle, onEdit, onRemove }: ConnectorCardProps) {
  const def = getConnectorDef(channel.type);
  const name = def?.name ?? channel.type;
  const icon = def?.icon ?? '🔌';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-4)',
        padding: 'var(--space-4)',
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      {/* Icon + name */}
      <span style={{ fontSize: 24, flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 'var(--font-size-base)',
            fontWeight: 600,
            color: 'var(--color-text)',
          }}
        >
          {name}
        </div>
        {!channel.enabled && (
          <div
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-muted)',
              marginTop: 2,
            }}
          >
            Disabled
          </div>
        )}
      </div>

      {/* Enable / disable toggle */}
      <label
        title={channel.enabled ? 'Disable connector' : 'Enable connector'}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <input
          type="checkbox"
          checked={channel.enabled}
          onChange={onToggle}
          style={{ width: 16, height: 16, cursor: 'pointer' }}
        />
        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
          {channel.enabled ? 'Enabled' : 'Disabled'}
        </span>
      </label>

      {/* Edit */}
      <Button variant="secondary" onClick={onEdit} style={{ flexShrink: 0 }}>
        Edit
      </Button>

      {/* Remove */}
      <Button variant="danger" onClick={onRemove} style={{ flexShrink: 0 }}>
        Remove
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConnectorSettings tab
// ---------------------------------------------------------------------------

export default function ConnectorSettings({ config, onUpdate }: SettingsTabProps) {
  const [channels, setChannels] = useState<ChannelEntry[]>(() => parseChannels(config));
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null);
  const [editIndex, setEditIndex] = useState<number | null>(null);

  function commitChannels(next: ChannelEntry[]) {
    setChannels(next);
    onUpdate({ channels: next }, true);
  }

  function handleToggle(index: number) {
    const next = channels.map((ch, i) => (i === index ? { ...ch, enabled: !ch.enabled } : ch));
    commitChannels(next);
  }

  function handleRemove(index: number) {
    const next = channels.filter((_, i) => i !== index);
    commitChannels(next);
  }

  function handleEdit(index: number) {
    setEditIndex(index);
    setModalMode('edit');
  }

  function handleModalConfirm(channel: ChannelEntry) {
    if (modalMode === 'add') {
      commitChannels([...channels, channel]);
    } else if (modalMode === 'edit' && editIndex !== null) {
      const next = channels.map((ch, i) => (i === editIndex ? channel : ch));
      commitChannels(next);
    }
    setModalMode(null);
    setEditIndex(null);
  }

  function handleModalCancel() {
    setModalMode(null);
    setEditIndex(null);
  }

  const editChannel = editIndex !== null ? channels[editIndex] : null;

  return (
    <>
      <div
        style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}
      >
        {/* Header row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-4)',
          }}
        >
          <div>
            <h2
              style={{
                fontSize: 'var(--font-size-base)',
                fontWeight: 600,
                color: 'var(--color-text)',
                margin: 0,
              }}
            >
              Configured Connectors
            </h2>
            <p
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-text-muted)',
                margin: 'var(--space-1) 0 0 0',
              }}
            >
              Messaging channels the bridge listens on. Changes require a bridge restart.
            </p>
          </div>
          <Button
            onClick={() => {
              setModalMode('add');
              setEditIndex(null);
            }}
            style={{ flexShrink: 0 }}
          >
            + Add Connector
          </Button>
        </div>

        {/* Connector cards */}
        {channels.length === 0 ? (
          <div
            style={{
              padding: 'var(--space-8)',
              textAlign: 'center',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--font-size-sm)',
              backgroundColor: 'var(--color-surface)',
              border: '1px dashed var(--color-border)',
              borderRadius: 'var(--radius-lg)',
            }}
          >
            No connectors configured. Click <strong>+ Add Connector</strong> to add one.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {channels.map((channel, index) => (
              <ConnectorCard
                key={`${channel.type}-${index}`}
                channel={channel}
                onToggle={() => handleToggle(index)}
                onEdit={() => handleEdit(index)}
                onRemove={() => handleRemove(index)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modal — rendered outside the content flow so it can overlay */}
      {modalMode !== null && (
        <ConnectorModal
          initial={modalMode === 'edit' ? (editChannel ?? null) : null}
          onConfirm={handleModalConfirm}
          onCancel={handleModalCancel}
        />
      )}
    </>
  );
}
