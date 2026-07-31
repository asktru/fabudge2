import { describe, expect, it } from 'vitest';

import { indexForPointer, moveItem } from '@/budget/reorder';

describe('moveItem', () => {
    it('moves an item down', () => {
        expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    });

    it('moves an item up', () => {
        expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    });

    it('leaves the list untouched for no-op and out-of-range moves', () => {
        const items = ['a', 'b', 'c'];

        expect(moveItem(items, 1, 1)).toBe(items);
        expect(moveItem(items, -1, 0)).toBe(items);
        expect(moveItem(items, 0, 3)).toBe(items);
    });
});

describe('indexForPointer', () => {
    const rows = [
        { top: 0, bottom: 10 },
        { top: 10, bottom: 20 },
        { top: 20, bottom: 30 },
    ];

    it('returns the row the pointer is inside', () => {
        expect(indexForPointer(5, rows)).toBe(0);
        expect(indexForPointer(15, rows)).toBe(1);
        expect(indexForPointer(25, rows)).toBe(2);
    });

    it('clamps past either end of the list', () => {
        expect(indexForPointer(-40, rows)).toBe(0);
        expect(indexForPointer(400, rows)).toBe(2);
    });

    it('resolves a gap between rows to the nearer neighbour', () => {
        const spaced = [
            { top: 0, bottom: 10 },
            { top: 30, bottom: 40 },
        ];

        expect(indexForPointer(14, spaced)).toBe(0);
        expect(indexForPointer(26, spaced)).toBe(1);
    });

    it('returns null for an empty list', () => {
        expect(indexForPointer(5, [])).toBeNull();
    });
});
