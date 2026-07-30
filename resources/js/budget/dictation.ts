export interface DictationContext {
    accounts: string[];
    categories: string[];
    payees: string[];
    /** YYYY-MM-DD */
    today: string;
}

export interface ParsedDictation {
    type: 'expense' | 'income';
    /** Absolute minor units. */
    amountMinor: number;
    payee: string | null;
    account: string | null;
    category: string | null;
    date: string | null;
    memo: string | null;
}

const INCOME_WORDS = ['received', 'refund', 'salary', 'income', 'got paid', 'paid me', 'earned', 'deposit'];

/** Case-insensitive containment match against known names (longest match wins). */
function matchName(transcript: string, names: string[]): string | null {
    const haystack = transcript.toLowerCase();
    let best: string | null = null;

    for (const name of names) {
        if (name.length >= 3 && haystack.includes(name.toLowerCase())) {
            if (!best || name.length > best.length) {
                best = name;
            }
        }
    }

    return best;
}

function resolveDate(transcript: string, today: string): string | null {
    const haystack = transcript.toLowerCase();

    if (haystack.includes('yesterday')) {
        const date = new Date(`${today}T12:00:00`);
        date.setDate(date.getDate() - 1);
        const pad = (part: number) => String(part).padStart(2, '0');

        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    return null;
}

/**
 * Heuristic fallback parser — used when the server-side LLM parser is
 * unavailable. Finds the first number as the amount, income keywords for the
 * type, and containment matches for payee/account/category.
 */
export function localParseDictation(transcript: string, context: DictationContext): ParsedDictation | null {
    const amountMatch = transcript.replace(/,/g, '.').match(/(\d+(?:\.\d{1,2})?)/);

    if (!amountMatch) {
        return null;
    }

    const amountMinor = Math.round(parseFloat(amountMatch[1]) * 100);

    if (!amountMinor) {
        return null;
    }

    const haystack = transcript.toLowerCase();
    const isIncome = INCOME_WORDS.some((word) => haystack.includes(word));

    return {
        type: isIncome ? 'income' : 'expense',
        amountMinor,
        payee: matchName(transcript, context.payees),
        account: matchName(transcript, context.accounts),
        category: matchName(transcript, context.categories),
        date: resolveDate(transcript, context.today),
        memo: null,
    };
}

/**
 * Server-first parse with local fallback. `parseUrl` is the Wayfinder URL of
 * the dictation endpoint.
 */
export async function parseDictation(
    transcript: string,
    context: DictationContext,
    parseUrl: string,
    fetchFn: typeof fetch = (...args) => fetch(...args),
): Promise<ParsedDictation | null> {
    try {
        const xsrf = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
        const response = await fetchFn(parseUrl, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'X-XSRF-TOKEN': xsrf ? decodeURIComponent(xsrf[1]) : '',
                'X-Requested-With': 'XMLHttpRequest',
            },
            body: JSON.stringify({ transcript, context }),
        });

        if (response.ok) {
            const parsed = (await response.json()) as ParsedDictation;

            if (parsed.amountMinor > 0) {
                return parsed;
            }
        }
    } catch {
        // Offline or server error — fall through to the local parser.
    }

    return localParseDictation(transcript, context);
}
