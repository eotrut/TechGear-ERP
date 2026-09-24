import { InvalidTransitionError } from "@/lib/errors";

/**
 * Status machines. Every entity with a lifecycle declares its allowed moves as
 * a typed map, and every status write goes through `assertTransition`. There
 * is no direct status assignment anywhere else, so an illegal move is a thrown
 * error rather than a quietly corrupted record. See docs/PLAN.md section 5.
 */

export type TransitionMap<S extends string> = Readonly<Record<S, readonly S[]>>;

export function canTransition<S extends string>(map: TransitionMap<S>, from: S, to: S): boolean {
  return map[from].includes(to);
}

export function assertTransition<S extends string>(
  map: TransitionMap<S>,
  entity: string,
  from: S,
  to: S,
): void {
  if (!canTransition(map, from, to)) {
    throw new InvalidTransitionError(entity, from, to);
  }
}

/** Statuses nothing can leave. */
export function isTerminal<S extends string>(map: TransitionMap<S>, status: S): boolean {
  return map[status].length === 0;
}
