import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { PAGES, pickCharacter, pickerCell } from '../src/editor/picker.ts';
import { colorCell } from '../src/editor/color-picker.ts';
import { fitsCell } from '@fq2js/engine/chars';
import { ScreenEditor, line, type EditorState } from '../src/editor/screen-editor.ts';
import { Editor, type SaveResult } from '../src/editor/editor.ts';
import { main as edit } from '../src/edit.ts';
import { contentTriggers, type GameFiles } from '../src/game.ts';
import type { Terminal } from '@fq2js/engine/terminal';
import { bestiary, content, FIXTURE_DATA } from '@fq2js/engine/fixture';
import { World, blankMap, type MapCell } from '@fq2js/engine/world';
import { caught, FakeTerminal, makeMap, makeWorld, mouse, row, screenText, tempDir, typed, type Step } from '@fq2js/engine/testing';

// The edit command, on the fixture's maps (unless told otherwise).
const files: GameFiles = { maps: join(FIXTURE_DATA, 'maps'), triggers: contentTriggers(content), encounterTables: bestiary.tableNames() };
const main = (args: readonly string[], term: Terminal, log: (line: string) => void): Promise<number> => edit(args, files, term, log);

// Steps, or a function that makes them from the terminal they'll run on
// (so a step can look at the screen).
type Steps = readonly Step[] | ((term: FakeTerminal) => readonly Step[]);
const stepsFor = (steps: Steps, term: FakeTerminal): readonly Step[] => (typeof steps === 'function' ? steps(term) : steps);

// ---- The character picker

describe('pickCharacter', () => {
    const at = (page: number, ch: string): number => PAGES[page]?.chars.indexOf(ch) ?? -1;

    test('starts on the current character, shows its page and code point, and Enter picks', async () => {
        const term = new FakeTerminal();
        term.feed(() => {
            expect(term.screen.cursor).toEqual(pickerCell(at(2, '♠')));
            expect(row(term.screen, 3)).toContain('Symbols (3/9)');
            expect(row(term.screen, 20)).toContain('U+2660');
            return 'enter';
        });
        expect(await pickCharacter(term, '♠')).toBe('♠');
        expect(term.screen.cursor).toBeNull();
    });

    test('a character on no page starts at the top of the first', async () => {
        expect(await pickCharacter(new FakeTerminal(['enter']), '€')).toBe('▀');
    });

    test('arrows move around the page, and stop or wrap at its ends', async () => {
        const blocks = PAGES[0]?.chars ?? [];
        expect(await pickCharacter(new FakeTerminal(['right', 'down', 'enter']), '▀')).toBe(blocks[17] ?? '');
        expect(await pickCharacter(new FakeTerminal(['left', 'enter']), '▀')).toBe(blocks.at(-1) ?? '');
        expect(await pickCharacter(new FakeTerminal(['right', 'enter']), blocks.at(-1) ?? '')).toBe('▀');
        expect(await pickCharacter(new FakeTerminal(['up', 'enter']), '▀')).toBe('▀');
        expect(await pickCharacter(new FakeTerminal(['end', 'enter']), '▀')).toBe(blocks[15] ?? '');
        expect(await pickCharacter(new FakeTerminal(['end', 'home', 'enter']), '▀')).toBe('▀');
        expect(await pickCharacter(new FakeTerminal([...Array.from({ length: 20 }, () => 'down'), 'enter']), '▀')).toBe(blocks.at(-1) ?? '');
    });

    test('Page Up and Page Down change pages, wrapping round', async () => {
        expect(await pickCharacter(new FakeTerminal(['pagedown', 'enter']), '▀')).toBe('─');
        expect(await pickCharacter(new FakeTerminal(['pageup', 'enter']), '▀')).toBe('Α');
    });

    test('a shorter page keeps the selection on it', async () => {
        const greek = PAGES[8]?.chars ?? [];
        // From the last cell of Maths (256) to Letters (188 characters).
        expect(await pickCharacter(new FakeTerminal(['end', 'pagedown', 'enter']), '∀')).toBe(PAGES[7]?.chars[15] ?? '');
        expect(greek.length).toBeLessThan(256);
    });

    test('typing a character picks it (in NFC), if it fits a cell', async () => {
        expect(await pickCharacter(new FakeTerminal(['ж']), ' ')).toBe('ж');
        expect(await pickCharacter(new FakeTerminal(['😀', 'escape']), ' ')).toBeNull();
    });

    test('Tab takes a code point', async () => {
        expect(await pickCharacter(new FakeTerminal(['tab', ...typed('2603')]), ' ')).toBe('☃');
        expect(await pickCharacter(new FakeTerminal(['tab', ...typed('03bb')]), ' ')).toBe('λ');
    });

    test('a code point that does not fit a cell, or is no code point, is refused', async () => {
        const term = new FakeTerminal();
        term.feed('tab', ...typed('1F600'), () => {
            expect(row(term.screen, 20)).toContain("That doesn't fit in one cell.");
            return 'tab';
        }, ...typed('110000'), 'tab', 'escape', 'tab', 'x', 'enter', 'escape');
        expect(await pickCharacter(term, ' ')).toBeNull();
        expect(term.remaining).toBe(0);
    });

    test('Escape cancels', async () => {
        expect(await pickCharacter(new FakeTerminal(['escape']), 'x')).toBeNull();
    });

    test('clicking a character picks it', async () => {
        const { x, y } = pickerCell(at(1, '╬'));
        expect(await pickCharacter(new FakeTerminal(['pagedown', mouse(x, y)]), '▀')).toBe('╬');
    });

    test('clicking outside the box cancels; other clicks and mouse input are ignored', async () => {
        expect(await pickCharacter(new FakeTerminal([mouse(1, 1)]), ' ')).toBeNull();
        const title = { x: pickerCell(0).x, y: pickerCell(0).y - 1 };
        const between = { x: pickerCell(0).x + 1, y: pickerCell(0).y };
        const empty = pickerCell(255);
        const steps = [mouse(title.x, title.y), mouse(between.x, between.y), mouse(empty.x, empty.y), mouse(pickerCell(5).x, pickerCell(5).y, { action: 'release', button: 'none' }), 'enter'];
        expect(await pickCharacter(new FakeTerminal(steps), '☺')).toBe('☺');
    });

    test('every page holds only characters that fit a cell, and none twice', () => {
        const all = PAGES.flatMap((p) => p.chars);
        expect(new Set(all).size).toBe(all.length);
        for (const page of PAGES) {
            expect(page.chars.length).toBeGreaterThan(0);
            expect(page.chars.length).toBeLessThanOrEqual(256);
            for (const ch of page.chars) {
                expect(fitsCell(ch)).toBe(true);
            }
        }
    });

});

// ---- Editing a screen

function state(changes: Partial<EditorState> = {}): EditorState {
    return { brush: { ch: '#', fg: 14, bg: 4, solid: true, terrain: 'grass' }, clipboard: null, overlay: 'none', showTriggers: true, ...changes };
}

interface Setup {
    world?: World;
    state?: EditorState;
    triggers?: ReadonlySet<string>;
}

// Edits screen 1 (blank land unless given a world) with `steps`, then Escape.
async function editScreen(steps: Steps, { world = makeWorld(makeMap(1, 1)), state: s = state(), triggers = new Set<string>() }: Setup = {}) {
    const term = new FakeTerminal();
    term.feed(...stepsFor(steps, term), 'escape');
    let changes = 0;
    const editor = new ScreenEditor({ term, world, screen: 1, state: s, triggers, changed: () => changes++ });
    await editor.run();
    expect(term.remaining).toBe(0);
    return { world, term, state: s, changes: () => changes };
}

const blank: MapCell = { ch: ' ', fg: 15, bg: 2, solid: false, terrain: 'grass' };
const brush: MapCell = { ch: '#', fg: 14, bg: 4, solid: true, terrain: 'grass' };

describe('ScreenEditor', () => {
    test('Space and Enter paint the brush; painting the same again changes nothing', async () => {
        const { world, changes } = await editScreen([' ', 'right', 'enter', 'enter']);
        expect(world.cell(1, 1, 1)).toEqual(brush);
        expect(world.cell(1, 2, 1)).toEqual(brush);
        expect(world.cell(1, 3, 1)).toEqual(blank);
        expect(changes()).toBe(2);
    });

    test('the cursor stays on the map', async () => {
        const { world } = await editScreen(['left', 'up', ' ', 'end', 'pagedown', 'right', 'down', ' ', 'home', ' ', 'pageup', 'end', ' ']);
        expect(world.cell(1, 1, 1)).toEqual(brush);
        expect(world.cell(1, 79, 22)).toEqual(brush);
        expect(world.cell(1, 1, 22)).toEqual(brush);
        expect(world.cell(1, 79, 1)).toEqual(brush);
    });

    test('the pen paints as the cursor moves', async () => {
        const { world } = await editScreen(['p', 'right', 'right', 'P', 'right']);
        expect([1, 2, 3, 4].map((x) => world.cell(1, x, 1).ch)).toEqual(['#', '#', '#', ' ']);
    });

    test('C picks the brush character, and Escape keeps the old one', async () => {
        const { state: s } = await editScreen(['c', '~', 'c', 'escape']);
        expect(s.brush.ch).toBe('~');
    });

    test('E takes the brush from the cell under the cursor', async () => {
        const world = makeWorld(makeMap(1, 1, ['2,1']));
        const { state: s } = await editScreen(
            (term) => [
                'right',
                'e',
                () => {
                    expect(row(term.screen, 25)).toBe('Took the brush from this cell.');
                    return 'x';
                },
            ],
            { world },
        );
        expect(s.brush).toEqual({ ch: ' ', fg: 15, bg: 2, solid: true, terrain: 'grass' });
    });

    test('F/f and B/b cycle the colours, H toggles hard', async () => {
        const { state: s } = await editScreen(['F', 'F', 'B', 'B', 'B', 'B', 'h']);
        expect(s.brush).toMatchObject({ fg: 0, bg: 8, solid: false });
        const back = await editScreen(['f', 'b'], { state: state({ brush: { ch: ' ', fg: 0, bg: 0, solid: false, terrain: 'grass' } }) });
        expect(back.state.brush).toMatchObject({ fg: 15, bg: 15 });
        // From one of the 256, back among the 16.
        const from256 = await editScreen(['F', 'b'], { state: state({ brush: { ch: ' ', fg: 208, bg: 17, solid: false, terrain: 'grass' } }) });
        expect(from256.state.brush).toMatchObject({ fg: 1, bg: 0 });
    });

    test('A picks from all 256 colours: Tab for the background', async () => {
        const { state: s } = await editScreen((term) => [
            'a',
            () => {
                expect(row(term.screen, 3)).toContain('Foreground colour');
                return 'right';
            },
            'enter',
            'a',
            'tab',
            'down',
            'down',
            () => {
                expect(row(term.screen, 3)).toContain('Background colour');
                expect(term.screen.cell(colorCell(36).x, colorCell(36).y)).toMatchObject({ ch: '<', bg: 36 });
                return 'enter';
            },
            'a',
            'escape',
        ]);
        expect(s.brush).toMatchObject({ fg: 15, bg: 36 });
    });

    describe('selections', () => {
        test('V then Space fills the selected rectangle', async () => {
            const { world } = await editScreen(['right', 'v', 'right', 'right', 'down', ' ', 'down', ' ']);
            for (const [x, y] of [[2, 1], [4, 1], [2, 2], [4, 2]] as const) {
                expect(world.cell(1, x, y)).toEqual(brush);
            }
            expect(world.cell(1, 1, 1)).toEqual(blank);
            expect(world.cell(1, 5, 2)).toEqual(blank);
            expect(world.cell(1, 4, 3)).toEqual(brush);
        });

        test('selecting backwards works too', async () => {
            const { world } = await editScreen(['right', 'right', 'down', 'v', 'left', 'left', 'up', ' ']);
            expect(world.cell(1, 1, 1)).toEqual(brush);
            expect(world.cell(1, 3, 2)).toEqual(brush);
        });

        test('Escape or V cancels a selection without leaving', async () => {
            const { world } = await editScreen(['v', 'right', 'escape', ' ', 'v', 'right', 'v', ' ']);
            expect(world.cell(1, 1, 1)).toEqual(blank);
            expect(world.cell(1, 2, 1)).toEqual(brush);
            expect(world.cell(1, 3, 1)).toEqual(brush);
        });

        test('the selection is shown with its colours swapped', async () => {
            await editScreen((term) => [
                'v',
                'right',
                () => {
                    expect(term.screen.cell(1, 1)).toMatchObject({ fg: 2, bg: 15 });
                    expect(term.screen.cell(3, 1)).toMatchObject({ fg: 15, bg: 2 });
                    return 'escape';
                },
            ]);
        });
    });

    test('Y copies a selection and S stamps it, clipped at the edges', async () => {
        const world = makeWorld(makeMap(1, 1, ['1,1']));
        world.setCell(1, 2, 1, brush);
        // Copy the 2x2 at the top left, stamp it at 79,2 (one column fits) and
        // at 1,22 (one row fits).
        const { state: s } = await editScreen(['v', 'right', 'down', 'y', 'end', 's', 'pagedown', 'home', 's'], { world });
        expect(s.clipboard).toHaveLength(2);
        expect(world.cell(1, 79, 2)).toEqual({ ...blank, solid: true });
        expect(world.cell(1, 79, 3)).toEqual(blank);
        expect(world.cell(1, 1, 22)).toEqual({ ...blank, solid: true });
        expect(world.cell(1, 2, 22)).toEqual(brush);
    });

    test("Y and S say what's missing", async () => {
        await editScreen((term) => [
            'y',
            () => {
                expect(row(term.screen, 25)).toBe('Select something first (V).');
                return 's';
            },
            () => {
                expect(row(term.screen, 25)).toBe('Nothing copied yet (V, then Y).');
                return 'x';
            },
        ]);
    });

    test('U undoes and R redoes, and a new change clears the redo', async () => {
        const { world } = await editScreen((term) => [
            ' ',
            'right',
            ' ',
            'u',
            'u',
            'u',
            () => {
                expect(row(term.screen, 25)).toBe('Nothing to undo.');
                return 'r';
            },
            'right',
            ' ',
            'R',
            () => {
                expect(row(term.screen, 25)).toBe('Nothing to redo.');
                return 'x';
            },
        ]);
        expect(world.cell(1, 1, 1)).toEqual(brush);
        expect(world.cell(1, 2, 1)).toEqual(blank);
        expect(world.cell(1, 3, 1)).toEqual(brush);
    });

    test('undo also covers fills and kind changes', async () => {
        const { world } = await editScreen(['v', 'right', ' ', 'u', 'k', 'u']);
        expect(world.cell(1, 1, 1)).toEqual(blank);
        expect(world.kind(1)).toBe(1);
    });

    test('undo keeps the last 200 changes', async () => {
        const steps = Array.from({ length: 205 }, (_, i): Step[] => [i % 2 ? 'F' : 'f', ' ']).flat();
        const { world } = await editScreen([...steps, ...Array.from({ length: 205 }, () => 'u')]);
        // The first five changes can't be undone any more.
        expect(world.cell(1, 1, 1).fg).not.toBe(15);
    });

    test('K cycles the kind and wraps around', async () => {
        const world = makeWorld(makeMap(1, 8));
        await editScreen(
            (term) => [
                'k',
                () => {
                    expect(row(term.screen, 25)).toBe('Kind 0: water.');
                    return 'k';
                },
                'k',
                'k',
                'k',
                'k',
                () => {
                    expect(row(term.screen, 25)).toBe('Kind 5: land (monsters).');
                    return 'x';
                },
            ],
            { world },
        );
        expect(world.kind(1)).toBe(5);
    });

    test('O shows solid cells in red', async () => {
        const world = makeWorld(makeMap(1, 1, ['1,1']));
        const { state: s } = await editScreen(
            (term) => [
                'o',
                () => {
                    expect(term.screen.cell(1, 1).bg).toBe(4);
                    expect(term.screen.cell(2, 1).bg).toBe(2);
                    return 'x';
                },
            ],
            { world },
        );
        expect(s.overlay).toBe('solid');
    });

    test('O again shows terrain as letters, and once more turns it off', async () => {
        const world = makeWorld(makeMap(1, 1));
        world.setCell(1, 2, 1, { ch: '♠', fg: 10, bg: 2, solid: true, terrain: 'forest' });
        const { state: s } = await editScreen(
            (term) => [
                'o',
                'o',
                () => {
                    expect(term.screen.cell(1, 1)).toMatchObject({ ch: '.', fg: 10, bg: 2 });
                    expect(term.screen.cell(2, 1)).toMatchObject({ ch: 'f', fg: 15, bg: 2 });
                    return 'o';
                },
                () => {
                    expect(term.screen.cell(2, 1).ch).toBe('♠');
                    return 'x';
                },
            ],
            { world },
        );
        expect(s.overlay).toBe('none');
    });

    test("G cycles the brush's terrain, and painting sets it", async () => {
        const { world, state: s } = await editScreen(['g', 'g', ' ']);
        expect(s.brush.terrain).toBe('mountain');
        expect(world.terrain(1, 1, 1)).toBe('mountain');
    });

    test("the palette's terrain button cycles it too, wrapping round", async () => {
        const { state: s } = await editScreen([mouse(73, 24)], { state: state({ brush: { ...brush, terrain: 'structure' } }) });
        expect(s.brush.terrain).toBe('grass');
    });

    test('trigger tiles blink until T turns that off', async () => {
        const { state: s } = await editScreen(
            (term) => [
                () => {
                    expect(term.screen.cell(3, 2).blink).toBe(true);
                    expect(term.screen.cell(4, 2).blink).toBe(false);
                    return 't';
                },
                () => {
                    expect(term.screen.cell(3, 2).blink).toBe(false);
                    return 'x';
                },
            ],
            { triggers: new Set(['3,2']) },
        );
        expect(s.showTriggers).toBe(false);
    });

    test('the status lines describe the screen, the cell and the brush', async () => {
        const world = makeWorld(makeMap(1, 6));
        const { term } = await editScreen(
            (t) => [
                'right',
                'down',
                'p',
                'v',
                () => {
                    expect(row(t.screen, 23)).toBe('Screen 1 small town  2,2  under cursor: fg E bg 4 hard grass trigger');
                    expect(row(t.screen, 24)).toBe('Brush #  fg 0█1█2█3█4█5█6█7█8█9█A█B█C█D█E█F█ bg ·   •             HARD grass');
                    expect(t.screen.cell(41, 24)).toMatchObject({ ch: 'E', fg: 0, bg: 7 });
                    expect(t.screen.cell(53, 24)).toMatchObject({ ch: '•', bg: 4 });
                    expect(row(t.screen, 25)).toStartWith('? help');
                    expect(row(t.screen, 25)).toEndWith('PEN SEL CLIP');
                    expect(t.screen.cursor).toEqual({ x: 2, y: 2 });
                    return 'escape';
                },
                'p',
            ],
            { world, triggers: new Set(['2,2']), state: state({ clipboard: [[blank]] }) },
        );
        expect(term.screen.cursor).toBeNull();
    });

    test('? shows the keys', async () => {
        await editScreen((term) => [
            '?',
            () => {
                expect(screenText(term.screen)).toContain('Editing a screen');
                return 'x';
            },
        ]);
    });
});

// ---- The overview

interface EditorSetup {
    world?: World;
    triggers?: ReadonlyMap<number, ReadonlySet<string>>;
}

function overview({ world = makeWorld(makeMap(1, 1), makeMap(2, 2), makeMap(82, 5)), triggers }: EditorSetup = {}) {
    const term = new FakeTerminal();
    const saves: World[] = [];
    const result: SaveResult = { written: ['0001.json'], deleted: [] };
    const editor = new Editor({
        term,
        world,
        ...(triggers ? { triggers } : {}),
        save: (w) => {
            saves.push(w);
            return result;
        },
    });
    return { editor, term, world, saves, result };
}

// Runs the overview with `steps`, checking they all get used.
async function runOverview(steps: Steps, setup: EditorSetup = {}) {
    const o = overview(setup);
    o.term.feed(...stepsFor(steps, o.term));
    await o.editor.run();
    expect(o.term.remaining).toBe(0);
    return o;
}

describe('Editor overview', () => {
    test('shows every screen by kind, starting on the first one', async () => {
        const { term } = await runOverview((t) => [
            () => {
                const s = t.screen;
                expect(s.cell(1, 1)).toMatchObject({ ch: ' ', bg: 2 });
                expect(s.cell(2, 1)).toMatchObject({ ch: '▪', fg: 13 });
                expect(s.cell(3, 1)).toMatchObject({ ch: '·', fg: 8 });
                expect(s.cell(2, 2)).toMatchObject({ ch: '∙', bg: 2 });
                expect(row(s, 25)).toContain('Screen 1 land');
                expect(s.cursor).toEqual({ x: 1, y: 1 });
                return 'q';
            },
        ]);
        expect(screenText(term.screen).trim()).toBe('');
        expect(term.screen.cursor).toBeNull();
    });

    test('the status line fits, even for the longest screen description', async () => {
        await runOverview(
            (t) => [
                'k',
                'x',
                () => {
                    expect(row(t.screen, 25)).toStartWith('Screen 1 small town monsters *');
                    expect(row(t.screen, 25)).toEndWith('? help');
                    return 'q';
                },
                'n',
            ],
            { world: makeWorld(makeMap(1, 5)) },
        );
    });

    test('the character picker leaves the status lines visible', async () => {
        await runOverview((t) => [
            'enter',
            'c',
            () => {
                expect(row(t.screen, 23)).toStartWith('Screen 1 land');
                return 'escape';
            },
            'escape',
            'q',
        ]);
    });

    test('an empty world starts on screen 1', async () => {
        await runOverview(
            (t) => [
                () => {
                    expect(row(t.screen, 25)).toContain('Screen 1 empty');
                    return 'q';
                },
            ],
            { world: makeWorld() },
        );
    });

    test('arrows, Home/End and PgUp/PgDn move around the grid and stop at its edges', async () => {
        await runOverview((t) => {
            const on = (text: string): Step => () => {
                expect(row(t.screen, 25)).toContain(text);
                return 'x';
            };
            return ['up', 'left', on('Screen 1 '), 'end', 'right', on('Screen 80 '), 'pagedown', 'down', on('Screen 1920 '), 'home', on('Screen 1841 '), 'pageup', on('Screen 1 '), 'right', 'down', on('Screen 82 land monsters'), 'q'];
        });
    });

    test('Enter edits an existing screen', async () => {
        const { world, editor } = await runOverview([' ', 'enter', ' ', 'escape', 'q', 'n']);
        expect(world.cell(1, 1, 1).ch).toBe('♠');
        expect(editor.hasUnsavedChanges).toBe(true);
    });

    test('Enter on an empty spot creates a screen of a chosen kind, then edits it', async () => {
        const { world } = await runOverview(['right', 'right', 'enter', 'down', 'down', 'enter', 'escape', 'q', 'n']);
        expect(world.kind(3)).toBe(2);
        expect(world.cell(3, 1, 1)).toEqual({ ch: ' ', fg: 15, bg: 0, solid: false, terrain: 'floor' });
    });

    test('Escape in the kind menu creates nothing', async () => {
        const { world } = await runOverview(['right', 'right', 'enter', 'escape', 'q']);
        expect(world.has(3)).toBe(false);
    });

    test('N creates a screen, but not over an existing one', async () => {
        const { world } = await runOverview((t) => [
            'n',
            () => {
                expect(row(t.screen, 25)).toBe('Screen 1 already exists.');
                return 'right';
            },
            'right',
            'N',
            'enter',
            () => {
                expect(row(t.screen, 25)).toBe('Created screen 3.');
                return 'q';
            },
            'n',
        ]);
        expect(world.kind(3)).toBe(0);
        expect(world.isSolid(3, 1, 1)).toBe(true);
    });

    test('C copies and V pastes onto an empty spot', async () => {
        const { world } = await runOverview(['c', 'right', 'right', 'v', 'q', 'n']);
        expect(world.kind(3)).toBe(1);
    });

    test('pasting over a screen asks first', async () => {
        const no = await runOverview(['c', 'right', 'v', 'n', 'q']);
        expect(no.world.kind(2)).toBe(2);
        const yes = await runOverview(['c', 'right', 'v', 'y', 'q', 'n']);
        expect(yes.world.kind(2)).toBe(1);
    });

    test('V with nothing copied, and C on an empty spot', async () => {
        await runOverview((t) => [
            'v',
            () => {
                expect(row(t.screen, 25)).toBe('Copy a screen first (C).');
                return 'right';
            },
            'right',
            'c',
            'v',
            () => {
                expect(row(t.screen, 25)).toBe('Copy a screen first (C).');
                return 'q';
            },
        ]);
    });

    test('D deletes after asking, mentioning scripts', async () => {
        const { world } = await runOverview(
            (t) => [
                'd',
                () => {
                    expect(row(t.screen, 25)).toBe('Delete screen 1 (the game has scripts on it)? (Y/N)');
                    return 'n';
                },
                'd',
                'y',
                'right',
                'right',
                'd',
                'q',
                'n',
            ],
            { world: makeWorld(makeMap(1, 1), makeMap(2, 2), makeMap(82, 5)), triggers: new Map([[1, new Set(['1,1'])]]) },
        );
        expect(world.screens()).toEqual([2, 82]);
    });

    test("K cycles a screen's kind; empty spots have none", async () => {
        const { world } = await runOverview(['k', 'k', 'right', 'right', 'k', 'q', 'n']);
        expect(world.kind(1)).toBe(3);
        expect(world.has(3)).toBe(false);
    });

    test('S saves and reports what was written', async () => {
        const o = await runOverview((t) => [
            's',
            () => {
                expect(row(t.screen, 25)).toBe('Saved: 1 written, 0 deleted.');
                return 'q';
            },
        ]);
        expect(o.saves).toHaveLength(1);

        const quiet = overview();
        quiet.result.written.length = 0;
        quiet.term.feed('S', () => {
            expect(row(quiet.term.screen, 25)).toBe('Saved: nothing had changed.');
            return 'q';
        });
        await quiet.editor.run();
    });

    describe('quitting with unsaved changes', () => {
        test('Y saves first', async () => {
            const o = await runOverview((t) => [
                'k',
                'q',
                () => {
                    expect(row(t.screen, 25)).toBe('Save changes before quitting? (Y/N, Esc stays)');
                    return 'x';
                },
                'y',
            ]);
            expect(o.saves).toHaveLength(1);
            expect(o.editor.hasUnsavedChanges).toBe(false);
        });

        test('N quits without saving', async () => {
            const o = await runOverview(['k', 'escape', 'n']);
            expect(o.saves).toHaveLength(0);
            expect(o.editor.hasUnsavedChanges).toBe(true);
        });

        test('Escape stays in the editor', async () => {
            const o = await runOverview(['k', 'q', 'escape', 's', 'q']);
            expect(o.saves).toHaveLength(1);
        });

        test('the status line marks unsaved changes', async () => {
            await runOverview((t) => [
                'k',
                'x',
                () => {
                    expect(row(t.screen, 25)).toContain('Screen 1 interior *');
                    return 'q';
                },
                'n',
            ]);
        });
    });

    test('? shows the keys', async () => {
        await runOverview((t) => [
            '?',
            () => {
                expect(screenText(t.screen)).toContain('The world overview');
                return 'x';
            },
            'q',
        ]);
    });
});

// ---- The command

describe('the edit command', () => {
    test('--help', async () => {
        const lines: string[] = [];
        expect(await main(['-h'], new FakeTerminal(), (l) => lines.push(l))).toBe(0);
        expect(lines[0]).toContain('Usage: edit [options]');
    });

    test('edits and saves a map folder', async () => {
        const dir = tempDir();
        makeWorld(makeMap(1, 1)).save(dir);
        const lines: string[] = [];
        expect(await main(['--maps', dir], new FakeTerminal(['k', 's', 'q']), (l) => lines.push(l))).toBe(0);
        expect(World.load(dir).kind(1)).toBe(2);
        expect(lines).toEqual([`Saved changes to ${dir}`]);
    });

    test('quitting without changes saves nothing', async () => {
        const dir = tempDir();
        makeWorld(blankMap(5, 1)).save(dir);
        const lines: string[] = [];
        await main(['-m', dir], new FakeTerminal(['q']), (l) => lines.push(l));
        expect(lines).toEqual(['No changes saved.']);
    });

    test('the terminal is restored even if the editor fails', async () => {
        const dir = tempDir();
        makeWorld(makeMap(1, 1)).save(dir);
        const term = new FakeTerminal([]);
        let stopped = false;
        term.stop = () => {
            stopped = true;
        };
        expect(await caught(main(['-m', dir], term, () => undefined))).toEqual(new Error('The test ran out of keys.'));
        expect(stopped).toBe(true);
    });
});

// ---- The mouse

describe('ScreenEditor with the mouse', () => {
    test('a left click paints and moves the cursor', async () => {
        const { world, term } = await editScreen([mouse(5, 6), mouse(5, 6, { action: 'release', button: 'none' })]);
        expect(world.cell(1, 5, 6)).toEqual(brush);
        expect(world.cell(1, 1, 1)).toEqual(blank);
        expect(term.screen.cursor).toBeNull();
    });

    test('dragging paints a solid stroke, which undoes in one go', async () => {
        const { world } = await editScreen([
            mouse(2, 2),
            mouse(6, 2, { action: 'drag' }),
            mouse(6, 4, { action: 'drag' }),
            mouse(6, 4, { action: 'release', button: 'none' }),
            mouse(10, 10),
            mouse(10, 10, { action: 'release', button: 'none' }),
            'u',
        ]);
        for (let x = 2; x <= 6; x++) {
            expect(world.cell(1, x, 2)).toEqual(brush);
        }
        expect(world.cell(1, 6, 3)).toEqual(brush);
        expect(world.cell(1, 6, 4)).toEqual(brush);
        expect(world.cell(1, 10, 10)).toEqual(blank);
    });

    test('undo takes back a whole stroke', async () => {
        const { world } = await editScreen([mouse(2, 2), mouse(4, 2, { action: 'drag' }), mouse(4, 2, { action: 'release', button: 'none' }), 'u']);
        for (let x = 2; x <= 4; x++) {
            expect(world.cell(1, x, 2)).toEqual(blank);
        }
    });

    test('dragging off the map, or without a button held, paints nothing', async () => {
        const { world } = await editScreen([
            mouse(3, 3, { action: 'drag' }),
            mouse(78, 3),
            mouse(80, 3, { action: 'drag' }),
            mouse(78, 23, { action: 'drag' }),
            mouse(78, 3, { action: 'release', button: 'none' }),
        ]);
        expect(world.cell(1, 3, 3)).toEqual(blank);
        expect(world.cell(1, 78, 3)).toEqual(brush);
        expect(world.cell(1, 79, 3)).toEqual(blank);
    });

    test('right-dragging selects, for the keys to fill or copy', async () => {
        const { world } = await editScreen([
            mouse(3, 3, { button: 'right' }),
            mouse(5, 4, { action: 'drag' }),
            mouse(90, 30, { action: 'drag' }),
            mouse(5, 4, { action: 'drag' }),
            mouse(5, 4, { action: 'release', button: 'none' }),
            ' ',
        ]);
        expect(world.cell(1, 3, 3)).toEqual(brush);
        expect(world.cell(1, 5, 4)).toEqual(brush);
        expect(world.cell(1, 6, 4)).toEqual(blank);
    });

    test('a left click cancels a selection', async () => {
        const { world } = await editScreen([mouse(3, 3, { button: 'right' }), mouse(5, 4, { action: 'drag' }), mouse(9, 9), ' ']);
        expect(world.cell(1, 3, 3)).toEqual(blank);
        expect(world.cell(1, 9, 9)).toEqual(brush);
    });

    test('a middle click takes the brush from a cell', async () => {
        const world = makeWorld(makeMap(1, 1, ['4,4']));
        const { state: s } = await editScreen([mouse(4, 4, { button: 'middle' })], { world });
        expect(s.brush).toEqual({ ...blank, solid: true });
    });

    test('the palette: brush character, colours and hard/soft', async () => {
        const { state: s } = await editScreen([mouse(7, 24), '~', mouse(13, 24), mouse(16, 24), mouse(49, 24), mouse(63, 24), mouse(68, 24), mouse(3, 24), mouse(48, 24)]);
        expect(s.brush).toEqual({ ch: '~', fg: 1, bg: 14, solid: false, terrain: 'grass' });
    });

    test('clicking fg or bg opens all 256 colours, to click one', async () => {
        const at = (c: number) => mouse(colorCell(c).x + 1, colorCell(c).y);
        const { state: s } = await editScreen((term) => [
            mouse(10, 24),
            at(208),
            mouse(47, 24),
            at(17),
            () => {
                // The label shows a colour past the 16.
                expect(term.screen.cell(46, 24)).toMatchObject({ ch: 'b', bg: 17 });
                return mouse(46, 24);
            },
            mouse(1, 1),
        ]);
        expect(s.brush).toMatchObject({ fg: 208, bg: 17 });
    });

    test('the wheel, releases and clicks below the map do nothing', async () => {
        const { world, state: s } = await editScreen([mouse(5, 5, { action: 'wheel', button: 'up' }), mouse(5, 25), mouse(5, 23), mouse(5, 5, { action: 'release', button: 'none' })]);
        expect(world.cell(1, 5, 5)).toEqual(blank);
        expect(s.brush).toEqual(brush);
    });
});

test('line fills in the cells between two points', () => {
    expect(line({ x: 1, y: 1 }, { x: 4, y: 1 })).toEqual([[2, 1], [3, 1], [4, 1]]);
    expect(line({ x: 1, y: 1 }, { x: 3, y: 3 })).toEqual([[2, 2], [3, 3]]);
    expect(line({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual([[5, 5]]);
});

describe('Editor overview with the mouse', () => {
    test('clicking a screen selects it, and clicking it again opens it', async () => {
        const { world } = await runOverview((t) => [
            mouse(2, 2),
            () => {
                expect(row(t.screen, 25)).toContain('Screen 82 ');
                return mouse(2, 2);
            },
            ' ',
            'escape',
            'q',
            'n',
        ]);
        expect(world.cell(82, 1, 1).ch).toBe('♠');
    });

    test('clicking an empty spot twice offers to create a screen, and a click picks the kind', async () => {
        const { world } = await runOverview([mouse(5, 1), mouse(5, 1), mouse(30, 10), 'escape', 'q', 'n']);
        expect(world.kind(5)).toBe(2);
    });

    test('other clicks do nothing', async () => {
        const { world } = await runOverview([mouse(1, 25), mouse(2, 1, { button: 'right' }), mouse(1, 1, { action: 'release', button: 'none' }), mouse(1, 1), mouse(1, 1, { action: 'wheel', button: 'down' }), 'escape', 'q']);
        expect(world.screens()).toEqual([1, 2, 82]);
    });
});

test('the edit command turns the mouse on, and off again', async () => {
    const dir = tempDir();
    makeWorld(makeMap(1, 1)).save(dir);
    const term = new FakeTerminal(['q']);
    await main(['-m', dir], term, () => undefined);
    expect(term.out.written).toContain('\x1b[?1006h');
    expect(term.out.written).toContain('\x1b[?1006l');
});

test('P marks a screen safe from fights between players, or not; interiors always are', async () => {
    const world = makeWorld(makeMap(1, 1), makeMap(2, 2));
    const term = new FakeTerminal();
    const editor = new Editor({ term, world, save: () => ({ written: [], deleted: [] }) });
    term.feed(
        'p',
        () => {
            expect(row(term.screen, 25)).toBe("Screen 1 is safe: players can't fight each other there.");
            return 'x';
        },
        () => {
            expect(row(term.screen, 25)).toContain('Screen 1 land safe *');
            return 'p';
        },
        () => {
            expect(row(term.screen, 25)).toBe('Players can fight each other on screen 1 now.');
            return 'right';
        },
        'p',
        () => {
            expect(row(term.screen, 25)).toBe('Interiors are always safe from fights between players.');
            return 'q';
        },
        'n',
    );
    await editor.run();
    expect(world.isSafe(1)).toBe(false);
});

describe('encounter tables in the overview', () => {
    test("E cycles a screen's table, and the status line shows it", async () => {
        const world = makeWorld(makeMap(1, 5));
        const term = new FakeTerminal();
        const editor = new Editor({ term, world, encounterTables: ['default', 'forest', 'swamp'], save: () => ({ written: [], deleted: [] }) });
        term.feed(
            'e',
            () => {
                expect(row(term.screen, 25)).toBe('Screen 1\'s monsters now come from the "forest" table.');
                return 'x';
            },
            () => {
                expect(row(term.screen, 25)).toContain('Screen 1 land monsters: forest *');
                return 'e';
            },
            'e',
            () => {
                expect(row(term.screen, 25)).toBe('Screen 1\'s monsters now come from the "default" table.');
                return 'q';
            },
            'n',
        );
        await editor.run();
        expect(world.encounters(1)).toBeUndefined();
    });

    test('E does nothing on an empty spot, and with only the default table', async () => {
        const world = makeWorld(makeMap(1, 5));
        const term = new FakeTerminal(['right', 'e', 'left', 'e', 'q', 'n']);
        await new Editor({ term, world, save: () => ({ written: [], deleted: [] }) }).run();
        expect(world.encounters(1)).toBeUndefined();
        expect(world.has(2)).toBe(false);
    });
});

describe('naming screens in the overview', () => {
    test('A names the screen, and the status line shows it', async () => {
        const world = makeWorld(makeMap(1, 1));
        const term = new FakeTerminal();
        const editor = new Editor({ term, world, save: () => ({ written: [], deleted: [] }) });
        term.feed(
            'a',
            ...typed('Frog Pond'),
            () => {
                expect(row(term.screen, 25)).toBe('Screen 1 is now called "Frog Pond".');
                return 'x';
            },
            () => {
                expect(row(term.screen, 25)).toStartWith('Screen 1 Frog Pond, land *');
                return 'a';
            },
            ...Array.from({ length: 9 }, () => 'backspace'),
            'enter',
            () => {
                expect(row(term.screen, 25)).toBe('Screen 1 has no name now.');
                return 'q';
            },
            'n',
        );
        await editor.run();
        expect(world.name(1)).toBe('');
    });

    test("keeping the same name changes nothing, and empty spots can't be named", async () => {
        const world = makeWorld(makeMap(1, 1));
        world.setName(1, 'Home');
        const term = new FakeTerminal(['a', 'enter', 'right', 'a', 'q']);
        const editor = new Editor({ term, world, save: () => ({ written: [], deleted: [] }) });
        await editor.run();
        expect(editor.hasUnsavedChanges).toBe(false);
    });

    test('a long name drops the key hints rather than overflowing', async () => {
        const world = makeWorld(makeMap(1, 5));
        world.setName(1, 'The Very Long Name Of This Place');
        const term = new FakeTerminal();
        term.feed(() => {
            expect(row(term.screen, 25)).toBe('Screen 1 The Very Long Name Of This Place, land monsters');
            return 'q';
        });
        await new Editor({ term, world, save: () => ({ written: [], deleted: [] }) }).run();
    });
});
