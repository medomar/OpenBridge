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
