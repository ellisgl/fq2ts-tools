// What the tools need to know about a game: where its maps are, and the
// parts of its content they show. A game passes this to each tool's main.

import type { FlagRecord } from '@fq2ts/engine/player';
import type { Content } from '@fq2ts/engine/game';
import type { WorldRecord } from '@fq2ts/engine/shared';

export interface GameFiles {
    // The map folder, unless --maps says otherwise.
    maps: string;
    // The tiles that run scripts, by screen (marked on maps).
    triggers?: ReadonlyMap<number, TriggerTiles>;
    // The names of the encounter tables (offered in the editor).
    encounterTables?: readonly string[];
}

// One screen's trigger tiles ("x,y"): just which they are, or, as a map,
// what each one does too (shown in the editor; "" when there's nothing to say).
export type TriggerTiles = ReadonlySet<string> | ReadonlyMap<string, string>;

// What the trigger on tile `xy` does, if the game said.
export function triggerAbout(tiles: TriggerTiles, xy: string): string | undefined {
    return 'get' in tiles ? tiles.get(xy) || undefined : undefined;
}

// The trigger tiles of a game's content, by screen, with what each does.
export function contentTriggers<F extends FlagRecord, W extends WorldRecord = WorldRecord>(content: Content<F, W>): Map<number, Map<string, string>> {
    const triggers = new Map<number, Map<string, string>>();
    for (const [screen, scripts] of Object.entries(content.screens)) {
        triggers.set(Number(screen), new Map(Object.entries(scripts?.at ?? {}).map(([xy, script]) => [xy, describeScript(script)])));
    }
    return triggers;
}

// What a script does, for the editor: its `about`, if the game gave it one
// (e.g. Object.assign(script, { about: 'door to 725 at 31,15' })), else its
// function's name ("runs bank"), unless that's only its tile.
export function describeScript(script: unknown): string {
    if (typeof script !== 'function') {
        return '';
    }
    if ('about' in script && typeof script.about === 'string') {
        return script.about;
    }
    return script.name === '' || /^\d+,\d+$/.test(script.name) ? '' : `runs ${script.name}`;
}
