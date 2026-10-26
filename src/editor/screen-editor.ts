// Editing one screen: painting cells with a brush (character, colours and
// whether it's solid), selections, copy and stamp, and undo.

import { at } from '@fq2js/engine/assert';
import { draw } from '@fq2js/engine/text';
import type { Screen } from '@fq2js/engine/screen';
import { KINDS, MAP_HEIGHT, MAP_KINDS, MAP_WIDTH, TERRAINS, TERRAIN_CODES, type GameMap, type MapCell, type Terrain, type World } from '@fq2js/engine/world';
import { isMouse, type Key, type MouseInput, type Terminal } from '@fq2js/engine/terminal';
import { pickCharacter } from './picker.ts';
import { inkOn, pickColor, type ColorSide } from './color-picker.ts';

const UNDO_LIMIT = 200;

// The palette on row 24: the brush (click for the character picker), the 16
// foreground colours (two cells each) and background colours (one each),
// and hard/soft. Clicking "fg" or "bg" opens the picker of all 256.
const PALETTE_ROW = 24;
const BRUSH_X = 7;
const FG_X = 13;
const FG_LABEL_X = FG_X - 3;
const BG_X = 49;
const BG_LABEL_X = BG_X - 3;
const HARD_X = 67;
const TERRAIN_X = 72;

// How each terrain looks in the terrain overlay: [fg, bg].
const TERRAIN_LOOK: Readonly<Record<Terrain, readonly [number, number]>> = {
    grass: [10, 2],
    forest: [15, 2],
    mountain: [0, 7],
    water: [15, 1],
    road: [14, 6],
    floor: [7, 0],
    structure: [15, 4],
};

// What the map shows over the cells.
export const OVERLAYS = ['none', 'solid', 'terrain'] as const;
export type Overlay = (typeof OVERLAYS)[number];

// What the editor keeps between screens.
export interface EditorState {
    brush: MapCell;
    clipboard: MapCell[][] | null;
    overlay: Overlay;
    showTriggers: boolean;
}

export interface ScreenEditorOptions {
    term: Terminal;
    world: World;
    screen: number;
    state: EditorState;
    // "x,y" tiles on this screen that have a trigger.
    triggers: ReadonlySet<string>;
    // Called whenever the world changes.
    changed(): void;
}

export const SCREEN_HELP = [
    '{yellow}Editing a screen',
    '',
    '{white}Arrows, Home/End, PgUp/PgDn {gray}move the cursor',
    '{white}Space   {gray}paint the brush here           {white}P {gray}pen: paint as you move',
    '{white}C       {gray}pick the brush character       {white}E {gray}take the brush from this cell',
    '{white}F / f   {gray}next / previous foreground     {white}B / b {gray}next / previous background',
    '{white}A       {gray}all 256 colours (Tab: foreground or background)',
    "{white}H       {gray}brush is hard (solid) or soft  {white}G {gray}the brush's terrain (ground)",
    '{white}V       {gray}start / cancel a selection. With one: {white}Space {gray}fills it, {white}Y {gray}copies it',
    '{white}S       {gray}stamp what was copied here (top left corner)',
    '{white}U / R   {gray}undo / redo',
    '{white}O       {gray}show solid cells, terrain, or neither   {white}T {gray}blink trigger tiles',
    "{white}K       {gray}change this screen's kind",
    '{white}Esc     {gray}back to the world overview      {white}? {gray}this help',
    '',
    '{yellow}With the mouse',
    '{white}Left    {gray}paint (drag to paint a stroke; a stroke is one undo)',
    '{white}Right   {gray}drag to select           {white}Middle {gray}take the brush from a cell',
    '{white}Bottom row {gray}click the brush for the character picker, a colour to use it,',
    '           {gray}fg or bg for all 256, or HARD/SOFT to switch',
];

// A colour as the map files have it: one hex digit, or two past F.
const hex = (c: number): string => c.toString(16).toUpperCase();
const describeCell = (c: MapCell): string => `fg ${hex(c.fg)} bg ${hex(c.bg)} ${c.solid ? 'hard' : 'soft'} ${c.terrain}`;

export class ScreenEditor {
    private readonly term: Terminal;
    private readonly screen: Screen;
    private readonly world: World;
    private readonly number: number;
    private readonly state: EditorState;
    private readonly triggers: ReadonlySet<string>;
    private readonly changed: () => void;
    private x = 1;
    private y = 1;
    private pen = false;
    private anchor: { x: number; y: number } | null = null;
    private readonly undoStack: GameMap[] = [];
    private readonly redoStack: GameMap[] = [];
    private message: string | null = null;
    // What the mouse is doing with a button held down.
    private dragging: 'paint' | 'select' | null = null;
    // Where the last painted stroke cell was, and whether this stroke has
    // been saved for undo yet.
    private last = { x: 1, y: 1 };
    private strokeSaved = false;

    public constructor({ term, world, screen, state, triggers, changed }: ScreenEditorOptions) {
        this.term = term;
        this.screen = term.screen;
        this.world = world;
        this.number = screen;
        this.state = state;
        this.triggers = triggers;
        this.changed = changed;
    }

    // Edits until Escape.
    public async run(): Promise<void> {
        for (;;) {
            this.draw();
            const key = await this.term.event();
            this.message = null;
            if (isMouse(key)) {
                await this.mouse(key);
                continue;
            }
            if (!(await this.handle(key))) {
                this.screen.cursor = null;
                return;
            }
        }
    }

    // ---- Keys

    // Returns false to leave the editor.
    private async handle(key: Key): Promise<boolean> {
        const s = this.state;
        switch (key) {
            case 'up':
            case 'down':
            case 'left':
            case 'right':
            case 'home':
            case 'end':
            case 'pageup':
            case 'pagedown':
                this.move(key);
                return true;
            case 'escape':
                if (this.anchor) {
                    this.anchor = null;
                } else {
                    return false;
                }
                return true;
            case ' ':
            case 'enter':
                if (this.anchor) {
                    this.fillSelection();
                } else {
                    this.paintHere();
                }
                return true;
            case '?':
                await this.help();
                return true;
        }
        switch (key.toLowerCase()) {
            case 'p':
                this.pen = !this.pen;
                if (this.pen) {
                    this.paintHere();
                }
                break;
            case 'c': {
                const ch = await pickCharacter(this.term, s.brush.ch);
                if (ch !== null) {
                    s.brush = { ...s.brush, ch };
                }
                break;
            }
            case 'e':
                s.brush = this.world.cell(this.number, this.x, this.y);
                this.message = 'Took the brush from this cell.';
                break;
            case 'f':
                s.brush = { ...s.brush, fg: ((s.brush.fg % 16) + (key === 'F' ? 1 : 15)) % 16 };
                break;
            case 'b':
                s.brush = { ...s.brush, bg: ((s.brush.bg % 16) + (key === 'B' ? 1 : 15)) % 16 };
                break;
            case 'a':
                await this.pickColor('fg');
                break;
            case 'g':
                s.brush = { ...s.brush, terrain: nextTerrain(s.brush.terrain) };
                break;
            case 'h':
                s.brush = { ...s.brush, solid: !s.brush.solid };
                break;
            case 'v':
                this.anchor = this.anchor ? null : { x: this.x, y: this.y };
                break;
            case 'y':
                this.copySelection();
                break;
            case 's':
                this.stamp();
                break;
            case 'u':
                this.undo();
                break;
            case 'r':
                this.redo();
                break;
            case 'o':
                s.overlay = at(OVERLAYS, (OVERLAYS.indexOf(s.overlay) + 1) % OVERLAYS.length);
                break;
            case 't':
                s.showTriggers = !s.showTriggers;
                break;
            case 'k':
                this.nextKind();
                break;
        }
        return true;
    }

    // ---- The mouse

    private async mouse(m: MouseInput): Promise<void> {
        if (m.action === 'wheel') {
            return;
        }
        if (m.action === 'release') {
            this.dragging = null;
            return;
        }
        const onMap = m.x >= 1 && m.x <= MAP_WIDTH && m.y >= 1 && m.y <= MAP_HEIGHT;
        if (m.action === 'drag') {
            if (this.dragging === 'paint' && onMap) {
                for (const [x, y] of line(this.last, m)) {
                    this.paint(x, y, true);
                }
                this.last = { x: m.x, y: m.y };
                [this.x, this.y] = [m.x, m.y];
            } else if (this.dragging === 'select') {
                this.x = Math.min(MAP_WIDTH, Math.max(1, m.x));
                this.y = Math.min(MAP_HEIGHT, Math.max(1, m.y));
            }
            return;
        }
        if (m.y === PALETTE_ROW) {
            await this.clickPalette(m.x);
            return;
        }
        if (!onMap) {
            return;
        }
        [this.x, this.y] = [m.x, m.y];
        if (m.button === 'left') {
            this.anchor = null;
            this.dragging = 'paint';
            this.strokeSaved = false;
            this.last = { x: m.x, y: m.y };
            this.paint(m.x, m.y, true);
        } else if (m.button === 'right') {
            this.anchor = { x: m.x, y: m.y };
            this.dragging = 'select';
        } else if (m.button === 'middle') {
            this.state.brush = this.world.cell(this.number, m.x, m.y);
            this.message = 'Took the brush from this cell.';
        }
    }

    private async clickPalette(x: number): Promise<void> {
        const s = this.state;
        if (x === BRUSH_X) {
            const ch = await pickCharacter(this.term, s.brush.ch);
            if (ch !== null) {
                s.brush = { ...s.brush, ch };
            }
        } else if (x === FG_LABEL_X || x === FG_LABEL_X + 1) {
            await this.pickColor('fg');
        } else if (x === BG_LABEL_X || x === BG_LABEL_X + 1) {
            await this.pickColor('bg');
        } else if (x >= FG_X && x < FG_X + 32) {
            s.brush = { ...s.brush, fg: Math.floor((x - FG_X) / 2) };
        } else if (x >= BG_X && x < BG_X + 16) {
            s.brush = { ...s.brush, bg: x - BG_X };
        } else if (x >= HARD_X && x < HARD_X + 4) {
            s.brush = { ...s.brush, solid: !s.brush.solid };
        } else if (x >= TERRAIN_X) {
            s.brush = { ...s.brush, terrain: nextTerrain(s.brush.terrain) };
        }
    }

    // Picks one of the brush's colours from all 256.
    private async pickColor(side: ColorSide): Promise<void> {
        const picked = await pickColor(this.term, this.state.brush, side);
        if (picked !== null) {
            this.state.brush = { ...this.state.brush, [picked.side]: picked.color };
        }
    }

    private move(key: Key): void {
        if (key === 'up') {
            this.y = Math.max(1, this.y - 1);
        } else if (key === 'down') {
            this.y = Math.min(MAP_HEIGHT, this.y + 1);
        } else if (key === 'left') {
            this.x = Math.max(1, this.x - 1);
        } else if (key === 'right') {
            this.x = Math.min(MAP_WIDTH, this.x + 1);
        } else if (key === 'home') {
            this.x = 1;
        } else if (key === 'end') {
            this.x = MAP_WIDTH;
        } else if (key === 'pageup') {
            this.y = 1;
        } else {
            this.y = MAP_HEIGHT;
        }
        if (this.pen) {
            this.paintHere();
        }
    }

    // ---- Changing the screen

    // Saves the screen for undo before a change.
    private checkpoint(): void {
        this.undoStack.push(this.world.export(this.number));
        if (this.undoStack.length > UNDO_LIMIT) {
            this.undoStack.shift();
        }
        this.redoStack.length = 0;
    }

    private paintHere(): void {
        this.paint(this.x, this.y, false);
    }

    // Paints one cell. A mouse stroke saves for undo only once, at its start.
    private paint(x: number, y: number, stroke: boolean): void {
        const here = this.world.cell(this.number, x, y);
        const b = this.state.brush;
        if (here.ch === b.ch && here.fg === b.fg && here.bg === b.bg && here.solid === b.solid) {
            return;
        }
        if (!stroke || !this.strokeSaved) {
            this.checkpoint();
        }
        if (stroke) {
            this.strokeSaved = true;
        }
        this.world.setCell(this.number, x, y, b);
        this.changed();
    }

    // The selection's corners, top left first.
    private selection(): { left: number; top: number; right: number; bottom: number } | null {
        if (!this.anchor) {
            return null;
        }
        return {
            left: Math.min(this.anchor.x, this.x),
            top: Math.min(this.anchor.y, this.y),
            right: Math.max(this.anchor.x, this.x),
            bottom: Math.max(this.anchor.y, this.y),
        };
    }

    private fillSelection(): void {
        const sel = this.selection();
        if (!sel) {
            return;
        }
        this.checkpoint();
        for (let y = sel.top; y <= sel.bottom; y++) {
            for (let x = sel.left; x <= sel.right; x++) {
                this.world.setCell(this.number, x, y, this.state.brush);
            }
        }
        this.anchor = null;
        this.changed();
    }

    private copySelection(): void {
        const sel = this.selection();
        if (!sel) {
            this.message = 'Select something first (V).';
            return;
        }
        const rows: MapCell[][] = [];
        for (let y = sel.top; y <= sel.bottom; y++) {
            const row: MapCell[] = [];
            for (let x = sel.left; x <= sel.right; x++) {
                row.push(this.world.cell(this.number, x, y));
            }
            rows.push(row);
        }
        this.state.clipboard = rows;
        this.anchor = null;
        this.message = `Copied ${sel.right - sel.left + 1}x${sel.bottom - sel.top + 1}.`;
    }

    // Pastes the clipboard with its top left corner at the cursor; whatever
    // would go off the screen is left out.
    private stamp(): void {
        const clip = this.state.clipboard;
        if (!clip) {
            this.message = 'Nothing copied yet (V, then Y).';
            return;
        }
        this.checkpoint();
        clip.forEach((row, dy) => {
            row.forEach((cell, dx) => {
                const x = this.x + dx;
                const y = this.y + dy;
                if (x <= MAP_WIDTH && y <= MAP_HEIGHT) {
                    this.world.setCell(this.number, x, y, cell);
                }
            });
        });
        this.changed();
    }

    private nextKind(): void {
        const kind = this.world.kind(this.number) ?? 0;
        this.checkpoint();
        const next = at(MAP_KINDS, (MAP_KINDS.indexOf(kind) + 1) % MAP_KINDS.length);
        this.world.setKind(this.number, next);
        this.message = `Kind ${next}: ${KINDS[next].name}${KINDS[next].monsters ? ' (monsters)' : ''}.`;
        this.changed();
    }

    private undo(): void {
        const before = this.undoStack.pop();
        if (!before) {
            this.message = 'Nothing to undo.';
            return;
        }
        this.redoStack.push(this.world.export(this.number));
        this.world.put(before);
        this.changed();
    }

    private redo(): void {
        const after = this.redoStack.pop();
        if (!after) {
            this.message = 'Nothing to redo.';
            return;
        }
        this.undoStack.push(this.world.export(this.number));
        this.world.put(after);
        this.changed();
    }

    // ---- Drawing

    private draw(): void {
        const { screen, world } = this;
        const sel = this.selection();
        const blink = this.state.showTriggers;
        for (let y = 1; y <= MAP_HEIGHT; y++) {
            for (let x = 1; x <= MAP_WIDTH; x++) {
                const c = world.cell(this.number, x, y);
                let ch = c.ch;
                let fg = c.fg;
                let bg = c.bg;
                if (this.state.overlay === 'solid' && c.solid) {
                    bg = 4;
                }
                if (this.state.overlay === 'terrain') {
                    ch = TERRAIN_CODES[c.terrain];
                    [fg, bg] = TERRAIN_LOOK[c.terrain];
                }
                if (sel && x >= sel.left && x <= sel.right && y >= sel.top && y <= sel.bottom) {
                    [fg, bg] = [bg, fg];
                }
                screen.put(x, y, ch, fg, bg, blink && this.triggers.has(`${x},${y}`));
            }
            screen.put(80, y, ' ', 7, 0);
        }
        this.drawStatus();
        screen.cursor = { x: this.x, y: this.y };
    }

    private drawStatus(): void {
        const { screen } = this;
        const kind = this.world.kind(this.number) ?? 0;
        const here = this.world.cell(this.number, this.x, this.y);
        const b = this.state.brush;
        const trigger = this.triggers.has(`${this.x},${this.y}`) ? ' {yellow}trigger' : '';

        screen.fillRow(23, 1);
        draw(screen, `{white}Screen ${this.number} {lightcyan}${KINDS[kind].name}{white}  ${this.x},${this.y}  under cursor: ${describeCell(here)}${trigger}`, { y: 23, bg: 1 });

        // The palette.
        screen.fillRow(PALETTE_ROW, 0);
        screen.text(1, PALETTE_ROW, 'Brush', 7, 0);
        screen.put(BRUSH_X, PALETTE_ROW, b.ch, b.fg, b.bg);
        // (A colour past the 16 shows beside its label.)
        screen.text(FG_LABEL_X, PALETTE_ROW, 'fg', b.fg > 15 ? inkOn(b.fg) : 7, b.fg > 15 ? b.fg : 0);
        for (let c = 0; c < 16; c++) {
            const x = FG_X + c * 2;
            const chosen = c === b.fg;
            screen.put(x, PALETTE_ROW, hex(c), chosen ? 0 : c === 0 ? 8 : c, chosen ? 7 : 0);
            screen.put(x + 1, PALETTE_ROW, '█', c, chosen ? 7 : 0);
        }
        screen.text(BG_LABEL_X, PALETTE_ROW, 'bg', b.bg > 15 ? inkOn(b.bg) : 7, b.bg > 15 ? b.bg : 0);
        for (let c = 0; c < 16; c++) {
            screen.put(BG_X + c, PALETTE_ROW, c === b.bg ? '•' : c === 0 ? '·' : ' ', c === b.bg ? inkOn(c) : 8, c);
        }
        screen.text(HARD_X, PALETTE_ROW, b.solid ? 'HARD' : 'SOFT', b.solid ? 12 : 10, 0);
        const [tfg, tbg] = TERRAIN_LOOK[b.terrain];
        screen.text(TERRAIN_X, PALETTE_ROW, b.terrain.slice(0, 8), tfg, tbg);

        screen.fillRow(25, 0);
        draw(screen, this.message === null ? '{darkgray}? help  Esc back  mouse: left paint, right select, middle pick' : `{yellow}${this.message}`, { y: 25, bg: 0 });
        const flags = [this.pen ? '{lightgreen}PEN' : '', this.anchor ? '{yellow}SEL' : '', this.state.clipboard ? '{gray}CLIP' : ''].filter(Boolean).join(' ');
        if (flags) {
            draw(screen, `{x 68}${flags}`, { y: 25, bg: 0 });
        }
    }

    private async help(): Promise<void> {
        this.screen.clear();
        this.screen.cursor = null;
        SCREEN_HELP.forEach((line, i) => draw(this.screen, line, { x: 3, y: 2 + i }));
        draw(this.screen, '{yellow}Press a key...', { x: 3, y: 4 + SCREEN_HELP.length });
        await this.term.key();
    }
}

// The cells on a straight line from one point to another, after the first
// (so that a fast mouse drag still paints a solid stroke).
export function line(from: { x: number; y: number }, to: { x: number; y: number }): [number, number][] {
    const cells: [number, number][] = [];
    const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
    for (let i = 1; i <= steps; i++) {
        cells.push([Math.round(from.x + ((to.x - from.x) * i) / steps), Math.round(from.y + ((to.y - from.y) * i) / steps)]);
    }
    return steps === 0 ? [[to.x, to.y]] : cells;
}

const nextTerrain = (t: Terrain): Terrain => at(TERRAINS, (TERRAINS.indexOf(t) + 1) % TERRAINS.length);
