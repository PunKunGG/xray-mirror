// Casiez, Roussel and Vogel, CHI 2012. https://gery.casiez.net/1euro/
export class OneEuroFilter {
  private previousTime: number | undefined;
  private readonly previousInput: Float64Array;
  private readonly previousOutput: Float64Array;
  private readonly previousVelocity: Float64Array;
  private readonly minCutoff: number;
  private readonly beta: number;

  constructor(size: number, minCutoff: number, beta: number) {
    this.previousInput = new Float64Array(size);
    this.previousOutput = new Float64Array(size);
    this.previousVelocity = new Float64Array(size);
    this.minCutoff = minCutoff;
    this.beta = beta;
  }

  reset(): void {
    this.previousTime = undefined;
    this.previousVelocity.fill(0);
  }

  apply(input: ArrayLike<number>, timestampMs: number): Float64Array {
    if (this.previousTime === undefined) {
      this.previousTime = timestampMs;
      this.previousInput.set(input);
      this.previousOutput.set(input);
      return this.previousOutput;
    }
    if (timestampMs <= this.previousTime) return this.previousOutput;

    const dt = (timestampMs - this.previousTime) / 1_000;
    const velocityAlpha = alpha(1, dt);
    for (let index = 0; index < input.length; index++) {
      const sample = input[index];
      const velocity = (sample - this.previousInput[index]) / dt;
      this.previousVelocity[index] += velocityAlpha * (velocity - this.previousVelocity[index]);
      const cutoff = this.minCutoff + this.beta * Math.abs(this.previousVelocity[index]);
      this.previousOutput[index] += alpha(cutoff, dt) * (sample - this.previousOutput[index]);
      this.previousInput[index] = sample;
    }
    this.previousTime = timestampMs;
    return this.previousOutput;
  }
}

function alpha(cutoff: number, dt: number): number {
  const rate = 2 * Math.PI * cutoff * dt;
  return rate / (rate + 1);
}
