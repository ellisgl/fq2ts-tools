#!/usr/bin/env bun
// Map viewer: writes the world as an HTML page to look at in a browser.
//
//   bun tools/view.ts [--out world.html] [--screens 1-7,82,721-726] [--maps data/maps] [--no-triggers]

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { World } from "../engine/world.ts";
import content from "../content/index.ts";
import { renderHtml } from "./html.ts";

const USAGE = `Usage: bun tools/view.ts [options]

  -o, --out FILE        where to write the page (default: world.html)
  -s, --screens LIST    only these screens, e.g. 1-7,82,721-726
  -m, --maps DIR        the map folder (default: data/maps)
      --no-triggers     don't mark trigger tiles
  -h, --help            show this help`;

// "1-3,7" → {1, 2, 3, 7}
export function parseScreenList(list: string): Set<number> {
  const screens = new Set<number>();
  for (const part of list.split(",")) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!match) throw new Error(`Not a screen or range: "${part}"`);
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (to < from) throw new Error(`Backwards range: "${part}"`);
    for (let n = from; n <= to; n++) screens.add(n);
  }
  return screens;
}

// The trigger tiles of the game's content, by screen.
export function contentTriggers(): Map<number, Set<string>> {
  const triggers = new Map<number, Set<string>>();
  for (const [screen, scripts] of Object.entries(content.screens)) {
    triggers.set(Number(screen), new Set(Object.keys(scripts?.at ?? {})));
  }
  return triggers;
}

export function main(args: readonly string[], log: (line: string) => void = console.log): number {
  const { values } = parseArgs({
    args: [...args],
    options: {
      out: { type: "string", short: "o", default: "world.html" },
      screens: { type: "string", short: "s" },
      maps: { type: "string", short: "m", default: join(import.meta.dir, "..", "data", "maps") },
      "no-triggers": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    log(USAGE);
    return 0;
  }
  const world = World.load(values.maps);
  const html = renderHtml(world, {
    ...(values.screens === undefined ? {} : { screens: parseScreenList(values.screens) }),
    ...(values["no-triggers"] ? {} : { triggers: contentTriggers() }),
  });
  const out = resolve(values.out);
  writeFileSync(out, html);
  log(`Wrote ${out}`);
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
