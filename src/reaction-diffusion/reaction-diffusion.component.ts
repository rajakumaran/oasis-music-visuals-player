import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, input, effect, ChangeDetectionStrategy } from '@angular/core';

/**
 * Reaction-Diffusion — "Turing Tapestry"
 *
 * Simulates the Gray-Scott reaction-diffusion model on a 2D grid:
 *   dU/dt = Du·∇²U - U·V² + f·(1 - U)
 *   dV/dt = Dv·∇²V + U·V² - (f + k)·V
 *
 * Where U and V are two "chemical" concentrations that diffuse and react.
 * The result is organic, biological textures — spots, stripes, mazes,
 * coral-like growth — that morph and pulse with the music.
 *
 * Audio mapping:
 *   • Bass → feed rate (f): slow, blobby coral growth
 *   • Treble → kill rate (k): fast spots/stripes (Turing instability)
 *   • Mids → diffusion ratio (Dv/Du): maze ↔ spots transition
 *   • Beat → "chemical burst": inject V at random points
 *   • Music profile → color palette
 *
 * Concept by E.M. & Kumar. Implementation: Spectra.
 */

@Component({
  selector: 'app-reaction-diffusion',
  standalone: true,
  template: `<canvas #canvas class="w-full h-full block"></canvas>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block w-full h-full' }
})
export class ReactionDiffusionComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') private canvasRef!: ElementRef<HTMLCanvasElement>;

  bars = input.required<number[]>();
  beat = input.required<{ strength: number; timestamp: number }>();
  musicProfile = input.required<'atmosphere' | 'rhythm' | 'transient'>();

  private ctx!: CanvasRenderingContext2D;
  private animFrameId: number | null = null;
  private resizeObserver!: ResizeObserver;

  // Simulation grid (double-buffered)
  private readonly GRID_W = 200;
  private readonly GRID_H = 200;
  private U!: Float32Array; // Chemical U concentration
  private V!: Float32Array; // Chemical V concentration
  private nextU!: Float32Array;
  private nextV!: Float32Array;
  private imageData!: ImageData;

  // Audio state
  private lastBeatTime = 0;
  private baseHue = 200;
  private burstCooldown = 0;

  // Gray-Scott default parameters (will be modulated by audio)
  private f = 0.055;  // feed rate
  private k = 0.062;  // kill rate
  private Du = 1.0;   // diffusion rate for U
  private Dv = 0.5;   // diffusion rate for V
  private readonly STEPS_PER_FRAME = 8; // simulation steps per render frame

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
   * Initialize the simulation grid.
   * U starts at 1.0 everywhere (uniform "fuel").
   * V starts at 0.0 everywhere, with a few seed clusters.
   */
  private initGrid(): void {
    const N = this.GRID_W * this.GRID_H;
    this.U = new Float32Array(N).fill(1.0);
    this.V = new Float32Array(N).fill(0.0);
    this.nextU = new Float32Array(N);
    this.nextV = new Float32Array(N);

    // Seed initial clusters of V (the "catalyst")
    this.seedClusters(5);
  }

  /**
   * Plant circular clusters of chemical V to kick-start pattern formation.
   */
  private seedClusters(count: number): void {
    for (let c = 0; c < count; c++) {
      const cx = Math.floor(Math.random() * (this.GRID_W - 20)) + 10;
      const cy = Math.floor(Math.random() * (this.GRID_H - 20)) + 10;
      const radius = 3 + Math.floor(Math.random() * 5);

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy <= radius * radius) {
            const x = cx + dx;
            const y = cy + dy;
            if (x >= 0 && x < this.GRID_W && y >= 0 && y < this.GRID_H) {
              const idx = y * this.GRID_W + x;
              this.U[idx] = 0.5;
              this.V[idx] = 0.25 + Math.random() * 0.1;
            }
          }
        }
      }
    }
  }

  /**
   * Inject a "chemical burst" at a random location — triggered by beat detection.
   */
  private injectBurst(strength: number): void {
    const cx = Math.floor(Math.random() * (this.GRID_W - 10)) + 5;
    const cy = Math.floor(Math.random() * (this.GRID_H - 10)) + 5;
    const radius = Math.floor(2 + strength * 6);

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius) {
          const x = (cx + dx + this.GRID_W) % this.GRID_W;
          const y = (cy + dy + this.GRID_H) % this.GRID_H;
          const idx = y * this.GRID_W + x;
          this.V[idx] = Math.min(1.0, this.V[idx] + 0.3 + strength * 0.3);
          this.U[idx] = Math.max(0.0, this.U[idx] - 0.2);
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
   * Run the Gray-Scott simulation for STEPS_PER_FRAME iterations.
   * Audio data modulates the PDE parameters in real time.
   */
  private step(): void {
    const bars = this.bars();
    const beat = this.beat();
    const profile = this.musicProfile();
    const W = this.GRID_W;
    const H = this.GRID_H;

    if (bars.length === 0) return;

    // --- Frequency band analysis ---
    const bassCount = Math.max(1, Math.floor(bars.length * 0.15));
    const trebleStart = Math.floor(bars.length * 0.7);
    const bass = bars.slice(0, bassCount).reduce((a, b) => a + b, 0) / bassCount;
    const mids = bars.slice(bassCount, trebleStart).reduce((a, b) => a + b, 0) / Math.max(1, trebleStart - bassCount);
    const treble = bars.slice(trebleStart).reduce((a, b) => a + b, 0) / Math.max(1, bars.length - trebleStart);

    // --- Audio-driven parameters ---
    // Feed rate: bass creates slow growth (lower f = slower, more coral-like)
    const targetF = 0.035 + bass * 0.035;
    // Kill rate: treble creates spots/stripes (higher k = more spots)
    const targetK = 0.058 + treble * 0.012;
    // Diffusion ratio: mids shift between mazes (low ratio) and spots (high ratio)
    const targetDv = 0.4 + mids * 0.3;

    // Smooth parameter transitions (avoid jarring visual jumps)
    this.f += (targetF - this.f) * 0.08;
    this.k += (targetK - this.k) * 0.08;
    this.Dv += (targetDv - this.Dv) * 0.05;

    // --- Beat detection → chemical burst ---
    if (beat.timestamp > this.lastBeatTime) {
      this.lastBeatTime = beat.timestamp;
      if (beat.strength > 0.3 && this.burstCooldown <= 0) {
        this.injectBurst(beat.strength);
        this.burstCooldown = 8; // prevent burst spam
      }
    }
    if (this.burstCooldown > 0) this.burstCooldown--;

    // --- Color from music profile ---
    if (profile === 'rhythm') this.baseHue += (15 - this.baseHue) * 0.01;        // Warm coral/red
    else if (profile === 'transient') this.baseHue += (170 - this.baseHue) * 0.01; // Teal/cyan
    else this.baseHue += (260 - this.baseHue) * 0.01;                              // Purple/indigo

    // --- Gray-Scott PDE simulation ---
    const f = this.f;
    const k = this.k;
    const Du = this.Du;
    const Dv = this.Dv;
    const dt = 1.0;

    for (let step = 0; step < this.STEPS_PER_FRAME; step++) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const idx = y * W + x;

          // Laplacian with toroidal (wrapping) boundary
          const xp = (x + 1) % W;
          const xm = (x - 1 + W) % W;
          const yp = (y + 1) % H;
          const ym = (y - 1 + H) % H;

          const lapU = this.U[y * W + xp] + this.U[y * W + xm]
                     + this.U[yp * W + x] + this.U[ym * W + x]
                     - 4.0 * this.U[idx];

          const lapV = this.V[y * W + xp] + this.V[y * W + xm]
                     + this.V[yp * W + x] + this.V[ym * W + x]
                     - 4.0 * this.V[idx];

          const u = this.U[idx];
          const v = this.V[idx];
          const uvv = u * v * v;

          this.nextU[idx] = u + dt * (Du * lapU - uvv + f * (1.0 - u));
          this.nextV[idx] = v + dt * (Dv * lapV + uvv - (f + k) * v);

          // Clamp to [0, 1]
          this.nextU[idx] = Math.max(0, Math.min(1, this.nextU[idx]));
          this.nextV[idx] = Math.max(0, Math.min(1, this.nextV[idx]));
        }
      }

      // Swap buffers
      const tmpU = this.U;
      const tmpV = this.V;
      this.U = this.nextU;
      this.V = this.nextV;
      this.nextU = tmpU;
      this.nextV = tmpV;
    }
  }

  /**
   * Render the simulation grid to the canvas.
   * Uses ImageData for pixel-perfect, high-performance rendering.
   */
  private render(): void {
    const canvas = this.canvasRef.nativeElement;
    const ctx = this.ctx;
    const cw = canvas.width;
    const ch = canvas.height;
    const W = this.GRID_W;
    const H = this.GRID_H;

    if (cw === 0 || ch === 0) return;

    // Create/update ImageData at simulation resolution
    if (!this.imageData || this.imageData.width !== W || this.imageData.height !== H) {
      this.imageData = new ImageData(W, H);
    }

    const data = this.imageData.data;
    const hue = this.baseHue;

    for (let i = 0; i < W * H; i++) {
      const v = this.V[i];
      const u = this.U[i];

      // V concentration drives the visible pattern
      // Map V to color: low V = dark background, high V = bright organic texture
      const intensity = v * 3.0; // amplify for visibility
      const clamped = Math.min(1.0, intensity);

      // HSL to RGB with hue shift based on local concentration ratio
      const localHue = (hue + v * 80 - u * 20) % 360;
      const sat = 0.7 + clamped * 0.3;
      const lum = clamped * 0.75;

      const rgb = this.hslToRgb(localHue / 360, sat, lum);

      const px = i * 4;
      data[px]     = rgb[0];
      data[px + 1] = rgb[1];
      data[px + 2] = rgb[2];
      data[px + 3] = 255;
    }

    // Scale up: draw at simulation resolution, CSS scales to fill
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.putImageData(this.imageData, 0, 0);
    ctx.drawImage(canvas, 0, 0, W, H, 0, 0, cw, ch);
  }

  /**
   * Convert HSL to RGB (h: 0-1, s: 0-1, l: 0-1) → [r, g, b] (0-255)
   */
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
