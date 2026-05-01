import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, input, effect, ChangeDetectionStrategy } from '@angular/core';

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  size: number;
  hue: number;
}

@Component({
  selector: 'app-particle-storm',
  standalone: true,
  template: `<canvas #canvas class="w-full h-full block"></canvas>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block w-full h-full' }
})
export class ParticleStormComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') private canvasRef!: ElementRef<HTMLCanvasElement>;

  bars = input.required<number[]>();
  beat = input.required<{ strength: number; timestamp: number }>();
  musicProfile = input.required<'atmosphere' | 'rhythm' | 'transient'>();

  private ctx!: CanvasRenderingContext2D;
  private animFrameId: number | null = null;
  private resizeObserver!: ResizeObserver;
  private particles: Particle[] = [];
  private lastBeatTime = 0;
  private baseHue = 0;

  private readonly MAX_PARTICLES = 2000;

  constructor() {
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

  private animate = (): void => {
    this.draw();
    this.animFrameId = requestAnimationFrame(this.animate);
  };

  private draw(): void {
    const canvas = this.canvasRef.nativeElement;
    const ctx = this.ctx;
    const w = canvas.width;
    const h = canvas.height;
    const bars = this.bars();
    const beat = this.beat();
    const profile = this.musicProfile();

    if (w === 0 || h === 0 || bars.length === 0) return;

    const cx = w / 2;
    const cy = h / 2;

    // Energy bands
    const bassCount = Math.max(1, Math.floor(bars.length * 0.15));
    const trebleStart = Math.floor(bars.length * 0.7);
    const bass = bars.slice(0, bassCount).reduce((a, b) => a + b, 0) / bassCount;
    const mids = bars.slice(bassCount, trebleStart).reduce((a, b) => a + b, 0) / Math.max(1, trebleStart - bassCount);
    const treble = bars.slice(trebleStart).reduce((a, b) => a + b, 0) / Math.max(1, bars.length - trebleStart);
    const overall = bars.reduce((a, b) => a + b, 0) / bars.length;

    // Color temperature from profile
    if (profile === 'rhythm') this.baseHue += (30 - this.baseHue) * 0.02;       // Warm orange
    else if (profile === 'transient') this.baseHue += (280 - this.baseHue) * 0.02; // Electric purple
    else this.baseHue += (200 - this.baseHue) * 0.02;                             // Cool blue

    // Beat burst detection
    let beatBurst = false;
    if (beat.timestamp > this.lastBeatTime) {
      this.lastBeatTime = beat.timestamp;
      beatBurst = true;
    }

    // --- Spawn particles ---
    const spawnRate = Math.floor(3 + overall * 15 + (beatBurst ? 80 * beat.strength : 0));
    for (let i = 0; i < spawnRate && this.particles.length < this.MAX_PARTICLES; i++) {
      // Spawn from a frequency-mapped angle
      const binIndex = Math.floor(Math.random() * bars.length);
      const energy = bars[binIndex] || 0;
      const angle = (binIndex / bars.length) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      
      const spawnDist = 10 + Math.random() * 30;
      const speed = (1 + energy * 6 + (beatBurst ? beat.strength * 8 : 0)) * window.devicePixelRatio;

      this.particles.push({
        x: cx + Math.cos(angle) * spawnDist,
        y: cy + Math.sin(angle) * spawnDist,
        vx: Math.cos(angle) * speed * (0.5 + Math.random()),
        vy: Math.sin(angle) * speed * (0.5 + Math.random()),
        life: 1.0,
        maxLife: 60 + Math.random() * 90,
        size: (1 + energy * 3 + (beatBurst ? 2 : 0)) * window.devicePixelRatio,
        hue: this.baseHue + (binIndex / bars.length) * 60 - 30 + Math.random() * 20
      });
    }

    // --- Background with persistence (trail effect) ---
    ctx.fillStyle = `rgba(2, 2, 8, ${0.08 + (1 - overall) * 0.07})`;
    ctx.fillRect(0, 0, w, h);

    // --- Beat bloom flash ---
    if (beatBurst && beat.strength > 0.3) {
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.4);
      gradient.addColorStop(0, `hsla(${this.baseHue}, 100%, 70%, ${beat.strength * 0.15})`);
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
    }

    // --- Physics: gravity well from bass, centrifugal from treble ---
    const gravityStrength = bass * 0.4 * window.devicePixelRatio;
    const centrifugalStrength = treble * 0.15 * window.devicePixelRatio;

    // --- Update and render particles ---
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];

      // Gravity toward center (bass)
      const dx = cx - p.x;
      const dy = cy - p.y;
      const distSq = dx * dx + dy * dy;
      const dist = Math.sqrt(distSq) + 1;
      p.vx += (dx / dist) * gravityStrength;
      p.vy += (dy / dist) * gravityStrength;

      // Centrifugal (treble) — pushes outward
      p.vx -= (dx / dist) * centrifugalStrength;
      p.vy -= (dy / dist) * centrifugalStrength;

      // Orbital drift (mids create swirl)
      p.vx += (-dy / dist) * mids * 0.15;
      p.vy += (dx / dist) * mids * 0.15;

      // Friction
      p.vx *= 0.985;
      p.vy *= 0.985;

      // Move
      p.x += p.vx;
      p.y += p.vy;

      // Age
      p.life -= 1 / p.maxLife;

      // Remove dead or off-screen
      if (p.life <= 0 || p.x < -50 || p.x > w + 50 || p.y < -50 || p.y > h + 50) {
        this.particles.splice(i, 1);
        continue;
      }

      // Render
      const alpha = p.life * (0.6 + overall * 0.4);
      const lightness = 55 + p.life * 25;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue}, 90%, ${lightness}%, ${alpha})`;
      ctx.fill();
    }

    // --- Central core glow ---
    const coreRadius = (20 + bass * 60 + (beatBurst ? beat.strength * 40 : 0)) * window.devicePixelRatio;
    const coreGradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadius);
    coreGradient.addColorStop(0, `hsla(${this.baseHue}, 100%, 85%, ${0.3 + bass * 0.4})`);
    coreGradient.addColorStop(0.3, `hsla(${this.baseHue}, 90%, 60%, ${0.15 + bass * 0.2})`);
    coreGradient.addColorStop(1, 'transparent');
    ctx.fillStyle = coreGradient;
    ctx.beginPath();
    ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}
