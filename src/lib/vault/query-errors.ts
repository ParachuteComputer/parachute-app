export const DATE_VIEW_REFETCH_INTERVAL_MS = 60_000;

export class DateViewOverflowError extends Error {
  constructor(limit: number) {
    super(
      `This date window reached its ${limit.toLocaleString()}-note safety ceiling. Retry after narrowing the window or filters.`,
    );
    this.name = "DateViewOverflowError";
  }
}

export function isDateViewOverflowError(error: unknown): boolean {
  return error instanceof DateViewOverflowError;
}

export function dateViewRefetchInterval(error: unknown): number | false {
  return isDateViewOverflowError(error) ? false : DATE_VIEW_REFETCH_INTERVAL_MS;
}
