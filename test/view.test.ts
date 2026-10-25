import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderHtml } from "../../tools/html.ts";
import { contentTriggers, main, parseScreenList } from "../../tools/view.ts";
import { blankMap } from "../../engine/world.ts";
import { gameWorld, makeMap, makeWorld, tempDir } from "../helpers.ts";

describe("parseScreenList", () => {
  test("numbers and ranges", () => {
    expect([...parseScreenList("1-3, 7,82-82")]).toEqual([1, 2, 3, 7, 82]);
  });

  test.each(["", "a", "1-", "3-1", "1,,2"])("rejects %p", (list) => {
    expect(() => parseScreenList(list)).toThrow();
  });
});

describe("renderHtml", () => {
  // Screen 1 (land) and 3 (two columns along), and interior 721.
  const world = makeWorld(makeMap(1, 1, ["2,1"]), makeMap(3, 5), blankMap(721, 2, { ch: "<", fg: 14, bg: 4, solid: false }));

  test("is a standalone page", () => {
    const html = renderHtml(world, { title: "My <World>" });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>My &#60;World&#62;</title>");
    expect(html).not.toMatch(/<(script|link)[^>]+(src|href)=/);
  });

  test("lays outdoor screens out by grid position, leaving gaps", () => {
    const html = renderHtml(world);
    expect(html).toContain("grid-template-columns:repeat(3,max-content)");
    expect(html).toContain('<figure style="grid-column:1;grid-row:1" data-screen="1">');
    expect(html).toContain('<figure style="grid-column:3;grid-row:1" data-screen="3">');
    expect(html).toContain("Screens 2, grid columns 1–3, rows 1–1.");
  });

  test("lists interiors separately, escaping their characters", () => {
    const html = renderHtml(world);
    expect(html).toContain("<h2>Interiors</h2>");
    expect(html).toContain('<figure data-screen="721">');
    expect(html).toContain("Screen 721 (interior)");
    expect(html).toContain(`<span class="fE b4">${"&#60;".repeat(79)}</span>`);
  });

  test("each row of a screen is 79 characters in colour runs", () => {
    const html = renderHtml(makeWorld(makeMap(1, 1, ["2,1"])));
    const pre = /<pre class="screen"[^>]*>([\s\S]*?)<\/pre>/.exec(html)?.[1] ?? "";
    const rows = pre.split("\n");
    expect(rows).toHaveLength(22);
    expect(rows[0]).toBe(`<span class="fF b2"> </span><span class="fF b2 s"> </span><span class="fF b2">${" ".repeat(77)}</span>`);
    for (const row of rows) expect(row.replace(/<[^>]+>/g, "")).toHaveLength(79);
  });

  test("marks trigger tiles", () => {
    const html = renderHtml(world, { triggers: new Map([[1, new Set(["5,1"])]]) });
    expect(html).toContain('<span class="fF b2 t" title="Trigger at 5,1"> </span>');
  });

  test("can show only some screens", () => {
    const html = renderHtml(world, { screens: new Set([721]) });
    expect(html).not.toContain("<h2>World</h2>");
    expect(html).toContain("<h2>Interiors</h2>");
    const outdoors = renderHtml(world, { screens: new Set([1]) });
    expect(outdoors).not.toContain("<h2>Interiors</h2>");
    expect(outdoors).toContain("Screens 1,");
  });

  test("renders the whole game world", () => {
    const html = renderHtml(gameWorld(), { triggers: contentTriggers() });
    expect(html.match(/<figure/g)).toHaveLength(gameWorld().screens().length);
    expect(html).toContain("Screen 82 (town)");
    expect(html).toContain('title="Trigger at 29,17"');
  });
});

test("contentTriggers lists the game's trigger tiles", () => {
  const triggers = contentTriggers();
  expect(triggers.get(82)?.has("29,17")).toBe(true);
  expect(triggers.get(1)).toBeUndefined();
});

describe("the view command", () => {
  test("writes the page", () => {
    const out = join(tempDir(), "w.html");
    const lines: string[] = [];
    expect(main(["--out", out, "--screens", "82"], (l) => lines.push(l))).toBe(0);
    expect(lines).toEqual([`Wrote ${out}`]);
    const html = readFileSync(out, "utf8");
    expect(html.match(/<figure/g)).toHaveLength(1);
    expect(html).toContain('title="Trigger at 29,17"');
  });

  test("--no-triggers and --maps", () => {
    const maps = tempDir();
    makeWorld(makeMap(5)).save(maps);
    const out = join(tempDir(), "w.html");
    main(["-o", out, "-m", maps, "--no-triggers"], () => undefined);
    const html = readFileSync(out, "utf8");
    expect(html).toContain('data-screen="5"');
    expect(html).not.toContain("Trigger at");
  });

  test("--help", () => {
    const lines: string[] = [];
    expect(main(["-h"], (l) => lines.push(l))).toBe(0);
    expect(lines[0]).toContain("Usage: bun tools/view.ts");
  });

  test("bad options are errors", () => {
    expect(() => main(["--bogus"], () => undefined)).toThrow();
    expect(() => main(["--screens", "x"], () => undefined)).toThrow('Not a screen or range: "x"');
  });
});
