import { describe, expect, it } from 'vitest';
import { dayPopoverBox } from '@/components/calendar/DayPopover';

/**
 * Where the wall's "+N more" card lands.
 *
 * Month view's `popoverLayout` anchors to a small cell and reserves half the
 * region to grow into. A week column is the full height of the grid and its
 * "+N more" is always the last thing in it, so that rule opened a three-row
 * card ~400px above the button that summoned it. This anchors to the button's
 * own edge instead — the numbers below are the wall's real geometry at
 * 1920x1080: a 913px-tall grid, 273px columns.
 */
const REGION = { width: 1920, height: 913 };
const COL = { left: 548, width: 273 }; // Wednesday

describe('dayPopoverBox — horizontal', () => {
  it('centres the card on its day column', () => {
    const box = dayPopoverBox({ top: 850, bottom: 880 }, COL, REGION);
    expect(box.left + box.width / 2).toBeCloseTo(COL.left + COL.width / 2, 5);
  });

  it('is wider than the column, so the card reads as its own surface', () => {
    const box = dayPopoverBox({ top: 850, bottom: 880 }, COL, REGION);
    expect(box.width).toBeGreaterThan(COL.width);
  });

  it('never spills past the left edge', () => {
    const box = dayPopoverBox({ top: 850, bottom: 880 }, { left: 0, width: 273 }, REGION);
    expect(box.left).toBeGreaterThanOrEqual(8);
  });

  it('never spills past the right edge', () => {
    const box = dayPopoverBox({ top: 850, bottom: 880 }, { left: 1647, width: 273 }, REGION);
    expect(box.left + box.width).toBeLessThanOrEqual(REGION.width - 8);
  });

  it('holds a readable minimum on a narrow column', () => {
    const box = dayPopoverBox({ top: 850, bottom: 880 }, { left: 10, width: 90 }, REGION);
    expect(box.width).toBe(240);
  });
});

describe('dayPopoverBox — vertical', () => {
  it('grows upward out of a button near the bottom, the ordinary case', () => {
    // A full-height column puts "+N more" at the bottom, so the card opens up
    // and its bottom edge sits on the button.
    const box = dayPopoverBox({ top: 850, bottom: 880 }, COL, REGION);
    expect(box.bottom).toBe(REGION.height - 880);
    expect(box.top).toBeUndefined();
  });

  it('gives it every pixel above the button to grow into', () => {
    const box = dayPopoverBox({ top: 850, bottom: 880 }, COL, REGION);
    expect(box.maxHeight).toBe(880 - 8);
  });

  it('grows downward instead when the button is high up', () => {
    // Two weeks on screen makes a short row; the anchor flips rather than
    // squeezing the card into a sliver.
    const box = dayPopoverBox({ top: 40, bottom: 70 }, COL, REGION);
    expect(box.top).toBe(40);
    expect(box.bottom).toBeUndefined();
    expect(box.maxHeight).toBe(REGION.height - 40 - 8);
  });

  it('anchors by exactly one edge, never both', () => {
    for (const b of [
      { top: 10, bottom: 40 },
      { top: 450, bottom: 480 },
      { top: 880, bottom: 910 },
    ]) {
      const box = dayPopoverBox(b, COL, REGION);
      expect([box.top, box.bottom].filter((v) => v !== undefined)).toHaveLength(1);
    }
  });

  it('never asks for a negative height', () => {
    const box = dayPopoverBox({ top: 0, bottom: 2 }, COL, { width: 1920, height: 4 });
    expect(box.maxHeight).toBeGreaterThanOrEqual(0);
  });
});
