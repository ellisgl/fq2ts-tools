// The colour picker: all 256 colours in a 16x16 grid, the 16 CGA colours
// on the first row (see engine/screen.ts for the rest).

import { COLOR_COUNT, rgb, type Color } from '@fq2js/engine/screen';
import { isMouse, type Terminal } from '@fq2js/engine/terminal';

const LEFT = 23;
const TOP = 2;

export type ColorSide = 'fg' | 'bg';

// Where colour `c` is drawn (two cells wide).
export const colorCell = (c: Color): { x: number; y: number } => ({ x: LEFT + 2 + (c % 16) * 2, y: TOP + 2 + Math.floor(c / 16) });

// Black or white, whichever shows up on `c`.
export const inkOn = (c: Color): Color => {
    const [r, g, b] = rgb(c);
    return r * 0.299 + g * 0.587 + b * 0.114 > 128 ? 0 : 15;
};

const hex = (c: Color): string => c.toString(16).toUpperCase().padStart(2, '0');

// Lets the user pick a foreground or background colour (Tab switches
// which) with the arrows and Enter, or by clicking it. Returns the side and
// colour, or null on Escape or a click outside the box.
export async function pickColor(term: Terminal, current: { fg: Color; bg: Color }, start: ColorSide): Promise<{ side: ColorSide; color: Color } | null> {
    const { screen } = term;
    let side = start;
    let selected = current[side];

    for (;;) {
        const title = side === 'fg' ? ' Foreground colour' : ' Background colour';
        screen.text(LEFT, TOP, '┌' + '─'.repeat(33) + '┐', 15, 1);
        screen.text(LEFT, TOP + 1, '│' + title.padEnd(33) + '│', 15, 1);
        for (let row = 0; row < 16; row++) {
            screen.text(LEFT, TOP + 2 + row, '│' + ' '.repeat(33) + '│', 15, 1);
        }
        screen.text(LEFT, TOP + 18, '│' + ' '.repeat(33) + '│', 15, 1);
        screen.text(LEFT, TOP + 19, '└' + '─'.repeat(33) + '┘', 15, 1);
        for (let c = 0; c < COLOR_COUNT; c++) {
            const { x, y } = colorCell(c);
            screen.text(x, y, c === selected ? '<>' : '  ', inkOn(c), c);
        }
        screen.text(LEFT + 2, TOP + 18, `${selected} (${hex(selected)})  Tab: ${side === 'fg' ? 'background' : 'foreground'}`.padEnd(31), 14, 1);
        screen.cursor = colorCell(selected);
        const key = await term.event();
        screen.cursor = null;

        if (isMouse(key)) {
            if (key.action !== 'press') {
                continue;
            }
            const col = Math.floor((key.x - LEFT - 2) / 2);
            const row = key.y - TOP - 2;
            if (key.x >= LEFT + 2 && col < 16 && row >= 0 && row < 16) {
                return { side, color: row * 16 + col };
            }
            if (key.x < LEFT || key.x > LEFT + 34 || key.y < TOP || key.y > TOP + 19) {
                return null;
            }
            continue;
        }

        const last = COLOR_COUNT - 1;
        if (key === 'enter') {
            return { side, color: selected };
        } else if (key === 'escape') {
            return null;
        } else if (key === 'tab') {
            side = side === 'fg' ? 'bg' : 'fg';
            selected = current[side];
        } else if (key === 'left') {
            selected = selected === 0 ? last : selected - 1;
        } else if (key === 'right') {
            selected = selected === last ? 0 : selected + 1;
        } else if (key === 'up') {
            selected = selected >= 16 ? selected - 16 : selected;
        } else if (key === 'down') {
            selected = Math.min(last, selected + 16);
        } else if (key === 'home') {
            selected -= selected % 16;
        } else if (key === 'end') {
            selected = selected - (selected % 16) + 15;
        }
    }
}
