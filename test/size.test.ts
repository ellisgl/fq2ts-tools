// The tools on a game made for a 120x37 screen, whose maps are 119x34.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readIcy } from '@fq2ts/engine/icy';
import { World, blankMap, mapFileName, writeMap, type MapKind } from '@fq2ts/engine/world';
import { FakeTerminal, makeMap, makeWorld, row, tempDir } from '@fq2ts/engine/testing';
import { ScreenEditor, type EditorState } from '../src/editor/screen-editor.ts';
import { main as edit } from '../src/edit.ts';
import { exportMap, importMap, icyFileName, main as art } from '../src/art.ts';
import { generate, isBlank, walkableAreas, worldPoint } from '../src/generator/generate.ts';
import { renderHtml } from '../src/html.ts';
import { gameMapSize, type GameFiles } from '../src/game.ts';

const SIZE = { width: 120, height: 37 };
const MAP = { width: 119, height: 34 };

// A maps folder of blank 119x34 screens.
function bigMaps(kinds: Readonly<Record<number, MapKind>>): string {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    for (const [screen, kind] of Object.entries(kinds)) {
        writeFileSync(join(dir, mapFileName(Number(screen))), writeMap(blankMap(Number(screen), kind, undefined, MAP)));
    }
    return dir;
}

const state = (): EditorState => ({ brush: { ch: '#', fg: 14, bg: 4, solid: true, terrain: 'grass' }, clipboard: null, overlay: 'none', showTriggers: true });

test("a game's map size comes from its screen", () => {
    expect(gameMapSize({ maps: '' })).toEqual({ width: 79, height: 22 });
    expect(gameMapSize({ maps: '', screen: SIZE })).toEqual(MAP);
});

describe('the editor', () => {
    test('edits the whole map, with its lines at the bottom of the screen', async () => {
        const world = makeWorld(makeMap(1, 1, [], MAP));
        const term = new FakeTerminal([], { size: SIZE });
        term.feed('end', 'pagedown', ' ', () => {
            expect(row(term.screen, 35)).toContain('Screen 1 land  119,34');
            expect(row(term.screen, 36)).toContain('Brush');
            expect(row(term.screen, 37)).toContain('? help');
            return 'escape';
        });
        await new ScreenEditor({ term, world, screen: 1, state: state(), triggers: new Set(), changed: () => undefined }).run();
        expect(world.cell(1, 119, 34)).toMatchObject({ ch: '#', solid: true });
        expect(term.remaining).toBe(0);
    });

    test('needs a screen big enough for the maps', () => {
        const world = makeWorld(makeMap(1, 1, [], MAP));
        expect(() => new ScreenEditor({ term: new FakeTerminal(), world, screen: 1, state: state(), triggers: new Set(), changed: () => undefined }))
            .toThrow("The editor needs a 120x37 screen for 119x34 maps, but its terminal's is 80x25.");
    });

    test('the edit command reads the maps at the game\'s size, and makes new screens that size', async () => {
        const dir = bigMaps({ 1: 1 });
        const files: GameFiles = { maps: dir, screen: SIZE };
        // (Screen 2 is next to screen 1 in the overview: N makes it, as land.)
        const term = new FakeTerminal(['right', 'n', 'enter', 's', 'escape', 'y'], { size: SIZE, fallback: 'escape' });
        const logs: string[] = [];
        expect(await edit([], files, term, (line) => logs.push(line))).toBe(0);
        expect(World.load(dir, MAP).screens()).toEqual([1, 2]);
    });
});

describe('Icy Draw', () => {
    test('a screen goes out and comes back at its size', () => {
        const map = blankMap(1, 1, { ch: '♣', fg: 10, bg: 2, solid: true, terrain: 'forest' }, MAP);
        const icy = exportMap(map);
        expect([icy.width, icy.height]).toEqual([119, 34]);
        expect(importMap(icy, map)).toEqual(map);
        expect(() => importMap(exportMap(makeMap(1)), map)).toThrow("it's 79x22, not 119x34");
    });

    test('the art command exports and imports at the game\'s size', () => {
        const maps = bigMaps({ 1: 1 });
        const out = tempDir();
        const files: GameFiles = { maps, screen: SIZE };
        expect(art(['export', '1', '-d', out], files, () => undefined)).toBe(0);
        expect(readIcy(readFileSync(join(out, icyFileName(1)))).width).toBe(119);
        expect(art(['import', '1', '-d', out], files, () => undefined)).toBe(0);
    });
});

describe('the generator', () => {
    test('fills a whole 119x34 screen, its open ground joined up', () => {
        const world = makeWorld(makeMap(1, 5, [], MAP), makeMap(2, 5, [], MAP));
        world.setCell(1, 1, 1, { ch: 'x', fg: 15, bg: 2, solid: false, terrain: 'grass' });
        generate(world, [2], { seed: 7 });
        expect(isBlank(world, 2)).toBe(false);
        const grid = Array.from({ length: 34 }, (_, y) => Array.from({ length: 119 }, (_, x) => world.cell(2, x + 1, y + 1)));
        const areas = walkableAreas(grid);
        // (Every bigger open area is joined to the main one; only tiny enclosed
        // pockets could be left, and those are planted over.)
        expect(areas.slice(1).every((area) => area.length < 6)).toBe(true);
    });

    test('world points step by the map size', () => {
        expect(worldPoint(2, 1, 1, MAP)).toEqual({ X: 119, Y: 0 });
        expect(worldPoint(81, 1, 1, MAP)).toEqual({ X: 0, Y: 34 });
    });
});

test('the viewer draws every row and column', () => {
    const html = renderHtml(makeWorld(makeMap(1, 1, [], MAP)));
    const pre = /<pre class="screen"[^>]*>([\s\S]*?)<\/pre>/.exec(html)?.[1] ?? '';
    const rows = pre.split('\n');
    expect(rows).toHaveLength(34);
    for (const line of rows) {
        expect(line.replace(/<[^>]+>/g, '')).toHaveLength(119);
    }
});
