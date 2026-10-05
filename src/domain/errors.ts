/**
 * A rule violation the user can fix. Messages are written in Azerbaijani for direct display;
 * `field` points the UI at the input that needs attention.
 */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly field?: string,
    readonly code: DomainErrorCode = 'invalid',
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
export type DomainErrorCode =
  | 'invalid'
  | 'not-found'
  | 'conflict'
  | 'stale'
  | 'closed-period'
  | 'forbidden'
  | 'insufficient-stock';

export function assert(condition: unknown, message: string, field?: string): asserts condition {
  if (!condition) throw new DomainError(message, field);
}
