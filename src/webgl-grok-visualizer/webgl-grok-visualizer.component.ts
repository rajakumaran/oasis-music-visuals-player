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

  private gl!: WebGLRenderingContext | null;
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
    this.initWebGL();
    this.startRenderLoop();
  }

  ngOnDestroy(): void {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    if (this.gl && this.program) this.gl.deleteProgram(this.program);
    if (this.gl && this.fftTexture) this.gl.deleteTexture(this.fftTexture);
  }

  private initWebGL(): void {
    const canvas = this.canvasRef.nativeElement;
    this.gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
    if (!this.gl) {
      console.error('WebGL not supported');
      return;
    }

    // Basic vertex shader (full-screen quad)
    const vertexShaderSource = `
      attribute vec2 a_position;
      varying vec2 v_uv;
      void main() {
        gl_Position = vec4(a_position, 0, 1);
        v_uv = (a_position + 1.0) / 2.0;
      }
    `;

    // Use the theme's fragment shader
    const fragmentShaderSource = this.theme.fragmentShader || '';

    const vertexShader = this.compileShader(this.gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = this.compileShader(this.gl.FRAGMENT_SHADER, fragmentShaderSource);

    this.program = this.gl.createProgram();
    if (this.program && vertexShader && fragmentShader) {
      this.gl.attachShader(this.program, vertexShader);
      this.gl.attachShader(this.program, fragmentShader);
      this.gl.linkProgram(this.program);

      if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
        console.error('Program link error:', this.gl.getProgramInfoLog(this.program));
        return;
      }

      this.gl.useProgram(this.program);

      // Set up quad
      const positionBuffer = this.gl.createBuffer();
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, positionBuffer);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), this.gl.STATIC_DRAW);

      const positionLocation = this.gl.getAttribLocation(this.program, 'a_position');
      this.gl.enableVertexAttribArray(positionLocation);
      this.gl.vertexAttribPointer(positionLocation, 2, this.gl.FLOAT, false, 0, 0);

      // Uniform locations
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
    }

    // Resize canvas
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  private compileShader(type: number, source: string): WebGLShader | null {
    if (!this.gl) return null;
    const shader = this.gl.createShader(type);
    if (shader) {
      this.gl.shaderSource(shader, source);
      this.gl.compileShader(shader);
      if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', this.gl.getShaderInfoLog(shader));
        this.gl.deleteShader(shader);
        return null;
      }
    }
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
      if (!this.gl || !this.program) return;

      // Update uniforms
      const time = (performance.now() - this.startTime) / 1000;
      this.gl.uniform1f(this.timeLocation, time);
      this.gl.uniform2f(this.resolutionLocation, this.canvasRef.nativeElement.width, this.canvasRef.nativeElement.height);

      // Compute low/mid/high
      const fft = this.audioService.frequencyData();
      const low = fft.slice(0, fft.length / 8).reduce((a: number, b: number) => a + b, 0) / (fft.length / 8) / 255;
      const mid = fft.slice(fft.length / 8, fft.length / 2).reduce((a: number, b: number) => a + b, 0) / (fft.length / 2 - fft.length / 8) / 255;
      const high = fft.slice(fft.length / 2).reduce((a: number, b: number) => a + b, 0) / (fft.length / 2) / 255;
      this.gl.uniform3f(this.lowMidHighLocation, low, mid, high);

      // Update FFT texture (1D, 1024x1, red channel)
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.fftTexture);
      const fftData = new Float32Array(fft.map(v => v / 255));
      this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.LUMINANCE, fft.length, 1, 0, this.gl.LUMINANCE, this.gl.FLOAT, fftData);
      this.gl.uniform1i(this.fftTextureLocation, 0);
      this.gl.activeTexture(this.gl.TEXTURE0);

      // Render
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
      this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);

      this.animationFrameId = requestAnimationFrame(render);
    };
    render();
  }
}