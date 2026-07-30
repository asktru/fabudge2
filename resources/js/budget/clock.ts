/** Wire clock for LWW: unix milliseconds. Wrapped so tests can stay deterministic via vi.spyOn(Date, 'now'). */
export function nowMs(): number {
    return Date.now();
}

/** Today's date as YYYY-MM-DD in the local timezone. */
export function today(): string {
    const date = new Date();
    const pad = (part: number) => String(part).padStart(2, '0');

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
