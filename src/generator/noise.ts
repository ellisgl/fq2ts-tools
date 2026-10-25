// Seeded randomness that depends only on (seed, x, y), so the same world
// position always gets the same value, whichever screen asks for it.

// A 32-bit hash of some integers.
export function hash(seed: number, ...values: number[]): number {
    let h = (seed ^ 0x9e3779b9) >>> 0;
    for (const v of values) {
        h = Math.imul(h ^ (v | 0), 0x85ebca6b);
        h = (h ^ (h >>> 13)) >>> 0;
        h = Math.imul(h, 0xc2b2ae35);
        h = (h ^ (h >>> 16)) >>> 0;
    }
    return h >>> 0;
}

// A number from 0 (inclusive) to 1 (exclusive) for this seed and position.
export const random = (seed: number, x: number, y: number): number => hash(seed, x, y) / 2 ** 32;

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// Smooth value noise from 0 to 1: random values on a grid of whole
// numbers, blended in between.
export function valueNoise(seed: number, x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smoothstep(0, 1, x - x0);
    const ty = smoothstep(0, 1, y - y0);
    const top = lerp(random(seed, x0, y0), random(seed, x0 + 1, y0), tx);
    const bottom = lerp(random(seed, x0, y0 + 1), random(seed, x0 + 1, y0 + 1), tx);
    return lerp(top, bottom, ty);
}

// Several octaves of value noise, each at twice the detail and half the
// strength of the last. Still from 0 to 1, mostly near the middle.
export function fbm(seed: number, x: number, y: number, octaves = 4): number {
    let total = 0;
    let amplitude = 1;
    let weight = 0;
    for (let i = 0; i < octaves; i++) {
        total += valueNoise(seed + i * 1013, x * 2 ** i, y * 2 ** i) * amplitude;
        weight += amplitude;
        amplitude /= 2;
    }
    return total / weight;
}
