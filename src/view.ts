// Map viewer: writes the world as an HTML page to look at in a browser.
// A game runs `main` with its own GameFiles:
//
//   bun run view [--out world.html] [--screens 1-7,82,721-726] [--maps DIR] [--no-triggers]

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { GRID_HEIGHT, GRID_WIDTH, World } from '@fq2ts/engine/world';
import { renderHtml } from './html.ts';
import type { GameFiles } from './game.ts';

const USAGE = `Usage: view [options]

  -o, --out FILE        where to write the page (default: world.html)
  -s, --screens LIST    only these screens, e.g. 1-7,82,721-726
  -m, --maps DIR        the map folder (default: the game's)
      --no-triggers     don't mark trigger tiles
  -h, --help            show this help`;

// "1-3,7" → {1, 2, 3, 7}
export function parseScreenList(list: string): Set<number> {
    const screens = new Set<number>();
    for (const part of list.split(',')) {
        const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
        if (!match) {
            throw new Error(`Not a screen or range: "${part}"`);
        }
        const from = Number(match[1]);
        const to = match[2] === undefined ? from : Number(match[2]);
        if (to < from) {
            throw new Error(`Backwards range: "${part}"`);
        }

        if (from < 1 || to > GRID_WIDTH * GRID_HEIGHT) {
            throw new Error(`Screens are numbered 1 to ${GRID_WIDTH * GRID_HEIGHT}: "${part}"`);
        }

        for (let n = from; n <= to; n++) {
            screens.add(n);
        }
    }
    return screens;
}

export function main(args: readonly string[], game: GameFiles, log: (line: string) => void = console.log): number {
    const { values } = parseArgs({
        args: [...args],
        options: {
            out: { type: 'string', short: 'o', default: 'world.html' },
            screens: { type: 'string', short: 's' },
            maps: { type: 'string', short: 'm', default: game.maps },
            'no-triggers': { type: 'boolean', default: false },
            help: { type: 'boolean', short: 'h', default: false },
        },
    });
    if (values.help) {
        log(USAGE);
        return 0;
    }
    const world = World.load(values.maps);
    const html = renderHtml(world, {
        ...(values.screens === undefined ? {} : { screens: parseScreenList(values.screens) }),
        ...(values['no-triggers'] || !game.triggers ? {} : { triggers: game.triggers }),
    });
    const out = resolve(values.out);
    writeFileSync(out, html);
    log(`Wrote ${out}`);
    return 0;
}
