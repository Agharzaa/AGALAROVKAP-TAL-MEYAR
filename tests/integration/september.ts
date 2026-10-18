import type { fixture } from './fixture.js';

/**
 * The September example agreed with the user (docs/QERARLAR.md), entered as manual operations:
 * opening capital in two banks and the VAT deposit, a purchase with VAT, its payment from the
 * bank and the deposit, a 15 000 sale, an 18 000 payment split between 223.01/224.04 and between
 * the invoice and an advance (543.01), a bank fee and the cost of goods sold.
 */
export function september(f: ReturnType<typeof fixture>) {
  const kapital = f.partner('Kapital Bank ASC', '9900003611');
  const pasha = f.partner('PAŞA Bank ASC', '1700767721');
  const founder = f.partner('Ağarza Ağalarov', '', 'individual');
  const supplier = f.partner('Təchizat ASC', '1700000002');
  const customer = f.partner('Alıcı MMC', '1700000001');
  const bankK = f.bankAccount(
    kapital,
    'AZ12AIIB38060019441234567890',
    '223.01',
    'AZN',
    'Kapital Bank AZN',
  );
  const bankP = f.bankAccount(
    pasha,
    'AZ55PAHA40060AZNHC0101091203',
    '223.01',
    'AZN',
    'PAŞA Bank AZN',
  );
  const deposit = f.bankAccount(
    kapital,
    'AZ77AIIB38060019449999999999',
    '224.04',
    'AZN',
    'ƏDV depozit',
  );
  const c12 = f.contract(supplier, '12', 'purchase');
  const c7 = f.contract(customer, '7', 'sale');
  const paper = f.product('Kağız A4', 'qutu');
  const goods = f.item('incomeType', 'Məhsul satışı');
  const fees = f.item('expenseItem', 'Bank xidmətləri');
  const tax = f.item('paymentKind', 'Vergi (haqq)');
  const capitalIn = f.item('capitalChange', 'Nizamnamə kapitalına qoyuluş');
  const mainGroup = f.item('productGroup', 'Əsas nomenklatura qrupu');
  const cogs = f.item('expenseItem', 'Satılmış malların maya dəyəri');
  const L = f.line;
  f.operation(
    '2026-08-31',
    [
      L('223.01', [bankK], '301', [founder, capitalIn], '30000'),
      L('223.01', [bankP], '301', [founder, capitalIn], '10000'),
      L('224.04', [deposit], '301', [founder, capitalIn], '3000'),
    ],
    'Başlanğıc qalıqlar',
  );
  const purchase = f.operation(
    '2026-09-05',
    [
      L('205', [paper], '531.01', [supplier, c12, ''], '10000', { quantity: '100' }),
      L('241', [supplier, '', '18'], '531.01', [supplier, c12, ''], '1800'),
    ],
    'Alış AA-001',
  );
  const purchaseDoc = `operation:${purchase.id}`;
  f.operation(
    '2026-09-18',
    [
      L('531.01', [supplier, c12, purchaseDoc], '223.01', [bankK], '10000'),
      L('531.01', [supplier, c12, purchaseDoc], '224.04', [deposit], '1800'),
    ],
    'Malsatana ödəniş',
  );
  const sale = f.operation(
    '2026-09-08',
    [
      L('211.01', [customer, c7, ''], '601', [goods, '18'], '15000'),
      L('604.1', ['18'], '521.01', [tax], '2288.14'),
    ],
    'Satış SF-0001',
  );
  const saleDoc = `operation:${sale.id}`;
  const receipt = f.operation(
    '2026-09-15',
    [
      L('223.01', [bankK], '211.01', [customer, c7, saleDoc], '12711.86'),
      L('223.01', [bankK], '543.01', [customer, c7, ''], '2542.38'),
      L('224.04', [deposit], '211.01', [customer, c7, saleDoc], '2288.14'),
      L('224.04', [deposit], '543.01', [customer, c7, ''], '457.62'),
    ],
    'Alıcıdan 18 000',
  );
  const receiptDoc = `operation:${receipt.id}`;
  f.operation('2026-09-30', [L('721', [fees], '223.01', [bankK], '3')], 'Bank xidmət haqqı');
  f.operation(
    '2026-09-30',
    [L('701', [mainGroup, cogs], '205', [paper], '7000', { quantity: '70' })],
    'Maya dəyəri',
  );
  return {
    kapital,
    founder,
    supplier,
    customer,
    bankK,
    bankP,
    deposit,
    c12,
    c7,
    paper,
    goods,
    fees,
    tax,
    capitalIn,
    purchase,
    sale,
    saleDoc,
    receiptDoc,
  };
}
