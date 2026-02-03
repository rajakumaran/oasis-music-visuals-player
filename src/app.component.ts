import { Component, ChangeDetectionStrategy, inject, signal, computed, WritableSignal, OnInit, OnDestroy, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AudioService } from './services/audio.service';
import { HolidayService } from './services/holiday.service';
import { PresetService, Preset } from './services/preset.service';
import { EqualizerTheme } from './models/equalizer-theme.model';
import { FullscreenToggleComponent } from './fullscreen-toggle/fullscreen-toggle.component';
import { WebglVisualizerComponent } from './webgl-visualizer/webgl-visualizer.component';
import { WebglGrokVisualizerComponent } from './webgl-grok-visualizer/webgl-grok-visualizer.component';
import { inject as vercelAnalytics } from '@vercel/analytics';

type LightSourcePosition = 'none' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center-stage' | 'top-center';
type SynergyDriveMode = 'atmosphere' | 'rhythm' | 'transient';
type SynergyDriveSetting = SynergyDriveMode | 'smart';
type Algorithm = 'basic' | 'stft-fractal' | 'wavelet-harmonic';
type VisualizerEngine = 'synergy' | 'algorithm';

interface AuraRing { id: number; radius: number; opacity: number; thickness: number; hue: number; }
interface AuraParticle { id: number; x: number; y: number; opacity: number; size: number; }

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FullscreenToggleComponent, WebglVisualizerComponent, WebglGrokVisualizerComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnInit, OnDestroy {
  audioService = inject(AudioService);
  holidayService = inject(HolidayService);
  presetService = inject(PresetService);
  
  playlist = this.audioService.playlist;
  currentTrackIndex = this.audioService.currentTrackIndex;
  isPlaying = this.audioService.isPlaying;
  currentTime = this.audioService.currentTime;
  duration = this.audioService.duration;
  gainValues = this.audioService.gainValues;
  currentTrack = this.audioService.currentTrack;
  audioSource = this.audioService.audioSource;
  beat = this.audioService.beat;
  transient = this.audioService.transient;

  // --- Visualizer Engine State ---
  visualizerEngine = signal<VisualizerEngine>('synergy');
  
  // Synergy Drive Engine State
  synergyDriveMode = signal<SynergyDriveSetting>('smart');
  effectiveSynergyDriveMode = computed(() => {
    const mode = this.synergyDriveMode();
    return mode === 'smart' ? this.audioService.detectedMusicProfile() : mode;
  });

  // Algorithm Lab Engine State
  selectedAlgorithm = signal<Algorithm>('basic');
  responseCurve = signal<'linear' | 'polynomial' | 'fractal'>('polynomial');
  
  private lastBeatTimestamp = 0;
  private lastTransientTimestamp = 0;
  

  private dataBuffers: Uint8Array[] = [];
  private readonly BUFFER_HISTORY_SIZE = 3;


  sensitivity = signal(1.2);
  backgroundImageUrl = signal<string | null>(null);
  decayFactor = signal(0.94);
  isMobile = signal(false);
  private readonly resizeListener = () => {
    this.updateDecayFactor();
    this.isMobile.set(window.innerWidth < 768);
  };

  barCount = signal(window.innerWidth > 1024 ? 96 : 64); // Adaptive bar count
  barSpacing = signal(2);
  private smoothedBars: number[] = [];

  tickerMessages: string[] = [
    'Welcome to the Audio Oasis Equalizer...',
    'Tip: Try combining different Visualization Modes, Algo Lab, and Synergy Drive settings!',
    'Tip: Try Microphone Mode to visualize any sound in your room.',
    'By Mr. Muthukumaran Azhagesan ( Kumar ), https://linktr.ee/muthukumaran.azhagesan',
  ];

  currentTickerMessage = signal(this.tickerMessages[0]);
  tickerDirection = signal<'left' | 'right'>('left');
  private tickerInterval: any;
  animationClass = computed(() => 'animate-' + this.tickerDirection());
  
  isAutoSwitching = signal(false);
  switchInterval = signal(10000);
  switchMode = signal<'sequential' | 'random'>('sequential');
  private themeSwitchIntervalId: any = null;

  // --- LED Theme Controls ---
  ledSegmentWidth = signal(8);
  ledSegmentHeight = signal(4);
  isKaleidoscope = signal(false);
  kaleidoscopeHueShift = signal(0);
  private kaleidoscopeAnimFrameId: number | null = null;
  
    // --- Style Fusion ---
  isStyleFusionOn = signal(false);
  private fusionIntervalId: any = null;
  fusionInterval = signal(10000); // New signal for fusion interval
  
  showOpportunisticTicker = signal(false);
  opportunisticTickerMessage = signal('Audio Oasis :: Built by Muthukumaran Azhagesan (Kumar). Check his Linktree for more projects!');
  private showTickerTimeout: any;
  private hideTickerTimeout: any;

  activeHoliday = this.holidayService.activeHoliday;
  isHolidayAvailable = this.holidayService.isHolidayAvailable;
  isHolidayThemeOn = this.holidayService.holidayThemeEnabled;
  detectedHoliday = this.holidayService.detectedHoliday;
  
  lightSourcePosition = signal<LightSourcePosition>('none');
  isLightingControlVisible = computed(() => !['led', 'webgl', 'webgl-shader-plasma', 'webgl-shader-geometry', 'webgl-shader-particles', 'webgl-shader-holo', 'webgl-shader-fractal' ].includes(this.effectiveTheme().type));
  lightingOverlayStyle = computed(() => {
    const position = this.lightSourcePosition();
    if (position === 'none' || !this.isLightingControlVisible()) return 'transparent';

    const hue = this.kaleidoscopeHueShift();
    const lightColor = this.isKaleidoscope() ? `hsla(${hue}, 100%, 70%, 0.35)` : 'rgba(255, 255, 255, 0.25)';
    const endColor = 'rgba(255, 255, 255, 0)';

    let positionCss = '';
    switch (position) {
      case 'top-left':     positionCss = `radial-gradient(circle at 0% 0%, ${lightColor} 0%, ${endColor} 60%)`; break;
      case 'top-right':    positionCss = `radial-gradient(circle at 100% 0%, ${lightColor} 0%, ${endColor} 60%)`; break;
      case 'bottom-left':  positionCss = `radial-gradient(circle at 0% 100%, ${lightColor} 0%, ${endColor} 60%)`; break;
      case 'bottom-right': positionCss = `radial-gradient(circle at 100% 100%, ${lightColor} 0%, ${endColor} 60%)`; break;
      case 'center-stage': positionCss = `radial-gradient(ellipse at 50% 50%, ${lightColor} 0%, ${endColor} 70%)`; break;
      case 'top-center':   positionCss = `radial-gradient(ellipse at 50% -40%, ${lightColor} 0%, ${endColor} 65%)`; break;
    }
    return positionCss;
  });

  presets = this.presetService.presets;
  newPresetName = signal('');
  selectedPreset = signal<Preset | null>(null);

  draggedTrackIndex = signal<number | null>(null);

  constructor() {
    effect(() => {
      const newCount = this.barCount();
      if (this.smoothedBars.length !== newCount) {
        this.smoothedBars = new Array(newCount).fill(0);
      }
    });

    effect(() => this.isAutoSwitching() ? this.startAutoSwitching() : this.stopAutoSwitching());
    effect(() => (this.isKaleidoscope() && (this.isPlaying() || this.audioSource() === 'microphone')) ? this.startKaleidoscope() : this.stopKaleidoscope());
    effect(() => this.isStyleFusionOn() ? this.startStyleFusion() : this.stopStyleFusion());
    this._reimplementUnchanged();
  }

  ngOnInit(): void {
    vercelAnalytics();
    this.isMobile.set(window.innerWidth < 768);
    this.updateDecayFactor();
    window.addEventListener('resize', this.resizeListener);
    this.setupTicker();
    this.scheduleOpportunisticTicker();
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.resizeListener);
    if (this.tickerInterval) clearInterval(this.tickerInterval);
    this.stopAutoSwitching();
    this.stopKaleidoscope();
    clearTimeout(this.showTickerTimeout);
    clearTimeout(this.hideTickerTimeout);
  }

  private setupTicker(): void {
    this.tickerDirection.set(Math.random() > 0.5 ? 'left' : 'right');
    let messageIndex = 0;
    this.tickerInterval = setInterval(() => {
      messageIndex = (messageIndex + 1) % this.tickerMessages.length;
      this.currentTickerMessage.set(this.tickerMessages[messageIndex]);
    }, 15000);
  }

  private scheduleOpportunisticTicker(): void {
    clearTimeout(this.showTickerTimeout);
    clearTimeout(this.hideTickerTimeout);
    const randomDelay = Math.random() * 30000 + 15000;
    this.showTickerTimeout = setTimeout(() => {
      this.showOpportunisticTicker.set(true);
      this.hideTickerTimeout = setTimeout(() => {
        this.showOpportunisticTicker.set(false);
        this.scheduleOpportunisticTicker();
      }, 12000);
    }, randomDelay);
  }

  private updateDecayFactor(): void {
    const width = window.innerWidth;
    const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);
    const map = (val: number, in_min: number, in_max: number, out_min: number, out_max: number) =>
      ((val - in_min) * (out_max - out_min)) / (in_max - in_min) + out_min;

    const decay = map(width, 320, 2560, 0.92, 0.97);
    this.decayFactor.set(clamp(decay, 0.92, 0.97));
  }

  private averageDataBuffers(currentData: Uint8Array): Uint8Array {
    this.dataBuffers.push(new Uint8Array(currentData));
    if (this.dataBuffers.length > this.BUFFER_HISTORY_SIZE) this.dataBuffers.shift();
    if (this.dataBuffers.length === 0) return new Uint8Array(currentData.length);
    const avg = new Uint8Array(this.dataBuffers[0].length);
    this.dataBuffers.forEach(buf => {
      for (let i = 0; i < avg.length; i++) {
        avg[i] += buf[i] / this.dataBuffers.length;
      }
    });
    return avg;
  }

  visualizerBars = computed(() => {
    const data = this.audioService.frequencyData();
    const sensitivityValue = this.sensitivity();
    const baseDecay = this.decayFactor();
    const driveMode = this.effectiveSynergyDriveMode();
    const beatInfo = this.beat();
    const transientInfo = this.transient();
    const bars = this.barCount();
    const engine = this.visualizerEngine();

    const output = new Array(bars);
    const logLength = Math.log(data.length);
    let lastIndex = 0;
    
    const avgData = this.averageDataBuffers(data);

    if (engine === 'synergy') {
      // --- SYNERGY DRIVE ENGINE ---
      const driveMode = this.effectiveSynergyDriveMode();
      const beatInfo = this.beat();
      const transientInfo = this.transient();
      let lastIndex = 0;

      let beatKick = 0;
      if (beatInfo.timestamp > this.lastBeatTimestamp) {
        this.lastBeatTimestamp = beatInfo.timestamp;
        beatKick = Math.min(1, beatInfo.strength * 0.7); // Increased beat kick
      }
      let transientSpike = 0, transientJitter = 0;
      if (transientInfo.timestamp > this.lastTransientTimestamp) {
        this.lastTransientTimestamp = transientInfo.timestamp;
        transientSpike = Math.min(1, transientInfo.intensity * 1.5);
        transientJitter = transientInfo.intensity * 0.2;
      }

      // --- Synergy Drive 2.0: Per-Range Physics ---
      const ranges = {
        subBass: 0.04, bass: 0.1, lowMid: 0.25, mid: 0.5,
        upperMid: 0.7, presence: 0.85, brilliance: 1.0
      };

      for (let i = 0; i < bars; i++) {
        const index = Math.max(lastIndex + 1, Math.floor(Math.exp(((i + 1) / bars) * logLength)));
        const slice = data.slice(lastIndex, index);
        let normalizedValue = slice.length > 0 ? (Math.max(...slice) / 255) : 0;
        
        const barProgress = i / (bars - 1);
        let finalDecay = baseDecay;
        let finalSensitivity = sensitivityValue;

        // Apply range-specific modifiers
        if (barProgress < ranges.subBass) { // Sub-bass
          finalSensitivity *= 1.1; finalDecay = Math.min(0.99, baseDecay + 0.025);
        } else if (barProgress < ranges.bass) { // Bass
          finalSensitivity *= 1.05; finalDecay = Math.min(0.985, baseDecay + 0.015);
        } else if (barProgress < ranges.lowMid) { // Low Mids
          finalSensitivity *= 0.9; finalDecay = Math.max(0.9, baseDecay - 0.02);
        } else if (barProgress < ranges.mid) { // Mids
          finalSensitivity *= 0.85;
        } else if (barProgress < ranges.upperMid) { // Upper Mids
          finalSensitivity *= 0.95;
        } else if (barProgress < ranges.presence) { // Presence
          finalSensitivity *= 1.15; finalDecay = Math.max(0.88, baseDecay - 0.05);
        } else { // Brilliance
          finalSensitivity *= 1.25; finalDecay = Math.max(0.85, baseDecay - 0.08);
        }

        normalizedValue *= finalSensitivity;
        normalizedValue += beatKick * (1 - barProgress) * (driveMode === 'atmosphere' ? 0.4 : 1);
        normalizedValue += transientSpike * barProgress * (driveMode === 'atmosphere' ? 0.5 : 1);

        const currentValue = this.smoothedBars[i] || 0;
        if (normalizedValue >= currentValue) {
          this.smoothedBars[i] = normalizedValue;
        } else {
          if (driveMode === 'atmosphere') finalDecay = Math.min(0.995, finalDecay + 0.03);
          this.smoothedBars[i] = currentValue * finalDecay;
        }
        output[i] = Math.min(1, Math.max(0, this.smoothedBars[i]));
        lastIndex = index;
      }

    } else { // ALGORITHM LAB ENGINE
      let lastIndex = 0;

      for (let i = 0; i < bars; i++) {
        let index = Math.max(lastIndex + 1, Math.floor(Math.exp(((i + 1) / bars) * logLength)));
        let slice = data.slice(lastIndex, index);
        let normalizedValue = slice.length > 0 ? (Math.max(...slice) / 255) * sensitivityValue : 0;
        const curve = this.responseCurve();
        if (curve === 'polynomial') normalizedValue = Math.pow(normalizedValue, 2);

        const currentValue = this.smoothedBars[i] || 0;
        this.smoothedBars[i] = normalizedValue >= currentValue ? normalizedValue : currentValue * baseDecay;
        output[i] = Math.min(1, Math.max(0, this.smoothedBars[i]));
        lastIndex = index;
      }
    }
    return output;
  });
  
  fractalCircles = computed(() => {
    const bars = this.visualizerBars();
    const count = this.barCount();
    const viewboxWidth = 640;
    const viewboxHeight = 160;
    const barWidth = viewboxWidth / count;
    const maxRadius = barWidth / 2 * 1.8;
    return bars.map((height, i) => ({
      id: `circle-${i}`,
      cx: i * barWidth + barWidth / 2,
      cy: viewboxHeight - Math.max(0.5, height * viewboxHeight),
      r: Math.max(0.5, height * maxRadius),
    }));
  });

  fordCircles = computed(() => {
    const bars = this.visualizerBars();
    const count = this.isMobile() ? 16 : Math.min(32, this.barCount()); // Adaptive count
    const viewboxWidth = 320;
    const viewboxHeight = 160;
    const beatInfo = this.beat();
    let beatPulse = 1.0;
    if (beatInfo.timestamp > this.lastBeatTimestamp) {
      beatPulse = 1.0 + beatInfo.strength * 0.2;
    }

    const circles = [];
    for (let i = 0; i < count; i++) {
      const barIndex = Math.floor(i / count * bars.length);
      const radius = bars[barIndex] * (viewboxHeight / 4) * beatPulse;
      const x = (i / (count - 1)) * viewboxWidth;
      const y = viewboxHeight - radius;
      circles.push({ 
        id: `ford-${i}`, 
        cx: x, 
        cy: y, 
        r: Math.max(1, radius),
        opacity: 0.5 + bars[barIndex] * 0.5
      });
    }
    return circles;
  });

  ledBars = computed(() => {
    const bars = this.visualizerBars();
    const segments = 16;
    return bars.map(barHeight => Math.floor(barHeight * segments));
  });

  neuralNetwork = computed(() => {
    const bars = this.visualizerBars();
    const rows = 5;
    const cols = Math.floor(this.barCount() / 4);
    const nodeCount = rows * cols;
    const viewboxWidth = 640;
    const viewboxHeight = 160;
    const xSpacing = viewboxWidth / (cols - 1);
    const ySpacing = viewboxHeight / (rows - 1);
    const nodes = [];
    for (let i = 0; i < nodeCount; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const barIndex = Math.min(bars.length - 1, Math.floor((i / nodeCount) * bars.length));
      const barHeight = bars[barIndex] || 0;
      nodes.push({ id: `node-${i}`, cx: col * xSpacing, cy: row * ySpacing, r: 2 + barHeight * 8, opacity: 0.4 + barHeight * 0.6 });
    }
    const connections = [];
    for (let i = 0; i < nodeCount; i++) {
      const barIndex = Math.min(bars.length - 1, Math.floor((i / nodeCount) * bars.length));
      const barHeight = bars[barIndex] || 0;
      const col = i % cols;
      const row = Math.floor(i / cols);
      if (col < cols - 1) {
        connections.push({ id: `conn-h-${i}`, x1: nodes[i].cx, y1: nodes[i].cy, x2: nodes[i + 1].cx, y2: nodes[i + 1].cy, opacity: 0.1 + barHeight * 0.4 });
      }
      if (row < rows - 1) {
        connections.push({ id: `conn-v-${i}`, x1: nodes[i].cx, y1: nodes[i].cy, x2: nodes[i + cols].cx, y2: nodes[i + cols].cy, opacity: 0.1 + barHeight * 0.4 });
      }
    }
    return { nodes, connections };
  });

  plasmaPaths = computed(() => {
    const bars = this.visualizerBars();
    const layers = 5;
    const segments = 32;
    const viewboxWidth = 320;
    const viewboxHeight = 160;
    const centerX = viewboxWidth / 2;
    const centerY = viewboxHeight / 2;
    const maxRadius = Math.min(centerX, centerY) * 0.9;
    const bassEnergy = (bars.slice(0, 4).reduce((a, b) => a + b, 0) / 4);
    const trebleEnergy = (bars.slice(bars.length - 16).reduce((a, b) => a + b, 0) / 16);
    const paths = [];
    for (let i = 0; i < layers; i++) {
      const baseRadius = (maxRadius / layers) * (i + 1);
      const points = [];
      const layerEnergy = bars[Math.floor(i / layers * bars.length)] || 0;
      for (let j = 0; j < segments; j++) {
        const angle = (j / segments) * 2 * Math.PI;
        const distortion1 = Math.sin(angle * 8 + performance.now() / 500) * 5 * trebleEnergy;
        const distortion2 = Math.sin(angle * 2 + performance.now() / 1000) * 15 * bassEnergy;
        const radius = baseRadius + (layerEnergy * 20) + distortion1 + distortion2;
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;
        points.push(`${x},${y}`);
      }
      paths.push({ id: `plasma-${i}`, d: `M ${points.join(' L ')} Z`, opacity: 0.1 + layerEnergy * 0.6 });
    }
    return paths;
  });

  private hyperlaneLayersState = Array(20).fill(0).map((_, i) => ({ z: i / 20, hue: Math.random() * 360 }));
  hyperlaneLayers = computed(() => {
    const bars = this.visualizerBars();
    const bass = bars.slice(0, Math.floor(this.barCount() / 8)).reduce((sum, val) => sum + val, 0) / (this.barCount() / 8);
    const speed = 0.005 + bass * 0.02;
    const viewboxWidth = 320;
    const viewboxHeight = 160;
    const centerX = viewboxWidth / 2;
    const centerY = viewboxHeight / 2;
    this.hyperlaneLayersState.forEach(layer => {
      layer.z += speed;
      if (layer.z > 1) {
        layer.z = 0;
        layer.hue = Math.random() * 360;
      }
    });
    return this.hyperlaneLayersState.map((layer, i) => {
      const perspective = layer.z * layer.z;
      const width = perspective * viewboxWidth * 1.5;
      const height = perspective * viewboxHeight * 1.5;
      const barIndex = Math.floor((i / this.hyperlaneLayersState.length) * bars.length);
      const brightness = 50 + (bars[barIndex] || 0) * 50;
      return { id: `lane-${i}`, x: centerX - width / 2, y: centerY - height / 2, width: width, height: height, stroke: `hsl(${layer.hue}, 100%, ${brightness}%)`, opacity: perspective * 0.8 };
    }).sort((a, b) => a.opacity - b.opacity);
  });
  
  private auraState = {
    rings: new Array(10).fill(0).map((_, i) => ({ id: i, radius: 0, opacity: 0, thickness: 0, hue: 0 })),
    particles: new Array(30).fill(0).map((_, i) => ({ id: i, x: 0, y: 0, opacity: 0, size: 0 })),
    lastBeat: 0
  };
  auraBloom = computed(() => {
    const bars = this.visualizerBars();
    const bass = bars.slice(0, 4).reduce((a,b)=>a+b,0)/4;
    const mids = bars.slice(10, 20).reduce((a,b)=>a+b,0)/10;
    const highs = bars.slice(bars.length-10).reduce((a,b)=>a+b,0)/10;
    const beat = this.beat();
    
    if (beat.timestamp > this.auraState.lastBeat && beat.strength > 0.3) {
      this.auraState.lastBeat = beat.timestamp;
      const ring = this.auraState.rings.find(r => r.opacity <= 0);
      if (ring) {
        ring.radius = 10 + mids * 30;
        ring.opacity = 1;
        ring.thickness = 1 + beat.strength * 5;
        ring.hue = Math.floor(Math.random() * 360);
      }
    }
    this.auraState.rings.forEach(r => {
      if (r.opacity > 0) {
        r.radius += 1 + bass * 1.5;
        r.opacity -= 0.02;
        r.thickness *= 0.98;
      }
    });
    this.auraState.particles.forEach(p => {
      if (p.opacity <= 0 && highs > 0.2 && Math.random() > 0.9) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 50 + Math.random() * 50;
        p.x = Math.cos(angle) * radius;
        p.y = Math.sin(angle) * radius;
        p.opacity = 1;
        p.size = 1 + Math.random() * 2 + highs * 3;
      } else {
        p.opacity -= 0.025;
        p.size *= 0.95;
      }
    });
    return {
      rings: this.auraState.rings,
      particles: this.auraState.particles,
      coreSize: 20 + bass * 30,
      coreOpacity: 0.5 + bass * 0.5
    };
  });

  private glyphsState = { lastUpdate: 0 };
  rhythmicGlyphs = computed(() => {
    const bass = this.visualizerBars().slice(0, 4).reduce((a,b)=>a+b,0)/4;
    const beat = this.beat();
    if(beat.timestamp > this.glyphsState.lastUpdate) {
        this.glyphsState.lastUpdate = beat.timestamp;
    }
    const t = beat.timestamp / 1000;
    return {
      outerRing: { rotation: t * 20, scale: 1 + bass * 0.2, opacity: 0.3 + bass * 0.7 },
      innerRing: { rotation: -t * 35, scale: 1 - bass * 0.1, opacity: 0.5 + bass * 0.5 },
      center: { scale: 0.8 + bass * 0.5, opacity: 0.2 + bass * 0.8 },
      sparkle: { scale: 1, opacity: Math.max(0, 1 - (performance.now() - beat.timestamp) / 300) }
    };
  });

  liquifyParams = computed(() => {
    const bass = this.visualizerBars().slice(0, 4).reduce((a,b)=>a+b,0)/4;
    const highs = this.visualizerBars().slice(this.barCount()-16).reduce((a,b)=>a+b,0)/16;
    return {
      turbulence: 0.005 + highs * 0.015,
      scale: 10 + bass * 40
    };
  });

bandFrequencies = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];

   themes: EqualizerTheme[] = [
    { name: 'Cyberdeck', type: 'convex', base: 'cyberdeck-bg', display: 'cyberdeck-display', bar: 'bg-gradient-to-t from-cyan-500 to-white shadow-[0_0_8px_rgba(34,211,238,0.8),0_0_20px_rgba(34,211,238,0.5)] rounded-t-sm', sliderTrack: 'bg-gray-800/50', sliderThumb: 'bg-cyan-400', text: 'text-cyan-200 font-mono', accent: 'text-fuchsia-400', button: 'btn-cyber', buttonHover: '', highlight: 'bg-cyan-400/20' },
    { name: 'Audio Terrain', type: 'webgl', webglMode: 'terrain', base: 'bg-gray-900', display: '#030712', bar: '', sliderTrack: 'bg-emerald-800/50', sliderThumb: 'bg-lime-400', text: 'text-lime-300', accent: '#0ece62', button: 'bg-emerald-900/70', buttonHover: 'hover:bg-emerald-800/70', highlight: 'bg-lime-500/50' },
    { name: 'VoxelScape', type: 'webgl', webglMode: 'bars', base: 'bg-gray-900', display: '#111827', bar: '', sliderTrack: 'bg-indigo-800/50', sliderThumb: 'bg-violet-400', text: 'text-violet-300', accent: '#a78bfa', button: 'bg-indigo-900/70', buttonHover: 'hover:bg-indigo-800/70', highlight: 'bg-violet-500/50' },
    { name: 'Borderless LED Rectangular', type: 'led', base: 'bg-gray-900', display: 'bg-black', bar: 'bg-gray-700 border-none shadow-none rounded-none', sliderTrack: 'bg-gray-600 border-none shadow-none rounded-none', sliderThumb: 'bg-gray-400 border-none shadow-none rounded-none', text: 'text-gray-300', accent: 'text-green-400', button: 'bg-gray-700 border-none shadow-none rounded-none', buttonHover: 'hover:bg-gray-600', highlight: 'bg-green-600/50 border-none shadow-none rounded-none' },
    // More innovative gradients based on existing ones, mutating with multi-stop gradients, radial elements, and dynamic shadows
    { name: 'Pioneer Aurora', type: 'shadow', base: 'bg-slate-200', display: 'bg-indigo-900/80', bar: 'bg-gradient-to-t from-indigo-800 via-purple-500 to-pink-300 shadow-[0_0_12px_#a855f7,-2px_0_5px_rgba(0,0,0,0.4)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-white', text: 'text-gray-800', accent: 'text-indigo-600', button: 'bg-gray-400', buttonHover: 'hover:bg-gray-500', highlight: 'bg-slate-300' },
    { name: 'Pioneer Convex Nebula', type: 'convex', base: 'bg-slate-200', display: 'bg-cyan-900/80', bar: 'bg-gradient-to-t from-cyan-700 via-teal-400 to-blue-200 shadow-[0_0_10px_#06b6d4,inset_0_2px_4px_rgba(255,255,255,0.3)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-white', text: 'text-gray-800', accent: 'text-cyan-600', button: 'bg-gray-400', buttonHover: 'hover:bg-gray-500', highlight: 'bg-slate-300' },
    { name: 'Marantz Lava Flow', type: 'shadow', base: 'bg-amber-100', display: 'bg-black/80', bar: 'bg-gradient-to-t from-red-900 via-orange-500 to-yellow-300 shadow-[0_0_15px_#f59e0b,-2px_0_5px_rgba(0,0,0,0.4)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-gray-700', text: 'text-gray-800', accent: 'text-red-700', button: 'bg-gray-300', buttonHover: 'hover:bg-gray-400', highlight: 'bg-amber-200' },
    { name: 'Marantz Concave Galaxy', type: 'concave', base: 'bg-amber-100', display: 'bg-black/80', bar: 'bg-gradient-to-t from-purple-900 via-indigo-500 to-blue-300 shadow-[0_0_12px_#6366f1,inset_0_-2px_4px_rgba(0,0,0,0.2)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-gray-700', text: 'text-gray-800', accent: 'text-purple-700', button: 'bg-gray-300', buttonHover: 'hover:bg-gray-400', highlight: 'bg-amber-200' },
    { name: 'Gold Standard Prism', type: 'convex', base: 'bg-gray-900', display: 'bg-black/60', bar: 'bg-gradient-to-t from-lime-700 via-green-400 to-teal-100 shadow-[0_0_8px_#22c55e,inset_0_2px_4px_rgba(255,255,255,0.3)] rounded-t-sm', sliderTrack: 'bg-lime-800/50', sliderThumb: 'bg-green-300', text: 'text-green-200', accent: 'text-lime-400', button: 'bg-lime-900/60', buttonHover: 'hover:bg-lime-800/60', highlight: 'bg-green-500/50' },
    { name: 'Classic LED Radial Glow', type: 'led', base: 'bg-gray-900', display: 'bg-black', bar: 'bg-radial-gradient(circle,green-500_0%,green-300_50%,transparent_100%) border-none shadow-none rounded-none', sliderTrack: 'bg-gray-600', sliderThumb: 'bg-gray-400', text: 'text-gray-300', accent: 'text-green-400', button: 'bg-gray-700', buttonHover: 'hover:bg-gray-600', highlight: 'bg-green-600/50' },
    { name: 'Pioneer Convex Sunset Burst', type: 'convex', base: 'bg-slate-200', display: 'bg-amber-900/80', bar: 'bg-gradient-to-t from-red-600 via-orange-400 to-yellow-200 shadow-[0_0_10px_#fb923c,inset_0_2px_4px_rgba(255,255,255,0.3)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-white', text: 'text-gray-800', accent: 'text-orange-600', button: 'bg-gray-400', buttonHover: 'hover:bg-gray-500', highlight: 'bg-slate-300' },
    { name: 'Marantz Ocean Depth', type: 'shadow', base: 'bg-amber-100', display: 'bg-black/80', bar: 'bg-gradient-to-t from-blue-900 via-cyan-500 to-teal-300 shadow-[0_0_15px_#14b8a6,-2px_0_5px_rgba(0,0,0,0.4)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-gray-700', text: 'text-gray-800', accent: 'text-blue-700', button: 'bg-gray-300', buttonHover: 'hover:bg-gray-400', highlight: 'bg-amber-200' },
    { name: 'Gold Standard Fire Opal', type: 'convex', base: 'bg-gray-900', display: 'bg-black/60', bar: 'bg-gradient-to-t from-orange-700 via-red-400 to-pink-100 shadow-[0_0_8px_#ef4444,inset_0_2px_4px_rgba(255,255,255,0.3)] rounded-t-sm', sliderTrack: 'bg-orange-800/50', sliderThumb: 'bg-red-300', text: 'text-red-200', accent: 'text-orange-400', button: 'bg-orange-900/60', buttonHover: 'hover:bg-orange-800/60', highlight: 'bg-red-500/50' },
    { name: 'Pioneer Neon Circuit', type: 'shadow', base: 'bg-slate-200', display: 'bg-lime-900/80', bar: 'bg-gradient-to-t from-lime-800 via-green-500 to-lime-300 shadow-[0_0_12px_#84cc16,-2px_0_5px_rgba(0,0,0,0.4)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-white', text: 'text-gray-800', accent: 'text-lime-600', button: 'bg-gray-400', buttonHover: 'hover:bg-gray-500', highlight: 'bg-slate-300' },
    // New innovative themes: Drawing board ideas inspired by modern audio visuals, like plasma effects, holographic, metallic sheens, or frequency-reactive illusions. These build on your FFT/polynomial setup by suggesting gradients that could visually map to freq bands (e.g., low freq warm colors, high freq cool). I've assumed types like 'plasma' or 'holo' could be new if your app supports extending types, but stuck to existing for compatibility—feel free to adapt. No new functions needed; your existing audio translation should pair well with these for dynamic visuals.
    { name: 'Plasma Vortex', type: 'shadow', base: 'bg-black', display: 'bg-purple-950/90', bar: 'bg-gradient-to-t from-purple-900 via-fuchsia-500 to-pink-300 shadow-[0_0_20px_#d946ef,-2px_0_5px_rgba(0,0,0,0.6)] rounded-t-md', sliderTrack: 'bg-purple-800/50', sliderThumb: 'bg-fuchsia-400', text: 'text-pink-200', accent: 'text-fuchsia-500', button: 'bg-purple-900/70', buttonHover: 'hover:bg-purple-800/70', highlight: 'bg-fuchsia-600/40' },
    { name: 'Holographic Spectrum', type: 'convex', base: 'bg-transparent', display: 'bg-blue-950/70', bar: 'bg-gradient-to-t from-cyan-700 via-blue-400 to-indigo-200 shadow-[0_0_15px_#3b82f6,inset_0_2px_4px_rgba(255,255,255,0.5),0_0_5px_rgba(255,255,255,0.2)] rounded-t-sm border border-blue-500/30', sliderTrack: 'bg-blue-800/40', sliderThumb: 'bg-indigo-300', text: 'text-cyan-200', accent: 'text-blue-400', button: 'bg-blue-900/50', buttonHover: 'hover:bg-blue-800/50', highlight: 'bg-indigo-500/30' },
    { name: 'Metallic Forge', type: 'concave', base: 'bg-gray-800', display: 'bg-black/85', bar: 'bg-gradient-to-t from-gray-700 via-orange-500 to-yellow-300 shadow-[inset_0_-2px_4px_rgba(0,0,0,0.3),0_0_10px_#f59e0b] rounded-t-sm', sliderTrack: 'bg-gray-500', sliderThumb: 'bg-orange-400', text: 'text-yellow-200', accent: 'text-orange-500', button: 'bg-gray-600', buttonHover: 'hover:bg-gray-500', highlight: 'bg-orange-600/40' },
    { name: 'Neon Cyber Grid', type: 'led', base: 'bg-black', display: 'bg-cyan-950', bar: 'bg-cyan-500 shadow-[0_0_8px_#06b6d4] border-none rounded-none', sliderTrack: 'bg-cyan-700/60', sliderThumb: 'bg-cyan-300', text: 'text-cyan-200', accent: 'text-cyan-400', button: 'bg-cyan-800/70', buttonHover: 'hover:bg-cyan-700/70', highlight: 'bg-cyan-500/50' },
    { name: 'Crystal Prism', type: 'convex', base: 'bg-white/10', display: 'bg-transparent', bar: 'bg-gradient-to-t from-violet-600 via-blue-400 to-green-200 shadow-[0_0_12px_rgba(255,255,255,0.8),inset_0_2px_4px_rgba(255,255,255,0.4)] rounded-t-sm', sliderTrack: 'bg-violet-500/40', sliderThumb: 'bg-blue-300', text: 'text-green-200', accent: 'text-violet-500', button: 'bg-violet-700/50', buttonHover: 'hover:bg-violet-600/50', highlight: 'bg-blue-500/30' },
    { name: 'Bass Inferno', type: 'shadow', base: 'bg-red-950', display: 'bg-black/90', bar: 'bg-gradient-to-t from-red-900 via-red-500 to-orange-300 shadow-[0_0_25px_#ef4444,-2px_0_5px_rgba(0,0,0,0.7)] rounded-t-lg', sliderTrack: 'bg-red-800/50', sliderThumb: 'bg-orange-400', text: 'text-orange-200', accent: 'text-red-500', button: 'bg-red-900/70', buttonHover: 'hover:bg-red-800/70', highlight: 'bg-red-600/50' },
    { name: 'Treble Sparkle', type: 'concave', base: 'bg-blue-950', display: 'bg-black/80', bar: 'bg-gradient-to-t from-blue-700 via-cyan-400 to-white shadow-[inset_0_-2px_4px_rgba(0,0,0,0.2),0_0_15px_#ffffff] rounded-t-sm', sliderTrack: 'bg-blue-600', sliderThumb: 'bg-cyan-300', text: 'text-white', accent: 'text-cyan-400', button: 'bg-blue-700', buttonHover: 'hover:bg-blue-600', highlight: 'bg-cyan-500/40' },
    { name: 'Vaporwave Retro', type: 'led', base: 'bg-pink-900', display: 'bg-purple-950/80', bar: 'bg-gradient-to-t from-pink-600 to-purple-400 shadow-none border-none rounded-none', sliderTrack: 'bg-pink-700/60', sliderThumb: 'bg-purple-300', text: 'text-purple-200', accent: 'text-pink-400', button: 'bg-pink-800/70', buttonHover: 'hover:bg-pink-700/70', highlight: 'bg-purple-500/50' },
    { name: 'Quantum Pulse', type: 'shadow', base: 'bg-black', display: 'bg-green-950/90', bar: 'bg-radial-gradient(circle,green-500_20%,lime-300_60%,transparent_100%) shadow-[0_0_18px_#22c55e,-2px_0_5px_rgba(0,0,0,0.5)] rounded-t-sm', sliderTrack: 'bg-green-800/50', sliderThumb: 'bg-lime-400', text: 'text-lime-200', accent: 'text-green-500', button: 'bg-green-900/70', buttonHover: 'hover:bg-green-800/70', highlight: 'bg-lime-600/40' },
    { name: 'Eclipse Shadow', type: 'concave', base: 'bg-gray-950', display: 'bg-black/95', bar: 'bg-gradient-to-t from-gray-900 via-gray-500 to-white/50 shadow-[inset_0_-4px_8px_rgba(0,0,0,0.4),0_0_10px_rgba(255,255,255,0.3)] rounded-t-sm', sliderTrack: 'bg-gray-700', sliderThumb: 'bg-gray-300', text: 'text-white', accent: 'text-gray-400', button: 'bg-gray-800', buttonHover: 'hover:bg-gray-700', highlight: 'bg-gray-500/50' },
    { name: 'Mukyo', type: 'shadow', base: 'bg-zinc-950', display: 'bg-zinc-900/80 backdrop-blur-sm border border-zinc-800', bar: 'bg-gradient-to-t from-cyan-900 via-cyan-500 to-white shadow-[0_0_15px_rgba(34,211,238,0.6)] rounded-t-[2px]', sliderTrack: 'bg-zinc-800', sliderThumb: 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]', text: 'text-zinc-300', accent: 'text-cyan-400', button: 'bg-zinc-800 border border-zinc-700', buttonHover: 'hover:bg-zinc-700', highlight: 'bg-zinc-800' },
    { name: 'Muknics', type: 'shadow', base: 'bg-[#1c1917]', display: 'bg-black/60 border-t border-orange-900/30', bar: 'bg-gradient-to-t from-orange-900 via-amber-500 to-yellow-100 shadow-[inset_2px_0_4px_rgba(0,0,0,0.6),0_0_12px_rgba(245,158,11,0.4)] rounded-t-sm', sliderTrack: 'bg-stone-800', sliderThumb: 'bg-amber-500 border-2 border-orange-900', text: 'text-stone-300', accent: 'text-amber-400', button: 'bg-stone-800', buttonHover: 'hover:bg-stone-700', highlight: 'bg-stone-700/50' },
    { name: 'Pioneer', type: 'shadow', base: 'bg-slate-200', display: 'bg-blue-900/80', bar: 'bg-gradient-to-t from-sky-600 to-sky-400 shadow-[0_0_8px_#38bdf8,-2px_0_5px_rgba(0,0,0,0.4)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-white', text: 'text-gray-800', accent: 'text-blue-600', button: 'bg-gray-400', buttonHover: 'hover:bg-gray-500', highlight: 'bg-slate-300' },
    { name: 'Pioneer Convex', type: 'convex', base: 'bg-slate-200', display: 'bg-blue-900/80', bar: 'bg-gradient-to-t from-sky-600 to-sky-400 shadow-[0_0_8px_#38bdf8] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-white', text: 'text-gray-800', accent: 'text-blue-600', button: 'bg-gray-400', buttonHover: 'hover:bg-gray-500', highlight: 'bg-slate-300' },
    { name: 'Marantz', type: 'shadow', base: 'bg-amber-100', display: 'bg-black/80', bar: 'bg-gradient-to-t from-blue-700 to-blue-500 shadow-[0_0_8px_#3b82f6,-2px_0_5px_rgba(0,0,0,0.4)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-gray-700', text: 'text-gray-800', accent: 'text-blue-700', button: 'bg-gray-300', buttonHover: 'hover:bg-gray-400', highlight: 'bg-amber-200' },
    { name: 'Marantz-variant1', type: 'shadow', base: 'bg-amber-100', display: 'bg-black/90', bar: 'bg-gradient-to-t from-blue-700 to-blue-500 shadow-[-2px_0_2px_rgba(0,0,0,0.6),-8px_0_20px_rgba(0,0,0,0.3)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-gray-700', text: 'text-gray-800', accent: 'text-blue-700', button: 'bg-gray-300', buttonHover: 'hover:bg-gray-400', highlight: 'bg-amber-200' },
    { name: 'Marantz-variant2', type: 'shadow', base: 'bg-amber-100', display: 'bg-black/3k', bar: 'bg-gradient-to-t from-blue-700 to-blue-500 shadow-[-4px_0_1px_rgba(0,0,0,0.5),-6px_0_10px_rgba(0,0,0,0.3)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-gray-700', text: 'text-gray-800', accent: 'text-blue-700', button: 'bg-gray-300', buttonHover: 'hover:bg-gray-400', highlight: 'bg-amber-200' },
    { name: 'Marantz Concave', type: 'concave', base: 'bg-amber-100', display: 'bg-black/80', bar: 'bg-gradient-to-t from-blue-700 to-blue-500 shadow-[0_0_8px_#3b82f6] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-gray-700', text: 'text-gray-800', accent: 'text-blue-700', button: 'bg-gray-300', buttonHover: 'hover:bg-gray-400', highlight: 'bg-amber-200' },
    { name: 'Marantz-concave-variant1', type: 'shadow', base: 'bg-amber-300', display: 'bg-black/3d', bar: 'bg-gradient-to-t from-blue-700 to-blue-500 shadow-[-2px_0_2px_rgba(0,0,0,0.6),-8px_0_20px_rgba(0,0,0,0.3)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-gray-700', text: 'text-gray-800', accent: 'text-blue-700', button: 'bg-gray-300', buttonHover: 'hover:bg-gray-400', highlight: 'bg-amber-200' },
    { name: 'Marantz-concave-variant2', type: 'shadow', base: 'bg-amber-400', display: 'bg-black/3d', bar: 'bg-gradient-to-t from-lime-300 to-purple-300 shadow-[-4px_0_1px_rgba(0,0,0,0.5),-6px_0_10px_rgba(0,0,0,0.3)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-gray-700', text: 'text-gray-800', accent: 'text-blue-700', button: 'bg-gray-300', buttonHover: 'hover:bg-gray-400', highlight: 'bg-amber-300' },
    { name: 'Marantz-concave-variant3', type: 'concave', base: 'bg-amber-400', display: 'bg-black/70', bar: 'bg-gradient-to-t from-rose-300 to-gray-300 shadow-[inset_-1px_0_2px_rgba(255,255,255,0.4),-5px_0_10px_rgba(0,0,0,0.5)], rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-gray-700', text: 'text-gray-800', accent: 'text-blue-700', button: 'bg-gray-300', buttonHover: 'hover:bg-gray-400', highlight: 'bg-amber-300' },
    { name: 'Glass Box', type: 'glass-box', base: 'bg-gray-900', display: 'bg-black/50', bar: 'bg-gradient-to-t from-purple-500 to-cyan-300 text-cyan-300', sliderTrack: 'bg-purple-800/60', sliderThumb: 'bg-cyan-300', text: 'text-purple-200', accent: 'text-cyan-300', button: 'bg-purple-900/70', buttonHover: 'hover:bg-purple-800/70', highlight: 'bg-cyan-500/50' },
    { name: 'Muntosh', type: '3d', base: 'bg-gray-900', display: 'bg-black/90', bar: 'bg-gradient-to-t from-sky-600 to-sky-300 shadow-[0_0_6px_#38bdf8]', sliderTrack: 'bg-gray-600', sliderThumb: 'bg-green-500', text: 'text-green-400', accent: 'text-sky-400', button: 'bg-gray-800 border border-gray-600', buttonHover: 'hover:bg-gray-700', highlight: 'bg-gray-700/50' },
    { name: 'Cyberpunk', type: 'shadow', base: 'bg-black', display: 'bg-black/80', bar: 'bar-neon-glow bg-cyan-400', sliderTrack: 'bg-gray-800', sliderThumb: 'bg-fuchsia-500', text: 'text-fuchsia-400 font-mono', accent: 'text-cyan-300', button: 'bg-gray-900 border border-fuchsia-700', buttonHover: 'hover:bg-gray-800', highlight: 'bg-fuchsia-600/50' },
    { name: 'Aqua Gloss', type: 'glossy', base: 'bg-gray-800', display: 'bg-black/50', bar: 'bg-gradient-to-t from-teal-500 to-cyan-400 shadow-[0_0_8px_#67e8f9]', sliderTrack: 'bg-gray-600', sliderThumb: 'bg-cyan-300', text: 'text-gray-200', accent: 'text-cyan-300', button: 'bg-gray-700', buttonHover: 'hover:bg-gray-600', highlight: 'bg-cyan-600/50' },
    { name: 'Liquid Sky', type: 'glass', base: 'bg-gradient-to-b from-slate-900 to-sky-900', display: 'bg-black/20', bar: 'rounded-t-md', sliderTrack: 'bg-sky-800/50', sliderThumb: 'bg-slate-300', text: 'text-slate-200', accent: 'text-sky-300', button: 'bg-sky-900/50', buttonHover: 'hover:bg-sky-800/50', highlight: 'bg-sky-700/50' },
    { name: 'Matrix', type: 'shadow', base: 'bg-black', display: 'bg-black/80', bar: 'bg-gradient-to-t from-emerald-700 to-green-400 shadow-[0_0_10px_#4ade80,-1px_0_4px_rgba(0,0,0,0.7)]', sliderTrack: 'bg-gray-800', sliderThumb: 'bg-green-500', text: 'text-green-400 font-mono', accent: 'text-green-300', button: 'bg-gray-900 border border-green-700', buttonHover: 'hover:bg-gray-800', highlight: 'bg-green-600/50' },
    { name: 'Cosmic Rift 2.0', type: '3d', base: 'cosmic-rift-bg', display: 'bg-black/40', bar: 'bg-gradient-to-t from-fuchsia-500 via-pink-400 to-cyan-300 shadow-[0_0_10px_#a855f7]', sliderTrack: 'bg-purple-800/50', sliderThumb: 'bg-fuchsia-500', text: 'text-purple-300', accent: 'text-cyan-300', button: 'bg-purple-900/70', buttonHover: 'hover:bg-purple-800/70', highlight: 'bg-fuchsia-500/50' },
    { name: 'Celestial Sphere', type: 'fractal', base: 'bg-gradient-to-br from-gray-900 via-blue-900 to-black', display: 'bg-black/40', bar: '', sliderTrack: 'bg-blue-800/50', sliderThumb: 'bg-sky-500', text: 'text-sky-300', accent: 'text-cyan-300', button: 'bg-blue-900/70', buttonHover: 'hover:bg-blue-800/70', highlight: 'bg-sky-500/50' },
    { name: 'Aura Bloom', type: 'aura', base: 'bg-black', display: 'bg-black/50', bar: '', sliderTrack: 'bg-indigo-800/50', sliderThumb: 'bg-violet-400', text: 'text-violet-300', accent: 'text-sky-300', button: 'bg-indigo-900/70', buttonHover: 'hover:bg-indigo-800/70', highlight: 'bg-sky-500/50' },
    // { name: 'Rhythmic Glyphs', type: 'glyphs', base: 'bg-slate-900', display: 'bg-black/60', bar: '', sliderTrack: 'bg-teal-800/50', sliderThumb: 'bg-emerald-400', text: 'text-teal-200', accent: 'text-emerald-300', button: 'bg-teal-900/60', buttonHover: 'hover:bg-teal-800/60', highlight: 'bg-emerald-500/50' },
    { name: 'Liquify', type: 'liquid', base: 'bg-gray-800', display: 'bg-black/70', bar: '', sliderTrack: 'bg-slate-600', sliderThumb: 'bg-white', text: 'text-slate-200', accent: 'text-cyan-300', button: 'bg-slate-700', buttonHover: 'hover:bg-slate-600', highlight: 'bg-cyan-500/50' },
    { name: 'Molten Core', type: 'glossy', base: 'bg-stone-900', display: 'bg-black/60', bar: 'bg-gradient-to-t from-red-700 via-orange-500 to-yellow-400 shadow-[0_0_8px_#fb923c]', sliderTrack: 'bg-red-900/50', sliderThumb: 'bg-amber-400', text: 'text-amber-300', accent: 'text-orange-400', button: 'bg-orange-800/50', buttonHover: 'hover:bg-orange-700/50', highlight: 'bg-yellow-500/50' },
    { name: 'Ocean Floor', type: 'glass', base: 'bg-gradient-to-t from-blue-900 to-teal-900', display: 'bg-black/30', bar: 'rounded-t-md', sliderTrack: 'bg-cyan-800/50', sliderThumb: 'bg-teal-300', text: 'text-cyan-200', accent: 'text-teal-300', button: 'bg-cyan-900/60', buttonHover: 'hover:bg-cyan-800/60', highlight: 'bg-teal-600/50' },
    { name: 'Aquamarine Dream', type: 'glossy', base: 'bg-gradient-to-br from-green-900 via-cyan-800 to-teal-900', display: 'bg-black/30', bar: 'bg-gradient-to-t from-emerald-400 to-cyan-200 shadow-[0_0_8px_#67e8f9]', sliderTrack: 'bg-teal-800/60', sliderThumb: 'bg-emerald-300', text: 'text-cyan-200', accent: 'text-emerald-300', button: 'bg-cyan-900/60', buttonHover: 'hover:bg-cyan-800/60', highlight: 'bg-emerald-600/50' },
    { name: 'Gold Standard', type: 'convex', base: 'bg-gray-900', display: 'bg-black/60', bar: 'bg-gradient-to-t from-yellow-700 via-amber-400 to-yellow-100 shadow-[0_0_8px_#facc15] rounded-t-sm', sliderTrack: 'bg-yellow-800/50', sliderThumb: 'bg-amber-300', text: 'text-amber-200', accent: 'text-yellow-400', button: 'bg-yellow-900/60', buttonHover: 'hover:bg-yellow-800/60', highlight: 'bg-amber-500/50' },
    { name: 'Art Deco', type: '3d', base: 'bg-black', display: 'bg-gray-900/50', bar: 'art-deco-bar', sliderTrack: 'bg-gray-700', sliderThumb: 'bg-amber-400', text: 'text-amber-200', accent: 'text-amber-400', button: 'bg-neutral-800', buttonHover: 'hover:bg-neutral-700', highlight: 'bg-amber-500/50' },
    { name: 'Woodgrain', type: 'convex', base: 'woodgrain-bg', display: 'bg-black/40', bar: 'bg-gradient-to-t from-amber-800 to-amber-600 rounded-t-sm', sliderTrack: 'bg-amber-900/70', sliderThumb: 'bg-amber-300', text: 'text-amber-200', accent: 'text-amber-300', button: 'bg-amber-950/50', buttonHover: 'hover:bg-amber-950/70', highlight: 'bg-amber-800/50' },
    { name: 'Platinum Sheen', type: 'convex', base: 'bg-slate-800', display: 'bg-black/50', bar: 'bg-gradient-to-t from-slate-400 via-gray-200 to-white shadow-[0_0_8px_#e2e8f0] rounded-t-sm', sliderTrack: 'bg-slate-600', sliderThumb: 'bg-white', text: 'text-slate-200', accent: 'text-cyan-300', button: 'bg-slate-700', buttonHover: 'hover:bg-slate-600', highlight: 'bg-cyan-500/50' },
    { name: 'Polished Silver', type: 'glossy', base: 'bg-gray-700', display: 'bg-black/50', bar: 'bg-gradient-to-t from-gray-600 via-slate-300 to-gray-400 shadow-[0_0_8px_#cbd5e1]', sliderTrack: 'bg-gray-500', sliderThumb: 'bg-slate-200', text: 'text-gray-200', accent: 'text-sky-300', button: 'bg-gray-600', buttonHover: 'hover:bg-gray-500', highlight: 'bg-sky-600/50' },
    { name: 'Classic LED', type: 'led', base: 'bg-gray-900', display: 'bg-black', bar: 'bg-gray-700', sliderTrack: 'bg-gray-600', sliderThumb: 'bg-gray-400', text: 'text-gray-300', accent: 'text-green-400', button: 'bg-gray-700', buttonHover: 'hover:bg-gray-600', highlight: 'bg-green-600/50' },
    { name: 'Translucent LED', type: 'led', base: 'bg-gray-900/80', display: 'bg-black/70', bar: 'bg-gray-700/60', sliderTrack: 'bg-gray-600/70', sliderThumb: 'bg-gray-400/80', text: 'text-gray-300/90', accent: 'text-green-400/90', button: 'bg-gray-700/70', buttonHover: 'hover:bg-gray-600/80', highlight: 'bg-green-600/40' },
    { name: 'Borderless LED', type: 'led', base: 'bg-gray-900', display: 'bg-black', bar: 'bg-gray-700 shadow-none border-none', sliderTrack: 'bg-gray-600', sliderThumb: 'bg-gray-400', text: 'text-gray-300', accent: 'text-green-400', button: 'bg-gray-700', buttonHover: 'hover:bg-gray-600', highlight: 'bg-green-600/50' },
    { name: 'Pioneer Neon Pink', type: 'shadow', base: 'bg-slate-200', display: 'bg-pink-900/80', bar: 'bg-gradient-to-t from-pink-600 to-pink-400 shadow-[0_0_8px_#ec4899,-2px_0_5px_rgba(0,0,0,0.4)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-white', text: 'text-gray-800', accent: 'text-pink-600', button: 'bg-gray-400', buttonHover: 'hover:bg-gray-500', highlight: 'bg-slate-300' },
    { name: 'Pioneer Convex Emerald', type: 'convex', base: 'bg-slate-200', display: 'bg-emerald-900/80', bar: 'bg-gradient-to-t from-emerald-600 to-emerald-400 shadow-[0_0_8px_#10b981] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-white', text: 'text-gray-800', accent: 'text-emerald-600', button: 'bg-gray-400', buttonHover: 'hover:bg-gray-500', highlight: 'bg-slate-300' },
    { name: 'Marantz Fire Red', type: 'shadow', base: 'bg-amber-100', display: 'bg-black/80', bar: 'bg-gradient-to-t from-red-700 to-red-500 shadow-[0_0_8px_#ef4444,-2px_0_5px_rgba(0,0,0,0.4)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-gray-700', text: 'text-gray-800', accent: 'text-red-700', button: 'bg-gray-300', buttonHover: 'hover:bg-gray-400', highlight: 'bg-amber-200' },
    { name: 'Marantz Concave Violet', type: 'concave', base: 'bg-amber-100', display: 'bg-black/80', bar: 'bg-gradient-to-t from-violet-700 to-violet-500 shadow-[0_0_8px_#8b5cf6] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-gray-700', text: 'text-gray-800', accent: 'text-violet-700', button: 'bg-gray-300', buttonHover: 'hover:bg-gray-400', highlight: 'bg-amber-200' },
    { name: 'Gold Standard Sapphire', type: 'convex', base: 'bg-gray-900', display: 'bg-black/60', bar: 'bg-gradient-to-t from-blue-700 via-indigo-400 to-blue-100 shadow-[0_0_8px_#3b82f6] rounded-t-sm', sliderTrack: 'bg-blue-800/50', sliderThumb: 'bg-indigo-300', text: 'text-indigo-200', accent: 'text-blue-400', button: 'bg-blue-900/60', buttonHover: 'hover:bg-blue-800/60', highlight: 'bg-indigo-500/50' },
    { name: 'Classic LED Glow', type: 'led', base: 'bg-gray-900', display: 'bg-black', bar: 'bg-gray-700 shadow-[0_0_4px_#22c55e]', sliderTrack: 'bg-gray-600', sliderThumb: 'bg-gray-400', text: 'text-gray-300', accent: 'text-green-400', button: 'bg-gray-700', buttonHover: 'hover:bg-gray-600', highlight: 'bg-green-600/50' },
    { name: 'Pioneer Sunset', type: 'shadow', base: 'bg-slate-200', display: 'bg-orange-900/80', bar: 'bg-gradient-to-t from-orange-600 to-amber-400 shadow-[0_0_8px_#f59e0b,-2px_0_5px_rgba(0,0,0,0.4)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-white', text: 'text-gray-800', accent: 'text-orange-600', button: 'bg-gray-400', buttonHover: 'hover:bg-gray-500', highlight: 'bg-slate-300' },
    { name: 'Marantz Ice Blue', type: 'concave', base: 'bg-amber-100', display: 'bg-black/80', bar: 'bg-gradient-to-t from-cyan-700 to-cyan-300 shadow-[0_0_8px_#06b6d4] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-gray-700', text: 'text-gray-800', accent: 'text-cyan-700', button: 'bg-gray-300', buttonHover: 'hover:bg-gray-400', highlight: 'bg-amber-200' },
    { name: 'Gold Standard Crimson', type: 'convex', base: 'bg-gray-900', display: 'bg-black/60', bar: 'bg-gradient-to-t from-rose-700 via-rose-400 to-rose-100 shadow-[0_0_8px_#e11d48] rounded-t-sm', sliderTrack: 'bg-rose-800/50', sliderThumb: 'bg-rose-300', text: 'text-rose-200', accent: 'text-rose-400', button: 'bg-rose-900/60', buttonHover: 'hover:bg-rose-800/60', highlight: 'bg-rose-500/50' },
    { name: 'Pioneer Convex Lime', type: 'convex', base: 'bg-slate-200', display: 'bg-lime-900/80', bar: 'bg-gradient-to-t from-lime-600 to-lime-400 shadow-[0_0_8px_#84cc16] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-white', text: 'text-gray-800', accent: 'text-lime-600', button: 'bg-gray-400', buttonHover: 'hover:bg-gray-500', highlight: 'bg-slate-300' },
    { name: 'Marantz Shadow Purple', type: 'shadow', base: 'bg-amber-100', display: 'bg-black/80', bar: 'bg-gradient-to-t from-purple-700 to-purple-500 shadow-[0_0_8px_#a855f7,-2px_0_5px_rgba(0,0,0,0.4)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-gray-700', text: 'text-gray-800', accent: 'text-purple-700', button: 'bg-gray-300', buttonHover: 'hover:bg-gray-400', highlight: 'bg-amber-200' },
    { name: 'Classic LED Amber', type: 'led', base: 'bg-gray-900', display: 'bg-black', bar: 'bg-amber-700', sliderTrack: 'bg-amber-600', sliderThumb: 'bg-amber-400', text: 'text-amber-300', accent: 'text-yellow-400', button: 'bg-amber-700', buttonHover: 'hover:bg-amber-600', highlight: 'bg-yellow-600/50' },
    { name: 'Pioneer Teal Glow', type: 'shadow', base: 'bg-slate-200', display: 'bg-teal-900/80', bar: 'bg-gradient-to-t from-teal-600 to-teal-400 shadow-[0_0_12px_#14b8a6,-2px_0_5px_rgba(0,0,0,0.4)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-white', text: 'text-gray-800', accent: 'text-teal-600', button: 'bg-gray-400', buttonHover: 'hover:bg-gray-500', highlight: 'bg-slate-300' },
    { name: 'Gold Standard Emerald', type: 'convex', base: 'bg-gray-900', display: 'bg-black/60', bar: 'bg-gradient-to-t from-emerald-700 via-emerald-400 to-emerald-100 shadow-[0_0_8px_#10b981] rounded-t-sm', sliderTrack: 'bg-emerald-800/50', sliderThumb: 'bg-emerald-300', text: 'text-emerald-200', accent: 'text-emerald-400', button: 'bg-emerald-900/60', buttonHover: 'hover:bg-emerald-800/60', highlight: 'bg-emerald-500/50' },
    { name: 'Marantz Concave Gold', type: 'concave', base: 'bg-amber-100', display: 'bg-black/80', bar: 'bg-gradient-to-t from-amber-700 to-amber-500 shadow-[0_0_8px_#fbbf24] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-gray-700', text: 'text-gray-800', accent: 'text-amber-700', button: 'bg-gray-300', buttonHover: 'hover:bg-gray-400', highlight: 'bg-amber-200' },
    { name: 'Classic LED Neon Blue', type: 'led', base: 'bg-gray-900', display: 'bg-black', bar: 'bg-blue-700 shadow-[0_0_6px_#3b82f6]', sliderTrack: 'bg-blue-600', sliderThumb: 'bg-blue-400', text: 'text-blue-300', accent: 'text-blue-400', button: 'bg-blue-700', buttonHover: 'hover:bg-blue-600', highlight: 'bg-blue-600/50' },
    { name: 'Pioneer Convex Fuchsia', type: 'convex', base: 'bg-slate-200', display: 'bg-fuchsia-900/80', bar: 'bg-gradient-to-t from-fuchsia-600 to-fuchsia-400 shadow-[0_0_8px_#d946ef] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-white', text: 'text-gray-800', accent: 'text-fuchsia-600', button: 'bg-gray-400', buttonHover: 'hover:bg-gray-500', highlight: 'bg-slate-300' },
    { name: 'Marantz Retro Green', type: 'shadow', base: 'bg-amber-100', display: 'bg-black/80', bar: 'bg-gradient-to-t from-green-700 to-green-500 shadow-[0_0_8px_#22c55e,-2px_0_5px_rgba(0,0,0,0.4)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-gray-700', text: 'text-gray-800', accent: 'text-green-700', button: 'bg-gray-300', buttonHover: 'hover:bg-gray-400', highlight: 'bg-amber-200' },        
  ];

  selectedTheme: WritableSignal<EqualizerTheme> = signal(this.themes[0]);
  effectiveTheme = computed(() => this.activeHoliday()?.theme ?? this.selectedTheme());
  selectedThemeIndex = computed(() => this.themes.findIndex(t => t.name === this.selectedTheme().name));
  
  onFileChange(event: Event) { this.audioService.loadFiles((event.target as HTMLInputElement).files!); }
  onBgImageChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const oldUrl = this.backgroundImageUrl();
      if (oldUrl && oldUrl.startsWith('blob:')) URL.revokeObjectURL(oldUrl);
      this.backgroundImageUrl.set(URL.createObjectURL(input.files[0]));
    }
  }

  onPlayPauseClick(): void { this.audioService.togglePlay(); }
  onGainChange(event: Event, index: number) { this.audioService.changeGain(index, parseFloat((event.target as HTMLInputElement).value)); }
  onSeek(event: Event) { this.audioService.seek(parseFloat((event.target as HTMLInputElement).value)); }
  onSensitivityChange(event: Event) { this.sensitivity.set(parseFloat((event.target as HTMLInputElement).value)); }
  onBarCountChange(event: Event) { this.barCount.set(parseInt((event.target as HTMLInputElement).value, 10)); }
  onBarSpacingChange(event: Event) { this.barSpacing.set(parseInt((event.target as HTMLInputElement).value, 10)); }
  setLightSource(position: LightSourcePosition) { this.lightSourcePosition.set(position); }
  selectTheme(index: string) { const i = parseInt(index, 10); if (!isNaN(i) && i < this.themes.length) this.selectedTheme.set(this.themes[i]); }
  toggleAutoSwitch() { this.isAutoSwitching.update(v => !v); }
  setSwitchInterval(event: Event) { this.switchInterval.set(parseInt((event.target as HTMLSelectElement).value, 10)); }
  setSwitchMode(mode: 'sequential' | 'random') { this.switchMode.set(mode); }
  toggleHolidayTheme(event: Event) { this.holidayService.setHolidayThemeEnabled((event.target as HTMLInputElement).checked); }
  setSynergyDriveMode(mode: SynergyDriveSetting) { this.synergyDriveMode.set(mode); }
  setResponseCurve(curve: 'linear' | 'polynomial') { this.responseCurve.set(curve); }

  private startAutoSwitching(): void {
    this.stopAutoSwitching();
    this.themeSwitchIntervalId = setInterval(() => this.selectNextTheme(), this.switchInterval());
  }
  private stopAutoSwitching(): void { if (this.themeSwitchIntervalId) { clearInterval(this.themeSwitchIntervalId); this.themeSwitchIntervalId = null; } }

  private selectNextTheme(): void {
    const currentIndex = this.themes.findIndex(t => t.name === this.selectedTheme().name);
    let nextIndex: number;
    if (this.switchMode() === 'random') {
      do { nextIndex = Math.floor(Math.random() * this.themes.length); } while (nextIndex === currentIndex && this.themes.length > 1);
    } else {
      nextIndex = (currentIndex + 1) % this.themes.length;
    }
    this.selectedTheme.set(this.themes[nextIndex]);
  }
   

  formatTime(seconds: number): string {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  incrementLedWidth() { this.ledSegmentWidth.update(w => Math.min(24, w + 1)); } //was 18 to not flood the menu bars on the side
  decrementLedWidth() { this.ledSegmentWidth.update(w => Math.max(2, w - 1)); }
  incrementLedHeight() { this.ledSegmentHeight.update(h => Math.min(16, h + 1)); }
  decrementLedHeight() { this.ledSegmentHeight.update(h => Math.max(1, h - 1)); }
  toggleKaleidoscope() { this.isKaleidoscope.update(k => !k); }

  toggleStyleFusion() { this.isStyleFusionOn.update(f => !f); }
  setFusionInterval(event: Event) { this.fusionInterval.set(parseInt((event.target as HTMLSelectElement).value, 10)); }
  
    private startKaleidoscope() {
    this.stopKaleidoscope();
    const animate = () => {
      this.kaleidoscopeHueShift.update(h => (h + 0.5) % 360);
      this.kaleidoscopeAnimFrameId = requestAnimationFrame(animate);
    };
    animate();
  }
  private stopKaleidoscope() { if (this.kaleidoscopeAnimFrameId !== null) { cancelAnimationFrame(this.kaleidoscopeAnimFrameId); this.kaleidoscopeAnimFrameId = null; } }

  private startStyleFusion() {
    this.stopStyleFusion();
    this.fusionIntervalId = setInterval(() => this.selectNextTheme(), this.fusionInterval());
  }
  private stopStyleFusion() { if (this.fusionIntervalId) { clearInterval(this.fusionIntervalId); this.fusionIntervalId = null; } }

  
  toggleAudioSource() { this.audioService.setAudioSource(this.audioSource() === 'file' ? 'microphone' : 'file'); }
  toggleCrossfade(event: Event) { this.audioService.isCrossfadeEnabled.set((event.target as HTMLInputElement).checked); }

    // --- Preset Methods ---
  savePreset() {
    const name = this.newPresetName().trim();
    if (name) {
      this.presetService.savePreset(name, this.gainValues());
      this.newPresetName.set('');
    }
  }

  applyPreset(event: Event) {
    const selectedName = (event.target as HTMLSelectElement).value;
    const preset = this.presets().find(p => p.name === selectedName);
    if (preset) {
      this.selectedPreset.set(preset);
      this.presetService.applyPreset(preset);
    }
  }

  deleteSelectedPreset() {
    const preset = this.selectedPreset();
    if (preset) {
      this.presetService.deletePreset(preset.name);
      this.selectedPreset.set(null);
    }
  }

  onDragStart(index: number) { this.draggedTrackIndex.set(index); }
  onDragOver(event: DragEvent) { event.preventDefault(); }
  onDrop(event: DragEvent, dropIndex: number) {
    event.preventDefault();
    const startIndex = this.draggedTrackIndex();
    if (startIndex === null || startIndex === dropIndex) return;
    
    this.playlist.update(list => {
      const newList = [...list];
      const [removed] = newList.splice(startIndex, 1);
      newList.splice(dropIndex, 0, removed);
      return newList;
    });
    
    const currentIdx = this.currentTrackIndex();
    if (currentIdx === startIndex) this.currentTrackIndex.set(dropIndex);
    else if (currentIdx !== null && startIndex < currentIdx && dropIndex >= currentIdx) this.currentTrackIndex.update(i => i! - 1);
    else if (currentIdx !== null && startIndex > currentIdx && dropIndex <= currentIdx) this.currentTrackIndex.update(i => i! + 1);
    
    this.draggedTrackIndex.set(null);
  } 
  onDragEnd() { this.draggedTrackIndex.set(null); }
  
  private _reimplementUnchanged() {
      // This block contains methods that were not directly part of the user's request,
      // but are kept to maintain existing functionality.
      this.startAutoSwitching = () => {
        this.stopAutoSwitching();
        this.themeSwitchIntervalId = setInterval(() => this.selectNextTheme(), this.switchInterval());
      };
      this.stopAutoSwitching = () => { if (this.themeSwitchIntervalId) { clearInterval(this.themeSwitchIntervalId); this.themeSwitchIntervalId = null; } };
      this.selectNextTheme = () => {
        const currentIndex = this.themes.findIndex(t => t.name === this.selectedTheme().name);
        let nextIndex: number;
        if (this.switchMode() === 'random') {
          do { nextIndex = Math.floor(Math.random() * this.themes.length); } while (nextIndex === currentIndex && this.themes.length > 1);
        } else {
          nextIndex = (currentIndex + 1) % this.themes.length;
        }
        this.selectedTheme.set(this.themes[nextIndex]);
      };
      this.startKaleidoscope = () => {
        this.stopKaleidoscope();
        const animate = () => {
          this.kaleidoscopeHueShift.update(h => (h + 0.5) % 360);
          this.kaleidoscopeAnimFrameId = requestAnimationFrame(animate);
        };
        animate();
      };
      this.stopKaleidoscope = () => { if (this.kaleidoscopeAnimFrameId !== null) { cancelAnimationFrame(this.kaleidoscopeAnimFrameId); this.kaleidoscopeAnimFrameId = null; } };
      this.savePreset = () => {
        const name = this.newPresetName().trim();
        if (name) {
          this.presetService.savePreset(name, this.gainValues());
          this.newPresetName.set('');
        }
      };
      this.applyPreset = (event: Event) => {
        const selectedName = (event.target as HTMLSelectElement).value;
        const preset = this.presets().find(p => p.name === selectedName);
        if (preset) {
          this.selectedPreset.set(preset);
          this.presetService.applyPreset(preset);
        }
      };
      this.deleteSelectedPreset = () => {
        const preset = this.selectedPreset();
        if (preset) {
          this.presetService.deletePreset(preset.name);
          this.selectedPreset.set(null);
        }
      };
      this.onDragStart = (index: number) => { this.draggedTrackIndex.set(index); };
      this.onDrop = (event: DragEvent, dropIndex: number) => {
        event.preventDefault();
        const startIndex = this.draggedTrackIndex();
        if (startIndex === null || startIndex === dropIndex) return;
        this.playlist.update(list => {
          const newList = [...list];
          const [removed] = newList.splice(startIndex, 1);
          newList.splice(dropIndex, 0, removed);
          return newList;
        });
        const currentIdx = this.currentTrackIndex();
        if (currentIdx === startIndex) this.currentTrackIndex.set(dropIndex);
        else if (currentIdx !== null && startIndex < currentIdx && dropIndex >= currentIdx) this.currentTrackIndex.update(i => i! - 1);
        else if (currentIdx !== null && startIndex > currentIdx && dropIndex <= currentIdx) this.currentTrackIndex.update(i => i! + 1);
        this.draggedTrackIndex.set(null);
      };
  }
}

