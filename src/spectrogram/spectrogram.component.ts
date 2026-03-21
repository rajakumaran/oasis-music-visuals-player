import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, input, effect, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-spectrogram',
  standalone: true,
  template: `<canvas #canvas class="w-full h-full block"></canvas>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block w-full h-full' }
})
export class SpectrogramComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') private canvasRef!: ElementRef<HTMLCanvasElement>;

  bars = input.required<number[]>();
  beat = input.required<{ strength: number; timestamp: number }>();

  private ctx!: CanvasRenderingContext2D;
  private animFrameId: number | null = null;
  private resizeObserver!: ResizeObserver;
  private lastBeatTime = 0;

  // Pre-computed color LUT (256 entries) for the heatmap
  private colorLUT: { r: number; g: number; b: number }[] = [];

  constructor() {
    this.buildColorLUT();

    effect(() => {
      this.bars();
      this.beat();
    });
  }

  ngAfterViewInit(): void {
    const canvas = this.canvasRef.nativeElement;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true })!;
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
    // Use CSS pixel dimensions (not DPR scaled) for clean pixel scrolling
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;
    // Clear on resize
    this.ctx.fillStyle = '#030712';
    this.ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  /**
   * Builds a 256-entry color lookup table for the spectrogram heatmap.
   * Gradient: deep navy → electric blue → cyan → yellow → white hot
   */
  private buildColorLUT(): void {
    const stops = [
      { pos: 0,   r:  3, g:  7, b: 18 },   // Near black 
      { pos: 50,  r: 10, g: 20, b: 80 },   // Deep navy
      { pos: 100, r: 20, g: 60, b: 180 },  // Electric blue
      { pos: 150, r: 30, g: 200, b: 220 }, // Cyan
      { pos: 190, r: 80, g: 240, b: 120 }, // Green-cyan
      { pos: 210, r: 220, g: 220, b: 40 }, // Yellow
      { pos: 235, r: 255, g: 160, b: 50 }, // Orange
      { pos: 250, r: 255, g: 240, b: 200 },// White-hot
      { pos: 255, r: 255, g: 255, b: 255 },// Pure white
    ];

    this.colorLUT = new Array(256);
    for (let i = 0; i < 256; i++) {
      let lower = stops[0], upper = stops[stops.length - 1];
      for (let s = 0; s < stops.length - 1; s++) {
        if (i >= stops[s].pos && i <= stops[s + 1].pos) {
          lower = stops[s];
          upper = stops[s + 1];
          break;
        }
      }
      const t = upper.pos === lower.pos ? 0 : (i - lower.pos) / (upper.pos - lower.pos);
      this.colorLUT[i] = {
        r: Math.round(lower.r + (upper.r - lower.r) * t),
        g: Math.round(lower.g + (upper.g - lower.g) * t),
        b: Math.round(lower.b + (upper.b - lower.b) * t),
      };
    }
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

    if (w === 0 || h === 0 || bars.length === 0) return;

    // Scroll speed: 2px per frame for a smooth flow
    const scrollPx = 2;

    // Shift existing image to the left by scrollPx pixels
    const imageData = ctx.getImageData(scrollPx, 0, w - scrollPx, h);
    ctx.putImageData(imageData, 0, 0);

    // Beat flash detection
    let beatFlash = 0;
    if (beat.timestamp > this.lastBeatTime) {
      this.lastBeatTime = beat.timestamp;
      beatFlash = beat.strength;
    }

    // Draw new column(s) on the right edge
    const colImageData = ctx.createImageData(scrollPx, h);
    const pixels = colImageData.data;

    for (let y = 0; y < h; y++) {
      // Map y-position to a frequency bin (inverted: bass at bottom, treble at top)
      const freqIndex = Math.floor(((h - 1 - y) / (h - 1)) * (bars.length - 1));
      const energy = bars[freqIndex] || 0;

      // Map energy (0-1) to color index (0-255), with a slight gamma boost for drama
      const boosted = Math.pow(energy, 0.7); // Gamma < 1 = brighter midtones
      let colorIndex = Math.min(255, Math.floor(boosted * 255 + beatFlash * 40));
      const color = this.colorLUT[colorIndex];

      // Write the pixel(s) for each column in scrollPx
      for (let col = 0; col < scrollPx; col++) {
        const idx = (y * scrollPx + col) * 4;
        pixels[idx] = color.r;
        pixels[idx + 1] = color.g;
        pixels[idx + 2] = color.b;
        pixels[idx + 3] = 255;
      }
    }

    ctx.putImageData(colImageData, w - scrollPx, 0);

    // Frequency axis labels (subtle overlay)
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = `${10}px monospace`;
    ctx.textAlign = 'left';
    const freqLabels = ['16k', '8k', '4k', '2k', '1k', '500', '250', '125', '64', '32'];
    freqLabels.forEach((label, i) => {
      const y = (i / (freqLabels.length - 1)) * (h - 20) + 12;
      ctx.fillText(label, 4, y);
    });
  }
}
