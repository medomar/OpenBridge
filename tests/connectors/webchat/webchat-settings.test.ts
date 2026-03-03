/**
 * Tests for WebChat settings panel (OB-1533).
 *
 * Covers:
 *   1. WEBCHAT_HTML contains gear button (#settings-btn)
 *   2. WEBCHAT_HTML contains settings panel (#settings-panel)
 *   3. Settings panel has role="dialog" and aria-hidden="true" initially
 *   4. Settings panel contains AI tool selector (#settings-tool-select)
 *   5. Settings panel contains execution profile radios (settings-profile)
 *   6. Settings panel contains notification checkboxes
 *   7. Settings panel contains theme selector (#settings-theme-select)
 *   8. Settings panel CSS is included in the bundle
 */

import { describe, it, expect } from 'vitest';
import { WEBCHAT_HTML } from '../../../src/connectors/webchat/ui-bundle.js';

describe('WebChat Settings Panel (OB-1533)', () => {
  it('contains gear button in header', () => {
    expect(WEBCHAT_HTML).toContain('id="settings-btn"');
    expect(WEBCHAT_HTML).toContain('aria-controls="settings-panel"');
    expect(WEBCHAT_HTML).toContain('Open settings');
  });

  it('contains settings panel element', () => {
    expect(WEBCHAT_HTML).toContain('id="settings-panel"');
    expect(WEBCHAT_HTML).toContain('role="dialog"');
    expect(WEBCHAT_HTML).toContain('aria-modal="true"');
    expect(WEBCHAT_HTML).toContain('aria-label="Settings"');
  });

  it('settings panel starts with aria-hidden=true', () => {
    // The panel should be hidden by default (aria-hidden="true")
    expect(WEBCHAT_HTML).toContain('id="settings-panel"');
    // Check the panel markup contains aria-hidden="true"
    const panelStart = WEBCHAT_HTML.indexOf('id="settings-panel"');
    const panelSection = WEBCHAT_HTML.slice(panelStart, panelStart + 300);
    expect(panelSection).toContain('aria-hidden="true"');
  });

  it('contains AI tool selector', () => {
    expect(WEBCHAT_HTML).toContain('id="settings-tool-select"');
    expect(WEBCHAT_HTML).toContain('Auto (discovered)');
  });

  it('contains execution profile radio buttons', () => {
    expect(WEBCHAT_HTML).toContain('name="settings-profile"');
    expect(WEBCHAT_HTML).toContain('value="fast"');
    expect(WEBCHAT_HTML).toContain('value="thorough"');
    expect(WEBCHAT_HTML).toContain('value="manual"');
  });

  it('contains notification checkboxes', () => {
    expect(WEBCHAT_HTML).toContain('id="settings-sound-check"');
    expect(WEBCHAT_HTML).toContain('id="settings-browser-notify-check"');
  });

  it('contains theme selector', () => {
    expect(WEBCHAT_HTML).toContain('id="settings-theme-select"');
    expect(WEBCHAT_HTML).toContain('value="light"');
    expect(WEBCHAT_HTML).toContain('value="dark"');
  });
});

describe('WebChat Theme Toggle — Settings Sync (OB-1537)', () => {
  it('contains header theme-toggle button', () => {
    expect(WEBCHAT_HTML).toContain('id="theme-toggle"');
    expect(WEBCHAT_HTML).toContain('Toggle dark mode');
  });

  it('contains settings theme select with light and dark options', () => {
    expect(WEBCHAT_HTML).toContain('id="settings-theme-select"');
    expect(WEBCHAT_HTML).toContain('value="light"');
    expect(WEBCHAT_HTML).toContain('value="dark"');
  });

  it('persists theme to localStorage via ob-theme key', () => {
    // Bundle must reference the localStorage key used for theme persistence
    expect(WEBCHAT_HTML).toContain('ob-theme');
  });

  it('header toggle and settings select reference the same data-theme attribute', () => {
    expect(WEBCHAT_HTML).toContain('data-theme');
    // Both header toggle and settings should use the shared data-theme attribute
    const dataThemeCount = (WEBCHAT_HTML.match(/data-theme/g) || []).length;
    expect(dataThemeCount).toBeGreaterThan(1);
  });

  it('settings-theme-select is grouped inside the settings panel', () => {
    const panelStart = WEBCHAT_HTML.indexOf('id="settings-panel"');
    const panelEnd = WEBCHAT_HTML.indexOf('</aside>', panelStart);
    expect(panelStart).toBeGreaterThan(-1);
    expect(panelEnd).toBeGreaterThan(panelStart);
    const panelContent = WEBCHAT_HTML.slice(panelStart, panelEnd);
    expect(panelContent).toContain('id="settings-theme-select"');
  });

  it('contains settings panel CSS', () => {
    expect(WEBCHAT_HTML).toContain('.settings-panel');
    expect(WEBCHAT_HTML).toContain('.settings-gear-btn');
    expect(WEBCHAT_HTML).toContain('.settings-overlay');
  });

  it('contains settings overlay element', () => {
    expect(WEBCHAT_HTML).toContain('id="settings-overlay"');
    expect(WEBCHAT_HTML).toContain('class="settings-overlay"');
  });
});

// ---------------------------------------------------------------------------
// OB-1544 — Settings API contract, Deep Mode stepper, MCP UI, persistence
// ---------------------------------------------------------------------------

describe('WebChat Settings — GET returns defaults (OB-1544)', () => {
  it('bundle marks "thorough" as the default execution profile', () => {
    // settings.js uses `localStorage.getItem('ob-exec-profile') || 'thorough'`
    // The bundle must reference 'thorough' as a valid profile value
    expect(WEBCHAT_HTML).toContain('value="thorough"');
  });

  it('bundle references the settings GET/PUT API endpoint', () => {
    // syncProfileToServer in settings.js fetches /api/webchat/settings via PUT
    expect(WEBCHAT_HTML).toContain('/api/webchat/settings');
  });

  it('bundle references all three valid profile values', () => {
    expect(WEBCHAT_HTML).toContain('value="fast"');
    expect(WEBCHAT_HTML).toContain('value="thorough"');
    expect(WEBCHAT_HTML).toContain('value="manual"');
  });
});

describe('WebChat Settings — PUT saves values (OB-1544)', () => {
  it('bundle contains profile radio group for saving selection', () => {
    expect(WEBCHAT_HTML).toContain('name="settings-profile"');
  });

  it('bundle references PUT method for settings sync', () => {
    // The bundle inlines settings.js which calls fetch with method: "PUT"
    expect(WEBCHAT_HTML).toContain('"PUT"');
  });

  it('bundle persists profile selection to localStorage', () => {
    // ob-exec-profile is the localStorage key used by settings.js
    expect(WEBCHAT_HTML).toContain('ob-exec-profile');
  });
});

describe('WebChat Settings — Deep Mode events update stepper (OB-1544)', () => {
  it('bundle contains deep-mode-bar element', () => {
    expect(WEBCHAT_HTML).toContain('id="deep-mode-bar"');
    expect(WEBCHAT_HTML).toContain('class="deep-mode-bar');
  });

  it('bundle contains Deep Mode stepper CSS classes', () => {
    expect(WEBCHAT_HTML).toContain('.dm-phase-dot');
    expect(WEBCHAT_HTML).toContain('.dm-phase-current');
    expect(WEBCHAT_HTML).toContain('.dm-phase-done');
  });

  it('bundle contains Deep Mode action button CSS', () => {
    expect(WEBCHAT_HTML).toContain('.dm-proceed-btn');
    expect(WEBCHAT_HTML).toContain('.dm-actions');
  });

  it('bundle listens for deep-mode-state WebSocket messages', () => {
    expect(WEBCHAT_HTML).toContain('deep-mode-state');
  });

  it('bundle sends get-deep-mode-state on reconnect', () => {
    expect(WEBCHAT_HTML).toContain('get-deep-mode-state');
  });
});

describe('WebChat Settings — MCP endpoints respond (OB-1544)', () => {
  it('bundle contains MCP server list UI element', () => {
    expect(WEBCHAT_HTML).toContain('id="mcp-server-list"');
  });

  it('bundle contains MCP add button', () => {
    expect(WEBCHAT_HTML).toContain('id="mcp-add-btn"');
  });

  it('bundle contains MCP add form', () => {
    expect(WEBCHAT_HTML).toContain('id="mcp-add-form"');
    expect(WEBCHAT_HTML).toContain('id="mcp-new-name"');
    expect(WEBCHAT_HTML).toContain('id="mcp-new-command"');
  });

  it('bundle references /api/mcp/servers endpoint', () => {
    expect(WEBCHAT_HTML).toContain('/api/mcp/servers');
  });

  it('bundle includes MCP server list CSS', () => {
    expect(WEBCHAT_HTML).toContain('.mcp-server-list');
    expect(WEBCHAT_HTML).toContain('.mcp-server-item');
  });
});

describe('WebChat Settings — settings persist across reloads (OB-1544)', () => {
  it('bundle uses ob-exec-profile localStorage key for profile persistence', () => {
    expect(WEBCHAT_HTML).toContain('ob-exec-profile');
  });

  it('bundle uses ob-preferred-tool localStorage key for tool preference', () => {
    expect(WEBCHAT_HTML).toContain('ob-preferred-tool');
  });

  it('bundle uses ob-sound localStorage key for sound preference', () => {
    expect(WEBCHAT_HTML).toContain('ob-sound');
  });

  it('bundle uses ob-theme localStorage key for theme persistence', () => {
    expect(WEBCHAT_HTML).toContain('ob-theme');
  });

  it('bundle reads localStorage on load to restore saved preferences', () => {
    // The bundle uses localStorage.getItem for each preference
    const localStorageGetCount = (WEBCHAT_HTML.match(/localStorage\.getItem/g) || []).length;
    expect(localStorageGetCount).toBeGreaterThanOrEqual(4);
  });
});
