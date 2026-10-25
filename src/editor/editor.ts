// The level editor: an overview of the whole 80x24 world grid, from which
// screens are created, copied, deleted and opened for editing.

import { at } from "../../engine/assert.ts";
import { draw, width } from "../../engine/text.ts";
import { choose, textInput } from "../../engine/ui.ts";
import type { Color, Screen } from "../../engine/screen.ts";
import { isMouse, type Key, type MouseInput, type Terminal } from "../../engine/terminal.ts";
import {
  GRID_HEIGHT,
  GRID_WIDTH,
  KINDS,
  MAP_KINDS,
  blankMap,
  gridPosition,
  type GameMap,
  type MapCell,
  type MapKind,
  type World,
} from "../../engine/world.ts";
import { ScreenEditor, type EditorState } from "./screen-editor.ts";

export interface SaveResult {
  written: string[];
  deleted: string[];
}

export interface EditorOptions {
  term: Terminal;
  world: World;
  // "x,y" trigger tiles by screen (shown so they aren't painted over by accident).
  triggers?: ReadonlyMap<number, ReadonlySet<string>>;
  // The encounter tables in data/monsters.json, for E to cycle through.
  encounterTables?: readonly string[];
  save: (world: World) => SaveResult;
}

// How each kind of screen looks on the overview: [char, fg, bg]. Screens
// with monsters have a dot.
const OVERVIEW: Readonly<Record<MapKind, readonly [string, Color, Color]>> = {
  0: [" ", 15, 1],
  1: [" ", 15, 2],
  2: ["▪", 13, 0],
  3: [" ", 15, 7],
  4: ["■", 7, 2],
  5: ["∙", 10, 2],
  6: ["■", 12, 2],
  7: ["∙", 8, 7],
  8: ["∙", 9, 1],
};

// What a new screen of each kind is filled with.
const FILL: Readonly<Record<MapKind, MapCell>> = {
  0: { ch: " ", fg: 15, bg: 1, solid: true, terrain: "water" },
  1: { ch: " ", fg: 15, bg: 2, solid: false, terrain: "grass" },
  2: { ch: " ", fg: 15, bg: 0, solid: false, terrain: "floor" },
  3: { ch: " ", fg: 15, bg: 7, solid: false, terrain: "floor" },
  4: { ch: " ", fg: 15, bg: 2, solid: false, terrain: "grass" },
  5: { ch: " ", fg: 15, bg: 2, solid: false, terrain: "grass" },
  6: { ch: " ", fg: 15, bg: 2, solid: false, terrain: "grass" },
  7: { ch: " ", fg: 15, bg: 7, solid: false, terrain: "floor" },
  8: { ch: " ", fg: 15, bg: 1, solid: true, terrain: "water" },
};

const kindLabel = (kind: MapKind): string => `${kind}  ${KINDS[kind].name}${KINDS[kind].monsters ? ", monsters" : ""}`;

export const OVERVIEW_HELP = [
  "{yellow}The world overview",
  "",
  "{gray}Each cell is one screen: {white}blue{gray} water, {white}green{gray} land, {white}gray{gray} town,",
  "{gray}{white}■{gray} small town, {lightmagenta}▪{gray} interior. A dot means random monsters.",
  "",
  "{white}Arrows, Home/End, PgUp/PgDn {gray}move",
  "{white}Enter   {gray}edit this screen (or create it)",
  "{white}N       {gray}create a screen here",
  "{white}C / V   {gray}copy this screen / paste over this one",
  "{white}D       {gray}delete this screen",
  "{white}K       {gray}change this screen's kind",
  "{white}E       {gray}change which encounter table its monsters come from",
  "{white}A       {gray}name this screen (shown when the player arrives)",
  "{white}S       {gray}save to the map folder",
  "{white}Q, Esc  {gray}quit",
  "{gray}With the mouse: click a screen to select it, and again to open it.",
  "",
  "{gray}Scripts in content/screens.ts refer to screens by number, so moving or",
  "{gray}deleting a screen that has them means changing the scripts too.",
];

export class Editor {
  private readonly term: Terminal;
  private readonly screen: Screen;
  private readonly world: World;
  private readonly triggers: ReadonlyMap<number, ReadonlySet<string>>;
  private readonly saveWorld: (world: World) => SaveResult;
  private readonly encounterTables: readonly string[];
  private readonly state: EditorState = {
    brush: { ch: "♠", fg: 10, bg: 2, solid: true, terrain: "forest" },
    clipboard: null,
    overlay: "none",
    showTriggers: true,
  };
  private current: number;
  private copied: GameMap | null = null;
  private modified = false;
  private message: string | null = null;

  constructor({ term, world, triggers = new Map(), encounterTables = ["default"], save }: EditorOptions) {
    this.term = term;
    this.screen = term.screen;
    this.world = world;
    this.triggers = triggers;
    this.saveWorld = save;
    this.encounterTables = encounterTables;
    this.current = world.screens()[0] ?? 1;
  }

  get hasUnsavedChanges(): boolean {
    return this.modified;
  }

  // Runs until the user quits.
  async run(): Promise<void> {
    for (;;) {
      this.draw();
      const key = await this.term.event();
      this.message = null;
      if (isMouse(key)) await this.mouse(key);
      else if (!(await this.handle(key))) break;
    }
    this.screen.cursor = null;
    this.screen.clear();
  }

  // Returns false to quit.
  private async handle(key: Key): Promise<boolean> {
    const { col, row } = gridPosition(this.current);
    const go = (c: number, r: number): void => {
      this.current = (r - 1) * GRID_WIDTH + c;
    };
    switch (key) {
      case "up":
        go(col, Math.max(1, row - 1));
        return true;
      case "down":
        go(col, Math.min(GRID_HEIGHT, row + 1));
        return true;
      case "left":
        go(Math.max(1, col - 1), row);
        return true;
      case "right":
        go(Math.min(GRID_WIDTH, col + 1), row);
        return true;
      case "home":
        go(1, row);
        return true;
      case "end":
        go(GRID_WIDTH, row);
        return true;
      case "pageup":
        go(col, 1);
        return true;
      case "pagedown":
        go(col, GRID_HEIGHT);
        return true;
      case "enter":
        if (this.world.has(this.current) || (await this.create())) await this.edit();
        return true;
      case "escape":
        return !(await this.confirmQuit());
      case "?":
        await this.help();
        return true;
    }
    switch (key.toLowerCase()) {
      case "n":
        if (this.world.has(this.current)) this.message = `Screen ${this.current} already exists.`;
        else await this.create();
        break;
      case "c":
        if (this.world.has(this.current)) {
          this.copied = this.world.export(this.current);
          this.message = `Copied screen ${this.current}.`;
        }
        break;
      case "v":
        await this.paste();
        break;
      case "d":
        await this.remove();
        break;
      case "k":
        this.nextKind();
        break;
      case "e":
        this.nextEncounters();
        break;
      case "a":
        await this.rename();
        break;
      case "s":
        this.save();
        break;
      case "q":
        return !(await this.confirmQuit());
    }
    return true;
  }

  // Clicking a screen selects it; clicking it again opens it.
  private async mouse(m: MouseInput): Promise<void> {
    if (m.action !== "press" || m.button !== "left" || m.y > GRID_HEIGHT || m.x > GRID_WIDTH) return;
    const screen = (m.y - 1) * GRID_WIDTH + m.x;
    if (screen !== this.current) {
      this.current = screen;
      return;
    }
    if (this.world.has(screen) || (await this.create())) await this.edit();
  }

  private changed = (): void => {
    this.modified = true;
  };

  private scriptsNote(screen: number): string {
    return this.triggers.has(screen) ? ` (it has scripts in content/screens.ts)` : "";
  }

  private async edit(): Promise<void> {
    const editor = new ScreenEditor({
      term: this.term,
      world: this.world,
      screen: this.current,
      state: this.state,
      triggers: this.triggers.get(this.current) ?? new Set(),
      changed: this.changed,
    });
    await editor.run();
  }

  // Asks for a kind and creates the current screen. Returns false if the
  // user changed their mind.
  private async create(): Promise<boolean> {
    const labels = MAP_KINDS.map(kindLabel);
    this.box(28, 6, 26, labels.length + 3, `New screen ${this.current}`);
    const choice = await choose(this.term, labels, { x: 30, y: 8 });
    if (choice < 0) return false;
    const kind = at(MAP_KINDS, choice);
    this.world.put(blankMap(this.current, kind, FILL[kind]));
    this.changed();
    this.message = `Created screen ${this.current}.`;
    return true;
  }

  private async paste(): Promise<void> {
    if (!this.copied) {
      this.message = "Copy a screen first (C).";
      return;
    }
    if (this.world.has(this.current) && !(await this.ask(`Replace screen ${this.current}${this.scriptsNote(this.current)}? (Y/N)`))) return;
    this.world.put({ ...this.copied, screen: this.current });
    this.changed();
    this.message = `Pasted screen ${this.copied.screen} onto ${this.current}.`;
  }

  private async remove(): Promise<void> {
    if (!this.world.has(this.current)) return;
    if (!(await this.ask(`Delete screen ${this.current}${this.scriptsNote(this.current)}? (Y/N)`))) return;
    this.world.remove(this.current);
    this.changed();
    this.message = `Deleted screen ${this.current}.`;
  }

  private async rename(): Promise<void> {
    if (!this.world.has(this.current)) return;
    this.prompt("Name:");
    const old = this.world.name(this.current);
    const name = (await textInput(this.term, { x: 7, y: 25, length: 31, value: old, fg: 15, bg: 1 })).trim();
    if (name === old) return;
    this.world.setName(this.current, name);
    this.changed();
    this.message = name ? `Screen ${this.current} is now called "${name}".` : `Screen ${this.current} has no name now.`;
  }

  // Cycles the screen's encounter table: "default" (not named in the map
  // file), then each other table in turn.
  private nextEncounters(): void {
    if (!this.world.has(this.current)) return;
    const others = this.encounterTables.filter((t) => t !== "default");
    const now = this.world.encounters(this.current);
    const next = now === undefined ? others[0] : others[others.indexOf(now) + 1];
    this.world.setEncounters(this.current, next);
    this.changed();
    this.message = `Screen ${this.current}'s monsters now come from the "${next ?? "default"}" table.`;
  }

  private nextKind(): void {
    const kind = this.world.kind(this.current);
    if (kind === undefined) return;
    const next = at(MAP_KINDS, (MAP_KINDS.indexOf(kind) + 1) % MAP_KINDS.length);
    this.world.setKind(this.current, next);
    this.changed();
    this.message = `Screen ${this.current} is now kind ${kindLabel(next)}.`;
  }

  private save(): void {
    const { written, deleted } = this.saveWorld(this.world);
    this.modified = false;
    this.message = written.length || deleted.length ? `Saved: ${written.length} written, ${deleted.length} deleted.` : "Saved: nothing had changed.";
  }

  // Returns true if it's all right to quit.
  private async confirmQuit(): Promise<boolean> {
    if (!this.modified) return true;
    this.prompt("Save changes before quitting? (Y/N, Esc stays)");
    for (;;) {
      const key = (await this.term.key()).toLowerCase();
      if (key === "y") {
        this.save();
        return true;
      }
      if (key === "n") return true;
      if (key === "escape") return false;
    }
  }

  // A yes/no question on the bottom row.
  private async ask(question: string): Promise<boolean> {
    this.prompt(question);
    return (await this.term.key()).toLowerCase() === "y";
  }

  private prompt(text: string): void {
    this.screen.fillRow(25, 0);
    draw(this.screen, `{yellow}${text}`, { y: 25, bg: 0 });
  }

  // ---- Drawing

  private draw(): void {
    const { screen } = this;
    for (let n = 1; n <= GRID_WIDTH * GRID_HEIGHT; n++) {
      const { col, row } = gridPosition(n);
      const kind = this.world.kind(n);
      if (kind === undefined) screen.put(col, row, "·", 8, 0);
      else {
        const [ch, fg, bg] = OVERVIEW[kind];
        screen.put(col, row, ch, fg, bg);
      }
    }
    screen.fillRow(25, 0);
    const kind = this.world.kind(this.current);
    const table = this.world.encounters(this.current);
    const monsters = kind !== undefined && KINDS[kind].monsters ? ` {gray}monsters${table === undefined ? "" : `: ${table}`}` : "";
    const what = kind === undefined ? "{darkgray}empty" : `{lightcyan}${KINDS[kind].name}${monsters}`;
    const name = this.world.name(this.current);
    const about = `{white}Screen ${this.current}${name ? ` {yellow}${name}{white},` : ""} ${what}${this.modified ? " {lightred}*" : ""}`;
    const hints = "   {darkgray}Enter edit  N new  C/V copy  D del  ? help";
    const status = this.message === null ? (width(about + hints) <= 80 ? about + hints : about) : `{yellow}${this.message}`;
    draw(screen, status, { y: 25, bg: 0 });
    const { col, row } = gridPosition(this.current);
    screen.cursor = { x: col, y: row };
  }

  private box(x: number, y: number, width: number, height: number, title: string): void {
    this.screen.text(x, y, `┌${"─".repeat(width - 2)}┐`, 15, 1);
    for (let i = 1; i < height - 1; i++) this.screen.text(x, y + i, `│${" ".repeat(width - 2)}│`, 15, 1);
    this.screen.text(x, y + height - 1, `└${"─".repeat(width - 2)}┘`, 15, 1);
    this.screen.text(x + 2, y, ` ${title} `, 14, 1);
  }

  private async help(): Promise<void> {
    this.screen.clear();
    this.screen.cursor = null;
    OVERVIEW_HELP.forEach((line, i) => draw(this.screen, line, { x: 3, y: 2 + i }));
    draw(this.screen, "{yellow}Press a key...", { x: 3, y: 4 + OVERVIEW_HELP.length });
    await this.term.key();
  }
}
