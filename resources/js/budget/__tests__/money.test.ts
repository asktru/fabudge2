import { describe, expect, it } from 'vitest';

import { convertToBase, formatAmount, parseAmount } from '@/budget/money';
import type { RateRow } from '@/budget/types';

describe('formatAmount', () => {
    it('formats positive and negative minor units', () => {
        expect(formatAmount(13650, 'CAD')).toBe('136.50');
        expect(formatAmount(-13650, 'CAD')).toBe('-136.50');
        expect(formatAmount(5, 'UAH')).toBe('0.05');
        expect(formatAmount(0, 'USD')).toBe('0.00');
    });
});

describe('parseAmount', () => {
    it('parses plain decimals into minor units', () => {
        expect(parseAmount('136.50', 'CAD')).toBe(13650);
        expect(parseAmount('136.5', 'CAD')).toBe(13650);
        expect(parseAmount('136', 'CAD')).toBe(13600);
        expect(parseAmount('-42.07', 'CAD')).toBe(-4207);
        expect(parseAmount('0.05', 'UAH')).toBe(5);
    });

    it('handles decimal commas and thousands separators', () => {
        expect(parseAmount('136,50', 'UAH')).toBe(13650);
        expect(parseAmount('1 234.56', 'CAD')).toBe(123456);
        expect(parseAmount('1,234.56', 'CAD')).toBe(123456);
    });

    it('rejects invalid input', () => {
        expect(parseAmount('', 'CAD')).toBeNull();
        expect(parseAmount('abc', 'CAD')).toBeNull();
        expect(parseAmount('1.2.3', 'CAD')).toBeNull();
        expect(parseAmount('-', 'CAD')).toBeNull();
        expect(parseAmount('1.234', 'CAD')).toBeNull(); // too many decimal places
    });
});

describe('convertToBase', () => {
    const rates: RateRow[] = [
        { quote: 'USD', rate: 0.73, fetched_at: 1 },
        { quote: 'UAH', rate: 30.4, fetched_at: 1 },
    ];

    it('returns the amount unchanged for the base currency', () => {
        expect(convertToBase(10000, 'CAD', rates)).toBe(10000);
    });

    it('divides by the base→quote rate', () => {
        expect(convertToBase(7300, 'USD', rates)).toBe(10000);
        expect(convertToBase(30400, 'UAH', rates)).toBe(1000);
    });

    it('returns null when no rate is cached', () => {
        expect(convertToBase(100, 'EUR', rates)).toBeNull();
        expect(convertToBase(100, 'USD', [])).toBeNull();
    });
});
