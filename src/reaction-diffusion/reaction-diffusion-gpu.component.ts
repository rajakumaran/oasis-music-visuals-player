import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, input, effect, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-reaction-diffusion-gpu',
  standalone: true,
  template: `<canvas #canvas class="w-full h-full block"></canvas>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block w-full h-full' }
})
export class ReactionDiffusionGpuComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') private canvasRef!: ElementRef<HTMLCanvasElement>;

  // Inputs from AudioService (same as your current component)
  bars = input.required<number[]>();
  beat = input.required<{ strength: number; timestamp: number }>();
  musicProfile = input.required<'atmosphere' | 'rhythm' | 'transient'>();

  private gl!: WebGL2RenderingContext;
  private animFrameId: number | null = null;
  private resizeObserver!: ResizeObserver;

  // Ping-pong textures for simulation
  private readTexture!: WebGLTexture;
  private writeTexture!: WebGLTexture;
  private framebuffer!: WebGLFramebuffer;

  private simulationProgram!: WebGLProgram;
  private displayProgram!: WebGLProgram;

  private resolution = 512;           // Internal simulation resolution (quality vs performance)
  private displayWidth = 0;
  private displayHeight = 0;

  // Simulation parameters (will be modulated by audio)
  private f = 0.055;   // feed
  private k = 0.062;   // kill
  private Du = 1.0;
  private Dv = 0.5;

  private lastBeatTime = 0;
  private burstCooldown = 0;
  private baseHue = 200;

  constructor() {
    effect(() => {
      this.bars();
      this.beat();
      this.musicProfile();
    });
  }

  ngAfterViewInit(): void {
    const canvas = this.canvasRef.nativeElement;
    this.gl = canvas.getContext('webgl2', { 
      alpha: false, 
      depth: false, 
      stencil: false,
      antialias: false 
    })!;

    if (!this.gl) {
      console.error('WebGL2 not supported');
      return;
    }

    this.initShaders();
    this.initTextures();
    this.initBuffers();

    this.handleResize();
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(canvas.parentElement!);

    this.seedInitialPattern();
    this.animate();
  }

  ngOnDestroy(): void {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    this.resizeObserver?.disconnect();
  }

  private handleResize(): void {
    const canvas = this.canvasRef.nativeElement;
    const parent = canvas.parentElement!;
    
    this.displayWidth = parent.clientWidth * window.devicePixelRatio;
    this.displayHeight = parent.clientHeight * window.devicePixelRatio;

    canvas.width = this.displayWidth;
    canvas.height = this.displayHeight;

    // Update viewport for display pass
    this.gl.viewport(0, 0, this.displayWidth, this.displayHeight);
  }

  // ==================== SHADER SETUP ====================

  private initShaders(): void {
    // We'll define the actual GLSL code below
    this.simulationProgram = this.createProgram(this.vertexShaderSource, this.simulationFragmentSource);
    this.displayProgram = this.createProgram(this.vertexShaderSource, this.displayFragmentSource);
  }

  private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
    const program = this.gl.createProgram()!;
    const vShader = this.compileShader(this.gl.VERTEX_SHADER, vertexSource);
    const fShader = this.compileShader(this.gl.FRAGMENT_SHADER, fragmentSource);

    this.gl.attachShader(program, vShader);
    this.gl.attachShader(program, fShader);
    this.gl.linkProgram(program);

    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      console.error('Shader program failed to link:', this.gl.getProgramInfoLog(program));
    }
    return program;
  }

  private compileShader(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type)!;
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', this.gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  // ==================== TEXTURES & BUFFERS ====================

  private initTextures(): void {
    // Create two textures for ping-pong (U and V packed in RGBA)
    this.readTexture = this.createDataTexture();
    this.writeTexture = this.createDataTexture();

    this.framebuffer = this.gl.createFramebuffer()!;
  }

  private createDataTexture(): WebGLTexture {
    const texture = this.gl.createTexture()!;
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA32F, this.resolution, this.resolution, 0,
                       this.gl.RGBA, this.gl.FLOAT, null);

    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.REPEAT);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.REPEAT);
    return texture;
  }

  private initBuffers(): void {
    // Full-screen quad
    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const buffer = this.gl.createBuffer()!;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);
  }

  private seedInitialPattern(): void {
    // TODO: Implement initial random seeds using a small render pass or data texture upload
    // For now, we can start with uniform + small random injection in first few frames
  }

  // ==================== MAIN ANIMATION LOOP ====================

  private animate = (): void => {
    this.updateSimulationParameters();
    this.runSimulationSteps();
    this.renderToScreen();
    this.animFrameId = requestAnimationFrame(this.animate);
  };

  private updateSimulationParameters(): void {
    const bars = this.bars();
    const beat = this.beat();
    const profile = this.musicProfile();

    if (bars.length === 0) return;

    const bass = bars.slice(0, Math.floor(bars.length * 0.2)).reduce((a, b) => a + b, 0) / (bars.length * 0.2);
    const mids = bars.slice(Math.floor(bars.length * 0.3), Math.floor(bars.length * 0.7))
                     .reduce((a, b) => a + b, 0) / (bars.length * 0.4);
    const treble = bars.slice(Math.floor(bars.length * 0.75)).reduce((a, b) => a + b, 0) / (bars.length * 0.25);

    // Audio mapping
    this.f = 0.035 + (bass / 255) * 0.045;
    this.k = 0.058 + (treble / 255) * 0.018;
    this.Dv = 0.35 + (mids / 255) * 0.45;

    // Beat burst
    if (beat.timestamp > this.lastBeatTime && beat.strength > 0.25) {
      this.lastBeatTime = beat.timestamp;
      if (this.burstCooldown <= 0) {
        this.triggerBurst(beat.strength);
        this.burstCooldown = 6;
      }
    }
    if (this.burstCooldown > 0) this.burstCooldown--;

    // Color mood
    if (profile === 'rhythm') this.baseHue = 15;
    else if (profile === 'transient') this.baseHue = 170;
    else this.baseHue = 260;
  }

  private triggerBurst(strength: number): void {
    // TODO: Render small bright spots into the simulation texture using a separate pass
    console.log('GPU Burst triggered with strength:', strength);
  }

  private runSimulationSteps(): void {
    // TODO: Implement ping-pong rendering with simulation shader
    // This will be the core of the GPU version
  }

  private renderToScreen(): void {
    // TODO: Use display program to render the simulation texture to screen with nice coloring
  }

  // ==================== GLSL SHADERS ====================

  private readonly vertexShaderSource = `#version 300 es
    in vec2 position;
    out vec2 vUv;
    void main() {
      vUv = position * 0.5 + 0.5;
      gl_Position = vec4(position, 0.0, 1.0);
    }`;

  private readonly simulationFragmentSource = `#version 300 es
    precision highp float;
    in vec2 vUv;
    out vec4 fragColor;

    uniform sampler2D uState;
    uniform float uF;
    uniform float uK;
    uniform float uDu;
    uniform float uDv;
    uniform float uTime;

    void main() {
      // Full Gray-Scott simulation logic goes here
      // (I'll provide the complete shader in the next message once you confirm)
    }`;

  private readonly displayFragmentSource = `#version 300 es
    precision highp float;
    in vec2 vUv;
    out vec4 fragColor;

    uniform sampler2D uState;
    uniform float uHue;

    void main() {
      // Beautiful color mapping from simulation state
    }`;
}