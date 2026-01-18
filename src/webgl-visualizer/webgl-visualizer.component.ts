import { Component, ChangeDetectionStrategy, ElementRef, AfterViewInit, OnDestroy, ViewChild, input, effect } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EqualizerTheme } from '../models/equalizer-theme.model';

@Component({
  selector: 'app-webgl-visualizer',
  standalone: true,
  template: `<canvas #canvas class="w-full h-full block"></canvas>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WebglVisualizerComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') private canvasRef!: ElementRef<HTMLCanvasElement>;

  // Inputs
  bars = input.required<number[]>();
  barWidth = input(80);
  theme = input.required<EqualizerTheme>();

  // Three.js properties
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private cubes: THREE.Mesh[] = [];
  private animationFrameId: number | null = null;
  private resizeObserver!: ResizeObserver;

  constructor() {
    // Effect to update bar heights smoothly
    effect(() => {
      const barData = this.bars();
      if (this.cubes.length === barData.length) {
        barData.forEach((value, i) => {
          const targetScale = Math.max(0.01, value * 12); // Voxel height multiplier
          // Lerp for smooth animation
          this.cubes[i].scale.y += (targetScale - this.cubes[i].scale.y) * 0.2;
          // Position cube so it grows upwards from the floor
          this.cubes[i].position.y = this.cubes[i].scale.y / 2;
        });
      }
    });
    
    // Effect to update bar width
    effect(() => {
        const widthPercent = this.barWidth();
        const scale = widthPercent / 100;
        this.cubes.forEach(cube => {
            cube.scale.x = scale;
            cube.scale.z = scale;
        });
    });

    // Effect to update theme colors
    effect(() => {
        const newTheme = this.theme();
        if (this.scene && this.cubes.length > 0) {
            this.scene.background = new THREE.Color(newTheme.display);
            this.cubes.forEach(cube => {
                (cube.material as THREE.MeshStandardMaterial).color.set(newTheme.accent);
                (cube.material as THREE.MeshStandardMaterial).emissive.set(newTheme.accent);
            });
        }
    });
  }

  ngAfterViewInit(): void {
    this.initThree();
    this.initResizeObserver();
    this.animate();
  }

  ngOnDestroy(): void {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    this.resizeObserver.disconnect();
    this.renderer.dispose();
    // Dispose of geometries and materials to free up GPU memory
    this.cubes.forEach(cube => {
        cube.geometry.dispose();
        (cube.material as THREE.Material).dispose();
    });
  }

  private initThree(): void {
    const canvas = this.canvasRef.nativeElement;
    const currentTheme = this.theme();

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(currentTheme.display);

    // Camera
    this.camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
    this.camera.position.set(0, 8, 18);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
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

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
    directionalLight.position.set(5, 10, 7.5);
    directionalLight.castShadow = true;
    this.scene.add(directionalLight);

    // Floor
    const floorGeometry = new THREE.PlaneGeometry(20, 20);
    const floorMaterial = new THREE.MeshStandardMaterial({
        color: 0x111111,
        metalness: 0.8,
        roughness: 0.4,
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    
    // Grid Helper
    const grid = new THREE.GridHelper(20, 20, 0x333333, 0x333333);
    this.scene.add(grid);

    // Voxel Cubes
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const numBars = 64;
    const gridSide = 8;

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
        
        // Position cubes in an 8x8 grid
        const x = (i % gridSide) - (gridSide / 2) + 0.5;
        const z = Math.floor(i / gridSide) - (gridSide / 2) + 0.5;
        cube.position.set(x * 1.5, 0.5, z * 1.5); // 1.5 multiplier for spacing

        this.cubes.push(cube);
        this.scene.add(cube);
    }
  }

  private initResizeObserver(): void {
    const canvas = this.canvasRef.nativeElement;
    this.resizeObserver = new ResizeObserver(entries => {
        const entry = entries[0];
        const { width, height } = entry.contentRect;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    });
    this.resizeObserver.observe(canvas);
  }

  private animate(): void {
    this.animationFrameId = requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
