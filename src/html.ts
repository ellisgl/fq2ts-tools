// Draws the world as a standalone HTML page: the outdoor screens laid out
// where they sit on the world grid, then every interior on its own. Cells
// keep their characters and CGA colours. The page can outline solid
// cells and trigger tiles, and zoom.

import { at } from '../engine/assert.ts';
import { RGB, type Color } from '../engine/screen.ts';
import { KINDS, MAP_HEIGHT, MAP_WIDTH, gridPosition, type MapCell, type World } from '../engine/world.ts';

export interface RenderOptions {
    title?: string;
    // Only these screens (default: all of them).
    screens?: ReadonlySet<number>;
    // "x,y" tiles that have a trigger, by screen.
    triggers?: ReadonlyMap<number, ReadonlySet<string>>;
}

const HEX = '0123456789ABCDEF';

const escapeHtml = (text: string): string => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

const css = (c: Color): string => {
    const [r, g, b] = at(RGB, c);
    return `rgb(${r},${g},${b})`;
};

function screenLabel(world: World, screen: number): string {
    const kind = world.kind(screen);
    const name = world.name(screen);
    const label = name ? `Screen ${screen}: ${name}` : `Screen ${screen}`;
    return kind === undefined ? label : `${label} (${KINDS[kind].name})`;
}

// One screen as a <pre>, with runs of same-looking cells in one span.
function renderScreen(world: World, screen: number, triggers: ReadonlySet<string> | undefined): string {
    const lines: string[] = [];
    for (let y = 1; y <= MAP_HEIGHT; y++) {
        let line = '';
        let run = '';
        let runClass = '';
        const flush = (): void => {
            if (run) {
                line += `<span class="${runClass}">${escapeHtml(run)}</span>`;
            }
            run = '';
        };
        for (let x = 1; x <= MAP_WIDTH; x++) {
            const cell: MapCell = world.cell(screen, x, y);
            const cls = `f${HEX.charAt(cell.fg)} b${HEX.charAt(cell.bg)}${cell.solid ? ' s' : ''}`;
            if (triggers?.has(`${x},${y}`)) {
                flush();
                line += `<span class="${cls} t" title="Trigger at ${x},${y}">${escapeHtml(cell.ch)}</span>`;
                runClass = '';
                continue;
            }
            if (cls !== runClass) {
                flush();
                runClass = cls;
            }
            run += cell.ch;
        }
        flush();
        lines.push(line);
    }
    return `<pre class="screen" title="${escapeHtml(screenLabel(world, screen))}">${lines.join('\n')}</pre>`;
}

function figure(world: World, screen: number, triggers: RenderOptions['triggers']): string {
    return `<figure data-screen="${screen}">${renderScreen(world, screen, triggers?.get(screen))}<figcaption>${escapeHtml(screenLabel(world, screen))}</figcaption></figure>`;
}

export function renderHtml(world: World, { title = 'Final Quest 2 — World', screens, triggers }: RenderOptions = {}): string {
    const shown = world.screens().filter((n) => !screens || screens.has(n));
    const outdoor = shown.filter((n) => world.isOutdoors(n));
    const indoor = shown.filter((n) => !world.isOutdoors(n));

    let worldGrid = '';
    if (outdoor.length) {
        const spots = outdoor.map((n) => ({ n, ...gridPosition(n) }));
        const cols = spots.map((s) => s.col);
        const rows = spots.map((s) => s.row);
        const [left, right, top, bottom] = [Math.min(...cols), Math.max(...cols), Math.min(...rows), Math.max(...rows)];
        const cells: string[] = [];
        for (const s of spots) {
            cells.push(figure(world, s.n, triggers).replace('<figure', `<figure style="grid-column:${s.col - left + 1};grid-row:${s.row - top + 1}"`));
        }
        worldGrid = `<section><h2>World</h2><p class="note">Screens ${outdoor.length}, grid columns ${left}–${right}, rows ${top}–${bottom}. Hover a screen for its number.</p><div class="world" style="grid-template-columns:repeat(${right - left + 1},max-content)">${cells.join('')}</div></section>`;
    }

    const interiors = indoor.length
        ? `<section><h2>Interiors</h2><div class="rooms">${indoor.map((n) => figure(world, n, triggers)).join('')}</div></section>`
        : '';

    const colours = Array.from({ length: 16 }, (_, c) => `.f${HEX.charAt(c)}{color:${css(c)}}`).join('') + Array.from({ length: 8 }, (_, c) => `.b${HEX.charAt(c)}{background:${css(c)}}`).join('');

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root { --size: 8px; color-scheme: dark; }
body { margin: 0; padding: 16px; background: #111; color: #ddd; font: 14px system-ui, sans-serif; }
header { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; gap: 16px; align-items: center; padding: 8px 0; background: #111; }
h1 { font-size: 18px; margin: 0 16px 0 0; }
h2 { font-size: 16px; margin: 24px 0 4px; }
.note { margin: 0 0 8px; color: #999; }
label { white-space: nowrap; }
.world { display: grid; gap: 2px; width: max-content; background: #222; }
.rooms { display: flex; flex-wrap: wrap; gap: 16px; }
figure { margin: 0; }
figcaption { font-size: 12px; color: #999; padding: 2px 0; }
.world figcaption { display: none; }
pre.screen { margin: 0; font: var(--size)/1 "DejaVu Sans Mono", Menlo, Consolas, monospace; background: #000; }
body.solid .s { box-shadow: inset 0 0 0 1px rgba(255, 64, 64, 0.8); }
body.triggers .t { outline: 2px solid #ff0; outline-offset: -1px; animation: blink 1s steps(2) infinite; }
@keyframes blink { 50% { outline-color: #f0f; } }
${colours}
</style>
</head>
<body class="triggers">
<header>
<h1>${escapeHtml(title)}</h1>
<label>Zoom <input id="zoom" type="range" min="4" max="20" value="8"></label>
<label><input id="solid" type="checkbox"> Solid cells</label>
<label><input id="triggers" type="checkbox" checked> Triggers</label>
</header>
${worldGrid}
${interiors}
<script>
const zoom = document.getElementById("zoom");
zoom.addEventListener("input", () => document.documentElement.style.setProperty("--size", zoom.value + "px"));
for (const name of ["solid", "triggers"]) {
  const box = document.getElementById(name);
  box.addEventListener("change", () => document.body.classList.toggle(name, box.checked));
}
</script>
</body>
</html>
`;
}
