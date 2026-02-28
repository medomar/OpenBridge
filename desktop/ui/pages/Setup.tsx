import { Fragment, useCallback, useEffect, useState } from 'react';
import { Button } from '../components/Button';
import AccountStep from './setup/AccountStep';
import AIToolStep from './setup/AIToolStep';
import WelcomeStep from './setup/WelcomeStep';
import WorkspaceStep from './setup/WorkspaceStep';

// Accumulated configuration data across all wizard steps.
// Extended by each step component (OB-1268 through OB-1274).
export interface WizardData {
  installedTools?: string[];
  authenticatedTools?: string[];
  workspacePath?: string;
  connectorType?: string;
  connectorConfig?: Record<string, string>;
  whitelist?: string[];
  allowAll?: boolean;
}

// Contract every step component must satisfy.
// Exported so step components can import it directly from this module.
export interface WizardStepProps {
  wizardData: WizardData;
  onUpdate: (updates: Partial<WizardData>) => void;
  onValidChange: (valid: boolean) => void;
  /** Optional: step can call this to programmatically advance (e.g., WelcomeStep auto-advance). */
  onNext?: () => void;
}

// Step labels — indices 0–6 match currentStep values
const STEPS = ['Welcome', 'AI Tools', 'Account', 'Workspace', 'Connector', 'Access', 'Finish'];

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

interface ProgressBarProps {
  currentStep: number;
  totalSteps: number;
}

function ProgressBar({ currentStep }: ProgressBarProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        padding: 'var(--space-6) var(--space-8)',
        borderBottom: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-surface)',
      }}
    >
      {STEPS.map((label, index) => {
        const isCompleted = index < currentStep;
        const isActive = index === currentStep;

        return (
          <Fragment key={label}>
            {index > 0 && (
              <div
                style={{
                  flex: 1,
                  height: 2,
                  marginTop: 15,
                  backgroundColor: isCompleted ? 'var(--color-accent)' : 'var(--color-border)',
                  transition: 'background-color 0.3s',
                }}
              />
            )}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 'var(--space-1)',
                minWidth: 60,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 'var(--radius-full)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 600,
                  backgroundColor:
                    isCompleted || isActive ? 'var(--color-accent)' : 'var(--color-surface-raised)',
                  color: isCompleted || isActive ? '#ffffff' : 'var(--color-text-muted)',
                  border: isCompleted || isActive ? 'none' : '2px solid var(--color-border)',
                  transition: 'all 0.3s',
                }}
              >
                {isCompleted ? '✓' : index + 1}
              </div>
              <span
                style={{
                  fontSize: 11,
                  color: isActive ? 'var(--color-accent)' : 'var(--color-text-muted)',
                  fontWeight: isActive ? 600 : 400,
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </span>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Placeholder step — replaced by real components in OB-1268 through OB-1274
// ---------------------------------------------------------------------------

interface PlaceholderStepProps {
  label: string;
  onValidChange: (valid: boolean) => void;
}

function PlaceholderStep({ label, onValidChange }: PlaceholderStepProps) {
  // Placeholder steps are always valid so the wizard remains navigable
  useEffect(() => {
    onValidChange(true);
  }, [onValidChange]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 200,
        color: 'var(--color-text-muted)',
        fontSize: 'var(--font-size-lg)',
      }}
    >
      {label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup wizard container
// ---------------------------------------------------------------------------

export default function Setup() {
  const [currentStep, setCurrentStep] = useState(0);
  const [wizardData, setWizardData] = useState<WizardData>({});
  // false until the active step signals it is valid
  const [stepValid, setStepValid] = useState(false);

  const totalSteps = STEPS.length;
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === totalSteps - 1;

  // Stable callbacks so step components' useEffect deps don't fire on every render
  const handleUpdate = useCallback((updates: Partial<WizardData>) => {
    setWizardData((prev) => ({ ...prev, ...updates }));
  }, []);

  const handleValidChange = useCallback((valid: boolean) => {
    setStepValid(valid);
  }, []);

  function handleBack() {
    if (!isFirstStep) {
      setCurrentStep((s) => s - 1);
      // Previously completed steps are assumed valid when navigating back
      setStepValid(true);
    }
  }

  function handleNext() {
    if (stepValid && !isLastStep) {
      setCurrentStep((s) => s + 1);
      // New step starts unvalidated until it signals readiness
      setStepValid(false);
    }
  }

  // Common props forwarded to every step component
  const stepProps: WizardStepProps = {
    wizardData,
    onUpdate: handleUpdate,
    onValidChange: handleValidChange,
    onNext: handleNext,
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: 'var(--color-bg)',
      }}
    >
      {/* Progress bar */}
      <ProgressBar currentStep={currentStep} totalSteps={totalSteps} />

      {/* Step content — key forces remount on step change to reset local state */}
      <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-8)' }}>
        {currentStep === 0 ? (
          <WelcomeStep key={0} {...stepProps} />
        ) : currentStep === 1 ? (
          <AIToolStep key={1} {...stepProps} />
        ) : currentStep === 2 ? (
          <AccountStep key={2} {...stepProps} />
        ) : currentStep === 3 ? (
          <WorkspaceStep key={3} {...stepProps} />
        ) : (
          /* Remaining step components (OB-1272–OB-1274) will replace PlaceholderStep here */
          <PlaceholderStep
            key={currentStep}
            label={STEPS[currentStep] ?? ''}
            onValidChange={stepProps.onValidChange}
          />
        )}
      </div>

      {/* Navigation */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: 'var(--space-4) var(--space-8)',
          borderTop: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-surface)',
        }}
      >
        <Button variant="secondary" onClick={handleBack} disabled={isFirstStep}>
          Back
        </Button>

        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
          Step {currentStep + 1} of {totalSteps}
        </span>

        {/* Last step (Finish) handles its own "Start OpenBridge" action — no Next button */}
        {isLastStep ? (
          <div style={{ width: 72 }} />
        ) : (
          <Button onClick={handleNext} disabled={!stepValid}>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}
