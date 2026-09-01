import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { matchTitleIcon, titleIconColor, type TitleIconSet } from '@/lib/calendar/title-rules';
import {
  lookupTitleIcon,
  resolveTitleIcons,
  suggestIcons,
  _setLocalIconDir,
} from '@/lib/calendar/title-icons';
import { getConfig, reloadConfig } from '@/lib/config';
import type { TitleIconRuleConfig } from '@/lib/config/types';

/** A resolved rule with a throwaway glyph — the matcher never looks at the art. */
const rule = (over: Partial<TitleIconSet['rules'][number]>) => ({
  equals: [],
  prefix: [],
  suffix: [],
  contains: [],
  keep: false,
  icon: 'solid:taxi',
  viewBox: '0 0 512 512',
  path: 'M0 0h1v1H0z',
  ...over,
});

const set = (...rules: TitleIconSet['rules']): TitleIconSet => ({ rules });

describe('matching a title', () => {
  it('drops a prefix and keeps the rest', () => {
    const m = matchTitleIcon('Dropoff Alex', set(rule({ prefix: ['Dropoff'] })));
    expect(m?.text).toBe('Alex');
  });

  it('drops a suffix and keeps the rest', () => {
    const m = matchTitleIcon('Dentist Appt', set(rule({ suffix: ['Appt'] })));
    expect(m?.text).toBe('Dentist');
  });

  it('drops an emoji from anywhere in the title', () => {
    const rules = set(rule({ contains: ['\u{1F696}'] }));
    expect(matchTitleIcon('\u{1F696} Alex', rules)?.text).toBe('Alex');
    // Mid-string: the doubled space the removal leaves must collapse, or the
    // title renders with a visible gouge in it.
    expect(matchTitleIcon('Soccer \u{1F696} practice', rules)?.text).toBe('Soccer practice');
  });

  it('keeps the matched words when the rule says so', () => {
    const m = matchTitleIcon('Pigs', set(rule({ equals: ['Pigs'], keep: true })));
    expect(m?.text).toBe('Pigs');
  });

  it('matches whatever case the phone typed it in', () => {
    expect(matchTitleIcon('dropoff alex', set(rule({ prefix: ['Dropoff'] })))?.text).toBe('alex');
    expect(matchTitleIcon('DENTIST APPT', set(rule({ suffix: ['appt'] })))?.text).toBe('DENTIST');
  });

  // THE BOUNDARY RULE IS THE WHOLE REASON THIS ISN'T A `startsWith` CALL.
  // "Drive" as a bare prefix eats "Driveway repair" and the wall shows a car
  // icon beside the word "way".
  it('will not match half a word', () => {
    const rules = set(rule({ prefix: ['Drive'] }));
    expect(matchTitleIcon('Driveway repair', rules)).toBeNull();
    expect(matchTitleIcon('Drive Jamie to school', rules)?.text).toBe('Jamie to school');
  });

  it('needs no boundary where the pattern has no word edge', () => {
    // An emoji is not a word character, so it matches flush against text.
    const m = matchTitleIcon('\u{1F696}Alex', set(rule({ contains: ['\u{1F696}'] })));
    expect(m?.text).toBe('Alex');
  });

  it('cleans up punctuation the drop left dangling', () => {
    const rules = set(rule({ prefix: ['Dropoff'] }));
    expect(matchTitleIcon('Dropoff: Alex', rules)?.text).toBe('Alex');
    expect(matchTitleIcon('Dropoff - Alex', rules)?.text).toBe('Alex');
  });

  it('leaves a trailing slash alone — "Call w/" is the whole point', () => {
    const rules = set(rule({ prefix: ['Call'] }));
    expect(matchTitleIcon('Call w/ Bob', rules)?.text).toBe('w/ Bob');
    expect(matchTitleIcon('Call w/', rules)?.text).toBe('w/');
  });

  // A glyph on its own is not an event anyone can identify from the doorway.
  it('gives the words back when dropping them would leave nothing', () => {
    const m = matchTitleIcon('Pigs', set(rule({ equals: ['Pigs'] })));
    expect(m?.text).toBe('Pigs');
  });

  it('takes the first matching rule and stops', () => {
    const m = matchTitleIcon(
      '\u{1F696} Dropoff Alex',
      set(
        rule({ contains: ['\u{1F696}'], icon: 'solid:taxi' }),
        rule({ prefix: ['\u{1F696} Dropoff'], icon: 'solid:car-side' })
      )
    );
    expect(m?.rule.icon).toBe('solid:taxi');
    expect(m?.text).toBe('Dropoff Alex');
  });

  it('returns null for anything that does not match', () => {
    const rules = set(rule({ prefix: ['Dropoff'] }));
    expect(matchTitleIcon('Soccer practice', rules)).toBeNull();
    expect(matchTitleIcon('', rules)).toBeNull();
    expect(matchTitleIcon('   ', rules)).toBeNull();
  });

  // The structural half of CLAUDE.md rule 2: with no rules there is nothing to
  // match, every call site falls through to its bare string, and the wall's
  // default render cannot have moved.
  it('returns null when the feature is unconfigured', () => {
    expect(matchTitleIcon('Dropoff Alex', undefined)).toBeNull();
    expect(matchTitleIcon('Dropoff Alex', set())).toBeNull();
  });
});

describe('what colour a glyph takes', () => {
  const match = { rule: rule({ prefix: ['x'] }), text: 'x' };

  it('inherits the title colour when nothing asks otherwise', () => {
    expect(titleIconColor(match, set(), '#ff0000', false)).toBeUndefined();
  });

  it('takes the board default, then the rule override', () => {
    const withDefault: TitleIconSet = { rules: [], color: '#111' };
    expect(titleIconColor(match, withDefault, undefined, false)).toBe('#111');
    const overridden = { rule: rule({ prefix: ['x'], color: '#222' }), text: 'x' };
    expect(titleIconColor(overridden, withDefault, undefined, false)).toBe('#222');
  });

  it('resolves "calendar" to the event’s own calendar colour', () => {
    const m = { rule: rule({ prefix: ['x'], color: 'calendar' }), text: 'x' };
    expect(titleIconColor(m, set(), '#FB923C', false)).toBe('#FB923C');
  });

  // A shared event has TWO calendar colours, so the caller hands over neither
  // rather than picking the first and claiming the event is one person's.
  it('falls back to the board default when there is no single calendar colour', () => {
    const m = { rule: rule({ prefix: ['x'], color: 'calendar' }), text: 'x' };
    expect(titleIconColor(m, { rules: [], color: '#d1d5dc' }, undefined, false)).toBe('#d1d5dc');
    // Nothing to fall back to: the board default is "calendar" as well.
    expect(titleIconColor(m, { rules: [], color: 'calendar' }, undefined, false)).toBeUndefined();
    expect(titleIconColor(m, set(), undefined, false)).toBeUndefined();
  });

  // On an all-day bar the BACKGROUND is the calendar colour. A calendar-coloured
  // glyph would vanish into it, and a fixed one can fail contrast against a
  // palette the config is free to change under it.
  it('ignores every colour setting on a filled band bar', () => {
    const m = { rule: rule({ prefix: ['x'], color: 'calendar' }), text: 'x' };
    expect(titleIconColor(m, { rules: [], color: '#111' }, '#FB923C', true)).toBeUndefined();
  });
});

describe('the icon catalogue', () => {
  it('resolves a Font Awesome icon to a viewBox and a path', () => {
    const taxi = lookupTitleIcon('solid:taxi');
    expect(taxi?.viewBox).toMatch(/^0 0 \d+ \d+$/);
    expect(taxi?.path.length).toBeGreaterThan(50);
  });

  it('reaches all three free packs', () => {
    expect(lookupTitleIcon('solid:car-side')).not.toBeNull();
    expect(lookupTitleIcon('regular:calendar')).not.toBeNull();
    expect(lookupTitleIcon('brands:google')).not.toBeNull();
  });

  it('refuses anything it cannot draw', () => {
    expect(lookupTitleIcon('solid:not-an-icon')).toBeNull();
    expect(lookupTitleIcon('taxi')).toBeNull();
    expect(lookupTitleIcon('duotone:taxi')).toBeNull();
  });

  // Font Awesome Free genuinely has cow, horse, dog and tractor but no pig, and
  // a 4-H family needs one. That gap is what `local:` exists for.
  it('has no pig, which is why data/icons exists', () => {
    expect(lookupTitleIcon('solid:pig')).toBeNull();
    expect(lookupTitleIcon('solid:piggy-bank')).not.toBeNull();
  });

  it('suggests near misses, because a typo only ever surfaces at load', () => {
    expect(suggestIcons('solid:taxii').join(' ')).toContain('taxi');
  });
});

describe('a local icon dropped into data/icons', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'homehq-icons-'));
    _setLocalIconDir(dir);
  });
  afterEach(() => {
    _setLocalIconDir(null);
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads the file and keeps its viewBox', () => {
    writeFileSync(
      join(dir, 'pig.svg'),
      '<svg viewBox="0 0 640 512"><path d="M10 10h20v20z"/></svg>'
    );
    expect(lookupTitleIcon('local:pig')).toEqual({ viewBox: '0 0 640 512', path: 'M10 10h20v20z' });
  });

  it('flattens a multi-path file into one outline', () => {
    writeFileSync(
      join(dir, 'barn.svg'),
      '<svg viewBox="0 0 24 24"><path d="M1 1z"/><path d="M2 2z"/></svg>'
    );
    expect(lookupTitleIcon('local:barn')?.path).toBe('M1 1z M2 2z');
  });

  it('refuses a missing file, an empty one, and a path escape', () => {
    expect(lookupTitleIcon('local:missing')).toBeNull();
    writeFileSync(join(dir, 'blank.svg'), '<svg viewBox="0 0 24 24"></svg>');
    expect(lookupTitleIcon('local:blank')).toBeNull();
    expect(lookupTitleIcon('local:../config')).toBeNull();
  });
});

describe('resolving a display block into what the browser receives', () => {
  const display = (titleIcons?: TitleIconRuleConfig[], titleIconColor?: string) => ({
    calendarWeeks: 2,
    showWeather: true,
    titleIcons,
    titleIconColor,
  });

  // Undefined, not an empty set: it is the value every render site checks to
  // short-circuit back to the bare title node (CLAUDE.md rule 2).
  it('is undefined when the key is absent or empty', () => {
    expect(resolveTitleIcons(display())).toBeUndefined();
    expect(resolveTitleIcons(display([]))).toBeUndefined();
  });

  it('normalises a bare string to an array and bakes the glyph in', () => {
    const resolved = resolveTitleIcons(display([{ prefix: 'Dropoff', icon: 'solid:car-side' }]));
    expect(resolved?.rules).toHaveLength(1);
    expect(resolved?.rules[0].prefix).toEqual(['Dropoff']);
    expect(resolved?.rules[0].equals).toEqual([]);
    expect(resolved?.rules[0].keep).toBe(false);
    expect(resolved?.rules[0].path.length).toBeGreaterThan(50);
  });

  it('puts the longest pattern first, so the specific one wins', () => {
    const resolved = resolveTitleIcons(
      display([{ prefix: ['Drive', 'Drive to', 'Dropoff'], icon: 'solid:car-side' }])
    );
    expect(resolved?.rules[0].prefix).toEqual(['Drive to', 'Dropoff', 'Drive']);
    // The behaviour that ordering buys: "Drive to Austin" loses both words.
    expect(matchTitleIcon('Drive to Austin', resolved)?.text).toBe('Austin');
    expect(matchTitleIcon('Drive Ana home', resolved)?.text).toBe('Ana home');
  });

  it('carries the board default colour through', () => {
    const resolved = resolveTitleIcons(
      display([{ equals: 'Pigs', icon: 'solid:piggy-bank' }], '#f59e0b')
    );
    expect(resolved?.color).toBe('#f59e0b');
  });
});

describe('config rejects a broken rule at LOAD, not at render', () => {
  let tmpDir: string;
  const base = {
    calendars: [{ id: 'primary', name: 'Family', color: '#4285f4' }],
    weather: { latitude: 40.7128, longitude: -74.006, temperatureUnit: 'fahrenheit' },
    auth: { pin: '123456' },
  };
  const write = (titleIcons: unknown, extra: Record<string, unknown> = {}) => {
    const path = join(tmpDir, 'config.json');
    writeFileSync(
      path,
      JSON.stringify({
        ...base,
        display: { calendarWeeks: 2, showWeather: true, titleIcons, ...extra },
      })
    );
    return path;
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'homehq-titlecfg-'));
    reloadConfig();
  });
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('accepts a well-formed block', () => {
    const cfg = getConfig(
      write([
        { contains: ['\u{1F696}', '\u{1F695}'], icon: 'solid:taxi' },
        { prefix: 'Call', icon: 'solid:phone', color: 'calendar' },
        { equals: 'Pigs', icon: 'solid:piggy-bank', keep: true },
      ])
    );
    expect(cfg.display.titleIcons).toHaveLength(3);
  });

  it('demands exactly one match kind', () => {
    expect(() => getConfig(write([{ icon: 'solid:taxi' }]))).toThrow('exactly one of');
    expect(() => getConfig(write([{ prefix: 'a', suffix: 'b', icon: 'solid:taxi' }]))).toThrow(
      'prefix + suffix'
    );
  });

  it('demands a non-empty pattern', () => {
    expect(() => getConfig(write([{ prefix: '   ', icon: 'solid:taxi' }]))).toThrow(
      'non-empty string'
    );
    expect(() => getConfig(write([{ prefix: [], icon: 'solid:taxi' }]))).toThrow(
      'non-empty string'
    );
  });

  // The typo is the likeliest way this breaks, and config-sync.sh's health check
  // is the thing that catches it — but only if the failure happens at boot.
  it('rejects an icon this build cannot draw, and says what it meant', () => {
    expect(() => getConfig(write([{ prefix: 'Call', icon: 'solid:phonee' }]))).toThrow(
      /is not an icon this build has[\s\S]*did you mean[\s\S]*phone/
    );
    expect(() => getConfig(write([{ prefix: 'Pigs', icon: 'local:pig' }]))).toThrow(
      /data\/icons\/pig\.svg/
    );
  });

  it('rejects the wrong type for colour and keep', () => {
    expect(() => getConfig(write([{ prefix: 'a', icon: 'solid:taxi', color: 7 }]))).toThrow(
      'color must be a CSS color'
    );
    expect(() => getConfig(write([{ prefix: 'a', icon: 'solid:taxi', keep: 'yes' }]))).toThrow(
      'keep must be true or false'
    );
    expect(() => getConfig(write(undefined, { titleIconColor: 3 }))).toThrow('titleIconColor');
  });

  it('holds a board override to the same standard as the wall', () => {
    const path = join(tmpDir, 'config.json');
    writeFileSync(
      path,
      JSON.stringify({
        ...base,
        display: { calendarWeeks: 2, showWeather: true },
        boards: {
          maddie: { layout: 'personal', display: { titleIcons: [{ icon: 'solid:nope' }] } },
        },
      })
    );
    expect(() => getConfig(path)).toThrow('boards.maddie.display.titleIcons[0]');
  });
});

// The example is what a new install copies, and a rule naming an icon this
// build lacks would make it refuse to boot. Cheap to guard, invisible to catch
// any other way.
describe('the shipped example config', () => {
  it('boots, icons and all', () => {
    reloadConfig();
    const cfg = getConfig(resolve(process.cwd(), 'data/config.example.json'));
    const rules = cfg.display.titleIcons ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules)
      expect(lookupTitleIcon(r.icon), `${r.icon} is unresolvable`).not.toBeNull();
    expect(resolveTitleIcons(cfg.display)?.rules).toHaveLength(rules.length);
  });
});
