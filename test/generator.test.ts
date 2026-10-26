import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fbm, hash, random, smoothstep, valueNoise } from '../src/generator/noise.ts';
import { STYLE, Terrain, generate, isBlank, walkableAreas, worldPoint } from '../src/generator/generate.ts';
import { main } from '../src/generate.ts';
import { MAP_HEIGHT, MAP_WIDTH, World, blankMap, type MapCell, type MapKind } from '@fq2ts/engine/world';
import { makeMap, makeWorld, tempDir } from '@fq2ts/engine/testing';

// ---- Noise

describe('noise', () => {
    test('hash and random depend only on their inputs', () => {
        expect(hash(1, 2, 3)).toBe(hash(1, 2, 3));
        expect(hash(1, 2, 3)).not.toBe(hash(2, 2, 3));
        expect(hash(1, 2, 3)).not.toBe(hash(1, 3, 2));
        for (let i = 0; i < 1000; i++) {
            const r = random(5, i, -i);
            expect(r).toBeGreaterThanOrEqual(0);
            expect(r).toBeLessThan(1);
        }
    });

    test('random values are spread out', () => {
        let sum = 0;
        for (let i = 0; i < 10_000; i++) {
            sum += random(9, i % 100, Math.floor(i / 100));
        }
        expect(sum / 10_000).toBeCloseTo(0.5, 1);
    });

    test('smoothstep', () => {
        expect(smoothstep(0, 1, -1)).toBe(0);
        expect(smoothstep(0, 1, 0.5)).toBe(0.5);
        expect(smoothstep(0, 1, 2)).toBe(1);
        expect(smoothstep(2, 4, 3)).toBe(0.5);
    });

    test('value noise hits the random values on whole numbers, and is smooth between', () => {
        expect(valueNoise(3, 4, 7)).toBe(random(3, 4, 7));
        for (let i = 0; i < 200; i++) {
            const x = i * 0.137;
            const y = i * 0.071;
            expect(Math.abs(valueNoise(3, x, y) - valueNoise(3, x + 0.001, y + 0.001))).toBeLessThan(0.01);
        }
    });

    test('fbm stays between 0 and 1', () => {
        for (let i = 0; i < 500; i++) {
            const v = fbm(1, i * 0.37, i * 0.19);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
        }
    });
});

// ---- Generating

// A 3x3 block of blank screens (columns 2-4, rows 2-4: screens 82-84,
// 162-164, 242-244) of the given kinds, row by row.
function block(kinds: readonly (readonly MapKind[])[]): { world: World; screens: number[] } {
    const world = makeWorld();
    const screens: number[] = [];
    kinds.forEach((row, r) => {
        row.forEach((kind, c) => {
            const n = (r + 1) * 80 + c + 2;
            world.put(blankMap(n, kind));
            screens.push(n);
        });
    });
    return { world, screens };
}

const LAND: MapKind[][] = [[5, 5, 5], [5, 5, 5], [5, 5, 5]];

function cells(world: World, screen: number): MapCell[] {
    const out: MapCell[] = [];
    for (let y = 1; y <= MAP_HEIGHT; y++) {
        for (let x = 1; x <= MAP_WIDTH; x++) {
            out.push(world.cell(screen, x, y));
        }
    }
    return out;
}

const share = (world: World, screen: number, test: (c: MapCell) => boolean): number => cells(world, screen).filter(test).length / (MAP_WIDTH * MAP_HEIGHT);
const isWater = (c: MapCell): boolean => c.bg === 1;

describe('generate', () => {
    test("the same seed makes the same terrain; another seed doesn't", () => {
        const a = block(LAND);
        const b = block(LAND);
        const c = block(LAND);
        generate(a.world, a.screens, { seed: 1 });
        generate(b.world, b.screens, { seed: 1 });
        generate(c.world, c.screens, { seed: 2 });
        expect(a.world.export(163)).toEqual(b.world.export(163));
        expect(a.world.export(163)).not.toEqual(c.world.export(163));
    });

    test("keeps each screen's kind and only uses the hand-made style's tiles", () => {
        const { world, screens } = block([[5, 0, 5], [1, 3, 8], [4, 5, 6]]);
        generate(world, screens, { seed: 3 });
        expect(world.kind(83)).toBe(0);
        expect(world.kind(164)).toBe(8);
        const styles = Object.values(STYLE).map((s) => JSON.stringify(s));
        for (const n of screens) {
            for (const c of cells(world, n)) {
                expect(styles).toContain(JSON.stringify(c));
            }
        }
    });

    test('a water screen among land screens becomes a lake, and the land stays land', () => {
        for (const seed of [1, 2, 3, 4]) {
            const { world, screens } = block([[5, 5, 5], [5, 0, 5], [5, 5, 5]]);
            generate(world, screens, { seed });
            expect(share(world, 163, isWater)).toBeGreaterThan(0.4);
            for (const n of [82, 84, 242, 244]) {
                expect(share(world, n, isWater)).toBeLessThan(0.2);
            }
        }
    });

    test('a sea of water screens has a shore where it meets land', () => {
        const { world, screens } = block([[5, 5, 5], [0, 0, 0], [0, 0, 0]]);
        generate(world, screens, { seed: 5 });
        expect(cells(world, 163).some((c) => c.ch === STYLE.shore.ch)).toBe(true);
        expect(share(world, 243, isWater)).toBeGreaterThan(0.9);
    });

    test('land screens have forest, open ground and some mountains', () => {
        let trees = 0;
        let mountains = 0;
        let grass = 0;
        for (const seed of [1, 2, 3]) {
            const { world, screens } = block(LAND);
            generate(world, screens, { seed });
            for (const n of screens) {
                trees += share(world, n, (c) => c.ch === '♠' || c.ch === '♣');
                mountains += share(world, n, (c) => c.ch === '∩');
                grass += share(world, n, (c) => !c.solid);
            }
        }
        // Roughly the mix of the hand-made land (19% trees, 4% mountains).
        expect(trees / 27).toBeGreaterThan(0.1);
        expect(trees / 27).toBeLessThan(0.35);
        expect(mountains / 27).toBeGreaterThan(0.01);
        expect(mountains / 27).toBeLessThan(0.1);
        expect(grass / 27).toBeGreaterThan(0.5);
    });

    test('towns get a clearing in the middle', () => {
        for (const seed of [1, 2, 3]) {
            const { world, screens } = block([[5, 5, 5], [5, 3, 5], [5, 4, 5]]);
            generate(world, screens, { seed });
            for (let y = 9; y <= 14; y++) {
                for (let x = 30; x <= 50; x++) {
                    expect(world.cell(163, x, y)).toEqual(STYLE.grass);
                }
            }
            for (let y = 10; y <= 13; y++) {
                for (let x = 36; x <= 44; x++) {
                    expect(world.cell(243, x, y)).toEqual(STYLE.grass);
                }
            }
        }
    });

    test('every land screen can be walked across, except where water cuts it off', () => {
        for (const seed of [1, 2, 3, 4, 5, 6]) {
            const { world, screens } = block(LAND);
            generate(world, screens, { seed });
            for (const n of screens) {
                const grid = Array.from({ length: MAP_HEIGHT }, (_, y) => Array.from({ length: MAP_WIDTH }, (_, x) => world.cell(n, x + 1, y + 1)));
                // With water as the only obstacle, which walkable areas could reach
                // each other? Those must already be one area.
                const dry = grid.map((row) => row.map((c) => ({ ...c, solid: isWater(c) })));
                const regions = walkableAreas(dry).map((area) => new Set(area.map(([x, y]) => `${x},${y}`)));
                const areas = walkableAreas(grid);
                for (const region of regions) {
                    const inside = areas.filter((area) => area.some(([x, y]) => region.has(`${x},${y}`)));
                    expect(inside.length).toBeLessThanOrEqual(1);
                }
            }
        }
    });

    test('open ground and roads carry on from a hand-made neighbour', () => {
    // Screen 81 (hand-made, west of 82): trees, except for a road at row 11.
        const world = makeWorld(blankMap(81, 1, STYLE.tree));
        world.setCell(81, 79, 11, STYLE.road);
        world.setCell(81, 79, 12, STYLE.grass);
        world.put(blankMap(82, 1));
        generate(world, [82], { seed: 8 });
        for (const x of [1, 2, 3]) {
            expect(world.cell(82, x, 11)).toEqual(STYLE.road);
            expect(world.cell(82, x, 12)).toEqual(STYLE.grass);
        }
        const grid = Array.from({ length: MAP_HEIGHT }, (_, y) => Array.from({ length: MAP_WIDTH }, (_, x) => world.cell(82, x + 1, y + 1)));
        expect(walkableAreas(grid)).toHaveLength(1);
    });

    test("generated screens don't stitch to each other", () => {
        const world = makeWorld(blankMap(81, 1, STYLE.road), blankMap(82, 1));
        generate(world, [81, 82], { seed: 8 });
        expect(world.cell(81, 79, 11)).not.toEqual(STYLE.road);
    });

    test('hand-made water counts towards the coast', () => {
    // A land screen between a hand-made sea and a hand-made field.
        const sea = makeWorld(blankMap(81, 1, STYLE.water), blankMap(82, 1), blankMap(83, 1, STYLE.grass));
        const field = makeWorld(blankMap(81, 1, STYLE.grass), blankMap(82, 1), blankMap(83, 1, STYLE.grass));
        const westWater = (w: World): number => cells(w, 82).filter((c, i) => isWater(c) && i % MAP_WIDTH < 20).length;
        let nearSea = 0;
        let nearField = 0;
        for (const seed of [1, 2, 3, 4, 5, 6]) {
            const a = makeWorld(sea.export(81), blankMap(82, 1), sea.export(83));
            const b = makeWorld(field.export(81), blankMap(82, 1), field.export(83));
            generate(a, [82], { seed });
            generate(b, [82], { seed });
            nearSea += westWater(a);
            nearField += westWater(b);
        }
        expect(nearSea).toBeGreaterThan(nearField * 2);
    });

    test('refuses missing screens and interiors', () => {
        const world = makeWorld(makeMap(1, 2));
        expect(() => generate(world, [5], { seed: 1 })).toThrow("Screen 5 doesn't exist");
        expect(() => generate(world, [1], { seed: 1 })).toThrow('Screen 1 is an interior');
    });
});

describe('Terrain', () => {
    test('the water level is smooth across every screen edge', () => {
        const { world, screens } = block([[5, 0, 5], [0, 5, 8], [5, 3, 0]]);
        const terrain = new Terrain(world, 11, new Set(screens));
        for (let Y = 80; Y < 22 * 5; Y++) {
            for (let X = 80; X < 79 * 5; X++) {
                expect(Math.abs(terrain.waterness(X, Y) - terrain.waterness(X + 1, Y))).toBeLessThan(0.2);
                expect(Math.abs(terrain.waterness(X, Y) - terrain.waterness(X, Y + 1))).toBeLessThan(0.2);
            }
        }
    });

    test("... including next to screens that don't exist", () => {
    // Land above water, with nothing to the east of either.
        const world = makeWorld(blankMap(10, 5), blankMap(90, 0));
        const terrain = new Terrain(world, 7, new Set([10, 90]));
        for (let x = 1; x <= MAP_WIDTH; x++) {
            const above = worldPoint(10, x, MAP_HEIGHT);
            const below = worldPoint(90, x, 1);
            expect(Math.abs(terrain.waterness(above.X, above.Y) - terrain.waterness(below.X, below.Y))).toBeLessThan(0.2);
        }
    });

    test("away from any screens it's neither land nor water", () => {
        const terrain = new Terrain(makeWorld(), 1);
        expect(Math.abs(terrain.waterness(5000, 300) - 0.5)).toBeLessThan(0.6);
    });

    test('worldPoint', () => {
        expect(worldPoint(1, 1, 1)).toEqual({ X: 0, Y: 0 });
        expect(worldPoint(82, 3, 4)).toEqual({ X: 81, Y: 25 });
    });
});

test('isBlank', () => {
    const world = makeWorld(blankMap(1, 1, STYLE.grass));
    expect(isBlank(world, 1)).toBe(true);
    world.setCell(1, 79, 22, STYLE.tree);
    expect(isBlank(world, 1)).toBe(false);
});

// ---- The command

describe('the generate command', () => {
    function setup(...maps: Parameters<typeof makeWorld>): { dir: string; run(...args: string[]): { code: number; lines: string[] } } {
        const dir = tempDir();
        makeWorld(...maps).save(dir);
        return {
            dir,
            run: (...args) => {
                const lines: string[] = [];
                const code = main(['-m', dir, ...args], { maps: dir }, (l) => lines.push(l), () => 99);
                return { code, lines };
            },
        };
    }

    test('fills every blank outdoor screen by default, with a random seed', () => {
        const { dir, run } = setup(blankMap(1, 5), blankMap(2, 2), makeMap(3, 1, ['1,1']), blankMap(4, 0));
        const { code, lines } = run();
        expect(code).toBe(0);
        expect(lines[0]).toBe('Generated 2 screens (1, 4) with seed 99.');
        expect(lines[1]).toStartWith('Saved 2 files to');
        const world = World.load(dir);
        expect(isBlank(world, 1)).toBe(false);
        expect(isBlank(world, 2)).toBe(true);
    });

    test("says so when there's nothing to fill", () => {
        const { run } = setup(makeMap(1, 1, ['1,1']));
        const { code, lines } = run();
        expect(code).toBe(1);
        expect(lines[0]).toContain('no blank outdoor screens');
    });

    test('--screens and --seed', () => {
        const { dir, run } = setup(blankMap(1, 5), blankMap(2, 5));
        expect(run('--screens', '2', '--seed', '5').lines[0]).toBe('Generated 1 screen (2) with seed 5.');
        const world = World.load(dir);
        expect(isBlank(world, 1)).toBe(true);
        const again = makeWorld(blankMap(1, 5), blankMap(2, 5));
        generate(again, [2], { seed: 5 });
        expect(world.export(2)).toEqual(again.export(2));
    });

    test("won't replace a screen with something on it without --force", () => {
        const { run } = setup(makeMap(1, 1, ['1,1']));
        expect(() => run('-s', '1')).toThrow('already have something on them: 1. Use --force');
        expect(run('-s', '1', '--force').code).toBe(0);
    });

    test('refuses missing screens, interiors and bad seeds', () => {
        const { run } = setup(blankMap(1, 2));
        expect(() => run('-s', '5')).toThrow("These screens don't exist yet: 5.");
        expect(() => run('-s', '1')).toThrow("These screens are interiors, which aren't generated: 1.");
        expect(() => run('--seed', 'x')).toThrow('The seed must be a whole number, not "x".');
    });

    test('--dry-run saves nothing, and --preview writes a page of the result and its neighbours', () => {
        const { dir, run } = setup(blankMap(82, 5), makeMap(83, 1, ['1,1']), blankMap(85, 1, STYLE.grass), blankMap(721, 2));
        const preview = join(tempDir(), 'p.html');
        const { lines } = run('-s', '82', '-n', '-p', preview);
        expect(lines).toEqual(['Generated 1 screen (82) with seed 99.', `Wrote a preview to ${preview}`, 'Dry run: nothing saved.']);
        expect(isBlank(World.load(dir), 82)).toBe(true);
        expect(existsSync(preview)).toBe(true);
        const html = readFileSync(preview, 'utf8');
        expect(html).toContain('data-screen="82"');
        expect(html).toContain('data-screen="83"');
        expect(html).not.toContain('data-screen="85"');
        expect(html).not.toContain('data-screen="721"');
    });

    test('--help', () => {
        const lines: string[] = [];
        expect(main(['-h'], { maps: '' }, (l) => lines.push(l))).toBe(0);
        expect(lines[0]).toContain('Usage: generate [options]');
    });
});

test('generated screens record their terrain', () => {
    const { world, screens } = block([[5, 0, 5], [5, 3, 5], [5, 5, 5]]);
    generate(world, screens, { seed: 2 });
    for (const n of screens) {
        for (const c of cells(world, n)) {
            const expected = c.bg === 1 ? 'water' : c.ch === '∩' ? 'mountain' : c.solid ? 'forest' : c.bg === 6 ? 'road' : 'grass';
            expect(c.terrain).toBe(expected);
        }
    }
});
