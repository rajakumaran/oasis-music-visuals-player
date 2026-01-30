// webgl-grok-visualizer/webgl-grok-visualizer.component.ts (New file - create this in your project)
import { Component, ElementRef, Input, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { AudioService } from '../services/audio.service';
import { EqualizerTheme } from '../models/equalizer-theme.model';

@Component({
  selector: 'app-webgl-grok-visualizer',
  standalone: true,
  templateUrl: './webgl-grok-visualizer.component.html',
})
export class WebglGrokVisualizerComponent implements OnInit, OnDestroy {
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;
  @Input() theme!: EqualizerTheme;

  @Input() bars: number[] = [];                // same as your visualizerBars()
  @Input() isPlaying: boolean = false;
  @Input() beat: { strength: number; timestamp: number } = { strength: 0, timestamp: 0 };
  @Input() musicProfile: 'smart' | 'atmosphere' | 'rhythm' | 'transient' = 'smart';

  private gl!: WebGL2RenderingContext | WebGLRenderingContext | null; // private gl!: WebGLRenderingContext | null;
  private program!: WebGLProgram | null;
  private animationFrameId: number | null = null;
  private timeLocation!: WebGLUniformLocation | null;
  private resolutionLocation!: WebGLUniformLocation | null;
  private lowMidHighLocation!: WebGLUniformLocation | null;
  private fftTextureLocation!: WebGLUniformLocation | null;
  private fftTexture!: WebGLTexture | null;
  private startTime = performance.now();

  constructor(private audioService: AudioService) {}

  ngOnInit(): void {
    // this.initWebGL();
    // this.startRenderLoop();
  }

  ngAfterViewInit(): void {
    this.initWebGL();
    if (this.program) {  // Only start loop if program is valid
      this.startRenderLoop();
    } else {
      console.warn('WebGL program failed to initialize — skipping render loop');
    }
  }
  
  ngOnDestroy(): void {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    if (this.gl && this.program) this.gl.deleteProgram(this.program);
    if (this.gl && this.fftTexture) this.gl.deleteTexture(this.fftTexture);
  }

  private initWebGL(): void {
    const canvas = this.canvasRef.nativeElement;
    // this.gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false }); this webgl 1.0. for what I Am working on I need webgl 2.0 or > 
    this.gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false }) as WebGL2RenderingContext | null;
    if (!this.gl) {
      console.error('WebGL2 not supported — falling back to WebGL1 (limited features)');
      this.gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false }) as WebGLRenderingContext | null;
      if (!this.gl) {
        console.error('WebGL not supported at all');
        return;
      }
    }
    if (!this.gl) {
      console.error('WebGL not supported in this browser/context');
      return;
    }
    console.log('WebGL context acquired'); // Confirm context

    // Basic vertex shader (full-screen quad)
    const vertexShaderSource = `#version 300 es
      in vec2 a_position;
      out vec2 v_uv;
      void main() {
        gl_Position = vec4(a_position, 0, 1);
        v_uv = (a_position + 1.0) / 2.0;
      }`;

    // Use the theme's fragment shader
    const fragmentShaderSource = this.theme.fragmentShader || `#version 300 es
      precision mediump float;
      out vec4 fragColor;
      void main() {
        fragColor = vec4(1.0, 0.0, 1.0, 1.0); // Magenta fallback
      }`;

    const vertexShader = this.compileShader(this.gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = this.compileShader(this.gl.FRAGMENT_SHADER, fragmentShaderSource);

    if (!vertexShader || !fragmentShader) {
      console.error('Shader compilation failed — cannot create program');
      return;
    }

    this.program = this.gl.createProgram();
    if (!this.program) {
      console.error('Failed to create WebGL program');
      return;
    }

    this.gl.attachShader(this.program, vertexShader);
    this.gl.attachShader(this.program, fragmentShader);
    this.gl.linkProgram(this.program);

    if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
      console.error('Program linking failed:', this.gl.getProgramInfoLog(this.program));
      this.gl.deleteProgram(this.program);
      this.program = null;
      return;
    }

    console.log('Shader program linked successfully');

    this.gl.useProgram(this.program);

    // Quad setup (unchanged)
    const positionBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, positionBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), this.gl.STATIC_DRAW);

    const positionLocation = this.gl.getAttribLocation(this.program, 'a_position');
    this.gl.enableVertexAttribArray(positionLocation);
    this.gl.vertexAttribPointer(positionLocation, 2, this.gl.FLOAT, false, 0, 0);

    // Uniform locations (add null checks later if needed)
    this.timeLocation = this.gl.getUniformLocation(this.program, 'u_time');
    this.resolutionLocation = this.gl.getUniformLocation(this.program, 'u_resolution');
    this.lowMidHighLocation = this.gl.getUniformLocation(this.program, 'u_lowMidHigh');
    this.fftTextureLocation = this.gl.getUniformLocation(this.program, 'u_fftTexture');

    // FFT texture setup
    this.fftTexture = this.gl.createTexture();
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.fftTexture);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);

    // Resize canvas
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  private compileShader(type: number, source: string): WebGLShader | null {
    if (!this.gl) return null;

    const shader = this.gl.createShader(type);
    if (!shader) {
      console.error('Failed to create shader object');
      return null;
    }

    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const infoLog = this.gl.getShaderInfoLog(shader);
      console.error(`Shader compile error (${type === this.gl.VERTEX_SHADER ? 'Vertex' : 'Fragment'}):\n${infoLog}`);
      console.error('Shader source was:\n', source); // Helpful for debugging
      this.gl.deleteShader(shader);
      return null;
    }

    console.log(`${type === this.gl.VERTEX_SHADER ? 'Vertex' : 'Fragment'} shader compiled OK`);
    return shader;
  }

  private resizeCanvas(): void {
    const canvas = this.canvasRef.nativeElement;
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    if (this.gl) this.gl.viewport(0, 0, canvas.width, canvas.height);
  }

  private startRenderLoop(): void {
    const render = () => {
      if (!this.gl || !this.program) {
        console.warn('Render loop stopped: no GL context or program');
        return;
      }

      // Update uniforms
      const time = (performance.now() - this.startTime) / 1000;
      this.gl.uniform1f(this.timeLocation, time);
      this.gl.uniform2f(this.resolutionLocation, this.canvasRef.nativeElement.width, this.canvasRef.nativeElement.height);

      // Compute low/mid/high
      const fft = this.audioService.frequencyData();
      // console.log(" FFT data: " + fft); data prints great
      // const low = fft.slice(0, fft.length / 8).reduce((a: number, b: number) => a + b, 0) / (fft.length / 8) / 255;
      // const mid = fft.slice(fft.length / 8, fft.length / 2).reduce((a: number, b: number) => a + b, 0) / (fft.length / 2 - fft.length / 8) / 255;
      // const high = fft.slice(fft.length / 2).reduce((a: number, b: number) => a + b, 0) / (fft.length / 2) / 255;
      const low = fft.slice(0, fft.length / 8).reduce((a, b) => a + b, 0) / (fft.length / 8) / 255;
      const mid = fft.slice(fft.length / 8, fft.length / 2).reduce((a, b) => a + b, 0) / (fft.length / 2 - fft.length / 8) / 255;
      const high = fft.slice(fft.length / 2).reduce((a, b) => a + b, 0) / (fft.length / 2) / 255;
      // Amplify small values so subtle music still reacts strongly
      const amp = 3.0; // Increase if you want more dramatic reaction, decrease for subtlety
      const boostedLow  = Math.min(1.0, low  * amp);
      const boostedMid  = Math.min(1.0, mid  * amp);
      const boostedHigh = Math.min(1.0, high * amp);

      this.gl.uniform3f(this.lowMidHighLocation, boostedLow, boostedMid, boostedHigh);
      console.log('Audio reactivity:', { low: low.toFixed(3), mid: mid.toFixed(3), high: high.toFixed(3) });
      console.log('Low/Mid/High:',            low.toFixed(2), mid.toFixed(2), high.toFixed(2));
      this.gl.uniform3f(this.lowMidHighLocation, low, mid, high);

      // Update FFT texture (1D, 1024x1, red channel)
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.fftTexture);
      const fftData = new Float32Array(fft.map(v => v / 255));
      // this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.LUMINANCE, fft.length, 1, 0, this.gl.LUMINANCE, this.gl.FLOAT, fftData);
      // For WebGL2 (preferred)
      if ((this.gl as any).R32F) {  // Check if WebGL2 context
        this.gl.texImage2D(
          this.gl.TEXTURE_2D,
          0,
          (this.gl as WebGL2RenderingContext).R32F,
          fft.length,
          1,
          0,
          this.gl.RED_BITS,
          this.gl.FLOAT,
          fftData
        );
        console.log('FFT texture uploaded — size:', fft.length);  
        // After texImage2D(...)
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.fftTexture);
        this.gl.uniform1i(this.fftTextureLocation, 0);
        console.log('Texture bound & uniform set to 0');
      } else {
        // Fallback for WebGL1: use UNSIGNED_BYTE (less precision, but works)
        const byteData = new Uint8Array(fft);
        this.gl.texImage2D(
          this.gl.TEXTURE_2D,
          0,
          this.gl.LUMINANCE,
          fft.length,
          1,
          0,
          this.gl.LUMINANCE,
          this.gl.UNSIGNED_BYTE,
          byteData
        );
        console.log('FFT texture uploaded — size:', fft.length);
        console.warn('Using WebGL1 fallback — reduced FFT precision');
      }
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.fftTexture);

      // WebGL2 supports FLOAT textures natively
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        (this.gl as WebGL2RenderingContext).R32F,               // Internal format (single-channel float)
        fft.length,
        1,
        0,
        this.gl.RED_BITS,                 // Format
        this.gl.FLOAT,                    // Type — now allowed in WebGL2
        fftData
      );
      this.gl.uniform1i(this.fftTextureLocation, 0);
      this.gl.activeTexture(this.gl.TEXTURE0);

      // Render
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
      this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);

      this.animationFrameId = requestAnimationFrame(render);

      ///
      // Beat pulse (sharp kick on beat)
      const beatPulse = this.beat.strength * (1.0 - Math.min(1.0, (performance.now() - this.beat.timestamp) / 300)); // decay over 300ms
      this.gl.uniform1f(this.gl.getUniformLocation(this.program, 'u_beatPulse'), beatPulse);

      // Music profile as float (0=atmosphere, 1=rhythm, 2=transient, 0.5=smart blend)
      let profileVal = 0.0;
      if (this.musicProfile === 'rhythm') profileVal = 1.0;
      else if (this.musicProfile === 'transient') profileVal = 2.0;
      else if (this.musicProfile === 'smart') profileVal = 0.5; // or blend logic
      this.gl.uniform1f(this.gl.getUniformLocation(this.program, 'u_profile'), profileVal);

      // Pass average bar energy + variance for more detail
      const avgBars = this.bars.reduce((a, b) => a + b, 0) / this.bars.length;
      const barVariance = this.bars.reduce((a, b) => a + Math.pow(b - avgBars, 2), 0) / this.bars.length;
      this.gl.uniform2f(this.gl.getUniformLocation(this.program, 'u_barStats'), avgBars, Math.sqrt(barVariance));
    };
    render();
  }
}