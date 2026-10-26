// What the tools need to know about a game: where its maps are, and the
// parts of its content they show. A game passes this to each tool's main.

import type { FlagRecord } from '@fq2js/engine/player';
import type { Content } from '@fq2js/engine/game';
import type { WorldRecord } from '@fq2js/engine/shared';

export interface GameFiles {
    // The map folder, unless --maps says otherwise.
    maps: string;
    // The tiles that run scripts, by screen (marked on maps).
    triggers?: ReadonlyMap<number, ReadonlySet<string>>;
    // The names of the encounter tables (offered in the editor).
    encounterTables?: readonly string[];
}

// The trigger tiles of a game's content, by screen.
export function contentTriggers<F extends FlagRecord, W extends WorldRecord = WorldRecord>(content: Content<F, W>): Map<number, Set<string>> {
    const triggers = new Map<number, Set<string>>();
    for (const [screen, scripts] of Object.entries(content.screens)) {
        triggers.set(Number(screen), new Set(Object.keys(scripts?.at ?? {})));
    }
    return triggers;
}
