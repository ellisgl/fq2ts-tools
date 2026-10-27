// Maps in Icy Draw: each screen as an .icy file with a layer for each part
// of it, to draw there and bring back. A game runs `main` with its own
// GameFiles:
//
//   bun run art export [SCREENS] [--dir DIR] [--maps DIR]
//   bun run art import [SCREENS] [--dir DIR] [--maps DIR]
//
// A screen's file has these layers, bottom first:
//
//   Tiles     the screen as it looks (with any layers you add, drawn
//             together as Icy Draw shows them)
//   Terrain   each cell's terrain, as its letter in the map files: . grass,
//             f forest, m mountain, w water, r road, _ floor, # structure
//             (a cell left empty gets the terrain its look suggests)
//   Solid     anything drawn here is solid
//   Triggers  the screen's trigger characters (see GameMap's `triggers`)
//
// All but Tiles start hidden. A file without one of them leaves that part
// of the map as it was. The screen's name, kind and encounters stay in its
// map file.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { flatten, readIcy, writeIcy, type Icy, type IcyCell, type IcyLayer } from '@fq2ts/engine/icy';
import { MAP_HEIGHT, MAP_WIDTH, TERRAINS, TERRAIN_CODES, World, inferTerrain, isTriggerCode, type GameMap, type Terrain } from '@fq2ts/engine/world';
import { at } from '@fq2ts/engine/assert';
import { parseScreenList } from './view.ts';
import type { GameFiles } from './game.ts';

const USAGE = `Usage: art export|import [SCREENS] [options]

  export            write each screen as an .icy file, to draw in Icy Draw
  import            read the .icy files back into the maps
  SCREENS           e.g. 1-7,82,721-726 (default: every screen, or every
                    .icy file there is)
  -d, --dir DIR     where the .icy files are (default: art/maps next to the
                    map folder)
  -m, --maps DIR    the map folder (default: the game's)
  -h, --help        show this help

Each file has a Tiles layer, then hidden Terrain, Solid and Triggers
layers; see the top of art.ts.`;

const SPECIAL = ['Terrain', 'Solid', 'Triggers'];

// How each terrain shows on the Terrain layer: [foreground, background].
const TERRAIN_COLORS: Readonly<Record<Terrain, readonly [number, number]>> = {
    grass: [10, 2],
    forest: [2, 0],
    mountain: [7, 8],
    water: [11, 1],
    road: [14, 6],
    floor: [7, 0],
    structure: [15, 8],
};
const SOLID: IcyCell = { ch: '█', fg: 12, bg: 0, blink: false };

export const icyFileName = (screen: number): string => `${String(screen).padStart(4, '0')}.icy`;

const layer = (title: string, cell: (x: number, y: number) => IcyCell | null, visible = false): IcyLayer => ({
    title,
    x: 1,
    y: 1,
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    visible,
    alpha: title !== 'Tiles',
    mode: 'normal',
    cells: Array.from({ length: MAP_WIDTH * MAP_HEIGHT }, (_, n) => cell((n % MAP_WIDTH) + 1, Math.floor(n / MAP_WIDTH) + 1)),
});

// A screen as layers.
export function exportMap(map: GameMap): Icy {
    const get = <T>(grid: T[][], x: number, y: number): T => at(at(grid, y - 1), x - 1);
    return {
        width: MAP_WIDTH,
        height: MAP_HEIGHT,
        background: null,
        layers: [
            layer('Tiles', (x, y) => ({ ch: get(map.tiles, x, y), fg: get(map.fg, x, y), bg: get(map.bg, x, y), blink: false }), true),
            layer('Terrain', (x, y) => {
                const terrain = get(map.terrain, x, y);
                const [fg, bg] = TERRAIN_COLORS[terrain];
                return { ch: TERRAIN_CODES[terrain], fg, bg, blink: false };
            }),
            layer('Solid', (x, y) => (get(map.solid, x, y) ? SOLID : null)),
            layer('Triggers', (x, y) => {
                const ch = map.triggers ? get(map.triggers, x, y) : null;
                return ch === null ? null : { ch, fg: 14, bg: 0, blink: false };
            }),
        ],
        tags: [],
    };
}

// The map with what the layers say: its look, and, where the file has
// those layers, its terrain, solid cells and triggers.
export function importMap(icy: Icy, map: GameMap): GameMap {
    if (icy.width !== MAP_WIDTH || icy.height !== MAP_HEIGHT) {
        throw new Error(`it's ${icy.width}x${icy.height}, not ${MAP_WIDTH}x${MAP_HEIGHT}`);
    }
    const named = (title: string): IcyLayer | undefined => icy.layers.find((l) => l.title === title);
    // A layer's cell at (x, y) on the screen, wherever the layer sits.
    const cell = (l: IcyLayer, x: number, y: number): IcyCell | null => {
        const lx = x - l.x;
        const ly = y - l.y;
        return lx < 0 || ly < 0 || lx >= l.width || ly >= l.height ? null : (l.cells[ly * l.width + lx] ?? null);
    };
    const marked = (c: IcyCell | null): c is IcyCell => c !== null && !(c.ch === ' ' && c.bg === null);
    const grid = <T>(value: (x: number, y: number) => T): T[][] =>
        Array.from({ length: MAP_HEIGHT }, (_, y) => Array.from({ length: MAP_WIDTH }, (_, x) => value(x + 1, y + 1)));

    const picture = flatten({ ...icy, layers: icy.layers.filter((l) => !SPECIAL.includes(l.title)) });
    const look = grid((x, y) => {
        const c = picture.cells[(y - 1) * MAP_WIDTH + x - 1];
        if (!c || c.bg === null) {
            throw new Error(`the cell at ${x},${y} is empty: every cell needs a character and colours`);
        }
        if (c.blink) {
            throw new Error(`the cell at ${x},${y} blinks, which a map can't`);
        }
        return { ch: c.ch, fg: c.fg, bg: c.bg };
    });

    const solidLayer = named('Solid');
    const solid = solidLayer ? grid((x, y) => marked(cell(solidLayer, x, y))) : map.solid;

    const terrainLayer = named('Terrain');
    const terrain = terrainLayer
        ? grid((x, y): Terrain => {
            const c = cell(terrainLayer, x, y);
            if (!marked(c)) {
                return inferTerrain({ ...at(at(look, y - 1), x - 1), solid: at(at(solid, y - 1), x - 1) }, map.kind);
            }
            const found = TERRAINS.find((t) => TERRAIN_CODES[t] === c.ch);
            if (!found) {
                throw new Error(`the Terrain layer has "${c.ch}" at ${x},${y}: use ${Object.values(TERRAIN_CODES).join(' ')}`);
            }
            return found;
        })
        : map.terrain;

    const triggerLayer = named('Triggers');
    const triggers = triggerLayer
        ? grid((x, y) => {
            const c = cell(triggerLayer, x, y);
            if (!marked(c) || c.ch === ' ') {
                return null;
            }
            if (!isTriggerCode(c.ch)) {
                throw new Error(`the Triggers layer has "${c.ch}" at ${x},${y}: triggers are one character you can type, other than "."`);
            }
            return c.ch;
        })
        : map.triggers;

    const out: GameMap = {
        ...map,
        tiles: look.map((row) => row.map((c) => c.ch)),
        fg: look.map((row) => row.map((c) => c.fg)),
        bg: look.map((row) => row.map((c) => c.bg)),
        solid,
        terrain,
    };
    delete out.triggers;
    return triggers?.some((row) => row.some((t) => t !== null)) ? { ...out, triggers } : out;
}

export function main(args: readonly string[], game: GameFiles, log: (line: string) => void = console.log): number {
    const { values, positionals } = parseArgs({
        args: [...args],
        allowPositionals: true,
        options: {
            dir: { type: 'string', short: 'd' },
            maps: { type: 'string', short: 'm', default: game.maps },
            help: { type: 'boolean', short: 'h', default: false },
        },
    });
    const [command, list, ...extra] = positionals;
    if (values.help || (command !== 'export' && command !== 'import') || extra.length) {
        log(USAGE);
        return values.help ? 0 : 1;
    }
    const maps = resolve(values.maps);
    const dir = resolve(values.dir ?? join(maps, '..', 'art', 'maps'));
    const world = World.load(maps);
    const wanted = list === undefined ? null : parseScreenList(list);

    if (command === 'export') {
        mkdirSync(dir, { recursive: true });
        const screens = world.screens().filter((n) => !wanted || wanted.has(n));
        for (const n of wanted ?? []) {
            if (!world.has(n)) {
                throw new Error(`There's no screen ${n}.`);
            }
        }
        for (const n of screens) {
            writeFileSync(join(dir, icyFileName(n)), writeIcy(exportMap(world.export(n))));
        }
        log(`Wrote ${screens.length} screen${screens.length === 1 ? '' : 's'} to ${dir}`);
        return 0;
    }

    const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^\d{4}\.icy$/.test(f)) : [];
    const screens = files.map((f) => Number(f.slice(0, 4))).filter((n) => !wanted || wanted.has(n));
    for (const n of wanted ?? []) {
        if (!screens.includes(n)) {
            throw new Error(`There's no ${icyFileName(n)} in ${dir}.`);
        }
    }
    for (const n of screens) {
        if (!world.has(n)) {
            throw new Error(`${icyFileName(n)}: there's no screen ${n} (make it in the editor first)`);
        }
        try {
            world.put(importMap(readIcy(readFileSync(join(dir, icyFileName(n)))), world.export(n)));
        } catch (err) {
            throw new Error(`${icyFileName(n)}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    const { written } = world.save(maps);
    log(written.length ? `Updated ${written.join(', ')}` : 'No maps changed.');
    return 0;
}
