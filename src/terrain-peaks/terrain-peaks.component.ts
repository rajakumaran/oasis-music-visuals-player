import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, input, effect, ChangeDetectionStrategy } from '@angular/core';

interface TerrainLayer {
  points: number[]; // Height values for each x-sample
  scrollOffset: number;
  speed: number;
  depth: number; // 0 = foreground, 1 = background
  freqStart: number; // Which frequency range drives this layer
  freqEnd: number;
}

@Component({
  selector: 'app-terrain-peaks',
  standalone: true,
  template: `<canvas #canvas class="w-full h-full block"></canvas>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block w-full h-full' }
})
export class TerrainPeaksComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') private canvasRef!: ElementRef<HTMLCanvasElement>;

  bars = input.required<number[]>();
  beat = input.required<{ strength: number; timestamp: number }>();
  musicProfile = input.required<'atmosphere' | 'rhythm' | 'transient'>();

  private ctx!: CanvasRenderingContext2D;
  private animFrameId: number | null = null;
  private resizeObserver!: ResizeObserver;
  private lastBeatTime = 0;
  private lightningFlash = 0;
  private layers: TerrainLayer[] = [];
  private starField: { x: number; y: number; size: number; twinklePhase: number }[] = [];

  private readonly NUM_LAYERS = 4;
  private readonly SAMPLES = 120;

  constructor() {
    this.initLayers();
    this.initStars();

    effect(() => {
      this.bars();
      this.beat();
      this.musicProfile();
    });
  }

  private initLayers(): void {
    this.layers = [];
    for (let i = 0; i < this.NUM_LAYERS; i++) {
      const depth = i / (this.NUM_LAYERS - 1); // 0 = front, 1 = back
      const freqBand = i / this.NUM_LAYERS;
      this.layers.push({
        points: new Array(this.SAMPLES).fill(0),
        scrollOffset: 0,
        speed: 0.3 + (1 - depth) * 1.2, // Foreground scrolls faster (parallax)
        depth,
        freqStart: freqBand,
        freqEnd: freqBand + 1 / this.NUM_LAYERS,
      });
    }
  }

  private initStars(): void {
    this.starField = [];
    for (let i = 0; i < 200; i++) {
      this.starField.push({
        x: Math.random(),
        y: Math.random() * 0.6, // Stars in the upper 60% of the screen
        size: 0.5 + Math.random() * 1.5,
        twinklePhase: Math.random() * Math.PI * 2,
      });
    }
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

    const overall = bars.reduce((a, b) => a + b, 0) / bars.length;
    const bass = bars.slice(0, Math.max(1, Math.floor(bars.length * 0.15))).reduce((a, b) => a + b, 0) / Math.max(1, Math.floor(bars.length * 0.15));
    const treble = bars.slice(Math.floor(bars.length * 0.7)).reduce((a, b) => a + b, 0) / Math.max(1, bars.length - Math.floor(bars.length * 0.7));

    // Beat lightning
    if (beat.timestamp > this.lastBeatTime) {
      this.lastBeatTime = beat.timestamp;
      if (beat.strength > 0.4) {
        this.lightningFlash = beat.strength;
      }
    }
    this.lightningFlash *= 0.85;

    // Color palette from profile
    let skyTop: string, skyBottom: string, mountainHue: number;
    if (profile === 'rhythm') {
      skyTop = '#0a0520'; skyBottom = '#1a0a2e';
      mountainHue = 270; // Purple mountains
    } else if (profile === 'transient') {
      skyTop = '#050a14'; skyBottom = '#0a1428';
      mountainHue = 200; // Blue-cyan mountains
    } else {
      skyTop = '#0a0808'; skyBottom = '#1a0e0a';
      mountainHue = 20; // Warm amber mountains
    }

    // --- Sky gradient ---
    const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
    skyGrad.addColorStop(0, skyTop);
    skyGrad.addColorStop(0.5, skyBottom);
    skyGrad.addColorStop(1, `hsl(${mountainHue}, 30%, 5%)`);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, h);

    // --- Stars ---
    const time = performance.now() / 1000;
    for (const star of this.starField) {
      const twinkle = 0.3 + 0.7 * Math.sin(time * 2 + star.twinklePhase);
      const alpha = twinkle * (0.4 + treble * 0.6);
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.beginPath();
      const sx = star.x * w;
      const sy = star.y * h;
      ctx.arc(sx, sy, star.size * window.devicePixelRatio, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- Lightning flash ---
    if (this.lightningFlash > 0.05) {
      ctx.fillStyle = `rgba(200, 220, 255, ${this.lightningFlash * 0.2})`;
      ctx.fillRect(0, 0, w, h);

      // Lightning bolt
      const boltX = w * (0.3 + Math.random() * 0.4);
      ctx.strokeStyle = `rgba(200, 220, 255, ${this.lightningFlash * 0.8})`;
      ctx.lineWidth = (1 + this.lightningFlash * 2) * window.devicePixelRatio;
      ctx.beginPath();
      ctx.moveTo(boltX, 0);
      let by = 0;
      while (by < h * 0.6) {
        by += 10 + Math.random() * 30;
        const bxx = boltX + (Math.random() - 0.5) * 60;
        ctx.lineTo(bxx, by);
      }
      ctx.stroke();
    }

    // --- Terrain layers (back to front for proper occlusion) ---
    for (let li = this.layers.length - 1; li >= 0; li--) {
      const layer = this.layers[li];

      // Scroll
      layer.scrollOffset += layer.speed;

      // Get frequency bins for this layer
      const startBin = Math.floor(layer.freqStart * bars.length);
      const endBin = Math.floor(layer.freqEnd * bars.length);
      const layerBins = bars.slice(startBin, endBin);
      const layerEnergy = layerBins.length > 0 ? layerBins.reduce((a, b) => a + b, 0) / layerBins.length : 0;

      // Update terrain heights
      for (let s = 0; s < this.SAMPLES; s++) {
        const binIndex = Math.floor((s / this.SAMPLES) * layerBins.length);
        const energy = layerBins[binIndex] || 0;

        // Target height based on frequency energy
        const baseHeight = 0.05 + (1 - layer.depth) * 0.1; // Foreground layers are taller
        const peakHeight = baseHeight + energy * (0.25 + (1 - layer.depth) * 0.15);

        // Smooth toward target
        layer.points[s] += (peakHeight - layer.points[s]) * (0.15 + (1 - layer.depth) * 0.1);

        // Add bass rumble to foreground layers
        if (layer.depth < 0.5) {
          layer.points[s] += Math.sin(time * 3 + s * 0.3) * bass * 0.02;
        }
      }

      // Vertical position: back layers are higher on screen
      const layerBaseY = h * (0.4 + layer.depth * 0.25);

      // Colors: deeper layers are hazier and cooler
      const layerLightness = 15 + (1 - layer.depth) * 20;
      const layerSaturation = 40 + (1 - layer.depth) * 30;
      const layerAlpha = 0.6 + (1 - layer.depth) * 0.4;

      // Draw filled mountain silhouette
      ctx.beginPath();
      ctx.moveTo(0, h);

      for (let s = 0; s <= this.SAMPLES; s++) {
        const x = (s / this.SAMPLES) * w;
        const peakH = layer.points[Math.min(s, this.SAMPLES - 1)] * h;
        const y = layerBaseY - peakH;

        if (s === 0) ctx.lineTo(0, y);
        else {
          // Smooth curve between points
          const prevX = ((s - 1) / this.SAMPLES) * w;
          const prevH = layer.points[Math.max(0, s - 1)] * h;
          const prevY = layerBaseY - prevH;
          const cpx = (prevX + x) / 2;
          ctx.quadraticCurveTo(prevX, prevY, cpx, (prevY + y) / 2);
        }
      }
      ctx.lineTo(w, h);
      ctx.closePath();

      // Mountain gradient
      const mountainGrad = ctx.createLinearGradient(0, layerBaseY - h * 0.4, 0, h);
      mountainGrad.addColorStop(0, `hsla(${mountainHue + layer.depth * 20}, ${layerSaturation}%, ${layerLightness + layerEnergy * 25}%, ${layerAlpha})`);
      mountainGrad.addColorStop(0.4, `hsla(${mountainHue + layer.depth * 10}, ${layerSaturation * 0.7}%, ${layerLightness * 0.6}%, ${layerAlpha})`);
      mountainGrad.addColorStop(1, `hsla(${mountainHue}, 20%, 3%, ${layerAlpha})`);
      ctx.fillStyle = mountainGrad;
      ctx.fill();

      // Edge glow on foreground layers
      if (layer.depth < 0.3 && layerEnergy > 0.2) {
        ctx.strokeStyle = `hsla(${mountainHue}, 80%, ${50 + layerEnergy * 30}%, ${layerEnergy * 0.4})`;
        ctx.lineWidth = (1 + layerEnergy * 2) * window.devicePixelRatio;
        ctx.stroke();
      }
    }

    // --- Ground fog ---
    const fogGrad = ctx.createLinearGradient(0, h * 0.7, 0, h);
    fogGrad.addColorStop(0, 'transparent');
    fogGrad.addColorStop(1, `hsla(${mountainHue}, 30%, 8%, ${0.3 + bass * 0.3})`);
    ctx.fillStyle = fogGrad;
    ctx.fillRect(0, 0, w, h);
  }
}
