import { describe, it, expect, afterEach, vi } from 'vitest';
import { patchCalendarEvent, deleteCalendarEvent, CalendarApiError } from '@/lib/google/calendar';

// Exercises the real Google write client for edit/delete against a mocked fetch
// (the route tests mock these functions, so their own wiring — URL encoding,
// method, and delete's 410-as-success idempotency — is only covered here).
describe('patchCalendarEvent / deleteCalendarEvent (Google write client)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const patchInput = {
    summary: 'Updated',
    start: { dateTime: '2026-07-01T11:00:00', timeZone: 'America/Chicago', date: null },
    end: { dateTime: '2026-07-01T12:00:00', timeZone: 'America/Chicago', date: null },
  };

  it('PATCHes events.patch with bearer auth + JSON body and returns the updated event', async () => {
    const updated = {
      id: 'evt_9',
      summary: 'Updated',
      start: { dateTime: '2026-07-01T11:00:00-05:00' },
      end: { dateTime: '2026-07-01T12:00:00-05:00' },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(updated), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await patchCalendarEvent(
      'tok_123',
      'cal@group.calendar.google.com',
      'evt_9',
      patchInput
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // Both calendarId and eventId must be URL-encoded into the path.
    expect(url).toContain('/calendars/cal%40group.calendar.google.com/events/evt_9');
    expect(init.method).toBe('PATCH');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok_123');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string).summary).toBe('Updated');
    expect(result.id).toBe('evt_9');
  });

  it('patch throws CalendarApiError carrying the HTTP status on a non-OK response', async () => {
    global.fetch = vi.fn(
      async () => new Response('insufficient permissions', { status: 403 })
    ) as unknown as typeof fetch;

    const err = await patchCalendarEvent('tok', 'primary', 'evt', patchInput).catch((e) => e);
    expect(err).toBeInstanceOf(CalendarApiError);
    expect(err.status).toBe(403);
  });

  it('DELETEs with bearer auth + an encoded path and resolves on 204', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      deleteCalendarEvent('tok_123', 'cal@group.calendar.google.com', 'evt_9')
    ).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/calendars/cal%40group.calendar.google.com/events/evt_9');
    expect(init.method).toBe('DELETE');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok_123');
  });

  it('treats a 410 Gone as success (idempotent delete — already removed)', async () => {
    global.fetch = vi.fn(
      async () => new Response('already gone', { status: 410 })
    ) as unknown as typeof fetch;

    await expect(deleteCalendarEvent('tok', 'primary', 'evt')).resolves.toBeUndefined();
  });

  it('delete throws CalendarApiError on other non-OK responses', async () => {
    global.fetch = vi.fn(
      async () => new Response('forbidden', { status: 403 })
    ) as unknown as typeof fetch;

    const err = await deleteCalendarEvent('tok', 'primary', 'evt').catch((e) => e);
    expect(err).toBeInstanceOf(CalendarApiError);
    expect(err.status).toBe(403);
  });
});
