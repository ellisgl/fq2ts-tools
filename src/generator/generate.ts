// The map generator: fills screens with land, water, forest, mountains and
// trails in the style of the hand-made ones.
//
// Every feature comes from noise over the whole world (not one screen at a
// time), so neighbouring generated screens line up at their edges. Water
// follows the kind grid: water screens become lakes and seas, land screens
// stay land, and coasts form where they meet. Towns get a clearing to build
// in by hand. Next to a hand-made screen, roads and open ground carry on
// across the edge, and any walkable patch left cut off gets a path cleared
// to the rest.

import { at, cellAt } from '@fq2ts/engine/assert';
import { MAP_HEIGHT, MAP_WIDTH, GRID_WIDTH, GRID_HEIGHT, blankMap, gridPosition, type MapCell, type MapKind, type World } from '@fq2ts/engine/world';
import { fbm, random, smoothstep } from './noise.ts';

export interface GenerateOptions {
    seed: number;
}

// The tiles, as the hand-made screens draw them.
export const STYLE = {
    grass: { ch: ' ', fg: 15, bg: 2, solid: false, terrain: 'grass' },
    tree: { ch: '♠', fg: 10, bg: 2, solid: true, terrain: 'forest' },
    autumnTree: { ch: '♠', fg: 6, bg: 2, solid: true, terrain: 'forest' },
    bush: { ch: '♣', fg: 10, bg: 2, solid: true, terrain: 'forest' },
    mountain: { ch: '∩', fg: 8, bg: 2, solid: true, terrain: 'mountain' },
    water: { ch: ' ', fg: 15, bg: 1, solid: true, terrain: 'water' },
    shore: { ch: '█', fg: 9, bg: 1, solid: true, terrain: 'water' },
    road: { ch: ' ', fg: 15, bg: 6, solid: false, terrain: 'road' },
} as const satisfies Record<string, MapCell>;

const WATER_KINDS: readonly MapKind[] = [0, 8];
const TOWN_KINDS: readonly MapKind[] = [3, 7];
const SMALL_TOWN_KINDS: readonly MapKind[] = [4, 6];

// How far stitching to a hand-made neighbour reaches into a screen.
const STITCH_DEPTH = 3;
// Walkable pockets smaller than this, away from the edges, are planted over
// instead of having a path cleared to them.
const POCKET = 6;

const walkable = (c: MapCell): boolean => !c.solid;
const isWaterCell = (c: MapCell): boolean => c.bg === 1 && (c.ch === ' ' || c.ch === '█');

// ---- Where things are in the world

// World coordinates of a cell: 0-based, across the whole grid of screens.
export function worldPoint(screen: number, x: number, y: number): { X: number; Y: number } {
    const { col, row } = gridPosition(screen);
    return { X: (col - 1) * MAP_WIDTH + (x - 1), Y: (row - 1) * MAP_HEIGHT + (y - 1) };
}

// ---- The terrain fields

export class Terrain {
    private readonly world: World;
    private readonly seed: number;
    private readonly generating: ReadonlySet<number>;
    private readonly measured = new Map<number, number>();

    // `generating`: the screens being generated. Any other screen is taken as
    // it is, so the terrain fits around it.
    public constructor(world: World, seed: number, generating: ReadonlySet<number> = new Set()) {
        this.world = world;
        this.seed = seed;
        this.generating = generating;
    }

    // How much of a screen should be water: 1 for a water screen being
    // generated, 0 for land, the share of water cells for any other screen,
    // and null when there's no outdoor screen.
    private target(screen: number | null): number | null {
        if (screen === null) {
            return null;
        }
        const kind = this.world.kind(screen);
        if (kind === undefined || kind === 2) {
            return null;
        }
        if (this.generating.has(screen)) {
            return WATER_KINDS.includes(kind) ? 1 : 0;
        }
        let share = this.measured.get(screen);
        if (share === undefined) {
            let water = 0;
            for (let y = 1; y <= MAP_HEIGHT; y++) {
                for (let x = 1; x <= MAP_WIDTH; x++) {
                    if (isWaterCell(this.world.cell(screen, x, y))) {
                        water++;
                    }
                }
            }
            share = water / (MAP_WIDTH * MAP_HEIGHT);
            this.measured.set(screen, share);
        }
        return share;
    }

    // The water level at a grid position (0-based column and row): its
    // screen's target, or for a missing screen the average of the screens
    // around it (or 0.5 if there are none). It must depend only on the
    // position, or the blend between positions would jump.
    private level(c: number, r: number): number {
        const own = this.targetAt(c, r);
        if (own !== null) {
            return own;
        }
        let sum = 0;
        let count = 0;
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                const t = this.targetAt(c + dc, r + dr);
                if (t === null) {
                    continue;
                }
                sum += t;
                count++;
            }
        }
        return count ? sum / count : 0.5;
    }

    private targetAt(c: number, r: number): number | null {
        return c < 0 || c >= GRID_WIDTH || r < 0 || r >= GRID_HEIGHT ? null : this.target(r * GRID_WIDTH + c + 1);
    }

    // How watery a point is: the kinds of the nearby screens blended between
    // their centres, roughened with noise. Above 0.5 is water.
    public waterness(X: number, Y: number): number {
        const u = (X - (MAP_WIDTH - 1) / 2) / MAP_WIDTH;
        const v = (Y - (MAP_HEIGHT - 1) / 2) / MAP_HEIGHT;
        const c0 = Math.floor(u);
        const r0 = Math.floor(v);
        const tx = u - c0;
        const ty = v - r0;
        const top = this.level(c0, r0) * (1 - tx) + this.level(c0 + 1, r0) * tx;
        const bottom = this.level(c0, r0 + 1) * (1 - tx) + this.level(c0 + 1, r0 + 1) * tx;
        // Some extra contrast, so that screens follow their kind more firmly.
        const base = 0.5 + (top * (1 - ty) + bottom * ty - 0.5) * 1.5;
        // Broad bays and points, then smaller wiggles. (Cells are about twice as
        // tall as they are wide, so X is scaled twice as much as Y.)
        const broad = (fbm(this.seed + 1, X / 40, Y / 20) - 0.5) * 1.6;
        const detail = (fbm(this.seed + 7, X / 12, Y / 6, 3) - 0.5) * 0.6;
        return base + broad + detail;
    }

    public isWater(X: number, Y: number): boolean {
        return this.waterness(X, Y) > 0.5;
    }

    public mountain(X: number, Y: number): number {
        return fbm(this.seed + 2, X / 20, Y / 10);
    }

    public forest(X: number, Y: number): number {
        return fbm(this.seed + 3, X / 30, Y / 15);
    }

    // Thin winding lines: where a smooth noise passes through its middle.
    public isTrail(X: number, Y: number): boolean {
        return Math.abs(fbm(this.seed + 4, X / 36, Y / 18, 3) - 0.5) < 0.018;
    }

    // 0 in the middle of a town screen, rising to 1 towards its edges; always
    // 1 elsewhere.
    public openness(screen: number, x: number, y: number): number {
        const kind = this.world.kind(screen);
        const small = kind !== undefined && SMALL_TOWN_KINDS.includes(kind);
        if (kind === undefined || (!small && !TOWN_KINDS.includes(kind))) {
            return 1;
        }
        const dx = (x - (MAP_WIDTH + 1) / 2) / (MAP_WIDTH / 2);
        const dy = (y - (MAP_HEIGHT + 1) / 2) / (MAP_HEIGHT / 2);
        const r = Math.sqrt(dx * dx + dy * dy);
        return small ? smoothstep(0.35, 0.8, r) : smoothstep(0.55, 0.95, r);
    }

    // The tile for one cell of a screen.
    public cell(screen: number, x: number, y: number): MapCell {
        const { X, Y } = worldPoint(screen, x, y);
        if (this.isWater(X, Y)) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (!this.isWater(X + dx, Y + dy)) {
                        return STYLE.shore;
                    }
                }
            }
            return STYLE.water;
        }
        const open = this.openness(screen, x, y);
        if (open < 0.05 || this.isTrail(X, Y)) {
            return STYLE.grass;
        }
        if (open > 0.9 && this.mountain(X, Y) > 0.7 && this.waterness(X, Y) < 0.3) {
            return STYLE.mountain;
        }
        const chance = (smoothstep(0.52, 0.64, this.forest(X, Y)) * 0.92 + 0.015) * open;
        if (random(this.seed + 5, X, Y) >= chance) {
            return STYLE.grass;
        }
        const kind = random(this.seed + 6, X, Y);
        return kind < 0.88 ? STYLE.tree : kind < 0.97 ? STYLE.autumnTree : STYLE.bush;
    }
}

// ---- Fixing up screens

type Grid = MapCell[][];


function get(grid: Grid, x: number, y: number): MapCell {
    return cellAt(grid, x, y);
}

function set(grid: Grid, x: number, y: number, cell: MapCell): void {
    at(grid, y - 1)[x - 1] = cell;
}

// The cells of an edge, from the outside in: for each position along the
// edge, our cells at depth 0, 1, ... and the neighbour's facing cell.
const EDGES = [
    { dx: -1, dy: 0, length: MAP_HEIGHT, ours: (i: number, d: number) => [1 + d, i] as const, theirs: (i: number) => [MAP_WIDTH, i] as const },
    { dx: 1, dy: 0, length: MAP_HEIGHT, ours: (i: number, d: number) => [MAP_WIDTH - d, i] as const, theirs: (i: number) => [1, i] as const },
    { dx: 0, dy: -1, length: MAP_WIDTH, ours: (i: number, d: number) => [i, 1 + d] as const, theirs: (i: number) => [i, MAP_HEIGHT] as const },
    { dx: 0, dy: 1, length: MAP_WIDTH, ours: (i: number, d: number) => [i, MAP_HEIGHT - d] as const, theirs: (i: number) => [i, 1] as const },
];

// Makes the edges facing hand-made screens agree with them: open ground and
// roads carry on in. (Water needs no help: the terrain already counts the
// hand-made screens' water.)
function stitch(world: World, screen: number, grid: Grid, generated: ReadonlySet<number>): void {
    for (const edge of EDGES) {
        const neighbour = screen + edge.dx + edge.dy * GRID_WIDTH;
        const { col, row } = gridPosition(screen);
        if (col + edge.dx < 1 || col + edge.dx > GRID_WIDTH || row + edge.dy < 1 || row + edge.dy > GRID_HEIGHT) {
            continue;
        }
        if (generated.has(neighbour) || !world.isOutdoors(neighbour)) {
            continue;
        }
        for (let i = 1; i <= edge.length; i++) {
            const [tx, ty] = edge.theirs(i);
            const facing = world.cell(neighbour, tx, ty);
            if (!walkable(facing)) {
                continue;
            }
            const fill = facing.bg === 6 ? STYLE.road : STYLE.grass;
            for (let d = 0; d < STITCH_DEPTH; d++) {
                set(grid, ...edge.ours(i, d), fill);
            }
        }
    }
}

type Point = readonly [number, number];
const STEPS: readonly Point[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const inside = (x: number, y: number): boolean => x >= 1 && x <= MAP_WIDTH && y >= 1 && y <= MAP_HEIGHT;
const key = (x: number, y: number): number => (y - 1) * MAP_WIDTH + (x - 1);

// The groups of walkable cells that touch each other, biggest first.
export function walkableAreas(grid: Grid): Point[][] {
    const seen = new Set<number>();
    const areas: Point[][] = [];
    for (let y = 1; y <= MAP_HEIGHT; y++) {
        for (let x = 1; x <= MAP_WIDTH; x++) {
            if (seen.has(key(x, y)) || !walkable(get(grid, x, y))) {
                continue;
            }
            const area: Point[] = [];
            const queue: Point[] = [[x, y]];
            seen.add(key(x, y));
            for (let next = queue.shift(); next; next = queue.shift()) {
                area.push(next);
                for (const [sx, sy] of STEPS) {
                    const nx = next[0] + sx;
                    const ny = next[1] + sy;
                    if (inside(nx, ny) && !seen.has(key(nx, ny)) && walkable(get(grid, nx, ny))) {
                        seen.add(key(nx, ny));
                        queue.push([nx, ny]);
                    }
                }
            }
            areas.push(area);
        }
    }
    return areas.sort((a, b) => b.length - a.length);
}

// The shortest way from `from` to any cell in `to` that doesn't cross
// water, or null. (Trees and mountains on it will be cleared.)
function pathBetween(grid: Grid, from: readonly Point[], to: ReadonlySet<number>): Point[] | null {
    const cameFrom = new Map<number, number>();
    const queue: Point[] = [];
    for (const p of from) {
        cameFrom.set(key(...p), -1);
        queue.push(p);
    }
    for (let next = queue.shift(); next; next = queue.shift()) {
        const k = key(...next);
        if (to.has(k)) {
            const path: Point[] = [];
            for (let step = k; step !== -1; step = cameFrom.get(step) ?? -1) {
                path.push([(step % MAP_WIDTH) + 1, Math.floor(step / MAP_WIDTH) + 1]);
            }
            return path;
        }
        for (const [sx, sy] of STEPS) {
            const nx = next[0] + sx;
            const ny = next[1] + sy;
            if (!inside(nx, ny) || cameFrom.has(key(nx, ny)) || isWaterCell(get(grid, nx, ny))) {
                continue;
            }
            cameFrom.set(key(nx, ny), k);
            queue.push([nx, ny]);
        }
    }
    return null;
}

// Joins every walkable area to the biggest one by clearing the shortest
// path through trees and mountains. Small enclosed pockets are planted over
// instead. Areas cut off by water stay as they are.
function connect(grid: Grid): void {
    for (;;) {
        const [main, ...rest] = walkableAreas(grid);
        if (!main) {
            return;
        }
        const mainKeys = new Set(main.map((p) => key(...p)));
        let joined = false;
        for (const area of rest) {
            const atEdge = area.some(([x, y]) => x === 1 || x === MAP_WIDTH || y === 1 || y === MAP_HEIGHT);
            if (!atEdge && area.length < POCKET) {
                for (const [x, y] of area) {
                    set(grid, x, y, STYLE.tree);
                }
                continue;
            }
            const path = pathBetween(grid, area, mainKeys);
            if (!path) {
                continue;
            }
            for (const [x, y] of path) {
                if (!walkable(get(grid, x, y))) {
                    set(grid, x, y, STYLE.grass);
                }
            }
            joined = true;
            break;
        }
        if (!joined) {
            return;
        }
    }
}

// ---- Generating

// Screens that are one cell repeated (as made by the editor's N).
export function isBlank(world: World, screen: number): boolean {
    const first = world.cell(screen, 1, 1);
    for (let y = 1; y <= MAP_HEIGHT; y++) {
        for (let x = 1; x <= MAP_WIDTH; x++) {
            const c = world.cell(screen, x, y);
            if (c.ch !== first.ch || c.fg !== first.fg || c.bg !== first.bg || c.solid !== first.solid) {
                return false;
            }
        }
    }
    return true;
}

// Fills the given screens (which must exist and be outdoors) with generated
// terrain, keeping their kinds.
export function generate(world: World, screens: readonly number[], { seed }: GenerateOptions): void {
    for (const screen of screens) {
        if (!world.has(screen)) {
            throw new Error(`Screen ${screen} doesn't exist; create it (with its kind) first.`);
        }
        if (!world.isOutdoors(screen)) {
            throw new Error(`Screen ${screen} is an interior; only outdoor screens are generated.`);
        }
    }
    const generated = new Set(screens);
    const terrain = new Terrain(world, seed, generated);
    for (const screen of screens) {
        const grid: Grid = Array.from({ length: MAP_HEIGHT }, (_, y) => Array.from({ length: MAP_WIDTH }, (_, x) => terrain.cell(screen, x + 1, y + 1)));
        stitch(world, screen, grid, generated);
        connect(grid);
        const map = blankMap(screen, world.kind(screen) ?? 1);
        grid.forEach((row, y) => {
            row.forEach((c, x) => {
                at(map.tiles, y)[x] = c.ch;
                at(map.fg, y)[x] = c.fg;
                at(map.bg, y)[x] = c.bg;
                at(map.solid, y)[x] = c.solid;
                at(map.terrain, y)[x] = c.terrain;
            });
        });
        world.put(map);
    }
}
