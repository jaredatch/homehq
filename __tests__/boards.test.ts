import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getConfig, reloadConfig } from '@/lib/config';
import {
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

    it('defaults the accent to the colour of the person it belongs to', () => {
      const board = resolveBoard('kida', write({ boards }))!;
      expect(board.accent).toBe('#ec4899');
    });

    it('lets an explicit accent win', () => {
      const config = write({
        boards: { kida: { ...boards.kida, accent: '#00ff00' } },
      });
      expect(resolveBoard('kida', config)!.accent).toBe('#00ff00');
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
