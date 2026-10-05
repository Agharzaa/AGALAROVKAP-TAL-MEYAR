/**
 * Weighted-average costing per company + account + warehouse + product. An issue takes
 * value × issued / on-hand, rounded once to the qəpik; issuing everything takes the whole
 * remaining value so no rounding residue is ever left behind. Negative stock is refused.
 */
import { DomainError } from './errors.js';
import { roundHalfAwayFromZero, type Minor } from './money.js';
import { formatQty, type Qty } from './quantity.js';

export interface StockBalance {
  quantity: Qty;
  value: Minor;
}

export function issueCost(balance: StockBalance, quantity: Qty, label: string): Minor {
  if (quantity <= 0n) throw new DomainError('Silinən miqdar müsbət olmalıdır.');
  if (balance.quantity < quantity)
    throw new DomainError(
      `${label}: anbarda kifayət qədər qalıq yoxdur (qalıq ${formatQty(balance.quantity)}, tələb ${formatQty(quantity)}).`,
      undefined,
      'insufficient-stock',
    );
  if (balance.quantity === quantity) return balance.value;
  return roundHalfAwayFromZero(balance.value * quantity, balance.quantity);
}
