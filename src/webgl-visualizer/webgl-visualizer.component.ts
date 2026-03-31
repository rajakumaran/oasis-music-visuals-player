import { Component, ChangeDetectionStrategy, ElementRef, AfterViewInit, OnDestroy, ViewChild, input, effect, output } from '@angular/core';
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

  interaction = output<void>();

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
  private voxelWavesGroup!: THREE.Group;
  private singularityGroup!: THREE.Group;
  private singularityCore!: THREE.Mesh;
  private accretionDisk!: THREE.Points;
  private hawkingParticles!: THREE.Points;
  // Metropolis State
  private metropolisGroup!: THREE.Group;
  private buildingMesh!: THREE.InstancedMesh;
  private trafficPoints!: THREE.Points;
  private zenithMesh!: THREE.Mesh;
  private trafficData: { x: number, y: number, z: number, speed: number, axis: 'x' | 'z', dir: number }[] = [];
  
  // Nebula State
  private nebulaGroup!: THREE.Group;
  private nebulaParticles!: THREE.Points;
  private nebulaCore!: THREE.Mesh;
  private nebulaSatellites: THREE.Mesh[] = [];
  private nebulaSatelliteData: { orbitRadius: number; orbitSpeed: number; orbitPhase: number; binIndex: number; axis: THREE.Vector3 }[] = [];
  private nebulaShockwaves: { ring: THREE.Mesh; age: number; maxAge: number }[] = [];
  private nebulaBasePositions!: Float32Array; // initial spiral positions for displacement
  
  // Aizawa Attractor State
  private attractorGroup!: THREE.Group;
  private attractorParticles!: THREE.Points;
  private attractorData: { x: number, y: number, z: number, originalIdx: number }[] = [];

  // Ford Spheres State
  private fordGroup!: THREE.Group;
  private fordSpheresMap: THREE.Mesh[] = [];

  // Menger Sponge State
  private mengerGroup!: THREE.Group;
  private mengerMesh!: THREE.InstancedMesh;

  private animationFrameId: number | null = null;
  private clock = new THREE.Clock();
  private isUserInteracting = false;
  private lastInteractionTime = 0;
  
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
                const impulseFactor = Math.max(0, 1 - (i / this.cubes.length) * 0.7); //Google suggests 0.7
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
    
    this.controls.addEventListener('start', () => {
      this.isUserInteracting = true;
      this.lastInteractionTime = performance.now();
      this.interaction.emit();
    });
    this.controls.addEventListener('end', () => {
      this.isUserInteracting = false;
      this.lastInteractionTime = performance.now();
    });

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
    if (this.voxelWavesGroup) {
      this.scene.remove(this.voxelWavesGroup);
      this.voxelWavesGroup.children.forEach(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
    }
    if (this.singularityGroup) {
      this.scene.remove(this.singularityGroup);
      this.singularityCore.geometry.dispose();
      (this.singularityCore.material as THREE.Material).dispose();
      this.accretionDisk.geometry.dispose();
      (this.accretionDisk.material as THREE.Material).dispose();
      this.hawkingParticles.geometry.dispose();
      (this.hawkingParticles.material as THREE.Material).dispose();
    }
    if (this.metropolisGroup) {
      this.scene.remove(this.metropolisGroup);
      this.buildingMesh.geometry.dispose();
      (this.buildingMesh.material as THREE.Material).dispose();
      this.trafficPoints.geometry.dispose();
      (this.trafficPoints.material as THREE.Material).dispose();
      this.zenithMesh.geometry.dispose();
      (this.zenithMesh.material as THREE.Material).dispose();
    }
    if (this.nebulaGroup) {
      this.scene.remove(this.nebulaGroup);
      this.nebulaParticles.geometry.dispose();
      (this.nebulaParticles.material as THREE.Material).dispose();
      this.nebulaCore.geometry.dispose();
      (this.nebulaCore.material as THREE.Material).dispose();
      this.nebulaSatellites.forEach(s => { s.geometry.dispose(); (s.material as THREE.Material).dispose(); });
      this.nebulaShockwaves.forEach(sw => { this.nebulaGroup.remove(sw.ring); sw.ring.geometry.dispose(); (sw.ring.material as THREE.Material).dispose(); });
      this.nebulaSatellites = [];
      this.nebulaSatelliteData = [];
      this.nebulaShockwaves = [];
    }
    if (this.attractorGroup) {
      this.scene.remove(this.attractorGroup);
      this.attractorParticles.geometry.dispose();
      (this.attractorParticles.material as THREE.Material).dispose();
      this.attractorData = [];
    }
    if (this.fordGroup) {
      this.scene.remove(this.fordGroup);
      this.fordSpheresMap.forEach(s => {
        s.geometry.dispose();
        (s.material as THREE.Material).dispose();
      });
      this.fordSpheresMap = [];
    }
    if (this.mengerGroup) {
      this.scene.remove(this.mengerGroup);
      this.mengerMesh.geometry.dispose();
      (this.mengerMesh.material as THREE.Material).dispose();
    }
  }

  private recreateVisualizers(): void {
    this.disposeSceneContent();
    this.createBarVisualizer();
    this.createTerrainVisualizer();
    this.createVoxelWavesVisualizer();
    this.createSingularityVisualizer();
    this.createMetropolisVisualizer();
    this.createNebulaVisualizer();
    this.createStrangeAttractorVisualizer();
    this.createFordSpheresVisualizer();
    this.createMengerSpongeVisualizer();
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

  private createVoxelWavesVisualizer() {
    this.voxelWavesGroup = new THREE.Group();
    const numRings = 8;
    const cubesPerRing = 16;
    const geometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    
    for (let r = 0; r < numRings; r++) {
      const radius = (r + 1) * 2.5;
      for (let i = 0; i < cubesPerRing; i++) {
        const angle = (i / cubesPerRing) * Math.PI * 2;
        const material = new THREE.MeshStandardMaterial({
          color: this.theme().accent,
          emissive: this.theme().accent,
          emissiveIntensity: 0.5
        });
        const cube = new THREE.Mesh(geometry, material);
        cube.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
        cube.castShadow = true;
        cube.receiveShadow = true;
        this.voxelWavesGroup.add(cube);
      }
    }
    this.scene.add(this.voxelWavesGroup);
  }

  private createSingularityVisualizer() {
    this.singularityGroup = new THREE.Group();
    
    // Core
    const coreGeom = new THREE.SphereGeometry(2, 32, 32);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      roughness: 0,
      metalness: 1,
      emissive: this.theme().accent,
      emissiveIntensity: 0.2
    });
    this.singularityCore = new THREE.Mesh(coreGeom, coreMat);
    this.singularityGroup.add(this.singularityCore);
    
    // Accretion Disk
    const diskCount = 2000;
    const diskGeom = new THREE.BufferGeometry();
    const diskPos = new Float32Array(diskCount * 3);
    const diskColors = new Float32Array(diskCount * 3);
    const accent = new THREE.Color(this.theme().accent);
    
    for (let i = 0; i < diskCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 4 + Math.random() * 8;
      diskPos[i * 3] = Math.cos(angle) * radius;
      diskPos[i * 3 + 1] = (Math.random() - 0.5) * 0.5;
      diskPos[i * 3 + 2] = Math.sin(angle) * radius;
      
      diskColors[i * 3] = accent.r;
      diskColors[i * 3 + 1] = accent.g;
      diskColors[i * 3 + 2] = accent.b;
    }
    diskGeom.setAttribute('position', new THREE.BufferAttribute(diskPos, 3));
    diskGeom.setAttribute('color', new THREE.BufferAttribute(diskColors, 3));
    
    const diskMat = new THREE.PointsMaterial({
      size: 0.05,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending
    });
    this.accretionDisk = new THREE.Points(diskGeom, diskMat);
    this.singularityGroup.add(this.accretionDisk);
    
    // Hawking Radiation
    const hawkingCount = 500;
    const hawkingGeom = new THREE.BufferGeometry();
    const hawkingPos = new Float32Array(hawkingCount * 3);
    for (let i = 0; i < hawkingCount; i++) {
      hawkingPos[i * 3] = 0;
      hawkingPos[i * 3 + 1] = 0;
      hawkingPos[i * 3 + 2] = 0;
    }
    hawkingGeom.setAttribute('position', new THREE.BufferAttribute(hawkingPos, 3));
    const hawkingMat = new THREE.PointsMaterial({
      size: 0.1,
      color: this.theme().accent,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending
    });
    this.hawkingParticles = new THREE.Points(hawkingGeom, hawkingMat);
    this.singularityGroup.add(this.hawkingParticles);
    
    this.scene.add(this.singularityGroup);
  }

  private createMetropolisVisualizer() {
    this.metropolisGroup = new THREE.Group();
    
    // 1. City Grid (InstancedMesh)
    const gridSize = 40;
    const spacing = 1.5;
    const totalBuildings = gridSize * gridSize;
    
    const buildingGeom = new THREE.BoxGeometry(0.6, 1, 0.6);
    // Move geometry up so it scales from the bottom
    buildingGeom.translate(0, 0.5, 0); 
    
    // Pure emissive white base material. Instance colors will multiply this.
    const buildingMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    
    this.buildingMesh = new THREE.InstancedMesh(buildingGeom, buildingMat, totalBuildings);
    this.buildingMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    
    // We add an instanceColor buffer so each building can glow appropriately
    const colors = new Float32Array(totalBuildings * 3);
    this.buildingMesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    this.buildingMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    
    const matrix = new THREE.Matrix4();
    let i = 0;
    for (let x = 0; x < gridSize; x++) {
      for (let z = 0; z < gridSize; z++) {
        const px = (x - gridSize / 2) * spacing;
        const pz = (z - gridSize / 2) * spacing;
        matrix.setPosition(px, 0, pz);
        this.buildingMesh.setMatrixAt(i, matrix);
        i++;
      }
    }
    this.metropolisGroup.add(this.buildingMesh);
    
    // 2. Neon Traffic Streams
    const numTraffic = 1000;
    const trafficGeom = new THREE.BufferGeometry();
    const trafficPos = new Float32Array(numTraffic * 3);
    this.trafficData = [];
    
    for (let t = 0; t < numTraffic; t++) {
      const isXAxis = Math.random() > 0.5;
      const lane = (Math.floor(Math.random() * gridSize) - gridSize / 2) * spacing;
      const startPos = (Math.random() - 0.5) * gridSize * spacing;
      
      const x = isXAxis ? startPos : lane + (Math.random() - 0.5) * 0.4;
      const z = isXAxis ? lane + (Math.random() - 0.5) * 0.4 : startPos;
      const y = 0.5; // Raised slightly so traffic doesn't clip with street
      
      trafficPos[t*3] = x;
      trafficPos[t*3+1] = y;
      trafficPos[t*3+2] = z;
      
      this.trafficData.push({
        x, y, z,
        speed: 0.05 + Math.random() * 0.1,
        axis: isXAxis ? 'x' : 'z',
        dir: Math.random() > 0.5 ? 1 : -1
      });
    }
    trafficGeom.setAttribute('position', new THREE.BufferAttribute(trafficPos, 3));
    
    const trafficMat = new THREE.PointsMaterial({
      color: this.theme().accent,
      size: 0.15,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending
    });
    this.trafficPoints = new THREE.Points(trafficGeom, trafficMat);
    this.metropolisGroup.add(this.trafficPoints);
    
    // 3. The Zenith (Floating Core)
    const zenithGeom = new THREE.IcosahedronGeometry(5, 1);
    const zenithMat = new THREE.MeshBasicMaterial({
      color: this.theme().accent,
      wireframe: true,
      transparent: true,
      opacity: 0.15
    });
    this.zenithMesh = new THREE.Mesh(zenithGeom, zenithMat);
    this.zenithMesh.position.set(0, 20, 0);
    this.metropolisGroup.add(this.zenithMesh);
    
    this.scene.add(this.metropolisGroup);
  }

  // ============= STRANGE ATTRACTOR (Aizawa) =============
  private createStrangeAttractorVisualizer() {
    this.attractorGroup = new THREE.Group();
    const numParticles = 8000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(numParticles * 3);
    const colors = new Float32Array(numParticles * 3);
    const accent = new THREE.Color(this.theme().accent || '#ffffff');
    this.attractorData = [];

    let x = 0.1, y = 0, z = 0;
    const dt = 0.01;
    const a = 0.95, b = 0.7, c = 0.6, d = 3.5, e = 0.25, f = 0.1;
    
    for (let i = 0; i < numParticles; i++) {
        const dx = (z - b) * x - d * y;
        const dy = d * x + (z - b) * y;
        const dz = c + a * z - (Math.pow(z, 3) / 3) - (x * x + y * y) * (1 + e * z) + f * z * Math.pow(x, 3);
        
        x += dx * dt;
        y += dy * dt;
        z += dz * dt;

        positions[i * 3] = x * 2;
        positions[i * 3 + 1] = y * 2;
        positions[i * 3 + 2] = z * 2;
        
        this.attractorData.push({ x: x * 2, y: y * 2, z: z * 2, originalIdx: i });

        const mixRatio = i / numParticles;
        const cColor = accent.clone().offsetHSL(mixRatio * 0.2, 0, 0);
        colors[i * 3] = cColor.r; colors[i * 3 + 1] = cColor.g; colors[i * 3 + 2] = cColor.b;
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    const material = new THREE.PointsMaterial({
        size: 0.1, vertexColors: true, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending
    });
    this.attractorParticles = new THREE.Points(geometry, material);
    this.attractorGroup.position.set(0, 3, 0);
    this.attractorGroup.add(this.attractorParticles);
    this.scene.add(this.attractorGroup);
  }

  // ============= FORD SPHERES (3D Apollonian Gasket) =============
  private createFordSpheresVisualizer() {
    this.fordGroup = new THREE.Group();
    this.fordSpheresMap = [];
    
    const material = new THREE.MeshStandardMaterial({
        color: this.theme().accent,
        metalness: 0.8,
        roughness: 0.2,
        emissive: this.theme().accent,
        emissiveIntensity: 0.2
    });

    const createSphere = (x: number, y: number, z: number, r: number) => {
        const geom = new THREE.SphereGeometry(1, 32, 32);
        const sphere = new THREE.Mesh(geom, material);
        sphere.position.set(x, y, z);
        sphere.scale.setScalar(r);
        sphere.castShadow = true;
        sphere.receiveShadow = true;
        sphere.userData = { initialScale: r };
        this.fordSpheresMap.push(sphere);
        this.fordGroup.add(sphere);
    };

    createSphere(0, 0, 0, 3);
    
    const numRings = 3;
    const baseRadius = 3;
    for (let ring = 1; ring <= numRings; ring++) {
        const r = baseRadius / ring;
        const count = ring * 6;
        for (let i = 0; i < count; i++) {
            const theta = (i / count) * Math.PI * 2;
            const phi = Math.acos(1 - 2 * ((i + 0.5) / count));
            const dist = baseRadius + r;
            const x = dist * Math.sin(phi) * Math.cos(theta);
            const y = dist * Math.sin(phi) * Math.sin(theta);
            const z = dist * Math.cos(phi);
            createSphere(x, y, z, r);
        }
    }
    
    this.fordGroup.position.set(0, 5, 0);
    this.scene.add(this.fordGroup);
  }

  // ============= MENGER SPONGE VOXEL LATTICE =============
  private createMengerSpongeVisualizer() {
      this.mengerGroup = new THREE.Group();
      
      const depth = 2;
      const cubesToDraw: THREE.Vector3[] = [];
      const size = 10;
      
      const isMengerSolid = (x: number, y: number, z: number): boolean => {
          while (x > 0 || y > 0 || z > 0) {
              if ((x % 3 === 1 && y % 3 === 1) || (y % 3 === 1 && z % 3 === 1) || (x % 3 === 1 && z % 3 === 1)) {
                  return false;
              }
              x = Math.floor(x / 3);
              y = Math.floor(y / 3);
              z = Math.floor(z / 3);
          }
          return true;
      };

      const dim = Math.pow(3, depth);
      const step = size / dim;

      for (let x = 0; x < dim; x++) {
          for (let y = 0; y < dim; y++) {
              for (let z = 0; z < dim; z++) {
                  if (isMengerSolid(x, y, z)) {
                      cubesToDraw.push(new THREE.Vector3(
                          (x - dim/2) * step + step/2,
                          (y - dim/2) * step + step/2,
                          (z - dim/2) * step + step/2
                      ));
                  }
              }
          }
      }

      const geom = new THREE.BoxGeometry(step * 0.95, step * 0.95, step * 0.95);
      const material = new THREE.MeshStandardMaterial({
          color: this.theme().accent,
          emissive: this.theme().accent,
          emissiveIntensity: 0.3,
          metalness: 0.5,
          roughness: 0.2,
      });

      this.mengerMesh = new THREE.InstancedMesh(geom, material, cubesToDraw.length);
      this.mengerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      const matrix = new THREE.Matrix4();
      cubesToDraw.forEach((pos, i) => {
          matrix.setPosition(pos);
          this.mengerMesh.setMatrixAt(i, matrix);
      });

      this.mengerMesh.castShadow = true;
      this.mengerMesh.receiveShadow = true;
      this.mengerGroup.add(this.mengerMesh);
      this.mengerGroup.position.set(0, 5, 0);
      this.scene.add(this.mengerGroup);
  }

  private toggleVisualizerMode(mode: 'bars' | 'terrain' | 'voxel-waves' | 'quantum-singularity' | 'webgl-metropolis' | 'webgl-nebula' | 'strange-attractor' | 'ford-spheres' | 'menger-sponge') {
      this.cubes.forEach(c => c.visible = mode === 'bars');
      if (this.terrainMesh) this.terrainMesh.visible = mode === 'terrain';
      if (this.voxelWavesGroup) this.voxelWavesGroup.visible = mode === 'voxel-waves';
      if (this.singularityGroup) this.singularityGroup.visible = mode === 'quantum-singularity';
      if (this.metropolisGroup) this.metropolisGroup.visible = mode === 'webgl-metropolis';
      if (this.nebulaGroup) this.nebulaGroup.visible = mode === 'webgl-nebula';
      if (this.attractorGroup) this.attractorGroup.visible = mode === 'strange-attractor';
      if (this.fordGroup) this.fordGroup.visible = mode === 'ford-spheres';
      if (this.mengerGroup) this.mengerGroup.visible = mode === 'menger-sponge';
  }

  private updateSceneFromTheme(theme: EqualizerTheme, profile: MusicProfile) {
    if (!this.scene) return;
    this.scene.background = new THREE.Color(theme.display);
    const accentColor = new THREE.Color(theme.accent);

    this.cubes.forEach(cube => {
      (cube.material as THREE.MeshStandardMaterial).color.set(accentColor);
      (cube.material as THREE.MeshStandardMaterial).emissive.set(accentColor);
    });

    if (this.voxelWavesGroup) {
      this.voxelWavesGroup.children.forEach(child => {
        if (child instanceof THREE.Mesh) {
          (child.material as THREE.MeshStandardMaterial).color.set(accentColor);
          (child.material as THREE.MeshStandardMaterial).emissive.set(accentColor);
        }
      });
    }

    if (this.singularityGroup) {
      (this.singularityCore.material as THREE.MeshStandardMaterial).emissive.set(accentColor);
      (this.accretionDisk.material as THREE.PointsMaterial).color.set(accentColor);
      (this.hawkingParticles.material as THREE.PointsMaterial).color.set(accentColor);
    }
    
    if (this.metropolisGroup) {
      const accent = new THREE.Color(accentColor);
      (this.zenithMesh.material as THREE.MeshBasicMaterial).color.set(accent);
      (this.trafficPoints.material as THREE.PointsMaterial).color.set(accent);
    }

    if (this.nebulaGroup) {
      (this.nebulaParticles.material as THREE.PointsMaterial).color.set(accentColor);
      (this.nebulaCore.material as THREE.MeshStandardMaterial).emissive.set(accentColor);
      this.nebulaSatellites.forEach(s => {
        (s.material as THREE.MeshStandardMaterial).color.set(accentColor);
        (s.material as THREE.MeshStandardMaterial).emissive.set(accentColor);
      });
    }
    
    if (this.terrainMesh) {
      (this.terrainMesh.material as THREE.ShaderMaterial).uniforms.colorAccent.value = accentColor;
    }

    if (this.attractorGroup) {
      (this.attractorParticles.material as THREE.PointsMaterial).color.set(accentColor);
    }
    if (this.fordGroup) {
      this.fordSpheresMap.forEach(s => {
        (s.material as THREE.MeshStandardMaterial).color.set(accentColor);
        (s.material as THREE.MeshStandardMaterial).emissive.set(accentColor);
      });
    }
    if (this.mengerGroup) {
      (this.mengerMesh.material as THREE.MeshStandardMaterial).color.set(accentColor);
      (this.mengerMesh.material as THREE.MeshStandardMaterial).emissive.set(accentColor);
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
    else if (this.theme().webglMode === 'voxel-waves') this.animateVoxelWaves(barData, elapsedTime);
    else if (this.theme().webglMode === 'quantum-singularity') this.animateSingularity(barData, elapsedTime);
    else if (this.theme().webglMode === 'webgl-metropolis') this.animateMetropolis(barData, elapsedTime);
    else if (this.theme().webglMode === 'webgl-nebula') this.animateNebula(barData, elapsedTime);
    else if (this.theme().webglMode === 'strange-attractor') this.animateStrangeAttractor(barData, elapsedTime);
    else if (this.theme().webglMode === 'ford-spheres') this.animateFordSpheres(barData, elapsedTime);
    else if (this.theme().webglMode === 'menger-sponge') this.animateMengerSponge(barData, elapsedTime);
    else this.animateBars(barData);

    this.directionalLight.intensity += (this.baseLightIntensity - this.directionalLight.intensity) * 0.05;
    this.animateCamera(barData, elapsedTime);
    this.handleResize();

    this.controls.update();
    this.composer.render();
  }

  private animateStrangeAttractor(barData: number[], elapsedTime: number) {
      if (!this.attractorGroup) return;
      const bass = barData.slice(0, 4).reduce((a, b) => a + b, 0) / 4;
      
      const positions = this.attractorParticles.geometry.attributes.position.array as Float32Array;
      
      this.attractorGroup.rotation.y = elapsedTime * 0.1;
      this.attractorGroup.rotation.z = Math.sin(elapsedTime * 0.05) * 0.2;
      
      for (let i = 0; i < this.attractorData.length; i++) {
          const orig = this.attractorData[i];
          const dist = Math.sqrt(orig.x*orig.x + orig.y*orig.y + orig.z*orig.z);
          const expansion = 1 + bass * (1 / (1 + dist));
          
          positions[i * 3] = orig.x * expansion;
          positions[i * 3 + 1] = orig.y * expansion;
          positions[i * 3 + 2] = orig.z * expansion;
      }
      this.attractorParticles.geometry.attributes.position.needsUpdate = true;
      (this.attractorParticles.material as THREE.PointsMaterial).size = 0.05 + bass * 0.2;
  }

  private animateFordSpheres(barData: number[], elapsedTime: number) {
      if (!this.fordGroup) return;
      
      const bass = barData.slice(0, 4).reduce((a, b) => a + b, 0) / 4;
      this.fordGroup.rotation.y += 0.005 + bass * 0.02;
      this.fordGroup.rotation.x = Math.sin(elapsedTime * 0.2) * 0.1;

      for (let i = 0; i < this.fordSpheresMap.length; i++) {
          const sphere = this.fordSpheresMap[i];
          const bin = Math.min(barData.length - 1, Math.floor((i / this.fordSpheresMap.length) * barData.length));
          const energy = barData[bin] || 0;
          
          const baseScale = sphere.userData['initialScale'] || 1;
          if (i === 0) {
              sphere.scale.setScalar(baseScale + bass * 1.5);
              (sphere.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.2 + bass * 2.5;
          } else {
              sphere.scale.setScalar(baseScale * (1 + energy * 1.5));
              (sphere.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.2 + energy * 2;
          }
      }
  }

  private animateMengerSponge(barData: number[], elapsedTime: number) {
      if (!this.mengerGroup || !this.mengerMesh) return;
      
      const bass = barData.slice(0, 4).reduce((a, b) => a + b, 0) / 4;
      this.mengerGroup.rotation.y = elapsedTime * 0.2;
      this.mengerGroup.rotation.x = Math.sin(elapsedTime * 0.1) * 0.2;

      const matrix = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const rot = new THREE.Quaternion();
      const sca = new THREE.Vector3();
      
      const count = this.mengerMesh.count;
      for (let i = 0; i < count; i++) {
          this.mengerMesh.getMatrixAt(i, matrix);
          matrix.decompose(pos, rot, sca);
          
          const dist = pos.length();
          const bin = Math.min(barData.length - 1, Math.floor((dist / 10) * barData.length));
          const energy = barData[bin] || 0;
          
          const targetScale = 1 + energy * 1.5;
          sca.setScalar(sca.x + (targetScale - sca.x) * 0.2);
          
          if (energy > 0.6) rot.setFromEuler(new THREE.Euler(energy*elapsedTime, energy*elapsedTime, 0));
          else rot.setFromEuler(new THREE.Euler(0, 0, 0));

          matrix.compose(pos, rot, sca);
          this.mengerMesh.setMatrixAt(i, matrix);
      }
      this.mengerMesh.instanceMatrix.needsUpdate = true;
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

  private animateVoxelWaves(barData: number[], elapsedTime: number) {
    if (!this.voxelWavesGroup) return;
    const children = this.voxelWavesGroup.children;
    const numRings = 8;
    const cubesPerRing = 16;
    
    children.forEach((child, index) => {
      const ringIndex = Math.floor(index / cubesPerRing);
      const cubeIndexInRing = index % cubesPerRing;
      const barIndex = Math.floor((ringIndex / numRings) * barData.length);
      const energy = barData[barIndex] || 0;
      
      // Respect view area: limit Y height
      const targetY = energy * 6;
      child.position.y += (targetY - child.position.y) * 0.1;
      
      // Limit scaling
      child.scale.setScalar(1 + energy * 1.5);
      child.rotation.y += 0.01 + energy * 0.05;
      
      // Floating motion
      child.position.y += Math.sin(elapsedTime * 2 + ringIndex) * 0.15;
    });
    
    this.voxelWavesGroup.rotation.y += 0.002;
  }

  private animateSingularity(barData: number[], elapsedTime: number) {
    if (!this.singularityGroup) return;
    
    const bass = barData.slice(0, 4).reduce((a, b) => a + b, 0) / 4;
    const mids = barData.slice(4, 20).reduce((a, b) => a + b, 0) / 16;
    const treble = barData.slice(barData.length - 16).reduce((a, b) => a + b, 0) / 16;
    
    // Core pulse
    const coreScale = 1 + bass * 1.5;
    this.singularityCore.scale.setScalar(coreScale);
    (this.singularityCore.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.2 + bass * 2;
    
    // Accretion Disk rotation and distortion
    this.accretionDisk.rotation.y += 0.01 + bass * 0.05;
    this.accretionDisk.rotation.z = Math.sin(elapsedTime * 0.5) * 0.2;
    
    const diskPositions = this.accretionDisk.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < diskPositions.length / 3; i++) {
        const yBase = diskPositions[i * 3 + 1];
        // Add some vertical wobble
        diskPositions[i * 3 + 1] = Math.sin(elapsedTime * 2 + i) * 0.1 * mids;
    }
    this.accretionDisk.geometry.attributes.position.needsUpdate = true;
    
    // Hawking Radiation
    const hawkingPositions = this.hawkingParticles.geometry.attributes.position.array as Float32Array;
    const beat = this.beat();
    if (beat.timestamp > this.lastBeatTimestamp) {
      // Reset some particles to origin and give them velocity
      for (let i = 0; i < 50; i++) {
        const idx = Math.floor(Math.random() * (hawkingPositions.length / 3));
        hawkingPositions[idx * 3] = 0;
        hawkingPositions[idx * 3 + 1] = (Math.random() - 0.5) * 2;
        hawkingPositions[idx * 3 + 2] = 0;
      }
    }
    
    for (let i = 0; i < hawkingPositions.length / 3; i++) {
      // Move particles outward
      const speed = 0.1 + treble * 0.5;
      const y = hawkingPositions[i * 3 + 1];
      const dir = y >= 0 ? 1 : -1;
      hawkingPositions[i * 3 + 1] += dir * speed;
      
      // Reset if too far
      if (Math.abs(hawkingPositions[i * 3 + 1]) > 20) {
        hawkingPositions[i * 3 + 1] = 0;
      }
    }
    this.hawkingParticles.geometry.attributes.position.needsUpdate = true;
    
    this.singularityGroup.rotation.z = Math.sin(elapsedTime * 0.2) * 0.1;
  }
  
  private animateMetropolis(barData: number[], elapsedTime: number) {
    if (!this.metropolisGroup || !this.buildingMesh) return;
    
    // 1. Animate Buildings (InstancedMesh)
    const gridSize = 40;
    const spacing = 1.5; // Matching updated creating spacing
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    
    const baseColor = new THREE.Color(0x020205); // Very dark, barely visible
    const accentColor = new THREE.Color(this.theme().accent);
    const colorObj = new THREE.Color();
    
    let i = 0;
    for (let x = 0; x < gridSize; x++) {
      for (let z = 0; z < gridSize; z++) {
        // Distance from center determines which frequency band affects it
        const dx = x - gridSize / 2;
        const dz = z - gridSize / 2;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const maxDist = gridSize / Math.sqrt(2);
        
        // Map distance to array index
        let barIdx = Math.floor((dist / maxDist) * barData.length);
        barIdx = Math.max(0, Math.min(barIdx, barData.length - 1));
        
        const energy = barData[barIdx] || 0;
        
        // High core, lower edges
        const heightMultiplier = 1 + (1 - dist/maxDist) * 15;
        const targetHeight = 0.1 + energy * heightMultiplier;
        
        this.buildingMesh.getMatrixAt(i, matrix);
        matrix.decompose(position, rotation, scale);
        
        // Smooth scaling
        scale.y += (targetHeight - scale.y) * 0.2;
        matrix.compose(position, rotation, scale);
        this.buildingMesh.setMatrixAt(i, matrix);
        
        // Apply neon glow to buildings based on energy level
        const glowLerp = Math.min(1, energy * 1.5);
        colorObj.copy(baseColor).lerp(accentColor, glowLerp);
        this.buildingMesh.setColorAt(i, colorObj);
        
        i++;
      }
    }
    this.buildingMesh.instanceMatrix.needsUpdate = true;
    if (this.buildingMesh.instanceColor) this.buildingMesh.instanceColor.needsUpdate = true;
    
    // 2. Animate Traffic
    const beatInfo = this.beat();
    const isBeat = beatInfo.timestamp > this.lastBeatTimestamp && beatInfo.strength > 0.5;
    if (isBeat) this.lastBeatTimestamp = beatInfo.timestamp;
    
    // Traffic accelerates on beat
    const beatBoost = isBeat ? beatInfo.strength * 2 : 0;
    const positions = this.trafficPoints.geometry.attributes.position.array as Float32Array;
    
    for (let t = 0; t < this.trafficData.length; t++) {
      const data = this.trafficData[t];
      const speed = data.speed * (1 + beatBoost + (barData[5] || 0) * 2); 
      
      if (data.axis === 'x') {
        data.x += speed * data.dir;
        if (Math.abs(data.x) > (gridSize * spacing) / 2) {
          data.x = data.x > 0 ? -(gridSize * spacing) / 2 : (gridSize * spacing) / 2;
        }
        positions[t*3] = data.x;
      } else {
        data.z += speed * data.dir;
        if (Math.abs(data.z) > (gridSize * spacing) / 2) {
          data.z = data.z > 0 ? -(gridSize * spacing) / 2 : (gridSize * spacing) / 2;
        }
        positions[t*3+2] = data.z;
      }
    }
    this.trafficPoints.geometry.attributes.position.needsUpdate = true;
    
    // 3. Animate Zenith
    const bass = barData.slice(0, 4).reduce((a, b) => a + b, 0) / 4;
    this.zenithMesh.rotation.y = elapsedTime * 0.1;
    this.zenithMesh.rotation.z = Math.sin(elapsedTime * 0.2) * 0.2;
    
    const targetScale = 1 + bass * 2;
    this.zenithMesh.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1);
  }

  // ============== AUDIO NEBULA ==============
  private createNebulaVisualizer() {
    this.nebulaGroup = new THREE.Group();

    // --- 1. Spiral Particle Cloud (6000 particles, 4 arms) ---
    const PARTICLE_COUNT = 6000;
    const NUM_ARMS = 4;
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const sizes = new Float32Array(PARTICLE_COUNT);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const armIndex = i % NUM_ARMS;
      const t = (i / PARTICLE_COUNT) * 6; // 0..6 spiral turns
      const armAngle = (armIndex / NUM_ARMS) * Math.PI * 2;
      const spiralAngle = armAngle + t * 1.2; // Spiral twist
      const radius = 2 + t * 2.5; // Expand outward

      // Add scatter (makes it feel organic, not perfectly geometric)
      const scatter = 0.5 + t * 0.4;
      const px = Math.cos(spiralAngle) * radius + (Math.random() - 0.5) * scatter;
      const py = (Math.random() - 0.5) * (1.5 + t * 0.3); // Vertical spread increases outward
      const pz = Math.sin(spiralAngle) * radius + (Math.random() - 0.5) * scatter;

      positions[i * 3] = px;
      positions[i * 3 + 1] = py;
      positions[i * 3 + 2] = pz;
      sizes[i] = 0.08 + Math.random() * 0.15;
    }

    // Store base positions for frequency-driven displacement
    this.nebulaBasePositions = new Float32Array(positions);

    const particleGeom = new THREE.BufferGeometry();
    particleGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particleGeom.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const particleMat = new THREE.PointsMaterial({
      size: 0.12,
      color: this.theme().accent,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.nebulaParticles = new THREE.Points(particleGeom, particleMat);
    this.nebulaGroup.add(this.nebulaParticles);

    // --- 2. Core Sphere ---
    const coreGeom = new THREE.SphereGeometry(1.5, 32, 32);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: this.theme().accent,
      emissiveIntensity: 1.5,
      roughness: 0.1,
      metalness: 0.9,
    });
    this.nebulaCore = new THREE.Mesh(coreGeom, coreMat);
    this.nebulaGroup.add(this.nebulaCore);

    // --- 3. Orbiting Satellite Objects (8 varied geometries) ---
    const satelliteGeometries: THREE.BufferGeometry[] = [
      new THREE.IcosahedronGeometry(0.4, 0),
      new THREE.OctahedronGeometry(0.35),
      new THREE.TorusGeometry(0.3, 0.1, 8, 12),
      new THREE.TetrahedronGeometry(0.4),
      new THREE.IcosahedronGeometry(0.5, 1),
      new THREE.DodecahedronGeometry(0.35),
      new THREE.TorusKnotGeometry(0.25, 0.08, 32, 8),
      new THREE.OctahedronGeometry(0.5),
    ];

    this.nebulaSatellites = [];
    this.nebulaSatelliteData = [];

    for (let s = 0; s < 8; s++) {
      const mat = new THREE.MeshStandardMaterial({
        color: this.theme().accent,
        emissive: this.theme().accent,
        emissiveIntensity: 0.8,
        roughness: 0.2,
        metalness: 0.8,
        wireframe: s % 3 === 0, // Every 3rd satellite is wireframe for variety
      });
      const mesh = new THREE.Mesh(satelliteGeometries[s], mat);
      mesh.castShadow = true;

      // Spread satellites across frequency spectrum
      const binIndex = Math.floor((s / 8) * 64);
      const orbitRadius = 5 + s * 2.5;
      const orbitSpeed = 0.3 + Math.random() * 0.5;
      const orbitPhase = (s / 8) * Math.PI * 2;

      // Tilt the orbit axis for visual variety
      const axis = new THREE.Vector3(
        Math.random() - 0.5,
        1 + Math.random(),
        Math.random() - 0.5
      ).normalize();

      this.nebulaSatellites.push(mesh);
      this.nebulaSatelliteData.push({ orbitRadius, orbitSpeed, orbitPhase, binIndex, axis });
      this.nebulaGroup.add(mesh);
    }

    this.scene.add(this.nebulaGroup);
  }

  private animateNebula(barData: number[], elapsedTime: number) {
    if (!this.nebulaGroup) return;

    const NUM_ARMS = 4;
    const bass = barData.slice(0, Math.max(1, Math.floor(barData.length * 0.15))).reduce((a, b) => a + b, 0) / Math.max(1, Math.floor(barData.length * 0.15));
    const mids = barData.slice(Math.floor(barData.length * 0.15), Math.floor(barData.length * 0.6)).reduce((a, b) => a + b, 0) / Math.max(1, Math.floor(barData.length * 0.45));
    const treble = barData.slice(Math.floor(barData.length * 0.6)).reduce((a, b) => a + b, 0) / Math.max(1, Math.floor(barData.length * 0.4));
    const overall = barData.reduce((a, b) => a + b, 0) / Math.max(1, barData.length);

    // --- 1. Animate particles: displace along Y and radially based on frequency ---
    const positions = this.nebulaParticles.geometry.attributes.position.array as Float32Array;
    const basePos = this.nebulaBasePositions;
    const particleCount = positions.length / 3;

    for (let i = 0; i < particleCount; i++) {
      const armIndex = i % NUM_ARMS;
      const t = (i / particleCount); // 0..1 progress along spiral

      // Each arm responds to a different frequency range
      let armFreqStart: number, armFreqEnd: number;
      if (armIndex === 0) { armFreqStart = 0; armFreqEnd = 0.1; }       // Sub-bass
      else if (armIndex === 1) { armFreqStart = 0.1; armFreqEnd = 0.3; } // Low-mids
      else if (armIndex === 2) { armFreqStart = 0.3; armFreqEnd = 0.6; } // High-mids
      else { armFreqStart = 0.6; armFreqEnd = 1.0; }                     // Treble

      const binIdx = Math.floor((armFreqStart + t * (armFreqEnd - armFreqStart)) * barData.length);
      const energy = barData[Math.min(binIdx, barData.length - 1)] || 0;

      // Base position + frequency-driven displacement
      const bx = basePos[i * 3];
      const by = basePos[i * 3 + 1];
      const bz = basePos[i * 3 + 2];

      // Radial displacement (push outward based on energy)
      const radialDist = Math.sqrt(bx * bx + bz * bz) + 0.001;
      const radialPush = energy * 2;
      const nx = bx / radialDist;
      const nz = bz / radialDist;

      // Vertical displacement (energy pushes particles up/down from the disk plane)
      const vertPush = energy * (by > 0 ? 1.5 : -1.5);

      // Gentle orbital drift
      const driftAngle = elapsedTime * 0.05 * (1 + overall * 0.3);
      const cos = Math.cos(driftAngle);
      const sin = Math.sin(driftAngle);
      const rx = bx * cos - bz * sin;
      const rz = bx * sin + bz * cos;

      // Shimmer for treble arm
      const shimmer = armIndex === 3 ? Math.sin(elapsedTime * 8 + i * 0.1) * treble * 0.5 : 0;

      positions[i * 3] = rx + nx * radialPush;
      positions[i * 3 + 1] = by + vertPush + shimmer;
      positions[i * 3 + 2] = rz + nz * radialPush;
    }
    this.nebulaParticles.geometry.attributes.position.needsUpdate = true;

    // Dynamic particle size
    (this.nebulaParticles.material as THREE.PointsMaterial).size = 0.1 + overall * 0.15;
    (this.nebulaParticles.material as THREE.PointsMaterial).opacity = 0.6 + overall * 0.35;

    // --- 2. Core breathing ---
    const coreScale = 1 + bass * 2.5;
    this.nebulaCore.scale.setScalar(coreScale);
    (this.nebulaCore.material as THREE.MeshStandardMaterial).emissiveIntensity = 1 + bass * 4;
    this.nebulaCore.rotation.y = elapsedTime * 0.3;
    this.nebulaCore.rotation.x = Math.sin(elapsedTime * 0.15) * 0.2;

    // --- 3. Satellite orbits ---
    for (let s = 0; s < this.nebulaSatellites.length; s++) {
      const sat = this.nebulaSatellites[s];
      const data = this.nebulaSatelliteData[s];
      const energy = barData[Math.min(data.binIndex, barData.length - 1)] || 0;

      // Orbit position
      const angle = elapsedTime * data.orbitSpeed + data.orbitPhase;
      const dynamicRadius = data.orbitRadius + energy * 4;

      // Orbit in a tilted plane using the axis
      const basePos3 = new THREE.Vector3(Math.cos(angle) * dynamicRadius, 0, Math.sin(angle) * dynamicRadius);
      // Rotate around the satellite's unique tilt axis
      const q = new THREE.Quaternion().setFromAxisAngle(data.axis, data.orbitPhase * 0.5);
      basePos3.applyQuaternion(q);

      sat.position.copy(basePos3);

      // Scale with energy
      const satScale = 0.8 + energy * 2.5;
      sat.scale.setScalar(satScale);

      // Spin
      sat.rotation.x += 0.02 + energy * 0.08;
      sat.rotation.y += 0.03 + energy * 0.06;

      // Emissive glow intensity
      (sat.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + energy * 3;
    }

    // --- 4. Beat-triggered shockwaves ---
    const beatInfo = this.beat();
    if (beatInfo.timestamp > this.lastBeatTimestamp && beatInfo.strength > 0.3) {
      // Create a new shockwave ring
      const ringGeom = new THREE.TorusGeometry(1, 0.08, 8, 64);
      const ringMat = new THREE.MeshBasicMaterial({
        color: this.theme().accent,
        transparent: true,
        opacity: 0.8 * beatInfo.strength,
        side: THREE.DoubleSide,
      });
      const ringMesh = new THREE.Mesh(ringGeom, ringMat);
      ringMesh.rotation.x = Math.PI / 2; // Lay flat
      this.nebulaGroup.add(ringMesh);
      this.nebulaShockwaves.push({ ring: ringMesh, age: 0, maxAge: 90 });
    }

    // Animate existing shockwaves
    for (let sw = this.nebulaShockwaves.length - 1; sw >= 0; sw--) {
      const wave = this.nebulaShockwaves[sw];
      wave.age++;
      const progress = wave.age / wave.maxAge;
      const expandScale = 1 + progress * 25; // Expand to radius ~25
      wave.ring.scale.setScalar(expandScale);
      (wave.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (1 - progress) * 0.6);

      if (wave.age >= wave.maxAge) {
        this.nebulaGroup.remove(wave.ring);
        wave.ring.geometry.dispose();
        (wave.ring.material as THREE.Material).dispose();
        this.nebulaShockwaves.splice(sw, 1);
      }
    }

    // --- 5. Dynamic bloom ---
    if (this.bloomPass) {
      this.bloomPass.strength = 0.5 + overall * 1.5;
    }

    // Slow group tilt for dramatics
    this.nebulaGroup.rotation.x = Math.sin(elapsedTime * 0.08) * 0.15;
  }

  private animateCamera(barData: number[], elapsedTime: number) {
      if (!this.isPlaying()) return;
      
      // If user is interacting or recently interacted, don't override camera position
      const timeSinceInteraction = performance.now() - this.lastInteractionTime;
      if (this.isUserInteracting || timeSinceInteraction < 3000) {
        this.controls.autoRotate = false;
        return;
      }

      // Default: slow orbit that scales with volume. Does NOT reset user pan or zoom!
      this.controls.autoRotate = true;
      const avgBarHeight = barData.length > 0 ? barData.reduce((a, b) => a + b, 0) / barData.length : 0;
      this.controls.autoRotateSpeed = 0.2 + avgBarHeight * 0.8;
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
