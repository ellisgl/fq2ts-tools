# @fq2ts/tools

Map tools for `@fq2ts/engine` games: a viewer (the world as an HTML page), a
level editor in the terminal, a terrain generator, and `art`, which exports
screens to [Icy Draw](https://github.com/mkrueger/icy_tools/blob/master/crates/icy_draw/README.md)
and imports them back (a layer each for the look, terrain, solid cells and
trigger characters; see [art.ts](src/art.ts)). Each tool's `main` takes the
game's `GameFiles` (its map folder, and the trigger tiles and encounter
tables to show); see Final Quest 2's [tools/](https://github.com/ellisgl/final-quest-2/tree/main/tools).

## Using it

```sh
bun add @fq2ts/tools@github:ellisgl/fq2ts-tools#v0.3.0
```

It ships its TypeScript source, which Bun runs as it is. It needs
`@fq2ts/engine` too, named by commit hash in the game's `dependencies` and
`overrides` (see the engine's README).

![the level editor, on Final Quest 2's Stone Valley](screenshots/leveleditor.png)

![Final Quest 2's whole world in the viewer](screenshots/view.png)

## Development

```sh
bun install
bun run check          # tsc (strict) + eslint + tests
```
