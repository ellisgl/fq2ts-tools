// The character picker: all 256 CP437 characters in a 16x16 grid.

import { at } from '../../engine/assert.ts';
import { cp437 } from '../../engine/cp437.ts';
import { isMouse, type Terminal } from '../../engine/terminal.ts';

const LEFT = 23;
const TOP = 2;

// Where character `i` is drawn.
export const pickerCell = (i: number): { x: number; y: number } => ({ x: LEFT + 2 + (i % 16) * 2, y: TOP + 2 + Math.floor(i / 16) });

// Lets the user pick a character with the arrows and Enter, by clicking it,
// or by typing it. Returns null on Escape or a click outside the box.
export async function pickCharacter(term: Terminal, current: string): Promise<string | null> {
    const { screen } = term;
    let selected = Math.max(0, cp437.indexOf(current));

    screen.text(LEFT, TOP, '┌' + '─'.repeat(33) + '┐', 15, 1);
    screen.text(LEFT, TOP + 1, '│' + ' Pick a character (or type one)  '.padEnd(33) + '│', 15, 1);
    for (let row = 0; row < 16; row++) {
        screen.text(LEFT, TOP + 2 + row, '│' + ' '.repeat(33) + '│', 15, 1);
    }
    screen.text(LEFT, TOP + 18, '│' + ' '.repeat(33) + '│', 15, 1);
    screen.text(LEFT, TOP + 19, '└' + '─'.repeat(33) + '┘', 15, 1);

    for (;;) {
        for (let i = 0; i < 256; i++) {
            const { x, y } = pickerCell(i);
            screen.put(x, y, at(cp437, i), i === selected ? 0 : 15, i === selected ? 7 : 1);
        }
        screen.text(LEFT + 2, TOP + 18, `Code ${String(selected).padStart(3)}  hex ${selected.toString(16).toUpperCase().padStart(2, '0')}`.padEnd(31), 14, 1);
        screen.cursor = pickerCell(selected);
        const key = await term.event();
        screen.cursor = null;
        if (isMouse(key)) {
            if (key.action !== 'press') {
                continue;
            }
            const col = (key.x - LEFT - 2) / 2;
            const row = key.y - TOP - 2;
            if (Number.isInteger(col) && col >= 0 && col < 16 && row >= 0 && row < 16) {
                return at(cp437, row * 16 + col);
            }
            if (key.x < LEFT || key.x > LEFT + 34 || key.y < TOP || key.y > TOP + 19) {
                return null;
            }
            continue;
        }
        if (key === 'enter') {
            return at(cp437, selected);
        }
        if (key === 'escape') {
            return null;
        }
        if (key === 'left') {
            selected = (selected + 255) % 256;
        } else if (key === 'right') {
            selected = (selected + 1) % 256;
        } else if (key === 'up') {
            selected = (selected + 240) % 256;
        } else if (key === 'down') {
            selected = (selected + 16) % 256;
        } else if (key === 'home') {
            selected -= selected % 16;
        } else if (key === 'end') {
            selected += 15 - (selected % 16);
        } else if ([...key].length === 1) {
            return key;
        }
    }
}
