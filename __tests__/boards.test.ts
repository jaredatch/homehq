import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getConfig, reloadConfig } from '@/lib/config';
import {
  boardPin,
  boardSlugForHost,
  boardSlugs,
  familyBoard,
  resolveBoard,
  todoProjectIds,
} from '@/lib/config/boards';
import type { AppConfig } from '@/lib/config/types';

describe('boards', () => {
  let tmpDir: string;

  const base = {
    calendars: [
      { id: 'family@g', name: 'Family', color: '#4285f4' },
      { id: 'kida@g', name: 'Kid A', color: '#ec4899' },
      { id: 'kida-private@g', name: 'Kid A private', color: '#f472b6' },
    ],
    weather: { latitude: 40.7128, longitude: -74.006, temperatureUnit: 'fahrenheit' },
    display: { calendarWeeks: 2, showWeather: true, filterResetSeconds: 300 },
    auth: { pin: '654321' },
  };

  const write = (extra: Record<string, unknown> = {}): AppConfig => {
    const path = join(tmpDir, 'config.json');
    writeFileSync(path, JSON.stringify({ ...base, ...extra }));
    return getConfig(path);
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'homehq-boards-'));
    reloadConfig();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('no boards configured', () => {
    it('loads and reports no boards', () => {
      const config = write();
      expect(config.boards).toBeUndefined();
      expect(boardSlugs(config)).toEqual([]);
      expect(todoProjectIds(config)).toEqual([]);
    });

    it('still resolves a family board straight from the top-level config', () => {
      const config = write();
      const board = familyBoard(config);
      expect(board.layout).toBe('family');
      // Same reference, not a copy — the wall renders from exactly what it
      // always did (CLAUDE.md rule 2).
      expect(board.calendars).toBe(config.calendars);
      expect(board.display).toBe(config.display);
    });

    it('keeps a hidden calendar off the family board', () => {
      // A personal board's private calendar syncs, but must never surface on
      // the kitchen wall.
      const config = write({
        calendars: [...base.calendars, { id: 'room@g', name: 'Room', color: '#fff', hidden: true }],
      });
      expect(familyBoard(config).calendars.map((c) => c.id)).not.toContain('room@g');
    });

    it('hands back the SAME calendars array when nothing is hidden', () => {
      const config = write();
      expect(familyBoard(config).calendars).toBe(config.calendars);
    });

    it('maps no host to a board', () => {
      const config = write();
      expect(boardSlugForHost('kitchen.example.com', config)).toBeNull();
    });
  });

  describe('resolution', () => {
    const boards = {
      kida: {
        layout: 'personal',
        name: 'Kid A',
        host: 'KidA.Example.com',
        calendars: ['kida@g', 'kida-private@g', 'family@g'],
        ownCalendars: ['kida@g', 'kida-private@g'],
        defaultCalendar: 'kida-private@g',
        todos: { projectId: '6cfABC' },
        display: { showWeather: false },
      },
    };

    it('returns null for an unknown slug rather than falling back', () => {
      // A typo'd kiosk URL must 404, never quietly show the whole family's
      // calendar on a kid's dresser.
      expect(resolveBoard('nope', write({ boards }))).toBeNull();
    });

    it('narrows and orders the calendars the board asked for', () => {
      const board = resolveBoard('kida', write({ boards }))!;
      expect(board.calendars.map((c) => c.id)).toEqual(['kida@g', 'kida-private@g', 'family@g']);
    });

    it('merges display over the top-level block instead of replacing it', () => {
      const board = resolveBoard('kida', write({ boards }))!;
      expect(board.display.showWeather).toBe(false); // overridden
      expect(board.display.calendarWeeks).toBe(2); // inherited
      expect(board.display.filterResetSeconds).toBe(300); // inherited
    });

    it('carries the todo binding and the create target', () => {
      const board = resolveBoard('kida', write({ boards }))!;
      expect(board.todos).toEqual({ projectId: '6cfABC' });
      expect(board.defaultCalendarId).toBe('kida-private@g');
      expect(board.ownCalendarIds).toEqual(['kida@g', 'kida-private@g']);
    });

    // The per-board accent colour was removed 2026-09-02: every board now uses
    // the family board's own scheme, so a form on a bedroom panel looks like a
    // form on the kitchen wall. An `accent` left in an old config is simply
    // ignored, which is what this asserts.
    it('ignores a leftover accent rather than failing to load', () => {
      const config = write({
        boards: { kida: { ...boards.kida, accent: '#00ff00' } },
      });
      expect(resolveBoard('kida', config)!.name).toBe('Kid A');
      expect(resolveBoard('kida', config)).not.toHaveProperty('accent');
    });

    it('treats every calendar as her own when ownCalendars is omitted', () => {
      const config = write({
        boards: { kida: { layout: 'personal', calendars: ['kida@g'] } },
      });
      expect(resolveBoard('kida', config)!.ownCalendarIds).toEqual(['kida@g']);
    });

    it('falls back to the slug when the board has no name', () => {
      const config = write({ boards: { kida: { layout: 'personal' } } });
      expect(resolveBoard('kida', config)!.name).toBe('kida');
    });

    it('lets a board name a hidden calendar explicitly', () => {
      const config = write({
        calendars: [...base.calendars, { id: 'room@g', name: 'Room', color: '#fff', hidden: true }],
        boards: { kida: { layout: 'personal', calendars: ['kida@g', 'room@g'] } },
      });
      expect(resolveBoard('kida', config)!.calendars.map((c) => c.id)).toEqual([
        'kida@g',
        'room@g',
      ]);
    });

    it('omits hidden calendars from a board that names none', () => {
      const config = write({
        calendars: [...base.calendars, { id: 'room@g', name: 'Room', color: '#fff', hidden: true }],
        boards: { kida: { layout: 'personal' } },
      });
      expect(resolveBoard('kida', config)!.calendars.map((c) => c.id)).not.toContain('room@g');
    });

    it('carries alwaysShow through', () => {
      const config = write({
        boards: {
          kida: {
            layout: 'personal',
            calendars: ['kida@g', 'family@g'],
            ownCalendars: ['kida@g'],
            alwaysShow: ['family@g'],
          },
        },
      });
      expect(resolveBoard('kida', config)!.alwaysShowIds).toEqual(['family@g']);
    });

    it('collects todo project ids across boards, deduped', () => {
      const config = write({
        boards: {
          kida: { layout: 'personal', todos: { projectId: 'p1' } },
          kidb: { layout: 'personal', todos: { projectId: 'p1' } },
          kidc: { layout: 'personal', todos: { projectId: 'p2' } },
        },
      });
      expect(todoProjectIds(config).sort()).toEqual(['p1', 'p2']);
    });
  });

  describe('host mapping', () => {
    const config = () =>
      write({
        boards: { kida: { layout: 'personal', host: 'KidA.Example.com' } },
      });

    it('matches case-insensitively and ignores the port', () => {
      expect(boardSlugForHost('kida.example.com', config())).toBe('kida');
      expect(boardSlugForHost('KIDA.EXAMPLE.COM:3000', config())).toBe('kida');
    });

    it('leaves a host no board claims alone', () => {
      expect(boardSlugForHost('kitchen.example.com', config())).toBeNull();
      expect(boardSlugForHost(null, config())).toBeNull();
      expect(boardSlugForHost('', config())).toBeNull();
    });
  });

  describe('validation', () => {
    const bad = (boards: unknown) => () => write({ boards });

    it('rejects a slug that would not survive being a URL segment', () => {
      expect(bad({ 'Kid A': { layout: 'personal' } })).toThrow('must be lowercase letters');
    });

    it('rejects an unknown layout', () => {
      expect(bad({ kida: { layout: 'touch' } })).toThrow('must be "family" or "personal"');
    });

    it('rejects a calendar id that does not exist', () => {
      // Fail at load, not with a convincingly empty screen in a bedroom.
      expect(bad({ kida: { layout: 'personal', calendars: ['ghost@g'] } })).toThrow(
        'unknown calendar id "ghost@g"'
      );
    });

    it('rejects ownCalendars the board does not show', () => {
      expect(
        bad({
          kida: { layout: 'personal', calendars: ['kida@g'], ownCalendars: ['family@g'] },
        })
      ).toThrow('ownCalendars must list calendar ids this board shows');
    });

    it('rejects a create target the board cannot see', () => {
      expect(
        bad({ kida: { layout: 'personal', calendars: ['kida@g'], defaultCalendar: 'family@g' } })
      ).toThrow('is not one of this board');
    });

    it('rejects alwaysShow the board does not show', () => {
      expect(
        bad({ kida: { layout: 'personal', calendars: ['kida@g'], alwaysShow: ['family@g'] } })
      ).toThrow('alwaysShow must list calendar ids this board shows');
    });

    it('rejects a non-boolean hidden flag', () => {
      const path = join(tmpDir, 'config.json');
      writeFileSync(
        path,
        JSON.stringify({
          ...base,
          calendars: [{ id: 'a@g', name: 'A', color: '#fff', hidden: 'yes' }],
        })
      );
      expect(() => getConfig(path)).toThrow('calendar.hidden must be a boolean');
    });

    it('rejects two boards claiming one host', () => {
      expect(
        bad({
          kida: { layout: 'personal', host: 'a.example.com' },
          kidb: { layout: 'personal', host: 'A.Example.com' },
        })
      ).toThrow('claimed by both boards');
    });

    it('rejects an empty todo project id', () => {
      expect(bad({ kida: { layout: 'personal', todos: { projectId: '' } } })).toThrow(
        'non-empty Todoist project id'
      );
    });

    it('holds board display overrides to the same rules as the top level', () => {
      expect(bad({ kida: { layout: 'personal', display: { weekStartsOn: 'friday' } } })).toThrow(
        'boards.kida.display.weekStartsOn must be "monday" or "sunday"'
      );
      expect(bad({ kida: { layout: 'personal', display: { timezone: 'Mars/Olympus' } } })).toThrow(
        'is not a valid IANA time zone'
      );
      expect(bad({ kida: { layout: 'personal', display: { filterResetSeconds: -1 } } })).toThrow(
        'must be a non-negative number'
      );
    });

    it('rejects a boards value that is not an object map', () => {
      expect(bad([{ layout: 'personal' }])).toThrow('keyed by board slug');
    });
  });

  it('leaves a config with no boards key valid, as it always was', () => {
    expect(() => write()).not.toThrow();
  });
});

describe('board PINs', () => {
  let tmpDir: string;

  const base = {
    calendars: [{ id: 'kida@g', name: 'Kid A', color: '#ec4899' }],
    weather: { latitude: 0, longitude: 0, temperatureUnit: 'fahrenheit' },
    display: { calendarWeeks: 2, showWeather: true },
    auth: { pin: '654321' },
  };

  const write = (boards: unknown) => {
    const path = join(tmpDir, 'config.json');
    writeFileSync(path, JSON.stringify({ ...base, boards }));
    return path;
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'homehq-board-pin-'));
    reloadConfig();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    reloadConfig();
  });

  it('reads a board’s own PIN', () => {
    const config = getConfig(write({ kida: { layout: 'personal', pin: '111111' } }));
    expect(boardPin('kida', config)).toBe('111111');
  });

  it('reports no PIN for a board without one', () => {
    // Only the family PIN opens it — the pre-existing behaviour, unchanged.
    const config = getConfig(write({ kida: { layout: 'personal' } }));
    expect(boardPin('kida', config)).toBeNull();
    expect(boardPin('nope', config)).toBeNull();
  });

  it('keeps the PIN off ResolvedBoard', () => {
    // ResolvedBoard is handed to board components; one careless spread into a
    // client component would ship the PIN to the browser.
    const config = getConfig(write({ kida: { layout: 'personal', pin: '111111' } }));
    expect(JSON.stringify(resolveBoard('kida', config))).not.toContain('111111');
  });

  it('rejects a PIN that is not six digits', () => {
    expect(() => getConfig(write({ kida: { layout: 'personal', pin: '12345' } }))).toThrow(
      /boards\.kida\.pin/
    );
    expect(() => getConfig(write({ kida: { layout: 'personal', pin: 'abcdef' } }))).toThrow(
      /boards\.kida\.pin/
    );
  });

  // ownsCalendarWeeks — how the personal board's full-screen week knows whether
  // to use its own one-row default or a number the board actually asked for.
  // The merged display block can't answer that: it always reports SOMETHING,
  // because calendarWeeks is required at the top level.
  describe('ownsCalendarWeeks', () => {
    it("is false when a board inherits the wall's calendarWeeks", () => {
      const config = getConfig(write({ kida: { layout: 'personal' } }));
      const board = resolveBoard('kida', config)!;
      // Inherited, so the merged block reports the wall's 2 …
      expect(board.display.calendarWeeks).toBe(2);
      // … but the board never asked for it, and PersonalBoard uses 1 instead.
      expect(board.ownsCalendarWeeks).toBe(false);
    });

    it('is false when a board overrides some OTHER display key', () => {
      const config = getConfig(
        write({ kida: { layout: 'personal', display: { showWeather: false } } })
      );
      expect(resolveBoard('kida', config)!.ownsCalendarWeeks).toBe(false);
    });

    it('is true when a board names calendarWeeks itself', () => {
      const config = getConfig(
        write({ kida: { layout: 'personal', display: { calendarWeeks: 3 } } })
      );
      const board = resolveBoard('kida', config)!;
      expect(board.display.calendarWeeks).toBe(3);
      expect(board.ownsCalendarWeeks).toBe(true);
    });

    it('is true for the family board, whose calendarWeeks IS the top-level one', () => {
      expect(familyBoard(getConfig(write({}))).ownsCalendarWeeks).toBe(true);
    });
  });
});
