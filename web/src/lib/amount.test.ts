import { describe, expect, it } from 'vitest';
import { amountError } from './amount';

describe('amountError', () => {
  it('names the comma and shows exactly what to type — the reported paste', () => {
    // Pasted from a spreadsheet: Number("7,668.31") is NaN, and the ticket
    // used to go silently dead.
    expect(amountError('7,668.31')).toBe('Remove the commas — type 7668.31');
    expect(amountError('1,000')).toBe('Remove the commas — type 1000');
  });

  it('does not guess for an ambiguous comma', () => {
    // "7,5" is 7.5 in much of the world. Stripping would silently multiply the
    // order by 10, so it only ever suggests, never rewrites.
    expect(amountError('7,5')).toBe('Remove the commas — type 75');
  });

  it('accepts plain numbers, and stays quiet on an empty field', () => {
    for (const ok of ['7668.31', '1000', '0.5', '  25 ']) expect(amountError(ok)).toBeNull();
    expect(amountError('')).toBeNull();
    expect(amountError('   ')).toBeNull();
  });

  it('rejects junk and non-positive amounts', () => {
    expect(amountError('abc')).toBe('Not a number');
    expect(amountError('$100')).toBe('Not a number');
    expect(amountError('0')).toBe('Must be more than 0');
    expect(amountError('-5')).toBe('Must be more than 0');
  });

  it('reports bounds when given them', () => {
    expect(amountError('50', { min: 1000 })).toBe('Minimum is 1,000');
    expect(amountError('9000000', { max: 5_000_000 })).toBe('Maximum is 5,000,000');
    expect(amountError('2000', { min: 1000, max: 5_000_000 })).toBeNull();
  });
});
