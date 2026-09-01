import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { fas } from '@fortawesome/free-solid-svg-icons';
import { far } from '@fortawesome/free-regular-svg-icons';
import { fab } from '@fortawesome/free-brands-svg-icons';
import type { DisplayConfig, TitleIconRuleConfig } from '@/lib/config/types';
import type { TitleIconRule, TitleIconSet } from './title-rules';

/**
 * Event-title icons — the catalogue half. SERVER ONLY.
 *
 * Font Awesome Free ships about 1,900 solid glyphs; the family uses six. The
 * whole catalogue therefore stays in `node_modules` on the droplet and only the
 * handful a config actually names is looked up and handed to the browser as
 * path data. That is what makes a new rule a `config.json` edit and a restart
 * rather than a rebuild — the alternative, vendoring generated SVGs the way
 * `fetch-weather-icons.mjs` does, would put a commit and a deploy between you
 * and every new icon.
 *
 * It also rules out Font Awesome's own SVG-replacement script, which would be
 * the obvious way to do this in a plain web page: it rewrites `<i>` into `<svg>`
 * AFTER the document renders, and `useWeekGridMetrics` measures event rows in
 * `useLayoutEffect`, BEFORE paint. Every cell's "+N more" would be computed
 * against rows that had not grown their icons yet.
 *
 * A local escape hatch exists for the glyphs Font Awesome doesn't have (there
 * is no pig): drop `pig.svg` into `data/icons/` and write `"local:pig"`. Same
 * gitignored `data/` directory as `config.json`, so it needs no rebuild either.
 */

type Pack = 'solid' | 'regular' | 'brands';

const PACKS: Record<Pack, Record<string, { iconName: string; icon: unknown[] }>> = {
  solid: fas as never,
  regular: far as never,
  brands: fab as never,
};

/** Font Awesome keys its packs by camelCase export name (`faTaxi`) and repeats
 * icons under every alias, so this folds them down to the kebab-case
 * `iconName` a config actually writes. Built once per pack, on first use. */
const byName = new Map<Pack, Map<string, ResolvedGlyph>>();

export interface ResolvedGlyph {
  viewBox: string;
  path: string;
}

function packIcons(pack: Pack): Map<string, ResolvedGlyph> {
  let cached = byName.get(pack);
  if (cached) return cached;
  cached = new Map();
  for (const def of Object.values(PACKS[pack])) {
    const [w, h, , , data] = def.icon as [number, number, unknown, unknown, string | string[]];
    // Free packs are single-path; an array would be a duotone glyph, and
    // flattening one to a single `fill` would draw it wrong rather than draw
    // it plainly. Skip those instead of shipping a smear.
    if (typeof data !== 'string') continue;
    cached.set(def.iconName, { viewBox: `0 0 ${w} ${h}`, path: data });
  }
  byName.set(pack, cached);
  return cached;
}

let localDirOverride: string | null = null;
const LOCAL_DIR = () => localDirOverride ?? resolve(process.cwd(), 'data/icons');

/** Point `local:` lookups somewhere else. Tests only — the same escape hatch
 * `_setDefaultDb()` gives the database, and for the same reason: a test must
 * never depend on a file in the gitignored `data/` directory. */
export function _setLocalIconDir(dir: string | null): void {
  localDirOverride = dir;
}

/**
 * A hand-dropped SVG from `data/icons/`. Every `d` in the file is concatenated
 * into one path, which is correct for a solid outline (the shape Font Awesome
 * uses, and the only shape that survives being drawn at chip size — the mono
 * emoji font shipped in 2026-08 proved that line art becomes a smudge there).
 * Stroked line art is NOT supported and will render as a filled blob.
 */
function localGlyph(name: string): ResolvedGlyph | null {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return null;
  const file = resolve(LOCAL_DIR(), `${name}.svg`);
  if (!existsSync(file)) return null;
  const svg = readFileSync(file, 'utf8');
  const paths = [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
  if (!paths.length) return null;
  const box = svg.match(/viewBox="([^"]+)"/)?.[1];
  return { viewBox: box ?? '0 0 512 512', path: paths.join(' ') };
}

/** Resolve an id like "solid:taxi", "regular:calendar" or "local:pig". */
export function lookupTitleIcon(id: string): ResolvedGlyph | null {
  const at = id.indexOf(':');
  if (at < 0) return null;
  const source = id.slice(0, at);
  const name = id.slice(at + 1);
  if (source === 'local') return localGlyph(name);
  if (source in PACKS) return packIcons(source as Pack).get(name) ?? null;
  return null;
}

/** Names close enough to `name` to be worth putting in an error message. A
 * typo'd icon is the likeliest way this feature breaks, and it breaks at config
 * load — where the message is the only thing anyone will see. */
export function suggestIcons(id: string, limit = 4): string[] {
  const name = id.slice(id.indexOf(':') + 1).toLowerCase();
  if (name.length < 3) return [];
  const hits: string[] = [];
  for (const pack of Object.keys(PACKS) as Pack[]) {
    for (const known of packIcons(pack).keys()) {
      if (known.includes(name) || name.includes(known)) hits.push(`${pack}:${known}`);
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

/**
 * Normalise a config match field, which accepts a bare string or an array.
 *
 * Sorted LONGEST FIRST, so the most specific pattern in a rule wins. Without
 * this, `["Drive", "Drive to"]` would match "Drive to Austin" on "Drive" and
 * leave "to Austin" — correct only if you happened to list the longer one
 * first, which is exactly the kind of ordering nobody remembers a month later.
 * Rule order still decides between RULES; this only orders within one.
 */
function patterns(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : [v])
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

/**
 * Turn a board's display block into the set the browser receives, or undefined
 * when the feature is unconfigured.
 *
 * Undefined rather than an empty set is deliberate: it is the value that lets
 * every render site short-circuit to the bare title node it drew before this
 * feature existed, which is how the wall-default stays byte-for-byte
 * (CLAUDE.md rule 2).
 */
export function resolveTitleIcons(display: DisplayConfig): TitleIconSet | undefined {
  const configured = display.titleIcons;
  if (!configured?.length) return undefined;

  const rules: TitleIconRule[] = [];
  for (const rule of configured) {
    const glyph = lookupTitleIcon(rule.icon);
    // Config validation already rejected an unknown icon, so this only fires
    // if a `data/icons/` file was deleted under a running server.
    if (!glyph) continue;
    rules.push({
      equals: patterns(rule.equals),
      prefix: patterns(rule.prefix),
      suffix: patterns(rule.suffix),
      contains: patterns(rule.contains),
      keep: rule.keep === true,
      color: rule.color,
      icon: rule.icon,
      viewBox: glyph.viewBox,
      path: glyph.path,
    });
  }
  if (!rules.length) return undefined;
  return { rules, color: display.titleIconColor };
}

export type { TitleIconRuleConfig };
