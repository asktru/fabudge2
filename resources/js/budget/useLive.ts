import { liveQuery } from 'dexie';
import { onScopeDispose, ref  } from 'vue';
import type {Ref} from 'vue';

/**
 * Bridge a Dexie liveQuery to a Vue ref: re-runs whenever the queried tables
 * change (local writes and incoming sync alike).
 */
export function useLive<T>(querier: () => T | Promise<T>, initial: T): Ref<T> {
    const value = ref(initial) as Ref<T>;

    const subscription = liveQuery(querier).subscribe({
        next: (result) => {
            value.value = result;
        },
    });

    onScopeDispose(() => subscription.unsubscribe());

    return value;
}
