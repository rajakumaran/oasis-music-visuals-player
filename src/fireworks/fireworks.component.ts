import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, input, effect, ChangeDetectionStrategy } from '@angular/core';

/**
 * Fireworks Visualizer — Music-Reactive Pyrotechnics
 *
 * Fireworks launch from the base of the screen, rise upward, and explode
 * into multi-color sparks that fade. Each frequency band drives a launch
 * position (like LED bars), and beats trigger burst explosions.
 */

interface Spark {
  x: number; y: number;
  vx: number; vy: number;
  life: number;
  hue: number; sat: number; light: number;
  size: number;
  trail: { x: number; y: number }[];
}

interface Rocket {
  x: number; y: number;
  vy: number;
  targetY: number;
  hue: number;
  bandIndex: number;
  energy: number;
  trail: { x: number; y: number; alpha: number }[];
  exploded: boolean;
}

@Component({
  selector: 'app-fireworks',
  standalone: true,
  template: `<canvas #canvas class="w-full h-full block"></canvas>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block w-full h-full' }
})
export class FireworksComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') private canvasRef!: ElementRef<HTMLCanvasElement>;

  bars = input.required<number[]>();
  beat = input.required<{ strength: number; timestamp: number }>();
  musicProfile = input.required<'atmosphere' | 'rhythm' | 'transient'>();

  private ctx!: CanvasRenderingContext2D;
  private animFrameId: number | null = null;
  private resizeObserver!: ResizeObserver;

  private rockets: Rocket[] = [];
  private sparks: Spark[] = [];
  private lastBeatTime = 0;
  private frameCount = 0;

  private readonly MAX_SPARKS = 3000;
  private readonly MAX_ROCKETS = 30;

  // Multi-color palette for explosions
  private readonly FIREWORK_HUES = [
    0,    // Red
    30,   // Orange
    55,   // Gold
    120,  // Green
    180,  // Cyan
    220,  // Blue
    280,  // Purple
    320,  // Magenta
    45,   // Amber
    340,  // Pink
  ];

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
    const dpr = window.devicePixelRatio;

    if (w === 0 || h === 0 || bars.length === 0) return;
    this.frameCount++;

    // Energy analysis
    const bassCount = Math.max(1, Math.floor(bars.length * 0.15));
    const trebleStart = Math.floor(bars.length * 0.7);
    const bass = bars.slice(0, bassCount).reduce((a, b) => a + b, 0) / bassCount;
    const overall = bars.reduce((a, b) => a + b, 0) / bars.length;

    // Beat detection
    let beatBurst = false;
    if (beat.timestamp > this.lastBeatTime) {
      this.lastBeatTime = beat.timestamp;
      beatBurst = true;
    }

    // --- Launch rockets from frequency bands ---
    // Each bar position maps to a horizontal launch point (like LED positions)
    const numBands = Math.min(bars.length, 20); // Use up to 20 bands
    const bandWidth = w / numBands;

    // Launch rockets on beats or when individual bands are strong
    if (beatBurst && beat.strength > 0.2 && this.rockets.length < this.MAX_ROCKETS) {
      // Big beat = multiple rockets
      const launchCount = Math.floor(1 + beat.strength * 4);
      for (let i = 0; i < launchCount; i++) {
        const bandIdx = Math.floor(Math.random() * numBands);
        const energy = bars[Math.floor(bandIdx * bars.length / numBands)] || 0;
        if (energy > 0.05) {
          this.launchRocket(bandIdx, numBands, w, h, energy, dpr);
        }
      }
    }

    // Continuous: strong frequency bands sporadically launch
    if (this.frameCount % 4 === 0) {
      for (let b = 0; b < numBands; b++) {
        const energy = bars[Math.floor(b * bars.length / numBands)] || 0;
        if (energy > 0.4 && Math.random() < energy * 0.15 && this.rockets.length < this.MAX_ROCKETS) {
          this.launchRocket(b, numBands, w, h, energy, dpr);
        }
      }
    }

    // --- Dark sky background with fade trail ---
    ctx.fillStyle = `rgba(2, 1, 8, 0.15)`;
    ctx.fillRect(0, 0, w, h);

    // --- Ground glow reflection ---
    const groundGrad = ctx.createLinearGradient(0, h - 40 * dpr, 0, h);
    groundGrad.addColorStop(0, 'transparent');
    groundGrad.addColorStop(1, `rgba(40, 20, 10, ${0.3 + overall * 0.3})`);
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, h - 40 * dpr, w, 40 * dpr);

    // --- Update and render rockets ---
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];

      if (!r.exploded) {
        // Rise upward
        r.y += r.vy;
        r.vy *= 0.985; // Slight deceleration

        // Add trail point
        r.trail.push({ x: r.x, y: r.y, alpha: 1 });
        if (r.trail.length > 15) r.trail.shift();

        // Draw rocket trail (bright ascending line)
        for (let t = 0; t < r.trail.length; t++) {
          const tp = r.trail[t];
          const trailAlpha = (t / r.trail.length) * 0.8;
          ctx.beginPath();
          ctx.arc(tp.x, tp.y, (1 + t * 0.3) * dpr, 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${r.hue}, 80%, 85%, ${trailAlpha})`;
          ctx.fill();
        }

        // Draw rocket head
        ctx.beginPath();
        ctx.arc(r.x, r.y, 2.5 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${r.hue}, 100%, 95%, 1)`;
        ctx.fill();

        // Check if reached target height → EXPLODE!
        if (r.y <= r.targetY || r.vy > -1 * dpr) {
          r.exploded = true;
          this.explodeRocket(r, dpr);
        }
      } else {
        // Rocket has exploded, remove it
        this.rockets.splice(i, 1);
      }
    }

    // --- Update and render sparks ---
    const gravity = 0.12 * dpr;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];

      // Physics
      s.vy += gravity; // Gravity pulls down
      s.vx *= 0.98;    // Air resistance
      s.vy *= 0.98;
      s.x += s.vx;
      s.y += s.vy;

      // Age
      s.life -= 0.012;

      // Store trail
      s.trail.push({ x: s.x, y: s.y });
      if (s.trail.length > 5) s.trail.shift();

      // Remove dead sparks
      if (s.life <= 0 || s.y > h + 20) {
        this.sparks.splice(i, 1);
        continue;
      }

      // Draw spark trail
      for (let t = 0; t < s.trail.length; t++) {
        const tp = s.trail[t];
        const trailAlpha = (t / s.trail.length) * s.life * 0.4;
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, s.size * 0.5 * s.life, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${s.hue}, ${s.sat}%, ${s.light}%, ${trailAlpha})`;
        ctx.fill();
      }

      // Draw spark
      const alpha = s.life * s.life; // Quadratic fade for sparkle feel
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size * Math.max(0.3, s.life), 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${s.hue}, ${s.sat}%, ${s.light}%, ${alpha})`;
      ctx.fill();

      // Bright core for fresh sparks
      if (s.life > 0.7) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size * 0.4 * s.life, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${s.hue}, 40%, 95%, ${(s.life - 0.7) * 3})`;
        ctx.fill();
      }
    }

    // --- Beat flash (sky illumination) ---
    if (beatBurst && beat.strength > 0.4) {
      ctx.fillStyle = `rgba(255, 240, 220, ${beat.strength * 0.04})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  private launchRocket(bandIdx: number, numBands: number, w: number, h: number, energy: number, dpr: number): void {
    const x = (bandIdx + 0.5) * (w / numBands) + (Math.random() - 0.5) * (w / numBands) * 0.4;
    const hue = this.FIREWORK_HUES[Math.floor(Math.random() * this.FIREWORK_HUES.length)];

    // Higher energy = higher launch
    const targetY = h * (0.15 + (1 - energy) * 0.35) + Math.random() * h * 0.1;

    this.rockets.push({
      x,
      y: h, // Start from bottom
      vy: -(6 + energy * 8) * dpr, // Launch speed
      targetY,
      hue,
      bandIndex: bandIdx,
      energy,
      trail: [],
      exploded: false,
    });
  }

  private explodeRocket(rocket: Rocket, dpr: number): void {
    // Choose explosion style
    const style = Math.random();
    const sparkCount = Math.floor(40 + rocket.energy * 80);
    const baseHue = rocket.hue;

    // Multi-color: 2-3 colors per explosion
    const colors = [
      baseHue,
      (baseHue + 30 + Math.random() * 60) % 360,
      (baseHue + 180 + Math.random() * 60) % 360,
    ];

    if (style < 0.4) {
      // Spherical burst
      for (let i = 0; i < sparkCount && this.sparks.length < this.MAX_SPARKS; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = (2 + Math.random() * 5) * dpr * (0.5 + rocket.energy * 0.8);
        const colorHue = colors[Math.floor(Math.random() * colors.length)];
        this.sparks.push({
          x: rocket.x, y: rocket.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0.7 + Math.random() * 0.3,
          hue: colorHue + (Math.random() - 0.5) * 15,
          sat: 80 + Math.random() * 20,
          light: 55 + Math.random() * 30,
          size: (1.5 + Math.random() * 2.5) * dpr,
          trail: [],
        });
      }
    } else if (style < 0.7) {
      // Ring/Peony explosion
      const rings = 2 + Math.floor(Math.random() * 2);
      for (let ring = 0; ring < rings; ring++) {
        const ringSpeed = (3 + ring * 2) * dpr;
        const ringCount = Math.floor(sparkCount / rings);
        const ringHue = colors[ring % colors.length];
        for (let i = 0; i < ringCount && this.sparks.length < this.MAX_SPARKS; i++) {
          const angle = (i / ringCount) * Math.PI * 2 + Math.random() * 0.2;
          const speed = ringSpeed * (0.8 + Math.random() * 0.4);
          this.sparks.push({
            x: rocket.x, y: rocket.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 0.6 + Math.random() * 0.4,
            hue: ringHue + (Math.random() - 0.5) * 10,
            sat: 85 + Math.random() * 15,
            light: 60 + Math.random() * 25,
            size: (1.5 + Math.random() * 2) * dpr,
            trail: [],
          });
        }
      }
    } else {
      // Willow/Cascading — sparks fly up then weep downward
      for (let i = 0; i < sparkCount && this.sparks.length < this.MAX_SPARKS; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = (1 + Math.random() * 3.5) * dpr;
        const colorHue = colors[Math.floor(Math.random() * 2)];
        this.sparks.push({
          x: rocket.x, y: rocket.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 2 * dpr, // Initial upward bias
          life: 0.9 + Math.random() * 0.1, // Long-lived for weeping effect
          hue: colorHue,
          sat: 70 + Math.random() * 20,
          light: 65 + Math.random() * 25,
          size: (1 + Math.random() * 2) * dpr,
          trail: [],
        });
      }
    }
  }
}
