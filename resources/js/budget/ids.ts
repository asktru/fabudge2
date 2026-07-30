import { v7 as uuidv7 } from 'uuid';

/** Time-sortable client-generated id for every synced row. */
export function newId(): string {
    return uuidv7();
}
