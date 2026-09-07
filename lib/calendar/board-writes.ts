/**
 * What one board is allowed to WRITE.
 *
 * `board-scope.ts` decides what a board may read; this is its twin for the
 * write routes. Until 2026-09-07 those routes checked for a valid session and
 * `isCalendarWriteEnabled()` and no more, so a session minted by a bedroom
 * panel's PIN could POST an edit for any calendar in the house. The only thing
 * keeping a personal board to its own calendars was `canEditEvent()` in the
 * browser, which is a courtesy, not a gate.
 *
 * The rules here are the browser's rules, restated server-side so the two can
 * never disagree:
 *
 * - A new event may land on the board's own calendars or on one it always
 *   shows (the "Family" target `eventTargets()` offers). Nothing else.
 * - An existing event may be changed or deleted only if EVERY copy of it is
 *   on one of the board's own calendars, which is exactly `canEditEvent()`.
 *   A shared event with a parent's copy is theirs to edit, not hers.
 * - A to-do route may touch only the one Todoist project the board names.
 *
 * A board with the family layout is unrestricted, as it is on the read side:
 * the wall draws every calendar and its form edits membership. An unstamped
 * (household) session is unrestricted too, because that is what the household
 * PIN has always meant. Every function here takes the resolved board so it can
 * be unit-tested with no session in sight.
 */

import type { ResolvedBoard } from '@/lib/config/boards';

/** True when this board's writes are held to its own calendars. */
export function isWriteRestricted(board: ResolvedBoard | null): board is ResolvedBoard {
  return board !== null && board.layout === 'personal';
}

/**
 * Calendars a restricted board may put a NEW event on: its own person's, plus
 * the always-shown ones. Mirrors `eventTargets()` in `personal-utils.ts`, which
 * offers "Just me" (an own calendar) and "Family" (another own calendar, else
 * the first always-shown one).
 */
export function creatableCalendarIds(board: ResolvedBoard): ReadonlySet<string> {
  return new Set([...board.ownCalendarIds, ...board.alwaysShowIds]);
}

/**
 * Whether a restricted board may change or delete an event that lives on
 * `memberIds` (every calendar its link group resolves to). All of them must be
 * the board's own person's. Mirrors `canEditEvent()`.
 */
export function boardOwnsEvent(board: ResolvedBoard, memberIds: readonly string[]): boolean {
  const own = new Set(board.ownCalendarIds);
  return memberIds.length > 0 && memberIds.every((id) => own.has(id));
}

/** Whether a restricted board may read or write a Todoist project. */
export function boardMayUseProject(board: ResolvedBoard, projectId: string): boolean {
  return board.todos?.projectId === projectId;
}
