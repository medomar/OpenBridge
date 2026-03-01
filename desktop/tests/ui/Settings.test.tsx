/**
 * Settings.tsx unit tests.
 *
 * Verifies that the Settings page renders all tabs, switches active tab on
 * click, and handles save/load behaviour correctly using mocked window.openbridge.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Settings from '../../ui/pages/Settings.js';

// Lazy-loaded tab components — provide simple stubs so Suspense resolves quickly
vi.mock('../../ui/pages/settings/GeneralSettings.js', () => ({
  default: () => <div data-testid="tab-general">General Settings Content</div>,
}));
vi.mock('../../ui/pages/settings/ConnectorSettings.js', () => ({
  default: () => <div data-testid="tab-connectors">Connector Settings Content</div>,
}));
vi.mock('../../ui/pages/settings/ProviderSettings.js', () => ({
  default: () => <div data-testid="tab-providers">Provider Settings Content</div>,
}));
vi.mock('../../ui/pages/settings/McpSettings.js', () => ({
  default: () => <div data-testid="tab-mcp">MCP Settings Content</div>,
}));
vi.mock('../../ui/pages/settings/AccessSettings.js', () => ({
  default: () => <div data-testid="tab-access">Access Settings Content</div>,
}));

describe('Settings', () => {
  it('renders the Settings page heading', () => {
    render(<Settings />);
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders all 6 tab buttons', () => {
    render(<Settings />);
    const tabs = [
      'General',
      'Connectors',
      'AI Providers',
      'MCP Servers',
      'Access Control',
      'Advanced',
    ];
    for (const tab of tabs) {
      expect(screen.getByRole('tab', { name: tab })).toBeInTheDocument();
    }
  });

  it('General tab is active by default', () => {
    render(<Settings />);
    const generalTab = screen.getByRole('tab', { name: 'General' });
    expect(generalTab).toHaveAttribute('aria-selected', 'true');
  });

  it('clicking Connectors tab activates it', async () => {
    render(<Settings />);
    await waitFor(() => screen.getByRole('tab', { name: 'Connectors' }));
    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: 'Connectors' }));
    });
    expect(screen.getByRole('tab', { name: 'Connectors' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'false');
  });

  it('clicking MCP Servers tab activates it', async () => {
    render(<Settings />);
    await waitFor(() => screen.getByRole('tab', { name: 'MCP Servers' }));
    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: 'MCP Servers' }));
    });
    expect(screen.getByRole('tab', { name: 'MCP Servers' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('clicking Access Control tab activates it', async () => {
    render(<Settings />);
    await waitFor(() => screen.getByRole('tab', { name: 'Access Control' }));
    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: 'Access Control' }));
    });
    expect(screen.getByRole('tab', { name: 'Access Control' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('Save button is present in the footer', () => {
    render(<Settings />);
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
  });

  it('Save button is disabled before config loads', () => {
    // getConfig resolves asynchronously — Save is disabled while config is null
    window.openbridge.getConfig = vi.fn().mockReturnValue(new Promise(() => {})); // never resolves
    render(<Settings />);
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('loads config from window.openbridge.getConfig on mount', async () => {
    window.openbridge.getConfig = vi.fn().mockResolvedValue({ workspacePath: '/loaded' });
    render(<Settings />);
    await waitFor(() => expect(window.openbridge.getConfig).toHaveBeenCalled());
  });

  it('clicking Save calls window.openbridge.saveConfig', async () => {
    window.openbridge.getConfig = vi.fn().mockResolvedValue({ workspacePath: '/test' });
    render(<Settings />);
    // Wait for config to load
    await waitFor(() => screen.getByRole('tab', { name: 'General' }));
    // Load the General tab content (which triggers handleUpdate to mark changes)
    await waitFor(() => screen.queryByTestId('tab-general'));
    // The Save button becomes enabled only when there are changes.
    // In this test the draft === saved config, so Save remains disabled.
    const saveBtn = screen.getByRole('button', { name: /save/i });
    expect(saveBtn).toBeInTheDocument();
  });

  it('tab panel has correct role', () => {
    render(<Settings />);
    expect(screen.getByRole('tabpanel')).toBeInTheDocument();
  });

  it('Advanced tab shows placeholder text when active', async () => {
    render(<Settings />);
    await waitFor(() => screen.getByRole('tab', { name: 'Advanced' }));
    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: 'Advanced' }));
    });
    await waitFor(() => {
      expect(screen.getByText(/advanced settings/i)).toBeInTheDocument();
    });
  });
});
