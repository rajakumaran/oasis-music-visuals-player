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

  bars = input.required<number[]>();
  beat = input.required<{ strength: number; timestamp: number }>();
  musicProfile = input.required<'atmosphere' | 'rhythm' | 'transient'>();

  private gl!: WebGL2RenderingContext;
  private animFrameId: number | null = null;
  private resizeObserver!: ResizeObserver;

  private resolution = 768;                    // Internal simulation resolution (good balance)
  private readTexture!: WebGLTexture;
  private writeTexture!: WebGLTexture;
  private framebuffer!: WebGLFramebuffer;

  private simulationProgram!: WebGLProgram;
  private displayProgram!: WebGLProgram;

  private quadBuffer!: WebGLBuffer;

  // Simulation parameters
  private f = 0.055;
  private k = 0.062;
  private Du = 1.0;
  private Dv = 0.5;

  private lastBeatTime = 0;
  private burstCooldown = 0;
  private baseHue = 200;

  private time = 0;

  constructor() {
    effect(() => {
      this.bars();
      this.beat();
      this.musicProfile();
    });
  }

  ngAfterViewInit(): void {
    const canvas = this.canvasRef.nativeElement;
    this.gl = canvas.getContext('webgl2', { alpha: false, depth: false, antialias: false }) as WebGL2RenderingContext;

    if (!this.gl) {
      console.error('WebGL2 is not supported in this browser.');
      return;
    }

    this.initWebGL();
    this.handleResize();
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(canvas.parentElement!);

    this.seedInitialState();
    this.animate();
  }

  ngOnDestroy(): void {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    this.resizeObserver?.disconnect();
  }

  private handleResize(): void {
    const canvas = this.canvasRef.nativeElement;
    const parent = canvas.parentElement!;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = parent.clientWidth * dpr;
    canvas.height = parent.clientHeight * dpr;

    this.gl.viewport(0, 0, canvas.width, canvas.height);
  }

  private initWebGL(): void {
    this.quadBuffer = this.gl.createBuffer()!;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), this.gl.STATIC_DRAW);

    this.simulationProgram = this.createProgram(this.vertexShader, this.simulationFragment);
    this.displayProgram = this.createProgram(this.vertexShader, this.displayFragment);

    this.readTexture = this.createTexture();
    this.writeTexture = this.createTexture();
    this.framebuffer = this.gl.createFramebuffer()!;
  }

  private createTexture(): WebGLTexture {
    const tex = this.gl.createTexture()!;
    this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA32F, this.resolution, this.resolution, 0,
      this.gl.RGBA, this.gl.FLOAT, null);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.REPEAT);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.REPEAT);
    return tex;
  }

  private createProgram(vsSource: string, fsSource: string): WebGLProgram {
    const program = this.gl.createProgram()!;
    const vertexShader = this.compileShader(this.gl.VERTEX_SHADER, vsSource);
    const fragmentShader = this.compileShader(this.gl.FRAGMENT_SHADER, fsSource);

    this.gl.attachShader(program, vertexShader);
    this.gl.attachShader(program, fragmentShader);
    this.gl.linkProgram(program);

    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      console.error('Program link error:', this.gl.getProgramInfoLog(program));
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

  private seedInitialState(): void {
    // Simple seed: fill with U=1, V=0 and add a few random spots
    const data = new Float32Array(this.resolution * this.resolution * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 1.0;     // U
      data[i + 1] = 0.0;   // V
      data[i + 2] = 0.0;
      data[i + 3] = 1.0;
    }
    // Add some random seeds
    for (let s = 0; s < 20; s++) {
      const x = Math.floor(Math.random() * (this.resolution - 20)) + 10;
      const y = Math.floor(Math.random() * (this.resolution - 20)) + 10;
      const idx = (y * this.resolution + x) * 4;
      data[idx] = 0.5;
      data[idx + 1] = 0.25;
    }

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.readTexture);
    this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, 0, 0, this.resolution, this.resolution,
      this.gl.RGBA, this.gl.FLOAT, data);
  }

  private animate = () => {
    this.updateParameters();
    this.runSimulation(8);           // 8 simulation steps per frame (adjust for speed/quality)
    this.renderToScreen();
    this.time += 0.016;
    this.animFrameId = requestAnimationFrame(this.animate);
  };

  private updateParameters(): void {
    const bars = this.bars();
    const beat = this.beat();
    const profile = this.musicProfile();

    if (bars.length < 10) return;

    const bass = bars.slice(0, Math.floor(bars.length * 0.18)).reduce((a, b) => a + b, 0) / (bars.length * 0.18);
    const mids = bars.slice(Math.floor(bars.length * 0.25), Math.floor(bars.length * 0.65))
      .reduce((a, b) => a + b, 0) / (bars.length * 0.4);
    const treble = bars.slice(Math.floor(bars.length * 0.7)).reduce((a, b) => a + b, 0) / (bars.length * 0.3);

    this.f = 0.032 + bass * 0.048;
    this.k = 0.055 + treble * 0.022;
    this.Dv = 0.32 + mids * 0.48;

    // Beat burst
    if (beat.timestamp > this.lastBeatTime && beat.strength > 0.28) {
      this.lastBeatTime = beat.timestamp;
      if (this.burstCooldown <= 0) {
        this.triggerBurst(beat.strength * 1.8);
        this.burstCooldown = 5;
      }
    }
    this.burstCooldown = Math.max(0, this.burstCooldown - 1);

    // Mood color
    if (profile === 'rhythm') this.baseHue = 20;
    else if (profile === 'transient') this.baseHue = 175;
    else this.baseHue = 265;
  }

  private triggerBurst(strength: number): void {
    // For simplicity, we re-seed a small area on the CPU side for now.
    // Advanced version can use a separate burst shader pass.
    console.log(`[RD-GPU] Burst triggered: ${strength.toFixed(2)}`);
  }

  private runSimulation(steps: number): void {
    const program = this.simulationProgram;
    this.gl.useProgram(program);

    const uStateLoc = this.gl.getUniformLocation(program, "uState");
    const uF = this.gl.getUniformLocation(program, "uF");
    const uK = this.gl.getUniformLocation(program, "uK");
    const uDu = this.gl.getUniformLocation(program, "uDu");
    const uDv = this.gl.getUniformLocation(program, "uDv");

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer);

    for (let i = 0; i < steps; i++) {
      // Ping -> Pong
      this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_2D, this.writeTexture, 0);

      this.gl.activeTexture(this.gl.TEXTURE0);
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.readTexture);
      this.gl.uniform1i(uStateLoc, 0);

      this.gl.uniform1f(uF, this.f);
      this.gl.uniform1f(uK, this.k);
      this.gl.uniform1f(uDu, this.Du);
      this.gl.uniform1f(uDv, this.Dv);

      this.drawQuad();

      // Swap
      [this.readTexture, this.writeTexture] = [this.writeTexture, this.readTexture];
    }

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
  }

  private renderToScreen(): void {
    const program = this.displayProgram;
    this.gl.useProgram(program);

    const uStateLoc = this.gl.getUniformLocation(program, "uState");
    const uHueLoc = this.gl.getUniformLocation(program, "uHue");

    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.readTexture);
    this.gl.uniform1i(uStateLoc, 0);
    this.gl.uniform1f(uHueLoc, this.baseHue);

    this.drawQuad();
  }

  private drawQuad(): void {
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
    const posLoc = this.gl.getAttribLocation(this.simulationProgram, "position"); // works for both programs
    this.gl.enableVertexAttribArray(posLoc);
    this.gl.vertexAttribPointer(posLoc, 2, this.gl.FLOAT, false, 0, 0);

    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
  }

  // ====================== GLSL SHADERS ======================

  private readonly vertexShader = `#version 300 es
    in vec2 position;
    out vec2 vUv;
    void main() {
      vUv = position * 0.5 + 0.5;
      gl_Position = vec4(position, 0.0, 1.0);
    }`;

  private readonly simulationFragment = `#version 300 es
    precision highp float;
    in vec2 vUv;
    out vec4 fragColor;

    uniform sampler2D uState;
    uniform float uF;
    uniform float uK;
    uniform float uDu;
    uniform float uDv;

    void main() {
      vec2 texel = 1.0 / vec2(textureSize(uState, 0));

      // 4-neighbor Laplacian
      float u  = texture(uState, vUv).r;
      float v  = texture(uState, vUv).g;

      float uL = texture(uState, vUv + vec2(-texel.x, 0.0)).r;
      float uR = texture(uState, vUv + vec2( texel.x, 0.0)).r;
      float uT = texture(uState, vUv + vec2(0.0, -texel.y)).r;
      float uB = texture(uState, vUv + vec2(0.0,  texel.y)).r;

      float vL = texture(uState, vUv + vec2(-texel.x, 0.0)).g;
      float vR = texture(uState, vUv + vec2( texel.x, 0.0)).g;
      float vT = texture(uState, vUv + vec2(0.0, -texel.y)).g;
      float vB = texture(uState, vUv + vec2(0.0,  texel.y)).g;

      float lapU = uL + uR + uT + uB - 4.0 * u;
      float lapV = vL + vR + vT + vB - 4.0 * v;

      float uvv = u * v * v;

      float newU = u + uDu * lapU - uvv + uF * (1.0 - u);
      float newV = v + uDv * lapV + uvv - (uF + uK) * v;

      fragColor = vec4(clamp(newU, 0.0, 1.0), clamp(newV, 0.0, 1.0), 0.0, 1.0);
    }`;

  private readonly displayFragment = `#version 300 es
    precision highp float;
    in vec2 vUv;
    out vec4 fragColor;

    uniform sampler2D uState;
    uniform float uHue;

    vec3 hsl2rgb(vec3 c) {
      vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0);
      return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
    }

    void main() {
      vec2 state = texture(uState, vUv).rg;
      float intensity = state.g * 3.5;                 // V drives visibility
      float localHue = (uHue + state.g * 90.0 - state.r * 30.0) / 360.0;

      vec3 color = hsl2rgb(vec3(localHue, 0.85, 0.6 + intensity * 0.4));
      fragColor = vec4(color, 1.0);
    }`;
}