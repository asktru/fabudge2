/**
 * Pure helpers behind drag-to-reorder. Keeping the arithmetic out of the
 * component means the fiddly parts (where a pointer lands, what a drop
 * changes) are unit tested rather than only reachable by dragging.
 */

/** Move an item to another index, returning a new array. Out-of-range indexes are no-ops. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
    if (from === to || from < 0 || from >= items.length || to < 0 || to >= items.length) {
        return items;
    }

    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);

    return next;
}

export interface RowBounds {
    top: number;
    bottom: number;
}

/**
 * The row index a pointer at `pointerY` is over, given the rows' current
 * on-screen bounds in list order. Pointers above the first row or below the
 * last clamp to the ends, so dragging past the edge parks the item there.
 *
 * Gaps between rows resolve to the nearer neighbour, which keeps a drag
 * across a divider from stalling.
 */
export function indexForPointer(pointerY: number, rows: RowBounds[]): number | null {
    if (rows.length === 0) {
        return null;
    }

    if (pointerY <= rows[0].top) {
        return 0;
    }

    if (pointerY >= rows[rows.length - 1].bottom) {
        return rows.length - 1;
    }

    let nearest = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const [index, row] of rows.entries()) {
        if (pointerY >= row.top && pointerY <= row.bottom) {
            return index;
        }

        const distance = pointerY < row.top ? row.top - pointerY : pointerY - row.bottom;

        if (distance < nearestDistance) {
            nearest = index;
            nearestDistance = distance;
        }
    }

    return nearest;
}
