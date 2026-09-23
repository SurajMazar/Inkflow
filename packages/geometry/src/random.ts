/**
 * Deterministic pseudo random generator (Park–Miller minimal standard, 31-bit).
 * Integer arithmetic makes the sequence identical on every JavaScript engine, which keeps
 * hand-drawn shapes stable across reloads, devices, exports and collaborators.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    const s = Math.floor(Math.abs(seed)) % 2147483647;
    this.state = s === 0 ? 1 : s;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = Math.imul(48271, this.state) % 2147483647;
    if (this.state < 0) this.state += 2147483647;
    return (this.state - 1) / 2147483646;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Float in [-magnitude, magnitude). */
  offset(magnitude: number): number {
    return (this.next() * 2 - 1) * magnitude;
  }
}
