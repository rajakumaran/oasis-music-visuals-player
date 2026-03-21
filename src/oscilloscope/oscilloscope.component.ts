import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, input, effect, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-oscilloscope',
  standalone: true,
  template: `<canvas #canvas class="w-full h-full block"></canvas>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block w-full h-full' }
})
export class OscilloscopeComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') private canvasRef!: ElementRef<HTMLCanvasElement>;

  timeDomainData = input.required<Uint8Array>();
  bars = input.required<number[]>();
  beat = input.required<{ strength: number; timestamp: number }>();
  musicProfile = input.required<'atmosphere' | 'rhythm' | 'transient'>();

  private ctx!: CanvasRenderingContext2D;
  private animFrameId: number | null = null;
  private lastBeatTime = 0;
  private bloomIntensity = 0;
  private resizeObserver!: ResizeObserver;

  constructor() {
    effect(() => {
      // Read all signals to register as dependencies
      this.timeDomainData();
      this.bars();
      this.beat();
      this.musicProfile();
      // Drawing happens in the rAF loop
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
    const data = this.timeDomainData();
    const bars = this.bars();
    const beat = this.beat();
    const profile = this.musicProfile();

    // Calculate energy bands
    const bass = bars.slice(0, Math.max(1, Math.floor(bars.length * 0.15))).reduce((a, b) => a + b, 0) / Math.max(1, Math.floor(bars.length * 0.15));
    const overallEnergy = bars.reduce((a, b) => a + b, 0) / Math.max(1, bars.length);

    // Beat bloom
    if (beat.timestamp > this.lastBeatTime) {
      this.lastBeatTime = beat.timestamp;
      this.bloomIntensity = Math.min(1, beat.strength * 1.5);
    }
    this.bloomIntensity *= 0.92;

    // --- Background: dark CRT with grid ---
    ctx.fillStyle = `rgba(5, 8, 12, ${0.25 + (1 - overallEnergy) * 0.15})`; // Persistence / phosphor trail
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = `rgba(30, 60, 40, ${0.15 + bass * 0.1})`;
    ctx.lineWidth = 1;
    const gridSpacingX = w / 12;
    const gridSpacingY = h / 8;
    ctx.beginPath();
    for (let x = gridSpacingX; x < w; x += gridSpacingX) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = gridSpacingY; y < h; y += gridSpacingY) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    // Center cross-hair (brighter)
    ctx.strokeStyle = `rgba(40, 80, 50, ${0.3 + bass * 0.1})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
    ctx.stroke();

    // --- Trace color from music profile ---
    let traceHue: number, traceSat: number;
    if (profile === 'atmosphere') { traceHue = 200; traceSat = 80; }      // Cool blue
    else if (profile === 'transient') { traceHue = 320; traceSat = 90; }   // Hot pink
    else { traceHue = 140; traceSat = 85; }                                // Electric green (classic)

    const traceColor = `hsl(${traceHue}, ${traceSat}%, ${55 + overallEnergy * 20}%)`;
    const glowColor = `hsla(${traceHue}, ${traceSat}%, 60%, ${0.3 + this.bloomIntensity * 0.4})`;

    // --- Draw the waveform trace ---
    if (data.length > 0) {
      const sliceWidth = w / data.length;

      // Outer glow layer (wide, soft)
      ctx.save();
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 15 + bass * 25 + this.bloomIntensity * 30;
      ctx.strokeStyle = traceColor;
      ctx.lineWidth = (2 + bass * 3 + this.bloomIntensity * 4) * window.devicePixelRatio;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const v = data[i] / 128.0; // Normalize: 128 = silence (center)
        const y = (v * h) / 2;
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * sliceWidth, y);
      }
      ctx.stroke();
      ctx.restore();

      // Inner bright trace layer (thin, sharp)
      ctx.strokeStyle = `hsla(${traceHue}, 100%, ${75 + this.bloomIntensity * 20}%, 0.9)`;
      ctx.lineWidth = (1 + bass * 1.5) * window.devicePixelRatio;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const v = data[i] / 128.0;
        const y = (v * h) / 2;
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * sliceWidth, y);
      }
      ctx.stroke();
    }

    // --- Beat bloom flash ---
    if (this.bloomIntensity > 0.05) {
      ctx.fillStyle = `hsla(${traceHue}, 100%, 70%, ${this.bloomIntensity * 0.08})`;
      ctx.fillRect(0, 0, w, h);
    }

    // --- CRT scanline overlay ---
    ctx.fillStyle = 'rgba(0,0,0,0.03)';
    for (let y = 0; y < h; y += 3 * window.devicePixelRatio) {
      ctx.fillRect(0, y, w, 1);
    }

    // --- Vignette edges ---
    const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
  }
}
