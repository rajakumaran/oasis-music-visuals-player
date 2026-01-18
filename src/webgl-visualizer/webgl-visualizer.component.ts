import { Component, ChangeDetectionStrategy, ElementRef, AfterViewInit, OnDestroy, ViewChild, input, effect } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
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
  private directionalLight!: THREE.DirectionalLight;
  private baseLightIntensity = 1.5;
  private cubes: THREE.Mesh[] = [];
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
            const beatImpulse = currentBeat.strength * 0.35;
            this.cubeStates.forEach((state, i) => {
                // Stronger impulse for lower frequency bars
                const impulseFactor = Math.max(0, 1 - (i / this.cubes.length) * 0.7);
                state.velocity += beatImpulse * impulseFactor;
            });
        }
    });

    // --- Dynamic Fog & Theme Effect ---
    effect(() => {
        const newTheme = this.theme();
        const profile = this.musicProfile();
        
        if (this.scene) {
            // FOG
            const fogColor = new THREE.Color(newTheme.accent);
            let fogNear = 15, fogFar = 40;

            switch(profile) {
                case 'atmosphere':
                    fogColor.set(0x111827); // Darker color
                    fogNear = 12; fogFar = 28;
                    break;
                case 'transient':
                    fogNear = 18; fogFar = 45;
                    break;
            }
            if (this.scene.fog) {
                (this.scene.fog as THREE.Fog).color.copy(fogColor);
                (this.scene.fog as THREE.Fog).near = fogNear;
                (this.scene.fog as THREE.Fog).far = fogFar;
            }

            // THEME COLORS
            this.scene.background = new THREE.Color(newTheme.display);
            this.cubes.forEach(cube => {
                (cube.material as THREE.MeshStandardMaterial).color.set(newTheme.accent);
                (cube.material as THREE.MeshStandardMaterial).emissive.set(newTheme.accent);
            });
        }
    });

    // --- Camera Rotation Effect ---
    effect(() => {
        if (this.controls) {
            this.controls.autoRotate = this.isPlaying();
        }
    });
  }

  ngAfterViewInit(): void {
    this.initThree();
    this.animate();
  }

  ngOnDestroy(): void {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    this.disposeCubes();
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
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 50;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // Prevent camera from going under the floor
    this.controls.target.set(0, 2, 0);
    this.controls.autoRotate = this.isPlaying();
    this.controls.autoRotateSpeed = 0.5;
    this.controls.update(); // Initial update
    this.initialCameraDistance = this.camera.position.distanceTo(this.controls.target);


    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    this.directionalLight = new THREE.DirectionalLight(0xffffff, this.baseLightIntensity);
    this.directionalLight.position.set(5, 10, 7.5);
    this.directionalLight.castShadow = true;
    this.scene.add(this.directionalLight);

    const floorGeometry = new THREE.PlaneGeometry(30, 30);
    const reflector = new Reflector(floorGeometry, {
        clipBias: 0.003,
        textureWidth: canvas.clientWidth * window.devicePixelRatio,
        textureHeight: canvas.clientHeight * window.devicePixelRatio,
        color: 0x777777
    });
    reflector.rotation.x = -Math.PI / 2;
    this.scene.add(reflector);

    const shadowFloor = new THREE.Mesh(
        new THREE.PlaneGeometry(30, 30),
        new THREE.ShadowMaterial({ opacity: 0.4 })
    );
    shadowFloor.rotation.x = -Math.PI / 2;
    shadowFloor.receiveShadow = true;
    shadowFloor.position.y = 0.01;
    this.scene.add(shadowFloor);
    
    // Grid Helper
    const grid = new THREE.GridHelper(30, 30, 0x333333, 0x333333);
    this.scene.add(grid);

    this.recreateCubes(); // Initial cube creation
  }

  private disposeCubes(): void {
     this.cubes.forEach(cube => {
        this.scene.remove(cube);
        cube.geometry.dispose();
        (cube.material as THREE.Material).dispose();
    });
    this.cubes = [];
  }

  private findBestGrid(n: number): { rows: number, cols: number } {
    if (n <= 0) return { rows: 0, cols: 0 };
    let best = { rows: 1, cols: n, diff: n - 1 };
    for (let i = 2; i * i <= n; i++) {
      if (n % i === 0) {
        const j = n / i;
        if (j - i < best.diff) {
          best = { rows: i, cols: j, diff: j - i };
        }
      }
    }
    return { rows: best.rows, cols: best.cols };
  }

  private recreateCubes(): void {
    this.disposeCubes();

    const currentTheme = this.theme();
    const numBars = this.bars().length;
    if (numBars === 0) return;

    this.cubeStates = Array(numBars).fill(0).map(() => ({ velocity: 0.0 }));

    const { rows, cols } = this.findBestGrid(numBars);
    const totalWidth = cols * 1.5;
    const totalDepth = rows * 1.5;

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < numBars; i++) {
        const material = new THREE.MeshStandardMaterial({
            color: currentTheme.accent,
            emissive: currentTheme.accent,
            emissiveIntensity: 0.3,
            metalness: 0.5,
            roughness: 0.6,
        });
        const cube = new THREE.Mesh(geometry, material);
        cube.castShadow = true;
        cube.receiveShadow = true;
        
        const col = i % cols;
        const row = Math.floor(i / cols);
        
        const x = col * 1.5 - totalWidth / 2 + 0.75;
        const z = row * 1.5 - totalDepth / 2 + 0.75;
        cube.position.set(x, 0.5, z);

        this.cubes.push(cube);
        this.scene.add(cube);
    }
  }

  private animate(): void {
    this.animationFrameId = requestAnimationFrame(() => this.animate());
    const canvas = this.renderer.domElement;
    const barData = this.bars();
    const elapsedTime = this.clock.getElapsedTime();

    // Recreate cubes if bar count changes
    if (barData.length !== this.cubes.length) {
      this.recreateCubes();
    }

    // Apply spring physics to cubes
    if (this.cubes.length === barData.length) {
      const SPRING = 0.04, DAMPING = 0.25;
      barData.forEach((value, i) => {
        const cube = this.cubes[i];
        const state = this.cubeStates[i];
        const targetScale = Math.max(0.01, value * 12);
        
        const displacement = targetScale - cube.scale.y;
        const springForce = displacement * SPRING;
        const dampingForce = state.velocity * DAMPING;
        const acceleration = springForce - dampingForce;
        
        state.velocity += acceleration;
        cube.scale.y += state.velocity;
        cube.scale.y = Math.max(0.01, cube.scale.y);
        cube.position.y = cube.scale.y / 2;
      });
    }

    // Smoothly return light to base intensity
    this.directionalLight.intensity += (this.baseLightIntensity - this.directionalLight.intensity) * 0.05;

    // --- Dynamic Camera Controls ---
    if (this.isPlaying()) {
      // Rotation speed based on music intensity
      const avgBarHeight = barData.length > 0 ? barData.reduce((a, b) => a + b, 0) / barData.length : 0;
      this.controls.autoRotateSpeed = 0.2 + avgBarHeight * 0.8;
      
      // Periodic zoom ("breathing") effect
      const zoomAmplitude = 2.5;
      const zoomFrequency = 0.15;
      const zoomOffset = Math.sin(elapsedTime * zoomFrequency) * zoomAmplitude;
      const targetDistance = this.initialCameraDistance + zoomOffset;
      
      const currentDistance = this.camera.position.distanceTo(this.controls.target);
      const newDistance = THREE.MathUtils.lerp(currentDistance, targetDistance, 0.05); // Smooth interpolation
      
      const direction = this.camera.position.clone().sub(this.controls.target).normalize();
      this.camera.position.copy(this.controls.target.clone().add(direction.multiplyScalar(newDistance)));
    }

    // Handle canvas resizing
    const needsResize = canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight;
    if (needsResize) {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width > 0 && height > 0) {
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
