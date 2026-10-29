// Map generator: fills screens with generated terrain. A game runs `main`
// with its own GameFiles:
//
//   bun run generate [--screens 8-14] [--seed 42] [--preview out.html] [--dry-run] [--force]

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { GRID_HEIGHT, GRID_WIDTH, World, gridPosition } from '@fq2ts/engine/world';
import { generate, isBlank } from './generator/generate.ts';
import { renderHtml } from './html.ts';
import { parseScreenList } from './view.ts';
import { gameMapSize, type GameFiles } from './game.ts';

const USAGE = `Usage: generate [options]

Fills outdoor screens with generated land, water, forest, mountains and
trails, following each screen's kind. Make the screens first (in the editor,
N creates a blank screen of a chosen kind); with no --screens, every blank
outdoor screen is filled.

  -s, --screens LIST    the screens to fill, e.g. 8-14,88
      --seed N          the same seed makes the same terrain (default: random)
  -f, --force           also replace screens that aren't blank
  -p, --preview FILE    write an HTML page of the result and its neighbours
  -n, --dry-run         don't save
  -m, --maps DIR        the map folder (default: the game's)
  -h, --help            show this help`;

// The screens next to these (and these), for previews.
function withNeighbours(world: World, screens: readonly number[]): Set<number> {
    const out = new Set(screens);
    for (const n of screens) {
        const { col, row } = gridPosition(n);
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                const c = col + dc;
                const r = row + dr;
                const m = (r - 1) * GRID_WIDTH + c;
                if (c >= 1 && c <= GRID_WIDTH && r >= 1 && r <= GRID_HEIGHT && world.isOutdoors(m)) {
                    out.add(m);
                }
            }
        }
    }
    return out;
}

export function main(args: readonly string[], game: GameFiles, log: (line: string) => void = console.log, randomSeed: () => number = () => Math.floor(Math.random() * 1e6)): number {
    const { values } = parseArgs({
        args: [...args],
        options: {
            screens: { type: 'string', short: 's' },
            seed: { type: 'string' },
            force: { type: 'boolean', short: 'f', default: false },
            preview: { type: 'string', short: 'p' },
            'dry-run': { type: 'boolean', short: 'n', default: false },
            maps: { type: 'string', short: 'm', default: game.maps },
            help: { type: 'boolean', short: 'h', default: false },
        },
    });
    if (values.help) {
        log(USAGE);
        return 0;
    }
    if (values.seed !== undefined && !/^\d+$/.test(values.seed)) {
        throw new Error(`The seed must be a whole number, not "${values.seed}".`);
    }
    const seed = values.seed === undefined ? randomSeed() : Number(values.seed);
    const dir = resolve(values.maps);
    const world = World.load(dir, gameMapSize(game));

    let screens: number[];
    if (values.screens === undefined) {
        screens = world.screens().filter((n) => world.isOutdoors(n) && isBlank(world, n));
        if (!screens.length) {
            log('There are no blank outdoor screens to fill. Create some in the editor (N), or name screens with --screens.');
            return 1;
        }
    } else {
        screens = [...parseScreenList(values.screens)];
        const missing = screens.filter((n) => !world.has(n));
        if (missing.length) {
            throw new Error(`These screens don't exist yet: ${missing.join(', ')}. Create them in the editor first, so they have a kind.`);
        }
        const indoors = screens.filter((n) => !world.isOutdoors(n));
        if (indoors.length) {
            throw new Error(`These screens are interiors, which aren't generated: ${indoors.join(', ')}.`);
        }
        const made = screens.filter((n) => !isBlank(world, n));
        if (made.length && !values.force) {
            throw new Error(`These screens already have something on them: ${made.join(', ')}. Use --force to replace them.`);
        }
    }

    generate(world, screens, { seed });
    log(`Generated ${screens.length} screen${screens.length === 1 ? '' : 's'} (${screens.join(', ')}) with seed ${seed}.`);

    if (values.preview !== undefined) {
        const out = resolve(values.preview);
        writeFileSync(out, renderHtml(world, { title: `Generated, seed ${seed}`, screens: withNeighbours(world, screens), ...(game.triggers ? { triggers: game.triggers } : {}) }));
        log(`Wrote a preview to ${out}`);
    }
    if (values['dry-run']) {
        log('Dry run: nothing saved.');
    } else {
        const { written } = world.save(dir);
        log(`Saved ${written.length} file${written.length === 1 ? '' : 's'} to ${dir}`);
    }
    return 0;
}
