import { describe, expect, test } from 'bun:test';
import { contentTriggers, describeScript, triggerAbout } from '../src/game.ts';
import { content } from '@fq2ts/engine/fixture';

describe('describeScript', () => {
    test("a script's about, else its name, unless that's only its tile", () => {
        const door = Object.assign(() => undefined, { about: 'door to 725 at 31,15' });
        const at = { '3,4': (): void => undefined };
        function bank(): void {}
        expect(describeScript(door)).toBe('door to 725 at 31,15');
        expect(describeScript(bank)).toBe('runs bank');
        expect(describeScript(at['3,4'])).toBe('');
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
