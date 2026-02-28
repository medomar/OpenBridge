import { useEffect, useState } from 'react';
import { Input } from '../../components/Input';
import { type WizardStepProps } from '../Setup';

interface ConnectorDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  configFields?: ConfigField[];
}

interface ConfigField {
  key: string;
  label: string;
  placeholder: string;
  hint?: string;
  validate?: (value: string) => boolean;
  validationError?: string;
}

const CONNECTORS: ConnectorDef[] = [
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

function isStepValid(
  selectedId: string | null,
  fieldValues: Record<string, string>,
  fieldDirty: Record<string, boolean>,
): boolean {
  if (!selectedId) return false;

  const def = CONNECTORS.find((c) => c.id === selectedId);
  if (!def) return false;

  if (!def.configFields || def.configFields.length === 0) return true;

  for (const field of def.configFields) {
    const val = fieldValues[field.key] ?? '';
    if (!val.trim()) return false;
    if (field.validate && !field.validate(val)) return false;
  }

  return true;
}

export default function ConnectorStep({ wizardData, onUpdate, onValidChange }: WizardStepProps) {
  const [selectedId, setSelectedId] = useState<string | null>(wizardData.connectorType ?? null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(
    wizardData.connectorConfig ?? {},
  );
  const [fieldDirty, setFieldDirty] = useState<Record<string, boolean>>({});

  // Notify parent of validity on every change
  useEffect(() => {
    const valid = isStepValid(selectedId, fieldValues, fieldDirty);
    onValidChange(valid);
  }, [selectedId, fieldValues, fieldDirty, onValidChange]);

  function handleSelectConnector(id: string) {
    setSelectedId(id);
    setFieldDirty({});
    // Clear connector-specific config when switching connectors
    const newFieldValues: Record<string, string> = {};
    const def = CONNECTORS.find((c) => c.id === id);
    for (const field of def?.configFields ?? []) {
      newFieldValues[field.key] = fieldValues[field.key] ?? '';
    }
    setFieldValues(newFieldValues);
    onUpdate({ connectorType: id, connectorConfig: newFieldValues });
  }

  function handleFieldChange(key: string, value: string) {
    const next = { ...fieldValues, [key]: value };
    setFieldValues(next);
    setFieldDirty((prev) => ({ ...prev, [key]: true }));
    onUpdate({ connectorConfig: next });
  }

  const selectedDef = selectedId ? CONNECTORS.find((c) => c.id === selectedId) : null;

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <h2
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: 'var(--color-text)',
          marginBottom: 'var(--space-2)',
        }}
      >
        Choose Connector
      </h2>

      <p
        style={{
          color: 'var(--color-text-muted)',
          fontSize: 'var(--font-size-base)',
          lineHeight: 1.6,
          marginBottom: 'var(--space-6)',
        }}
      >
        Select the messaging channel you want to use with OpenBridge.
      </p>

      {/* Connector cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-6)',
        }}
      >
        {CONNECTORS.map((connector) => {
          const isSelected = selectedId === connector.id;

          return (
            <button
              key={connector.id}
              onClick={() => handleSelectConnector(connector.id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: 'var(--space-4) var(--space-3)',
                borderRadius: 'var(--radius-lg)',
                border: `2px solid ${isSelected ? 'var(--color-accent)' : 'var(--color-border)'}`,
                backgroundColor: isSelected ? 'rgba(59,130,246,0.06)' : 'var(--color-surface)',
                cursor: 'pointer',
                transition: 'all 0.15s',
                outline: 'none',
                textAlign: 'center',
              }}
            >
              <span style={{ fontSize: 28, lineHeight: 1 }}>{connector.icon}</span>
              <span
                style={{
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: isSelected ? 600 : 500,
                  color: isSelected ? 'var(--color-accent)' : 'var(--color-text)',
                }}
              >
                {connector.name}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--color-text-muted)',
                  lineHeight: 1.3,
                }}
              >
                {connector.description}
              </span>
            </button>
          );
        })}
      </div>

      {/* Connector-specific config inputs */}
      {selectedDef && selectedDef.configFields && selectedDef.configFields.length > 0 && (
        <div
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-5)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-4)',
          }}
        >
          <div
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: 600,
              color: 'var(--color-text)',
              marginBottom: 'var(--space-1)',
            }}
          >
            {selectedDef.name} Configuration
          </div>

          {selectedDef.configFields.map((field) => {
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

      {/* WhatsApp note */}
      {selectedId === 'whatsapp' && (
        <div
          style={{
            marginTop: 'var(--space-4)',
            padding: 'var(--space-3) var(--space-4)',
            backgroundColor: 'rgba(59,130,246,0.06)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-muted)',
            lineHeight: 1.5,
          }}
        >
          A QR code will appear in the terminal on first run. Scan it with WhatsApp (Linked Devices)
          to connect.
        </div>
      )}

      {/* Console note */}
      {selectedId === 'console' && (
        <div
          style={{
            marginTop: 'var(--space-4)',
            padding: 'var(--space-3) var(--space-4)',
            backgroundColor: 'rgba(59,130,246,0.06)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-muted)',
            lineHeight: 1.5,
          }}
        >
          Console mode runs in the terminal — useful for testing without a messaging platform.
        </div>
      )}

      {/* WebChat note */}
      {selectedId === 'webchat' && (
        <div
          style={{
            marginTop: 'var(--space-4)',
            padding: 'var(--space-3) var(--space-4)',
            backgroundColor: 'rgba(59,130,246,0.06)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-muted)',
            lineHeight: 1.5,
          }}
        >
          A browser-based chat UI opens automatically when the bridge starts. No external accounts
          needed.
        </div>
      )}
    </div>
  );
}
