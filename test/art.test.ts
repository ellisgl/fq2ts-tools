import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readIcy, writeIcy, type Icy, type IcyCell, type IcyLayer } from '@fq2ts/engine/icy';
import { MAP_HEIGHT, MAP_WIDTH, World, writeMap, type GameMap } from '@fq2ts/engine/world';
import { makeMap, makeWorld, tempDir } from '@fq2ts/engine/testing';
import { at } from '@fq2ts/engine/assert';
import { exportMap, importMap, icyFileName, main } from '../src/art.ts';

// A screen with a bit of everything: colours past the 16, solid cells,
// several terrains and some triggers.
function busyMap(): GameMap {
    const map = makeMap(82, 5, ['1,1', '40,11', '79,22']);
    at(map.tiles, 0)[0] = '█';
    at(map.fg, 0)[0] = 208;
    at(map.bg, 5)[5] = 17;
    at(map.terrain, 1)[1] = 'water';
    at(map.terrain, 2)[2] = 'road';
    at(map.terrain, 3)[3] = 'structure';
    map.triggers = Array.from({ length: MAP_HEIGHT }, (_, y) => Array.from({ length: MAP_WIDTH }, (_, x) => (y === 4 && x < 3 ? 'D' : x === 10 && y === 10 ? '!' : null)));
    return map;
}

const throughFile = (icy: Icy): Icy => readIcy(writeIcy(icy));
const layerOf = (icy: Icy, title: string): IcyLayer => {
    const found = icy.layers.find((l) => l.title === title);
    if (!found) {
        throw new Error(`no ${title} layer`);
    }
    return found;
};
const setCell = (l: IcyLayer, x: number, y: number, c: IcyCell | null): void => {
    l.cells[(y - 1) * l.width + x - 1] = c;
};

describe('exportMap and importMap', () => {
    test('a screen comes back as it went out', () => {
        const map = busyMap();
        expect(importMap(throughFile(exportMap(map)), map)).toEqual(map);
        const plain = makeMap(3, 2);
        expect(importMap(throughFile(exportMap(plain)), plain)).toEqual(plain);
    });

    test('a Tiles layer, then hidden Terrain, Solid and Triggers layers', () => {
        const icy = exportMap(busyMap());
        expect(icy.layers.map((l) => [l.title, l.visible])).toEqual([['Tiles', true], ['Terrain', false], ['Solid', false], ['Triggers', false]]);
        expect(layerOf(icy, 'Terrain').cells[MAP_WIDTH + 1]).toMatchObject({ ch: 'w' });
        expect(layerOf(icy, 'Solid').cells[0]).toMatchObject({ ch: '█' });
        expect(layerOf(icy, 'Solid').cells[1]).toBeNull();
        expect(layerOf(icy, 'Triggers').cells[4 * MAP_WIDTH]).toMatchObject({ ch: 'D' });
    });

    test('layers drawn over Tiles are part of the look; hidden ones are not', () => {
        const map = makeMap(1);
        const icy = exportMap(map);
        const drawn = (title: string, visible: boolean, ch: string): IcyLayer => {
            const l: IcyLayer = { ...layerOf(icy, 'Tiles'), title, visible, alpha: true, cells: Array.from({ length: MAP_WIDTH * MAP_HEIGHT }, () => null) };
            setCell(l, 5, 5, { ch, fg: 4, bg: null, blink: false });
            return l;
        };
        icy.layers.push(drawn('Trees', true, '♣'), drawn('Draft', false, '?'));
        const back = importMap(throughFile(icy), map);
        expect([back.tiles[4]?.[4], back.fg[4]?.[4], back.bg[4]?.[4]]).toEqual(['♣', 4, 2]);
    });

    test('anything on Solid is solid, and an empty Terrain cell gets the terrain its look suggests', () => {
        const map = makeMap(1);
        const icy = exportMap(map);
        setCell(layerOf(icy, 'Solid'), 2, 2, { ch: 'x', fg: 1, bg: null, blink: false });
        setCell(layerOf(icy, 'Terrain'), 3, 3, null);
        setCell(layerOf(icy, 'Tiles'), 3, 3, { ch: '~', fg: 9, bg: 1, blink: false });
        const back = importMap(throughFile(icy), map);
        expect(back.solid[1]?.[1]).toBe(true);
        expect(back.terrain[2]?.[2]).toBe('water');
    });

    test('with no triggers left, the map has none; with no special layers, it keeps its own', () => {
        const map = busyMap();
        const icy = exportMap(map);
        layerOf(icy, 'Triggers').cells.fill(null);
        expect(importMap(throughFile(icy), map)).not.toHaveProperty('triggers');
        const onlyTiles = { ...icy, layers: [layerOf(icy, 'Tiles')] };
        expect(importMap(throughFile(onlyTiles), map)).toEqual(map);
    });

    test('refuses what a map cannot hold', () => {
        const map = makeMap(1);
        const changed = (change: (icy: Icy) => void): Icy => {
            const icy = exportMap(map);
            change(icy);
            return throughFile(icy);
        };
        expect(() => importMap(changed((icy) => {
            icy.width = 80;
        }), map)).toThrow("it's 80x22, not 79x22");
        expect(() => importMap(changed((icy) => {
            // (Only a layer with an alpha channel leaves a cell empty.)
            layerOf(icy, 'Tiles').alpha = true;
            setCell(layerOf(icy, 'Tiles'), 4, 5, null);
        }), map)).toThrow('the cell at 4,5 is empty');
        expect(() => importMap(changed((icy) => setCell(layerOf(icy, 'Tiles'), 4, 5, { ch: 'x', fg: 1, bg: 0, blink: true })), map)).toThrow('the cell at 4,5 blinks');
        expect(() => importMap(changed((icy) => setCell(layerOf(icy, 'Terrain'), 4, 5, { ch: 'q', fg: 1, bg: 0, blink: false })), map)).toThrow('the Terrain layer has "q" at 4,5');
        expect(() => importMap(changed((icy) => setCell(layerOf(icy, 'Triggers'), 4, 5, { ch: '.', fg: 1, bg: 0, blink: false })), map)).toThrow('the Triggers layer has "." at 4,5');
    });
});

describe('bun run art', () => {
    function setup(): { maps: string; dir: string; log: string[]; run(...args: string[]): number } {
        const maps = tempDir();
        makeWorld(busyMap(), makeMap(1)).save(maps);
        const dir = join(maps, '..', 'art', 'maps');
        const log: string[] = [];
        return { maps, dir, log, run: (...args) => main(args, { maps }, (line) => log.push(line)) };
    }

    test('export writes each screen; import with no changes changes nothing', () => {
        const { dir, log, run } = setup();
        expect(run('export')).toBe(0);
        expect(existsSync(join(dir, '0001.icy'))).toBe(true);
        expect(existsSync(join(dir, '0082.icy'))).toBe(true);
        expect(run('import')).toBe(0);
        expect(log).toEqual([`Wrote 2 screens to ${dir}`, 'No maps changed.']);
    });

    test('import brings back what was drawn, for the screens asked for', () => {
        const { maps, dir, log, run } = setup();
        run('export', '1,82');
        const icy = readIcy(readFileSync(join(dir, icyFileName(1))));
        setCell(layerOf(icy, 'Tiles'), 1, 1, { ch: 'Z', fg: 14, bg: 4, blink: false });
        writeFileSync(join(dir, icyFileName(1)), writeIcy(icy));
        run('import', '1');
        expect(log.at(-1)).toBe('Updated 0001.json');
        expect(World.load(maps).tile(1, 1, 1)).toEqual({ ch: 'Z', fg: 14, bg: 4 });
        expect(readFileSync(join(maps, '0082.json'), 'utf8')).toBe(writeMap(busyMap()));
    });

    test('errors name the file, and screens that are not there', () => {
        const { dir, run } = setup();
        run('export');
        writeFileSync(join(dir, '0001.icy'), 'not a picture');
        expect(() => run('import')).toThrow('0001.icy: not an .icy file');
        expect(() => run('export', '5')).toThrow("There's no screen 5.");
        expect(() => run('import', '5')).toThrow("There's no 0005.icy in");
    });

    test('help, and a missing command', () => {
        const { log, run } = setup();
        expect(run('-h')).toBe(0);
        expect(run()).toBe(1);
        expect(run('paint')).toBe(1);
        expect(log[0]).toContain('Usage: art export|import');
    });
});
