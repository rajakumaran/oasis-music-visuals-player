import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, input, effect, ChangeDetectionStrategy } from '@angular/core';

/**
 * Cymatics — "Sound Made Visible"
 *
 * Inspired by Ernst Chladni's 18th-century experiments where bowing a metal plate
 * covered in sand causes the grains to migrate to the nodal lines (places of zero
 * vibration), forming mesmerizing geometric patterns.
 *
 * Here, ~2500 particles act as "grains of sand" on a virtual vibrating plate.
 * The Chladni equation  f(x,y) = sin(n·πx)·sin(m·πy) ± sin(m·πx)·sin(n·πy)
 * defines the vibration surface. Particles drift toward the nodal lines where f ≈ 0.
 *
 * Audio mapping:
 *   • Bass energy → the mode integers (n, m) — controls the pattern shape
 *   • Mids energy → particle drift speed / formation tightness
 *   • Treble energy → individual particle shimmer & vibration amplitude
 *   • Beat detection → triggers a "mode jump" where n,m snap to new values
 */

interface CymaticParticle {
  x: number;   // 0–1 normalized plate coordinates
  y: number;
  vx: number;
  vy: number;
  hue: number;
  size: number;
  settled: number; // 0–1, how settled this particle is on a nodal line
}

@Component({
  selector: 'app-cymatics',
  standalone: true,
  template: `<canvas #canvas class="w-full h-full block"></canvas>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block w-full h-full' }
})
export class CymaticsComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') private canvasRef!: ElementRef<HTMLCanvasElement>;

  bars = input.required<number[]>();
  beat = input.required<{ strength: number; timestamp: number }>();
  musicProfile = input.required<'atmosphere' | 'rhythm' | 'transient'>();

  private ctx!: CanvasRenderingContext2D;
  private animFrameId: number | null = null;
  private resizeObserver!: ResizeObserver;

  private particles: CymaticParticle[] = [];
  private lastBeatTime = 0;
  private baseHue = 200;

  // Current Chladni mode — smoothly interpolated
  private targetN = 3;
  private targetM = 5;
  private currentN = 3;
  private currentM = 5;

  // Mode jump cooldown
  private lastModeJumpTime = 0;
  private modeJumpFlash = 0;

  // Plate rotation for visual interest
  private plateRotation = 0;

  private readonly PARTICLE_COUNT = 2500;
  private readonly MODES = [
    [1, 2], [2, 3], [3, 4], [2, 5], [3, 5], [4, 5],
    [1, 4], [3, 7], [4, 7], [5, 6], [5, 8], [6, 7],
    [2, 7], [3, 8], [4, 9], [5, 7], [7, 8], [6, 9],
  ];

  constructor() {
    // Trigger change detection for inputs
    effect(() => {
      this.bars();
      this.beat();
      this.musicProfile();
    });
  }

  ngAfterViewInit(): void {
    const canvas = this.canvasRef.nativeElement;
    this.ctx = canvas.getContext('2d')!;
    this.handleResize();
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(canvas.parentElement!);
    this.initParticles();
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

  private initParticles(): void {
    this.particles = [];
    for (let i = 0; i < this.PARTICLE_COUNT; i++) {
      this.particles.push({
        x: Math.random(),
        y: Math.random(),
        vx: 0,
        vy: 0,
        hue: 190 + Math.random() * 40,
        size: 0.8 + Math.random() * 1.2,
        settled: 0,
      });
    }
  }

  private animate = (): void => {
    this.draw();
    this.animFrameId = requestAnimationFrame(this.animate);
  };

  /**
   * The Chladni equation: f(x,y) = sin(n·π·x)·sin(m·π·y) + sin(m·π·x)·sin(n·π·y)
   * Nodal lines are where f ≈ 0.
   * The sign variant (+ vs -) produces different pattern families.
   */
  private chladni(x: number, y: number, n: number, m: number): number {
    const nx = n * Math.PI * x;
    const ny = n * Math.PI * y;
    const mx = m * Math.PI * x;
    const my = m * Math.PI * y;
    return Math.sin(nx) * Math.sin(my) + Math.sin(mx) * Math.sin(ny);
  }

  /**
   * Numerical gradient of the Chladni function.
   * Particles follow -gradient(|f|²) to reach nodal lines (minima of |f|).
   */
  private chladniGradient(x: number, y: number, n: number, m: number): { gx: number; gy: number } {
    const eps = 0.002;
    const f = this.chladni(x, y, n, m);
    const fx = this.chladni(x + eps, y, n, m);
    const fy = this.chladni(x, y + eps, n, m);

    // Gradient of f² (which has minima at nodal lines)
    const gx = (fx * fx - f * f) / eps;
    const gy = (fy * fy - f * f) / eps;
    return { gx, gy };
  }

  private draw(): void {
    const canvas = this.canvasRef.nativeElement;
    const ctx = this.ctx;
    const w = canvas.width;
    const h = canvas.height;
    const bars = this.bars();
    const beat = this.beat();
    const profile = this.musicProfile();

    if (w === 0 || h === 0 || bars.length === 0) return;

    const dpr = window.devicePixelRatio;

    // --- Frequency analysis ---
    const bassCount = Math.max(1, Math.floor(bars.length * 0.15));
    const trebleStart = Math.floor(bars.length * 0.7);
    const bass = bars.slice(0, bassCount).reduce((a, b) => a + b, 0) / bassCount;
    const mids = bars.slice(bassCount, trebleStart).reduce((a, b) => a + b, 0) / Math.max(1, trebleStart - bassCount);
    const treble = bars.slice(trebleStart).reduce((a, b) => a + b, 0) / Math.max(1, bars.length - trebleStart);
    const overall = bars.reduce((a, b) => a + b, 0) / bars.length;

    // --- Color from music profile ---
    if (profile === 'rhythm') this.baseHue += (320 - this.baseHue) * 0.015;       // Magenta/pink
    else if (profile === 'transient') this.baseHue += (180 - this.baseHue) * 0.015; // Cyan
    else this.baseHue += (260 - this.baseHue) * 0.015;                              // Purple/indigo

    // --- Beat detection → mode jump ---
    const now = performance.now();
    let beatBurst = false;
    if (beat.timestamp > this.lastBeatTime) {
      this.lastBeatTime = beat.timestamp;
      beatBurst = true;

      // Mode jump: pick a new Chladni pattern on strong beats
      if (beat.strength > 0.35 && now - this.lastModeJumpTime > 800) {
        this.lastModeJumpTime = now;
        this.modeJumpFlash = beat.strength;

        // Pick a mode influenced by bass energy
        const modeIndex = Math.floor(bass * (this.MODES.length - 1)) % this.MODES.length;
        const altIndex = (modeIndex + Math.floor(Math.random() * 4) + 1) % this.MODES.length;
        const chosen = Math.random() > 0.5 ? this.MODES[modeIndex] : this.MODES[altIndex];
        this.targetN = chosen[0];
        this.targetM = chosen[1];
      }
    }

    // Smoothly interpolate current mode toward target
    this.currentN += (this.targetN - this.currentN) * 0.04;
    this.currentM += (this.targetM - this.currentM) * 0.04;

    // Flash decay
    this.modeJumpFlash *= 0.88;

    // Plate rotation — slow, bass-driven
    this.plateRotation += 0.0005 + bass * 0.002;

    // --- Background ---
    ctx.fillStyle = `rgba(2, 2, 6, ${0.12 + (1 - overall) * 0.08})`;
    ctx.fillRect(0, 0, w, h);

    // --- Circular plate boundary ---
    const cx = w / 2;
    const cy = h / 2;
    const plateRadius = Math.min(cx, cy) * 0.88;

    // Subtle plate edge ring
    ctx.strokeStyle = `hsla(${this.baseHue}, 60%, 30%, ${0.15 + overall * 0.2})`;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(cx, cy, plateRadius, 0, Math.PI * 2);
    ctx.stroke();

    // Outer glow ring
    ctx.strokeStyle = `hsla(${this.baseHue}, 80%, 50%, ${0.05 + overall * 0.1})`;
    ctx.lineWidth = 6 * dpr;
    ctx.beginPath();
    ctx.arc(cx, cy, plateRadius + 4 * dpr, 0, Math.PI * 2);
    ctx.stroke();

    // --- Mode jump flash ---
    if (this.modeJumpFlash > 0.05) {
      const flashGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, plateRadius);
      flashGrad.addColorStop(0, `hsla(${this.baseHue + 30}, 100%, 80%, ${this.modeJumpFlash * 0.12})`);
      flashGrad.addColorStop(0.5, `hsla(${this.baseHue}, 100%, 60%, ${this.modeJumpFlash * 0.06})`);
      flashGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = flashGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, plateRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- Particle physics & rendering ---
    const n = this.currentN;
    const m = this.currentM;
    const driftStrength = 0.008 + mids * 0.025;    // How aggressively particles seek nodal lines
    const trembleAmp = 0.001 + treble * 0.006;    // High-freq shimmer on particles
    const friction = 0.75 + (1 - mids) * 0.15;    // Damping (tight formations when mids are high)
    const cos_r = Math.cos(this.plateRotation);
    const sin_r = Math.sin(this.plateRotation);

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];

      // Rotate particle coordinates for the Chladni computation (plate rotates)
      const rx = (p.x - 0.5) * cos_r - (p.y - 0.5) * sin_r + 0.5;
      const ry = (p.x - 0.5) * sin_r + (p.y - 0.5) * cos_r + 0.5;

      // Compute gradient of |f|² to push toward nodal lines
      const grad = this.chladniGradient(rx, ry, n, m);

      // Apply drift force toward nodal lines
      p.vx -= grad.gx * driftStrength;
      p.vy -= grad.gy * driftStrength;

      // Treble shimmer (random micro-vibration)
      p.vx += (Math.random() - 0.5) * trembleAmp;
      p.vy += (Math.random() - 0.5) * trembleAmp;

      // Beat burst — scatter particles briefly for dramatic reorganization
      if (beatBurst && beat.strength > 0.3) {
        p.vx += (Math.random() - 0.5) * beat.strength * 0.015;
        p.vy += (Math.random() - 0.5) * beat.strength * 0.015;
      }

      // Friction
      p.vx *= friction;
      p.vy *= friction;

      // Move
      p.x += p.vx;
      p.y += p.vy;

      // Circular boundary — reflect particles back into the plate
      const dx = p.x - 0.5;
      const dy = p.y - 0.5;
      const distFromCenter = Math.sqrt(dx * dx + dy * dy);
      if (distFromCenter > 0.44) {
        // Push back inward
        const angle = Math.atan2(dy, dx);
        p.x = 0.5 + Math.cos(angle) * 0.43;
        p.y = 0.5 + Math.sin(angle) * 0.43;
        p.vx *= -0.3;
        p.vy *= -0.3;
      }

      // Settled-ness: how close to a nodal line
      const f = Math.abs(this.chladni(rx, ry, n, m));
      p.settled += ((f < 0.15 ? 1 : 0) - p.settled) * 0.1;

      // --- Render particle ---
      const screenX = cx + (p.x - 0.5) * plateRadius * 2;
      const screenY = cy + (p.y - 0.5) * plateRadius * 2;

      // Color: settled particles glow brighter, frequency-mapped hue
      const lightness = 45 + p.settled * 35 + overall * 15;
      const saturation = 70 + p.settled * 25;
      const alpha = 0.3 + p.settled * 0.55 + overall * 0.15;
      const particleSize = (p.size + p.settled * 0.8 + bass * 0.5) * dpr;

      p.hue += ((this.baseHue + distFromCenter * 60 - 30) - p.hue) * 0.02;

      ctx.beginPath();
      ctx.arc(screenX, screenY, particleSize, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue}, ${saturation}%, ${lightness}%, ${alpha})`;
      ctx.fill();
    }

    // --- Central core glow (bass-reactive) ---
    const coreRadius = (15 + bass * 40 + (beatBurst ? beat.strength * 25 : 0)) * dpr;
    const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadius);
    coreGrad.addColorStop(0, `hsla(${this.baseHue + 20}, 100%, 85%, ${0.08 + bass * 0.12})`);
    coreGrad.addColorStop(0.4, `hsla(${this.baseHue}, 90%, 60%, ${0.04 + bass * 0.06})`);
    coreGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
    ctx.fill();

    // --- Nodal line ghost overlay (very subtle visualization of the current pattern) ---
    if (overall > 0.1) {
      const ghostRes = 80;
      const ghostAlpha = 0.02 + overall * 0.03;
      for (let gx = 0; gx < ghostRes; gx++) {
        for (let gy = 0; gy < ghostRes; gy++) {
          const px = gx / ghostRes;
          const py = gy / ghostRes;
          const gdx = px - 0.5;
          const gdy = py - 0.5;
          if (gdx * gdx + gdy * gdy > 0.44 * 0.44) continue; // Skip outside plate

          const rpx = (px - 0.5) * cos_r - (py - 0.5) * sin_r + 0.5;
          const rpy = (px - 0.5) * sin_r + (py - 0.5) * cos_r + 0.5;
          const fVal = Math.abs(this.chladni(rpx, rpy, n, m));

          if (fVal < 0.08) {
            const sx = cx + (px - 0.5) * plateRadius * 2;
            const sy = cy + (py - 0.5) * plateRadius * 2;
            ctx.fillStyle = `hsla(${this.baseHue + 40}, 80%, 70%, ${ghostAlpha * (1 - fVal / 0.08)})`;
            ctx.fillRect(sx - dpr, sy - dpr, 2 * dpr, 2 * dpr);
          }
        }
      }
    }
  }
}
