import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, input, effect, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-radar-pulse',
  standalone: true,
  template: `<canvas #canvas class="w-full h-full block"></canvas>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block w-full h-full' }
})
export class RadarPulseComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') private canvasRef!: ElementRef<HTMLCanvasElement>;

  bars = input.required<number[]>();
  beat = input.required<{ strength: number; timestamp: number }>();
  musicProfile = input.required<'atmosphere' | 'rhythm' | 'transient'>();

  private ctx!: CanvasRenderingContext2D;
  private animFrameId: number | null = null;
  private resizeObserver!: ResizeObserver;
  private sweepAngle = 0;
  private lastBeatTime = 0;
  private bloomIntensity = 0;

  // History buffer for phosphor afterglow (store last N frames of blip data)
  private blipHistory: { angle: number; dist: number; intensity: number; age: number }[] = [];

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
    const maxRadius = Math.min(w, h) * 0.44;

    // Energy bands
    const bass = bars.slice(0, Math.max(1, Math.floor(bars.length * 0.15))).reduce((a, b) => a + b, 0) / Math.max(1, Math.floor(bars.length * 0.15));
    const overall = bars.reduce((a, b) => a + b, 0) / bars.length;

    // Beat bloom
    if (beat.timestamp > this.lastBeatTime) {
      this.lastBeatTime = beat.timestamp;
      this.bloomIntensity = Math.min(1, beat.strength * 1.5);
    }
    this.bloomIntensity *= 0.92;

    // Color from profile
    let hue: number;
    if (profile === 'rhythm') hue = 140;       // Classic green
    else if (profile === 'transient') hue = 30; // Amber/orange
    else hue = 180;                              // Cyan

    // Sweep rotation speed: tied to bass
    const sweepSpeed = 0.015 + bass * 0.025;
    this.sweepAngle = (this.sweepAngle + sweepSpeed) % (Math.PI * 2);

    // --- Background: dark fade for phosphor persistence ---
    ctx.fillStyle = `rgba(2, 4, 2, ${0.06 + (1 - overall) * 0.04})`;
    ctx.fillRect(0, 0, w, h);

    // --- Range rings ---
    ctx.strokeStyle = `hsla(${hue}, 60%, 30%, 0.15)`;
    ctx.lineWidth = 1;
    for (let i = 1; i <= 5; i++) {
      const r = (i / 5) * maxRadius;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Cross-hair lines
    ctx.strokeStyle = `hsla(${hue}, 60%, 30%, 0.1)`;
    ctx.beginPath();
    ctx.moveTo(cx - maxRadius, cy); ctx.lineTo(cx + maxRadius, cy);
    ctx.moveTo(cx, cy - maxRadius); ctx.lineTo(cx, cy + maxRadius);
    ctx.stroke();

    // --- Record blips at current sweep position ---
    for (let i = 0; i < bars.length; i++) {
      const energy = bars[i];
      if (energy > 0.05) {
        const dist = ((i / bars.length) * 0.85 + 0.1) * maxRadius; // Bass near center, treble at edge
        this.blipHistory.push({
          angle: this.sweepAngle,
          dist,
          intensity: energy,
          age: 0
        });
      }
    }

    // --- Render blip history (phosphor afterglow) ---
    for (let i = this.blipHistory.length - 1; i >= 0; i--) {
      const blip = this.blipHistory[i];
      blip.age++;

      if (blip.age > 180) {
        this.blipHistory.splice(i, 1);
        continue;
      }

      const fadeAlpha = Math.max(0, (1 - blip.age / 180)) * blip.intensity;
      const bx = cx + Math.cos(blip.angle) * blip.dist;
      const by = cy + Math.sin(blip.angle) * blip.dist;
      const blipSize = (2 + blip.intensity * 4) * window.devicePixelRatio * (1 - blip.age / 300);

      ctx.beginPath();
      ctx.arc(bx, by, Math.max(0.5, blipSize), 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${hue}, 100%, ${60 + blip.intensity * 30}%, ${fadeAlpha * 0.7})`;
      ctx.fill();
    }

    // Cap history size
    if (this.blipHistory.length > 5000) {
      this.blipHistory = this.blipHistory.slice(-3000);
    }

    // --- Sweep line with gradient tail ---
    const tailArc = 0.6; // ~35 degrees of sweep tail
    const sweepGradient = ctx.createConicGradient(this.sweepAngle - tailArc, cx, cy);
    sweepGradient.addColorStop(0, 'transparent');
    sweepGradient.addColorStop(tailArc / (Math.PI * 2), `hsla(${hue}, 100%, 55%, ${0.15 + overall * 0.15})`);
    sweepGradient.addColorStop(tailArc / (Math.PI * 2) + 0.001, 'transparent');
    sweepGradient.addColorStop(1, 'transparent');
    
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, maxRadius, this.sweepAngle - tailArc, this.sweepAngle);
    ctx.closePath();
    ctx.fillStyle = sweepGradient;
    ctx.fill();

    // Sharp sweep edge line
    ctx.strokeStyle = `hsla(${hue}, 100%, 70%, ${0.6 + bass * 0.3})`;
    ctx.lineWidth = 2 * window.devicePixelRatio;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(this.sweepAngle) * maxRadius, cy + Math.sin(this.sweepAngle) * maxRadius);
    ctx.stroke();

    // --- Center dot ---
    const dotRadius = (3 + bass * 4) * window.devicePixelRatio;
    const dotGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, dotRadius * 3);
    dotGrad.addColorStop(0, `hsla(${hue}, 100%, 80%, 0.9)`);
    dotGrad.addColorStop(0.3, `hsla(${hue}, 80%, 50%, 0.4)`);
    dotGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = dotGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, dotRadius * 3, 0, Math.PI * 2);
    ctx.fill();

    // --- Beat bloom ---
    if (this.bloomIntensity > 0.05) {
      ctx.strokeStyle = `hsla(${hue}, 100%, 70%, ${this.bloomIntensity * 0.3})`;
      ctx.lineWidth = (2 + this.bloomIntensity * 3) * window.devicePixelRatio;
      ctx.beginPath();
      ctx.arc(cx, cy, maxRadius * (0.5 + this.bloomIntensity * 0.5), 0, Math.PI * 2);
      ctx.stroke();
    }

    // --- Outer ring ---
    ctx.strokeStyle = `hsla(${hue}, 60%, 40%, ${0.3 + overall * 0.2})`;
    ctx.lineWidth = 2 * window.devicePixelRatio;
    ctx.beginPath();
    ctx.arc(cx, cy, maxRadius, 0, Math.PI * 2);
    ctx.stroke();

    // --- CRT scanlines ---
    ctx.fillStyle = 'rgba(0,0,0,0.03)';
    for (let y = 0; y < h; y += 3 * window.devicePixelRatio) {
      ctx.fillRect(0, y, w, 1);
    }
  }
}
