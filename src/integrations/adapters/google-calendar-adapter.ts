import { google, type calendar_v3 } from 'googleapis';
import { createLogger } from '../../core/logger.js';
import type {
  BusinessIntegration,
  HealthStatus,
  IntegrationCapability,
  IntegrationConfig,
} from '../../types/integration.js';

const logger = createLogger('google-calendar-adapter');

/**
 * Google Calendar integration adapter.
 *
 * Capabilities:
 * - create_event: Create a calendar event
 * - list_events: List upcoming events
 * - update_event: Update an existing event
 * - delete_event: Delete an event
 * - check_availability: Check free/busy status for a time range
 *
 * Credentials expected (from credential store):
 * - Auth type "oauth2":
 *     clientId: OAuth2 client ID
 *     clientSecret: OAuth2 client secret
 *     refreshToken: OAuth2 refresh token (obtained via consent flow)
 */
export class GoogleCalendarAdapter implements BusinessIntegration {
  readonly name = 'google-calendar';
  readonly type = 'calendar' as const;

  private calendar: calendar_v3.Calendar | null = null;
  private calendarId = 'primary';

  async initialize(config: IntegrationConfig): Promise<void> {
    const opts = config.options;

    const clientId = opts['clientId'] as string | undefined;
    const clientSecret = opts['clientSecret'] as string | undefined;
    const refreshToken = opts['refreshToken'] as string | undefined;

    if (!clientId || typeof clientId !== 'string') {
      throw new Error('Google Calendar adapter requires clientId in config.options');
    }
    if (!clientSecret || typeof clientSecret !== 'string') {
      throw new Error('Google Calendar adapter requires clientSecret in config.options');
    }
    if (!refreshToken || typeof refreshToken !== 'string') {
      throw new Error('Google Calendar adapter requires refreshToken in config.options');
    }

    const auth = new google.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials({ refresh_token: refreshToken });
    this.calendar = google.calendar({ version: 'v3', auth });

    if (opts['calendarId'] && typeof opts['calendarId'] === 'string') {
      this.calendarId = opts['calendarId'];
    }

    // Verify credentials work
    try {
      await this.calendar.calendars.get({ calendarId: this.calendarId });
    } catch (err) {
      this.calendar = null;
      throw new Error(
        `Google Calendar initialization failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    logger.info({ calendarId: this.calendarId }, 'Google Calendar adapter initialized');
  }

  async healthCheck(): Promise<HealthStatus> {
    const checkedAt = new Date().toISOString();

    if (!this.calendar) {
      return { status: 'unhealthy', message: 'Not initialized', checkedAt, details: {} };
    }

    try {
      const res = await this.calendar.calendars.get({ calendarId: this.calendarId });
      return {
        status: 'healthy',
        message: 'Google Calendar API reachable',
        checkedAt,
        details: {
          calendarId: this.calendarId,
          calendarSummary: res.data.summary ?? 'unknown',
          timeZone: res.data.timeZone ?? 'unknown',
        },
      };
    } catch (err) {
      return {
        status: 'unhealthy',
        message: err instanceof Error ? err.message : String(err),
        checkedAt,
        details: {},
      };
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async shutdown(): Promise<void> {
    this.calendar = null;
    logger.info('Google Calendar adapter shut down');
  }

  describeCapabilities(): IntegrationCapability[] {
    return [
      {
        name: 'create_event',
        description:
          'Create a calendar event. Params: summary (string), start (string, ISO 8601 datetime), end (string, ISO 8601 datetime), description (string, optional), attendees (string[], optional — list of email addresses), location (string, optional), timeZone (string, optional, e.g. "America/New_York").',
        category: 'write',
        requiresApproval: true,
      },
      {
        name: 'list_events',
        description:
          'List upcoming calendar events. Params: timeMin (string, ISO 8601 datetime, default now), timeMax (string, ISO 8601 datetime, optional), maxResults (number, default 10), query (string, optional free-text search).',
        category: 'read',
        requiresApproval: false,
      },
      {
        name: 'update_event',
        description:
          'Update an existing calendar event. Params: eventId (string), summary (string, optional), start (string, ISO 8601, optional), end (string, ISO 8601, optional), description (string, optional), attendees (string[], optional), location (string, optional).',
        category: 'write',
        requiresApproval: true,
      },
      {
        name: 'delete_event',
        description: 'Delete a calendar event by ID. Params: eventId (string).',
        category: 'write',
        requiresApproval: true,
      },
      {
        name: 'check_availability',
        description:
          'Check free/busy availability for one or more calendars. Params: timeMin (string, ISO 8601), timeMax (string, ISO 8601), calendarIds (string[], optional — defaults to the configured calendar).',
        category: 'read',
        requiresApproval: false,
      },
    ];
  }

  async query(operation: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.calendar) {
      throw new Error('Google Calendar adapter not initialized — call initialize() first');
    }

    switch (operation) {
      case 'list_events':
        return await this.listEvents(params);
      case 'check_availability':
        return await this.checkAvailability(params);
      default:
        throw new Error(`Unknown query operation: ${operation}`);
    }
  }

  async execute(operation: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.calendar) {
      throw new Error('Google Calendar adapter not initialized — call initialize() first');
    }

    switch (operation) {
      case 'create_event':
        return await this.createEvent(params);
      case 'update_event':
        return await this.updateEvent(params);
      case 'delete_event':
        return await this.deleteEvent(params);
      default:
        throw new Error(`Unknown execute operation: ${operation}`);
    }
  }

  // ── Private helpers ────────────────────────────────────────────

  private async createEvent(
    params: Record<string, unknown>,
  ): Promise<{ eventId: string; summary: string; htmlLink: string | null }> {
    const summary = params['summary'] as string;
    const start = params['start'] as string;
    const end = params['end'] as string;

    if (!summary || typeof summary !== 'string') {
      throw new Error('summary is required');
    }
    if (!start || typeof start !== 'string') {
      throw new Error('start is required (ISO 8601 datetime)');
    }
    if (!end || typeof end !== 'string') {
      throw new Error('end is required (ISO 8601 datetime)');
    }

    const timeZone = (params['timeZone'] as string) ?? 'UTC';
    const description = params['description'] as string | undefined;
    const location = params['location'] as string | undefined;
    const attendeeEmails = params['attendees'] as string[] | undefined;

    const event: calendar_v3.Schema$Event = {
      summary,
      start: { dateTime: start, timeZone },
      end: { dateTime: end, timeZone },
    };

    if (description) event.description = description;
    if (location) event.location = location;
    if (attendeeEmails && attendeeEmails.length > 0) {
      event.attendees = attendeeEmails.map((email) => ({ email }));
    }

    const res = await this.calendar!.events.insert({
      calendarId: this.calendarId,
      requestBody: event,
    });

    logger.info({ eventId: res.data.id, summary }, 'Calendar event created');
    return {
      eventId: res.data.id ?? '',
      summary: res.data.summary ?? summary,
      htmlLink: res.data.htmlLink ?? null,
    };
  }

  private async listEvents(
    params: Record<string, unknown>,
  ): Promise<{ events: Array<Record<string, unknown>>; nextPageToken: string | null }> {
    const timeMin = (params['timeMin'] as string) ?? new Date().toISOString();
    const timeMax = params['timeMax'] as string | undefined;
    const maxResults = Math.min((params['maxResults'] as number) ?? 10, 100);
    const query = params['query'] as string | undefined;

    const res = await this.calendar!.events.list({
      calendarId: this.calendarId,
      timeMin,
      ...(timeMax ? { timeMax } : {}),
      maxResults,
      ...(query ? { q: query } : {}),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = (res.data.items ?? []).map((e) => ({
      id: e.id,
      summary: e.summary,
      start: e.start?.dateTime ?? e.start?.date,
      end: e.end?.dateTime ?? e.end?.date,
      description: e.description,
      location: e.location,
      attendees: (e.attendees ?? []).map((a) => ({
        email: a.email,
        responseStatus: a.responseStatus,
      })),
      htmlLink: e.htmlLink,
      status: e.status,
    }));

    return {
      events,
      nextPageToken: res.data.nextPageToken ?? null,
    };
  }

  private async updateEvent(
    params: Record<string, unknown>,
  ): Promise<{ eventId: string; summary: string; htmlLink: string | null }> {
    const eventId = params['eventId'] as string;
    if (!eventId || typeof eventId !== 'string') {
      throw new Error('eventId is required');
    }

    // Fetch current event to patch only provided fields
    const current = await this.calendar!.events.get({
      calendarId: this.calendarId,
      eventId,
    });

    const patch: calendar_v3.Schema$Event = {};

    if (params['summary'] && typeof params['summary'] === 'string') {
      patch.summary = params['summary'];
    }
    if (params['description'] !== undefined) {
      patch.description = params['description'] as string;
    }
    if (params['location'] !== undefined) {
      patch.location = params['location'] as string;
    }

    const timeZone = (params['timeZone'] as string) ?? current.data.start?.timeZone ?? 'UTC';
    if (params['start'] && typeof params['start'] === 'string') {
      patch.start = { dateTime: params['start'], timeZone };
    }
    if (params['end'] && typeof params['end'] === 'string') {
      patch.end = { dateTime: params['end'], timeZone };
    }

    const attendeeEmails = params['attendees'] as string[] | undefined;
    if (attendeeEmails) {
      patch.attendees = attendeeEmails.map((email) => ({ email }));
    }

    const res = await this.calendar!.events.patch({
      calendarId: this.calendarId,
      eventId,
      requestBody: patch,
    });

    logger.info({ eventId, summary: res.data.summary }, 'Calendar event updated');
    return {
      eventId: res.data.id ?? eventId,
      summary: res.data.summary ?? '',
      htmlLink: res.data.htmlLink ?? null,
    };
  }

  private async deleteEvent(
    params: Record<string, unknown>,
  ): Promise<{ eventId: string; deleted: boolean }> {
    const eventId = params['eventId'] as string;
    if (!eventId || typeof eventId !== 'string') {
      throw new Error('eventId is required');
    }

    await this.calendar!.events.delete({ calendarId: this.calendarId, eventId });

    logger.info({ eventId }, 'Calendar event deleted');
    return { eventId, deleted: true };
  }

  private async checkAvailability(
    params: Record<string, unknown>,
  ): Promise<{ timeMin: string; timeMax: string; busy: Array<{ start: string; end: string }> }> {
    const timeMin = params['timeMin'] as string;
    const timeMax = params['timeMax'] as string;

    if (!timeMin || typeof timeMin !== 'string') {
      throw new Error('timeMin is required (ISO 8601 datetime)');
    }
    if (!timeMax || typeof timeMax !== 'string') {
      throw new Error('timeMax is required (ISO 8601 datetime)');
    }

    const calendarIds = (params['calendarIds'] as string[] | undefined) ?? [this.calendarId];

    const res = await this.calendar!.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        items: calendarIds.map((id) => ({ id })),
      },
    });

    const allBusy: Array<{ start: string; end: string }> = [];
    const calendars = res.data.calendars ?? {};
    for (const cal of Object.values(calendars)) {
      for (const slot of cal.busy ?? []) {
        if (slot.start && slot.end) {
          allBusy.push({ start: slot.start, end: slot.end });
        }
      }
    }

    // Sort by start time
    allBusy.sort((a, b) => a.start.localeCompare(b.start));

    logger.info({ timeMin, timeMax, busySlots: allBusy.length }, 'Availability checked');
    return { timeMin, timeMax, busy: allBusy };
  }
}
