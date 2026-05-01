import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, input, effect, ChangeDetectionStrategy } from '@angular/core';

/**
 * Cellular Automata — "Game of Life Groove"
 *
 * A 2D grid where cells live, die, and evolve according to Conway's Game of Life
 * rules (or Wolfram Rule 30 for 1D chaos), driven in real time by audio FFT data.
 *
 * Audio mapping:
 *   • Bass → birth probability — bass "seeds" new cell clusters
 *   • Treble → death/kill probability — highs thin the population
 *   • Mids → evolution speed (steps per frame: 1–4)
 *   • Beat → inject "gliders" or "oscillators" at random positions
 *   • Music profile → color palette (warm/cool/electric)
 *
 * The result is emergent complexity — patterns evolve organically with the song
 * like a living organism. Hypnotic and biological.
 *
 * Concept by E.M. & Kumar. Implementation: Spectra.
 */

// Classic Game of Life glider/oscillator patterns for beat injection
const GLIDER = [[0,1,0],[0,0,1],[1,1,1]];
const LWSS = [[0,1,0,0,1],[1,0,0,0,0],[1,0,0,0,1],[1,1,1,1,0]];
const BLINKER = [[1,1,1]];
const PULSAR_SEED = [[0,0,1,1,1,0,0,0,1,1,1,0,0]];

@Component({
  selector: 'app-cellular-automata',
  standalone: true,
  template: `<canvas #canvas class="w-full h-full block"></canvas>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block w-full h-full' }
})
export class CellularAutomataComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') private canvasRef!: ElementRef<HTMLCanvasElement>;

  bars = input.required<number[]>();
  beat = input.required<{ strength: number; timestamp: number }>();
  musicProfile = input.required<'atmosphere' | 'rhythm' | 'transient'>();

  private ctx!: CanvasRenderingContext2D;
  private animFrameId: number | null = null;
  private resizeObserver!: ResizeObserver;

  // Simulation grid (double-buffered)
  private readonly GRID_W = 250;
  private readonly GRID_H = 250;
  private grid!: Uint8Array;
  private nextGrid!: Uint8Array;
  private age!: Float32Array; // tracks how long each cell has been alive (for glow effect)
  private imageData!: ImageData;

  // Audio state
  private lastBeatTime = 0;
  private baseHue = 130; // green-ish default (like classic GoL)
  private frameCount = 0;
  private burstCooldown = 0;

  // FFT waveform overlay
  private waveformData: number[] = [];

  constructor() {
    effect(() => {
      this.bars();
      this.beat();
      this.musicProfile();
    });
  }

  ngAfterViewInit(): void {
    const canvas = this.canvasRef.nativeElement;
    this.ctx = canvas.getContext('2d', { willReadFrequently: false })!;
    this.handleResize();
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(canvas.parentElement!);
    this.initGrid();
    this.animate();
  }

  ngOnDestroy(): void {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    this.resizeObserver?.disconnect();
  }

  private handleResize(): void {
    const canvas = this.canvasRef.nativeElement;
    const parent = canvas.parentElement!;
    canvas.width = parent.clientWidth * window.devicePixelRatio;
    canvas.height = parent.clientHeight * window.devicePixelRatio;
  }

  /**
   * Initialize the grid with a random seed (sparse population).
   */
  private initGrid(): void {
    const N = this.GRID_W * this.GRID_H;
    this.grid = new Uint8Array(N);
    this.nextGrid = new Uint8Array(N);
    this.age = new Float32Array(N);

    // Sparse random seed (~15% alive)
    for (let i = 0; i < N; i++) {
      this.grid[i] = Math.random() < 0.15 ? 1 : 0;
    }
  }

  /**
   * Inject a classic pattern (glider, LWSS, blinker) at a random position.
   */
  private injectPattern(strength: number): void {
    const patterns = strength > 0.7
      ? [LWSS, GLIDER, GLIDER, GLIDER]
      : strength > 0.4
        ? [GLIDER, BLINKER, GLIDER]
        : [BLINKER, BLINKER];

    const pattern = patterns[Math.floor(Math.random() * patterns.length)];
    const rotation = Math.floor(Math.random() * 4);

    // Random position
    const ox = Math.floor(Math.random() * (this.GRID_W - 15)) + 5;
    const oy = Math.floor(Math.random() * (this.GRID_H - 15)) + 5;

    for (let py = 0; py < pattern.length; py++) {
      for (let px = 0; px < pattern[py].length; px++) {
        if (pattern[py][px]) {
          let x = px, y = py;
          // Rotate the pattern
          for (let r = 0; r < rotation; r++) {
            const tmp = x;
            x = pattern.length - 1 - y;
            y = tmp;
          }
          const gx = (ox + x + this.GRID_W) % this.GRID_W;
          const gy = (oy + y + this.GRID_H) % this.GRID_H;
          this.grid[gy * this.GRID_W + gx] = 1;
          this.age[gy * this.GRID_W + gx] = 0;
        }
      }
    }

    // Also inject a cluster of random cells for visual chaos on strong beats
    if (strength > 0.6) {
      const radius = Math.floor(3 + strength * 5);
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy <= radius * radius && Math.random() < 0.4) {
            const gx = (ox + dx + this.GRID_W) % this.GRID_W;
            const gy = (oy + dy + this.GRID_H) % this.GRID_H;
            this.grid[gy * this.GRID_W + gx] = 1;
            this.age[gy * this.GRID_W + gx] = 0;
          }
        }
      }
    }
  }

  private animate = (): void => {
    this.step();
    this.render();
    this.animFrameId = requestAnimationFrame(this.animate);
  };

  /**
   * Run the Game of Life simulation with audio-modulated rules.
   */
  private step(): void {
    const bars = this.bars();
    const beat = this.beat();
    const profile = this.musicProfile();
    const W = this.GRID_W;
    const H = this.GRID_H;

    if (bars.length === 0) return;

    this.frameCount++;
    this.waveformData = bars;

    // --- Frequency analysis ---
    const bassCount = Math.max(1, Math.floor(bars.length * 0.15));
    const trebleStart = Math.floor(bars.length * 0.7);
    const bass = bars.slice(0, bassCount).reduce((a, b) => a + b, 0) / bassCount;
    const mids = bars.slice(bassCount, trebleStart).reduce((a, b) => a + b, 0) / Math.max(1, trebleStart - bassCount);
    const treble = bars.slice(trebleStart).reduce((a, b) => a + b, 0) / Math.max(1, bars.length - trebleStart);
    const overall = bars.reduce((a, b) => a + b, 0) / bars.length;

    // --- Color from profile ---
    if (profile === 'rhythm') this.baseHue += (30 - this.baseHue) * 0.015;        // Hot orange
    else if (profile === 'transient') this.baseHue += (280 - this.baseHue) * 0.015; // Electric purple
    else this.baseHue += (150 - this.baseHue) * 0.015;                              // Bio-green

    // --- Beat → inject patterns ---
    if (beat.timestamp > this.lastBeatTime) {
      this.lastBeatTime = beat.timestamp;
      if (beat.strength > 0.3 && this.burstCooldown <= 0) {
        this.injectPattern(beat.strength);
        this.burstCooldown = 5;
      }
    }
    if (this.burstCooldown > 0) this.burstCooldown--;

    // --- Determine evolution speed (mids-driven) ---
    const stepsPerFrame = Math.max(1, Math.min(4, Math.floor(1 + mids * 3)));

    // --- Audio-modulated birth/survival probabilities ---
    // Bass boosts births, treble increases deaths
    const birthBoost = bass * 0.04;   // Chance of spontaneous cell birth
    const deathBoost = treble * 0.03; // Chance of extra cell death

    // --- Run simulation steps ---
    for (let s = 0; s < stepsPerFrame; s++) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const idx = y * W + x;

          // Count live neighbors (toroidal boundary)
          let neighbors = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = (x + dx + W) % W;
              const ny = (y + dy + H) % H;
              neighbors += this.grid[ny * W + nx];
            }
          }

          const alive = this.grid[idx];

          if (alive) {
            // Standard Conway: survive on 2 or 3 neighbors
            if (neighbors === 2 || neighbors === 3) {
              this.nextGrid[idx] = 1;
              this.age[idx] += 0.1; // age increases
            } else {
              // Die — but treble can cause extra random death
              this.nextGrid[idx] = 0;
              this.age[idx] *= 0.7; // fade
            }
            // Random death from treble
            if (Math.random() < deathBoost) {
              this.nextGrid[idx] = 0;
              this.age[idx] *= 0.5;
            }
          } else {
            // Standard Conway: birth on exactly 3 neighbors
            if (neighbors === 3) {
              this.nextGrid[idx] = 1;
              this.age[idx] = 0;
            } else {
              this.nextGrid[idx] = 0;
              this.age[idx] *= 0.9; // ghost fade
            }
            // Random birth from bass
            if (Math.random() < birthBoost) {
              this.nextGrid[idx] = 1;
              this.age[idx] = 0;
            }
          }
        }
      }

      // Swap buffers
      const tmp = this.grid;
      this.grid = this.nextGrid;
      this.nextGrid = tmp;
    }
  }

  /**
   * Render the grid to the canvas using ImageData for performance.
   */
  private render(): void {
    const canvas = this.canvasRef.nativeElement;
    const ctx = this.ctx;
    const cw = canvas.width;
    const ch = canvas.height;
    const W = this.GRID_W;
    const H = this.GRID_H;

    if (cw === 0 || ch === 0) return;

    if (!this.imageData || this.imageData.width !== W || this.imageData.height !== H) {
      this.imageData = new ImageData(W, H);
    }

    const data = this.imageData.data;
    const hue = this.baseHue;

    for (let i = 0; i < W * H; i++) {
      const alive = this.grid[i];
      const cellAge = Math.min(1, this.age[i]);
      const px = i * 4;

      if (alive) {
        // Alive cells: bright, hue-shifted by age
        const cellHue = (hue + cellAge * 60) % 360;
        const sat = 0.8 + cellAge * 0.2;
        const lum = 0.45 + cellAge * 0.3;
        const rgb = this.hslToRgb(cellHue / 360, sat, lum);
        data[px]     = rgb[0];
        data[px + 1] = rgb[1];
        data[px + 2] = rgb[2];
        data[px + 3] = 255;
      } else if (cellAge > 0.05) {
        // Ghost trail: recently dead cells leave a fading afterimage
        const ghostHue = (hue + 30) % 360;
        const ghostLum = cellAge * 0.15;
        const rgb = this.hslToRgb(ghostHue / 360, 0.5, ghostLum);
        data[px]     = rgb[0];
        data[px + 1] = rgb[1];
        data[px + 2] = rgb[2];
        data[px + 3] = 255;
      } else {
        // Dead: dark background
        data[px]     = 2;
        data[px + 1] = 2;
        data[px + 2] = 6;
        data[px + 3] = 255;
      }
    }

    // Scale up
    ctx.imageSmoothingEnabled = false; // Crisp pixel art look for CA
    ctx.putImageData(this.imageData, 0, 0);
    ctx.drawImage(canvas, 0, 0, W, H, 0, 0, cw, ch);

    // --- FFT waveform overlay on bottom edge ---
    if (this.waveformData.length > 0) {
      const bars = this.waveformData;
      ctx.strokeStyle = `hsla(${hue + 40}, 80%, 60%, 0.3)`;
      ctx.lineWidth = 1.5 * window.devicePixelRatio;
      ctx.beginPath();
      for (let i = 0; i < bars.length; i++) {
        const x = (i / bars.length) * cw;
        const y = ch - bars[i] * ch * 0.15;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  private hslToRgb(h: number, s: number, l: number): [number, number, number] {
    let r: number, g: number, b: number;
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p: number, q: number, t: number): number => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }
}
