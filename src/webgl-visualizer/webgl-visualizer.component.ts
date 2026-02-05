import { Component, ChangeDetectionStrategy, ElementRef, AfterViewInit, OnDestroy, ViewChild, input, effect } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { EqualizerTheme } from '../models/equalizer-theme.model';

type MusicProfile = 'atmosphere' | 'rhythm' | 'transient';

@Component({
  selector: 'app-webgl-visualizer',
  standalone: true,
  template: `<canvas #canvas class="w-full h-full block"></canvas>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block w-full h-full'
  }
})
export class WebglVisualizerComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') private canvasRef!: ElementRef<HTMLCanvasElement>;

  // Inputs
  bars = input.required<number[]>();
  theme = input.required<EqualizerTheme>();
  isPlaying = input.required<boolean>();
  beat = input.required<{ strength: number, timestamp: number }>();
  musicProfile = input.required<MusicProfile>();

  // Three.js properties
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private composer!: EffectComposer;
  private bloomPass!: UnrealBloomPass;
  private directionalLight!: THREE.DirectionalLight;
  private baseLightIntensity = 1.5;
  private cubes: THREE.Mesh[] = [];
  private terrainMesh!: THREE.Mesh;
  private animationFrameId: number | null = null;
  private clock = new THREE.Clock();
  
  // Bar physics state
  private cubeStates: { velocity: number }[] = [];
  private lastBeatTimestamp = 0;

  // Camera animation state
  private initialCameraDistance = 0;


  constructor() {
    // --- Beat Impulse & Light Pulse Effect ---
    effect(() => {
        const currentBeat = this.beat();
        if (this.directionalLight && currentBeat.timestamp > this.lastBeatTimestamp) {
            this.lastBeatTimestamp = currentBeat.timestamp;

            // Light pulse
            this.directionalLight.intensity = this.baseLightIntensity + currentBeat.strength * 1.5;

            // Bar bounce impulse
             const beatImpulse = currentBeat.strength * 0.1; // Slightly increased impulse //WAS 0.35 Google suggests 0.4//
            this.cubeStates.forEach((state, i) => {
                // Stronger impulse for lower frequency bars
                const impulseFactor = Math.max(0, 1 - (i / this.cubes.length) * 0.1); //Google suggests 0.7
                state.velocity += beatImpulse * impulseFactor;
            });
        }
    });

    // --- Dynamic Fog & Theme Effect ---
    effect(() => {
        const newTheme = this.theme();
        const profile = this.musicProfile();
        this.updateSceneFromTheme(newTheme, profile);
    });

    effect(() => {
        if (this.controls) this.controls.autoRotate = this.isPlaying();
        const webglMode = this.theme().webglMode || 'bars';
        this.toggleVisualizerMode(webglMode);
    });

    // --- Camera Rotation Effect --- this effect is ugly and not pleasant, hence commentin it out
    // effect(() => {
    //     if (this.controls) {
    //         this.controls.autoRotate = this.isPlaying();
    //     }
    // });
  }

  ngAfterViewInit(): void {
    this.initThree();
    this.animate();
  }

  ngOnDestroy(): void {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    this.disposeSceneContent();
    this.renderer.dispose();
  }
  
  private initThree(): void {
    const canvas = this.canvasRef.nativeElement;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x000000, 15, 40);
    // Camera
    this.camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
    this.camera.position.set(0, 8, 18);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;

    // Controls
    this.initControls();
    this.initLighting();
    this.initFloor();
    this.initPostProcessing();
    
    this.recreateVisualizers();
    this.updateSceneFromTheme(this.theme(), this.musicProfile());
    this.toggleVisualizerMode(this.theme().webglMode || 'bars');
  }

  private initControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 5; this.controls.maxDistance = 50;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.target.set(0, 2, 0);
    this.controls.autoRotate = this.isPlaying(); this.controls.autoRotateSpeed = 0.5;
    this.controls.update();
    this.initialCameraDistance = this.camera.position.distanceTo(this.controls.target);
  }

  // Lighting
  private initLighting() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    this.directionalLight = new THREE.DirectionalLight(0xffffff, this.baseLightIntensity);
    this.directionalLight.position.set(5, 10, 7.5);
    this.directionalLight.castShadow = true;
    this.scene.add(this.directionalLight);
  }

  private initFloor() {
    const floorGeometry = new THREE.PlaneGeometry(30, 30);
    const reflector = new Reflector(floorGeometry, {
        clipBias: 0.003,
        textureWidth: 1024 * window.devicePixelRatio,
        textureHeight: 1024 * window.devicePixelRatio,
        color: 0x777777
    });
    reflector.rotation.x = -Math.PI / 2;
    this.scene.add(reflector);
  }

  private initPostProcessing() {
    const canvas = this.canvasRef.nativeElement;
    const renderPass = new RenderPass(this.scene, this.camera);
    // Tuned bloom pass settings to avoid "whitewash" on large screens
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(canvas.clientWidth, canvas.clientHeight), 0.5, 0.6, 0.8); //WAS  0.8, 0.6, 0.4
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderPass);
    this.composer.addPass(this.bloomPass);
  }

  private disposeSceneContent(): void {
     this.cubes.forEach(cube => {
        this.scene.remove(cube);
        cube.geometry.dispose();
        (cube.material as THREE.Material).dispose();
    });
    this.cubes = [];
    if (this.terrainMesh) {
      this.scene.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      (this.terrainMesh.material as THREE.Material).dispose();
    }
  }

  private recreateVisualizers(): void {
    this.disposeSceneContent();
    this.createBarVisualizer();
    this.createTerrainVisualizer();
  }

  private createBarVisualizer() {
    const numBars = this.bars().length || 64;
    this.cubeStates = Array(numBars).fill(0).map(() => ({ velocity: 0.0 }));
    const { rows, cols } = {rows: 8, cols: Math.ceil(numBars/8)};
    const totalWidth = cols * 1.5, totalDepth = rows * 1.5;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < numBars; i++) {
        const material = new THREE.MeshStandardMaterial();
        const cube = new THREE.Mesh(geometry, material);
        cube.castShadow = true; cube.receiveShadow = true;
        const col = i % cols, row = Math.floor(i / cols);
        const x = col * 1.5 - totalWidth / 2 + 0.75;
        const z = row * 1.5 - totalDepth / 2 + 0.75;
        cube.position.set(x, 0.5, z);

        this.cubes.push(cube);
        this.scene.add(cube);
    }
  }

  private createTerrainVisualizer() {
      const TERRAIN_SIZE = 30;
      const TERRAIN_SEGMENTS = 127;
      const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
      geometry.rotateX(-Math.PI / 2);

      const material = new THREE.ShaderMaterial({
          uniforms: {
              time: { value: 0 },
              colorAccent: { value: new THREE.Color(this.theme().accent) }
          },
          vertexShader: `
              varying float vHeight;
              void main() {
                  vHeight = position.y;
                  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
              }
          `,
          fragmentShader: `
              varying float vHeight;
              uniform vec3 colorAccent;
              void main() {
                  vec3 deepColor = vec3(0.0, 0.05, 0.1);
                  vec3 shallowColor = colorAccent * 0.8;
                  vec3 highColor = vec3(1.0, 1.0, 1.0);
                  float h = clamp(vHeight / 5.0, 0.0, 1.0);
                  vec3 color = mix(deepColor, shallowColor, smoothstep(0.0, 0.3, h));
                  color = mix(color, highColor, smoothstep(0.3, 0.6, h));
                  gl_FragColor = vec4(color, 1.0);
              }
          `,
          wireframe: true
      });

      this.terrainMesh = new THREE.Mesh(geometry, material);
      this.scene.add(this.terrainMesh);
  }

  private toggleVisualizerMode(mode: 'bars' | 'terrain') {
      this.cubes.forEach(c => c.visible = mode === 'bars');
      if (this.terrainMesh) this.terrainMesh.visible = mode === 'terrain';
  }

  private updateSceneFromTheme(theme: EqualizerTheme, profile: MusicProfile) {
    if (!this.scene) return;
    this.scene.background = new THREE.Color(theme.display);
    const accentColor = new THREE.Color(theme.accent);

    this.cubes.forEach(cube => {
      (cube.material as THREE.MeshStandardMaterial).color.set(accentColor);
      (cube.material as THREE.MeshStandardMaterial).emissive.set(accentColor);
    });
    
    if (this.terrainMesh) {
      (this.terrainMesh.material as THREE.ShaderMaterial).uniforms.colorAccent.value = accentColor;
    }

    this.scene.fog = new THREE.Fog(
        profile === 'atmosphere' ? 0x111827 : accentColor,
        profile === 'atmosphere' ? 12 : 15,
        profile === 'atmosphere' ? 28 : 40
    );
  }
  
  private animate(): void {
    this.animationFrameId = requestAnimationFrame(() => this.animate());
    const canvas = this.renderer.domElement;
    const barData = this.bars();
    const elapsedTime = this.clock.getElapsedTime();

    if (this.theme().webglMode === 'terrain') this.animateTerrain(barData);
    else this.animateBars(barData);

    this.directionalLight.intensity += (this.baseLightIntensity - this.directionalLight.intensity) * 0.05;
    this.animateCamera(barData, elapsedTime);
    this.handleResize();

    this.controls.update();
    this.composer.render();
  }

  private animateBars(barData: number[]) {
      if (this.cubes.length !== barData.length) this.recreateVisualizers();
      const SPRING = 0.045, DAMPING = 0.22;
      barData.forEach((value, i) => {
        const cube = this.cubes[i], state = this.cubeStates[i];
        const targetScale = Math.max(0.01, value * 12);
        
        // Spring physics
        const displacement = targetScale - cube.scale.y;
        state.velocity += displacement * SPRING - state.velocity * DAMPING;
        cube.scale.y = Math.max(0.01, cube.scale.y + state.velocity);
        cube.position.y = cube.scale.y / 2;
        if (this.isPlaying()) cube.rotation.y += 0.005 + value * 0.02;
      });
  }

  private animateTerrain(barData: number[]) {
      if (!this.terrainMesh) return;
      const positions = this.terrainMesh.geometry.attributes.position;
      const segments = Math.sqrt(positions.count) - 1;
      for (let i = 0; i < positions.count; i++) {
          const x = positions.getX(i);
          const z = positions.getZ(i);
          const dist = Math.sqrt(x*x + z*z);
          const barIndex = Math.min(barData.length - 1, Math.floor(dist / 15 * barData.length));
          const height = barData[barIndex] * 6;
          positions.setY(i, height);
      }
      positions.needsUpdate = true;
  }
  
  private animateCamera(barData: number[], elapsedTime: number) {
      if (!this.isPlaying()) return;
      const avgBarHeight = barData.length > 0 ? barData.reduce((a, b) => a + b, 0) / barData.length : 0;
      this.controls.autoRotateSpeed = 0.2 + avgBarHeight * 0.8;
      
      // Periodic zoom ("breathing") effect
      const zoomAmplitude = 2.5;
      const zoomFrequency = 0.15;
      const zoomOffset = Math.sin(elapsedTime * 0.15) * 2.5;
      const targetDistance = this.initialCameraDistance + zoomOffset;
      
      const currentDistance = this.camera.position.distanceTo(this.controls.target);
      const newDistance = THREE.MathUtils.lerp(currentDistance, targetDistance, 0.05); // Smooth interpolation
      
      const direction = this.camera.position.clone().sub(this.controls.target).normalize();
      this.camera.position.copy(this.controls.target.clone().add(direction.multiplyScalar(newDistance)));
  }
  // Handle canvas resizing
  private handleResize() {
    const canvas = this.renderer.domElement;
    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
      const width = canvas.clientWidth, height = canvas.clientHeight;
      this.renderer.setSize(width, height, false);
      this.composer.setSize(width, height);
      this.camera.aspect = width / height;
      
      // Adaptive FOV for better wide-screen views
      this.camera.fov = THREE.MathUtils.mapLinear(this.camera.aspect, 1, 2.5, 50, 40);

      this.camera.updateProjectionMatrix();
    }

   }
}