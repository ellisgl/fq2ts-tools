// Level editor for a game's maps, in the terminal (80x25 or bigger). A game
// runs `main` with its own GameFiles:
//
//   bun run edit [--maps DIR]

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Terminal } from '@fq2js/engine/terminal';
import { World } from '@fq2js/engine/world';
import { Editor } from './editor/editor.ts';
import type { GameFiles } from './game.ts';

const USAGE = `Usage: edit [options]

  -m, --maps DIR   the map folder to edit (default: the game's)
  -h, --help       show this help

Press ? in the editor for its keys.`;

export async function main(args: readonly string[], game: GameFiles, term: Terminal = new Terminal(), log: (line: string) => void = console.log): Promise<number> {
    const { values } = parseArgs({
        args: [...args],
        options: {
            maps: { type: 'string', short: 'm', default: game.maps },
            help: { type: 'boolean', short: 'h', default: false },
        },
    });
    if (values.help) {
        log(USAGE);
        return 0;
    }
    const dir = resolve(values.maps);
    const world = World.load(dir);
    const saved: string[] = [];
    const editor = new Editor({
        term,
        world,
        triggers: game.triggers ?? new Map(),
        encounterTables: game.encounterTables ?? [],
        save: (w) => {
            const result = w.save(dir);
            saved.push(...result.written, ...result.deleted);
            return result;
        },
    });
    term.start({ mouse: true });
    try {
        await editor.run();
    } finally {
        term.stop();
    }
    log(saved.length ? `Saved changes to ${dir}` : 'No changes saved.');
    return 0;
}
