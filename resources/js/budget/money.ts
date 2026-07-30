import type { RateRow } from './types';

/** Minor-unit exponents; every currency we care about uses 2. */
const MINOR_UNIT_DIGITS: Record<string, number> = {};

export function minorUnitDigits(currency: string): number {
    return MINOR_UNIT_DIGITS[currency] ?? 2;
}

/** Format minor units for display, e.g. (-13650, 'CAD') → "-136.50". */
export function formatAmount(amountMinor: number, currency: string): string {
    const digits = minorUnitDigits(currency);
    const sign = amountMinor < 0 ? '-' : '';
    const abs = Math.abs(amountMinor);
    const major = Math.floor(abs / 10 ** digits);
    const minor = String(abs % 10 ** digits).padStart(digits, '0');

    return `${sign}${major}.${minor}`;
}

/** Format with currency symbol/code for UI, using Intl. */
export function formatMoney(amountMinor: number, currency: string): string {
    const digits = minorUnitDigits(currency);

    return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        currencyDisplay: 'narrowSymbol',
    }).format(amountMinor / 10 ** digits);
}

/**
 * Parse user input like "136.50", "-136,50", "1 234.56" into minor units.
 * Returns null for empty/invalid input or too many decimal places.
 */
export function parseAmount(input: string, currency: string): number | null {
    const digits = minorUnitDigits(currency);
    const stripped = input.trim().replace(/[\s']/g, '');
    // A comma is a thousands separator when a dot is also present ("1,234.56"),
    // otherwise it's a decimal comma ("136,50").
    const cleaned = stripped.includes('.') ? stripped.replace(/,/g, '') : stripped.replace(',', '.');

    if (cleaned === '' || !/^-?\d*(\.\d*)?$/.test(cleaned) || cleaned === '-' || cleaned === '.' || cleaned === '-.') {
        return null;
    }

    const [wholePart, fractionPart = ''] = cleaned.replace('-', '').split('.');

    if (fractionPart.length > digits) {
        return null;
    }

    const minor = Number(wholePart || '0') * 10 ** digits + Number(fractionPart.padEnd(digits, '0') || '0');

    return cleaned.startsWith('-') ? -minor : minor;
}

/**
 * Convert an amount to the base currency (CAD) using cached rates.
 * Rates are quoted as base→quote (1 CAD = rate × quote), so we divide.
 * Returns null when no rate is cached for the currency.
 */
export function convertToBase(amountMinor: number, currency: string, rates: RateRow[], base = 'CAD'): number | null {
    if (currency === base) {
        return amountMinor;
    }

    const rate = rates.find((row) => row.quote === currency)?.rate;

    if (!rate || rate <= 0) {
        return null;
    }

    return Math.round(amountMinor / rate);
}
