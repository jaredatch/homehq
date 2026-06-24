import { describe, it, expect, afterEach, vi } from 'vitest';
import { createCalendarEvent, CalendarApiError } from '@/lib/google/calendar';

describe('createCalendarEvent (Google write client)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const sampleInput = {
    summary: 'Dentist',
    start: { dateTime: '2026-07-01T09:00:00', timeZone: 'America/Chicago' },
    end: { dateTime: '2026-07-01T10:00:00', timeZone: 'America/Chicago' },
  };

  it('POSTs events.insert with bearer auth + a JSON body and returns the created event', async () => {
    const created = {
      id: 'goog_evt_1',
      summary: 'Dentist',
      start: { dateTime: '2026-07-01T09:00:00-05:00' },
      end: { dateTime: '2026-07-01T10:00:00-05:00' },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(created), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await createCalendarEvent(
      'tok_123',
      'cal@group.calendar.google.com',
      sampleInput
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // calendarId must be URL-encoded into the path.
    expect(url).toContain('/calendars/cal%40group.calendar.google.com/events');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok_123');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string).summary).toBe('Dentist');
    expect(result.id).toBe('goog_evt_1');
  });

  it('throws CalendarApiError carrying the HTTP status on a non-OK response', async () => {
    global.fetch = vi.fn(
      async () => new Response('insufficient permissions', { status: 403 })
    ) as unknown as typeof fetch;

    const err = await createCalendarEvent('tok', 'primary', sampleInput).catch((e) => e);
    expect(err).toBeInstanceOf(CalendarApiError);
    expect(err.status).toBe(403);
  });
});
