/**
 * Domain errors. Each one carries a message that is safe to show the person
 * who caused it, so an action can return `error.message` verbatim instead of
 * guessing at what went wrong. Anything that is not a DomainError is a bug and
 * is logged, and the person sees a generic message instead.
 */

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

/**
 * A draw that would take a stock position below what it can give. Names the
 * SKU, the location and the shortfall, because "insufficient stock" on a
 * twelve-line transfer is not something a person can act on.
 */
export class InsufficientStockError extends DomainError {
  constructor(
    readonly sku: string,
    readonly warehouseCode: string,
    readonly requested: number,
    readonly available: number,
  ) {
    super(
      `${sku} has ${available} available in ${warehouseCode}, so ${requested} cannot be taken. ` +
        `Short by ${requested - available}.`,
    );
    this.name = "InsufficientStockError";
  }
}

/** A status change the entity's transition map does not allow. */
export class InvalidTransitionError extends DomainError {
  constructor(
    readonly entity: string,
    readonly from: string,
    readonly to: string,
    detail?: string,
  ) {
    super(
      detail ??
        `${entity} cannot move from ${from.toLowerCase().replace(/_/g, " ")} to ${to
          .toLowerCase()
          .replace(/_/g, " ")}.`,
    );
    this.name = "InvalidTransitionError";
  }
}

/** A record the caller named does not exist, or is no longer usable. */
export class NotFoundError extends DomainError {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
