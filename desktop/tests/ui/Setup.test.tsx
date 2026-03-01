/**
 * Setup.tsx wizard navigation tests.
 *
 * Child step components are mocked with minimal stubs so we can test the
 * wizard container's navigation logic (step transitions, validation gating,
 * progress bar) in isolation.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { WizardStepProps } from '../../ui/pages/Setup.js';

// ---------------------------------------------------------------------------
// Stub step components — call onValidChange(true) immediately to unblock Next.
// Each stub is identifiable via a data-testid attribute.
// ---------------------------------------------------------------------------

function makeStub(testId: string, autoValid = true) {
  return ({ onValidChange }: WizardStepProps) => {
    React.useEffect(() => {
      if (autoValid) onValidChange(true);
    }, [onValidChange]);
    return <div data-testid={testId}>{testId}</div>;
  };
}

vi.mock('../../ui/pages/setup/WelcomeStep.js', () => ({
  default: makeStub('step-welcome'),
}));

vi.mock('../../ui/pages/setup/AIToolStep.js', () => ({
  default: makeStub('step-ai-tool'),
}));

vi.mock('../../ui/pages/setup/AccountStep.js', () => ({
  default: makeStub('step-account'),
}));

vi.mock('../../ui/pages/setup/WorkspaceStep.js', () => ({
  default: makeStub('step-workspace'),
}));

vi.mock('../../ui/pages/setup/ConnectorStep.js', () => ({
  default: makeStub('step-connector'),
}));

vi.mock('../../ui/pages/setup/AccessStep.js', () => ({
  default: makeStub('step-access'),
}));

// FinishStep uses useNavigate — mock it too
vi.mock('../../ui/pages/setup/FinishStep.js', () => ({
  default: makeStub('step-finish', false), // Not auto-valid; has its own action button
}));

// ---------------------------------------------------------------------------
// Import component under test (after mocks are declared)
// ---------------------------------------------------------------------------
import Setup from '../../ui/pages/Setup.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderSetup() {
  return render(
    <MemoryRouter>
      <Setup />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Setup wizard', () => {
  it('renders the Welcome step on initial load', async () => {
    renderSetup();
    // Wait for the stub's useEffect to run
    await act(async () => {});
    expect(screen.getByTestId('step-welcome')).toBeInTheDocument();
  });

  it('shows "Step 1 of 7" counter on initial render', async () => {
    renderSetup();
    await act(async () => {});
    expect(screen.getByText(/step 1 of 7/i)).toBeInTheDocument();
  });

  it('Back button is disabled on the first step', async () => {
    renderSetup();
    await act(async () => {});
    const backBtn = screen.getByRole('button', { name: /back/i });
    expect(backBtn).toBeDisabled();
  });

  it('Next button is enabled after step signals valid', async () => {
    renderSetup();
    await act(async () => {});
    const nextBtn = screen.getByRole('button', { name: /next/i });
    expect(nextBtn).not.toBeDisabled();
  });

  it('clicking Next advances to the second step', async () => {
    renderSetup();
    await act(async () => {});
    const nextBtn = screen.getByRole('button', { name: /next/i });
    await act(async () => {
      fireEvent.click(nextBtn);
    });
    expect(screen.getByTestId('step-ai-tool')).toBeInTheDocument();
    expect(screen.getByText(/step 2 of 7/i)).toBeInTheDocument();
  });

  it('clicking Back on step 2 returns to step 1', async () => {
    renderSetup();
    await act(async () => {});
    // Advance to step 2
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await act(async () => {});
    expect(screen.getByTestId('step-ai-tool')).toBeInTheDocument();
    // Go back
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    await act(async () => {});
    expect(screen.getByTestId('step-welcome')).toBeInTheDocument();
    expect(screen.getByText(/step 1 of 7/i)).toBeInTheDocument();
  });

  it('progress bar renders all 7 step labels', () => {
    renderSetup();
    const labels = ['Welcome', 'AI Tools', 'Account', 'Workspace', 'Connector', 'Access', 'Finish'];
    for (const label of labels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('progress bar shows checkmark for completed steps', async () => {
    renderSetup();
    await act(async () => {});
    // Advance through two steps
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await act(async () => {});
    // Step 1 (index 0) should now show a checkmark (✓)
    const checkmarks = screen.getAllByText('✓');
    expect(checkmarks.length).toBeGreaterThanOrEqual(1);
  });

  it('Next button is absent on the last step (step 7)', async () => {
    renderSetup();
    await act(async () => {});
    // Advance through all 6 steps to reach step 7 (index 6)
    for (let i = 0; i < 6; i++) {
      const nextBtn = screen.queryByRole('button', { name: /next/i });
      if (!nextBtn) break;
      fireEvent.click(nextBtn);
      await act(async () => {});
    }
    expect(screen.getByTestId('step-finish')).toBeInTheDocument();
    // No Next button on the last step
    expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument();
  });

  it('wizard can traverse all 7 steps sequentially', async () => {
    renderSetup();
    await act(async () => {});
    // Advance through steps 1-6 (clicking Next 6 times)
    for (let step = 1; step <= 6; step++) {
      expect(screen.getByText(new RegExp(`step ${step} of 7`, 'i'))).toBeInTheDocument();
      const nextBtn = screen.queryByRole('button', { name: /next/i });
      if (!nextBtn) break;
      fireEvent.click(nextBtn);
      await act(async () => {});
    }
    // Final step (7/7): FinishStep renders, no Next button
    expect(screen.getByText(/step 7 of 7/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument();
  });

  it('Back button on step 2 returns to step 1 with Back still disabled', async () => {
    renderSetup();
    await act(async () => {});
    // Go to step 2
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await act(async () => {});
    expect(screen.getByText(/step 2 of 7/i)).toBeInTheDocument();
    // Back is enabled on step 2
    expect(screen.getByRole('button', { name: /back/i })).not.toBeDisabled();
    // Navigate back
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    await act(async () => {});
    // On step 1: Back is disabled again
    expect(screen.getByText(/step 1 of 7/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back/i })).toBeDisabled();
  });
});
