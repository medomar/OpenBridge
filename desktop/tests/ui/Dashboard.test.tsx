/**
 * Dashboard.tsx unit tests.
 *
 * Verifies that the dashboard renders bridge status, start/stop control,
 * channels, messages, and worker panels correctly using mocked window.openbridge.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Dashboard from '../../ui/pages/Dashboard.js';

describe('Dashboard', () => {
  it('renders the Start Bridge button initially', async () => {
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /start bridge/i })).toBeInTheDocument();
    });
  });

  it('shows "Stopped" status badge when bridge is stopped', async () => {
    window.openbridge.getBridgeStatus = vi.fn().mockResolvedValue({ status: 'stopped' });
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText(/stopped/i)).toBeInTheDocument();
    });
  });

  it('shows "Running" status badge when bridge is running', async () => {
    window.openbridge.getBridgeStatus = vi.fn().mockResolvedValue({ status: 'running' });
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText(/running/i)).toBeInTheDocument();
    });
  });

  it('shows channels panel with "No channels" when config has empty channels', async () => {
    window.openbridge.getConfig = vi.fn().mockResolvedValue({
      workspacePath: '/test',
      channels: [],
    });
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText(/no channels configured/i)).toBeInTheDocument();
    });
  });

  it('renders a configured channel from config', async () => {
    window.openbridge.getConfig = vi.fn().mockResolvedValue({
      workspacePath: '/test',
      channels: [{ type: 'whatsapp', enabled: true }],
    });
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText(/whatsapp/i)).toBeInTheDocument();
    });
  });

  it('shows "No messages yet" in the messages panel initially', async () => {
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText(/no messages yet/i)).toBeInTheDocument();
    });
  });

  it('shows "No active workers" when no workers are running', async () => {
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText(/no active workers/i)).toBeInTheDocument();
    });
  });

  it('clicking Start Bridge calls window.openbridge.startBridge', async () => {
    window.openbridge.getBridgeStatus = vi.fn().mockResolvedValue({ status: 'stopped' });
    render(<Dashboard />);
    await waitFor(() => screen.getByRole('button', { name: /start bridge/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start bridge/i }));
    });
    expect(window.openbridge.startBridge).toHaveBeenCalled();
  });

  it('clicking Stop Bridge calls window.openbridge.stopBridge', async () => {
    window.openbridge.getBridgeStatus = vi.fn().mockResolvedValue({ status: 'running' });
    render(<Dashboard />);
    await waitFor(() => screen.getByRole('button', { name: /stop bridge/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /stop bridge/i }));
    });
    expect(window.openbridge.stopBridge).toHaveBeenCalled();
  });

  it('displays the Channels panel header', async () => {
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText('Channels')).toBeInTheDocument();
    });
  });

  it('displays the Messages panel header', async () => {
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText('Messages')).toBeInTheDocument();
    });
  });

  it('displays the Active Workers panel header', async () => {
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText('Active Workers')).toBeInTheDocument();
    });
  });

  it('registers onWorkerUpdate and onMessageReceived listeners on mount', async () => {
    render(<Dashboard />);
    await waitFor(() => {
      expect(window.openbridge.onWorkerUpdate).toHaveBeenCalled();
      expect(window.openbridge.onMessageReceived).toHaveBeenCalled();
    });
  });
});
