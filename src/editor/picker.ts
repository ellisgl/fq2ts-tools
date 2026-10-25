// The character picker: pages of Unicode characters in a 16x16 grid. Any
// character one column wide can be used (see engine/chars.ts); the pages
// are the useful ones for drawing maps, and anything else can be typed, or
// entered by its code point.

import { at } from '@fq2js/engine/assert';
import { fitsCell } from '@fq2js/engine/chars';
import { askText } from '@fq2js/engine/ui';
import { isMouse, type Terminal } from '@fq2js/engine/terminal';

const LEFT = 23;
const TOP = 2;
const PER_PAGE = 256;

export interface PickerPage {
    name: string;
    chars: readonly string[];
}

// The assigned characters in these ranges of code points that fit a cell.
function page(name: string, ...ranges: readonly (readonly [number, number])[]): PickerPage {
    const chars: string[] = [];
    for (const [from, to] of ranges) {
        for (let code = from; code <= to; code++) {
            const ch = String.fromCodePoint(code);
            if (fitsCell(ch) && ch.trim() !== '') {
                chars.push(ch);
            }
        }
    }

    return { name, chars: chars.slice(0, PER_PAGE) };
}

export const PAGES: readonly PickerPage[] = [
    page('Blocks and shapes', [0x2580, 0x259F], [0x25A0, 0x25FF]),
    page('Box drawing', [0x2500, 0x257F]),
    page('Symbols', [0x2600, 0x26FF]),
    page('Arrows', [0x2190, 0x21FF], [0x27F0, 0x27FF]),
    page('Dingbats', [0x2700, 0x27BF]),
    page('Technical', [0x2300, 0x23FF]),
    page('Maths', [0x2200, 0x22FF]),
    page('Letters', [0x21, 0x7E], [0xA1, 0xFF]),
    page('Greek and Cyrillic', [0x391, 0x3C9], [0x400, 0x45F]),
];

// Where character `i` of a page is drawn.
export const pickerCell = (i: number): { x: number; y: number } => ({ x: LEFT + 2 + (i % 16) * 2, y: TOP + 2 + Math.floor(i / 16) });

const hex = (ch: string): string => `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;

// The page and place of a character, or the start of the first page.
function find(ch: string): { page: number; index: number } {
    for (const [p, { chars }] of PAGES.entries()) {
        const index = chars.indexOf(ch);
        if (index >= 0) {
            return { page: p, index };
        }
    }

    return { page: 0, index: 0 };
}

// Lets the user pick a character: with the arrows and Enter (Page Up and
// Page Down for other pages), by clicking it, by typing it, or by its code
// point (Tab). Returns null on Escape or a click outside the box.
export async function pickCharacter(term: Terminal, current: string): Promise<string | null> {
    const { screen } = term;
    let { page: p, index: selected } = find(current);
    let note = '';

    for (;;) {
        const { name, chars } = at(PAGES, p);
        selected = Math.min(selected, chars.length - 1);
        screen.text(LEFT, TOP, '┌' + '─'.repeat(33) + '┐', 15, 1);
        screen.text(LEFT, TOP + 1, '│' + ` ${name} (${p + 1}/${PAGES.length})`.padEnd(33) + '│', 15, 1);
        for (let row = 0; row < 16; row++) {
            screen.text(LEFT, TOP + 2 + row, '│' + ' '.repeat(33) + '│', 15, 1);
        }
        screen.text(LEFT, TOP + 18, '│' + ' '.repeat(33) + '│', 15, 1);
        screen.text(LEFT, TOP + 19, '└' + '─'.repeat(33) + '┘', 15, 1);
        chars.forEach((ch, i) => {
            const { x, y } = pickerCell(i);
            screen.put(x, y, ch, i === selected ? 0 : 15, i === selected ? 7 : 1);
        });
        screen.text(LEFT + 2, TOP + 18, (note || `${hex(at(chars, selected))}  PgUp/PgDn  Tab: U+`).padEnd(31).slice(0, 31), 14, 1);
        note = '';
        screen.cursor = pickerCell(selected);
        const key = await term.event();
        screen.cursor = null;

        if (isMouse(key)) {
            if (key.action !== 'press') {
                continue;
            }
            const col = (key.x - LEFT - 2) / 2;
            const row = key.y - TOP - 2;
            const clicked = Number.isInteger(col) && col >= 0 && col < 16 && row >= 0 && row < 16 ? chars[row * 16 + col] : undefined;
            if (clicked !== undefined) {
                return clicked;
            }
            if (key.x < LEFT || key.x > LEFT + 34 || key.y < TOP || key.y > TOP + 19) {
                return null;
            }
            continue;
        }

        const last = chars.length - 1;
        if (key === 'enter') {
            return at(chars, selected);
        } else if (key === 'escape') {
            return null;
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
            selected = Math.min(last, selected - (selected % 16) + 15);
        } else if (key === 'pagedown') {
            p = (p + 1) % PAGES.length;
        } else if (key === 'pageup') {
            p = (p + PAGES.length - 1) % PAGES.length;
        } else if (key === 'tab') {
            const picked = await codePoint(term);
            if (picked !== null && fitsCell(picked)) {
                return picked;
            }
            note = picked === null ? '' : "That doesn't fit in one cell.";
        } else if (fitsCell(key)) {
            return key.normalize('NFC');
        }
    }
}

// Asks for a code point in hex, as the character; null if it isn't one.
async function codePoint(term: Terminal): Promise<string | null> {
    term.screen.text(LEFT + 2, TOP + 18, 'U+'.padEnd(31), 14, 1);
    const typed = await askText(term, { x: LEFT + 4, y: TOP + 18, length: 7, fg: 15, bg: 0, filter: (ch) => /^[0-9a-f]$/i.test(ch) });
    const code = typed === null || typed === '' ? NaN : parseInt(typed, 16);
    return Number.isInteger(code) && code <= 0x10FFFF ? String.fromCodePoint(code) : null;
}
