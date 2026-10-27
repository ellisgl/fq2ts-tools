import { describe, expect, test } from 'bun:test';
import { contentTriggers, describeScript, triggerAbout } from '../src/game.ts';
import { content, testWorld } from '@fq2ts/engine/fixture';
import { MAP_HEIGHT, MAP_WIDTH } from '@fq2ts/engine/world';

describe('describeScript', () => {
    test("a script's about, else its name, unless that's only its tile or trigger character", () => {
        const door = Object.assign(() => undefined, { about: 'door to 725 at 31,15' });
        const at = { '3,4': (): void => undefined };
        const triggers = { X: (): void => undefined };
        function bank(): void {}
        expect(describeScript(door)).toBe('door to 725 at 31,15');
        expect(describeScript(bank)).toBe('runs bank');
        expect(describeScript(at['3,4'])).toBe('');
        expect(describeScript(triggers.X)).toBe('');
        expect(describeScript(() => undefined)).toBe('');
        expect(describeScript(undefined)).toBe('');
    });
});

describe('triggerAbout', () => {
    test('what a tile does, from a map; nothing from a set or a blank', () => {
        expect(triggerAbout(new Map([['1,1', 'a sign'], ['2,1', '']]), '1,1')).toBe('a sign');
        expect(triggerAbout(new Map([['2,1', '']]), '2,1')).toBeUndefined();
        expect(triggerAbout(new Set(['1,1']), '1,1')).toBeUndefined();
    });
});

test("contentTriggers has every screen's trigger tiles", () => {
    const triggers = contentTriggers(content);
    for (const [screen, scripts] of Object.entries(content.screens)) {
        expect([...(triggers.get(Number(screen))?.keys() ?? [])]).toEqual(Object.keys(scripts?.at ?? {}));
    }
});

test('given the world, contentTriggers has the tiles its maps mark with trigger characters', () => {
    const world = testWorld();
    const map = world.export(1);
    map.triggers = Array.from({ length: MAP_HEIGHT }, (_, y) => Array.from({ length: MAP_WIDTH }, (_, x) => (y === 2 && x < 2 ? 'S' : null)));
    world.put(map);
    const sign = Object.assign(() => undefined, { about: 'a sign' });
    const screens = { ...content.screens, 1: { ...content.screens[1], triggers: { S: sign } } };
    const triggers = contentTriggers({ ...content, screens }, world).get(1);
    expect(triggers?.get('1,3')).toBe('a sign');
    expect(triggers?.get('2,3')).toBe('a sign');
    expect(triggers?.has('12,10')).toBe(true);
});
