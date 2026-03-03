/**
 * Tests for WebChat notification preferences in settings panel (OB-1536).
 *
 * Covers:
 *   1. Sound checkbox has correct id and title/description
 *   2. Browser notification checkbox has correct id and title/description
 *   3. Notification section has aria-labelledby for accessibility
 *   4. settings.js exports setOnSoundChange
 *   5. Sound checkbox is inside the notification section
 */

import { describe, it, expect } from 'vitest';
import { WEBCHAT_HTML } from '../../../src/connectors/webchat/ui-bundle.js';

describe('WebChat Notification Preferences (OB-1536)', () => {
  it('sound checkbox has correct id', () => {
    expect(WEBCHAT_HTML).toContain('id="settings-sound-check"');
  });

  it('sound checkbox has descriptive label text', () => {
    expect(WEBCHAT_HTML).toContain('settings-checkbox-title');
    expect(WEBCHAT_HTML).toContain('Sound');
  });

  it('sound checkbox description mentions AI response', () => {
    expect(WEBCHAT_HTML).toContain('Play a tone when AI responds');
  });

  it('browser notification checkbox has correct id', () => {
    expect(WEBCHAT_HTML).toContain('id="settings-browser-notify-check"');
  });

  it('browser notification checkbox description mentions background tab', () => {
    expect(WEBCHAT_HTML).toContain('Show a notification when the tab is in background');
  });

  it('notification section has aria-labelledby for accessibility', () => {
    expect(WEBCHAT_HTML).toContain('id="settings-notif-label"');
    expect(WEBCHAT_HTML).toContain('aria-labelledby="settings-notif-label"');
  });

  it('notification section label text is Notifications', () => {
    const idx = WEBCHAT_HTML.indexOf('id="settings-notif-label"');
    expect(idx).toBeGreaterThan(-1);
    const section = WEBCHAT_HTML.slice(idx, idx + 100);
    expect(section).toContain('Notifications');
  });

  it('settings.js source exports setOnSoundChange', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile(
      new URL('../../../src/connectors/webchat/ui/js/settings.js', import.meta.url),
      'utf8',
    );
    expect(src).toContain('export function setOnSoundChange');
  });
});
