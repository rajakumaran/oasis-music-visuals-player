import { Component, ChangeDetectionStrategy, inject, signal, computed, WritableSignal, OnInit, OnDestroy, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AudioService } from './services/audio.service';
import { HolidayService } from './services/holiday.service';
import { PresetService, Preset } from './services/preset.service';
import { EqualizerTheme } from './models/equalizer-theme.model';
import { FullscreenToggleComponent } from './fullscreen-toggle/fullscreen-toggle.component';
import { inject as vercelAnalytics } from '@vercel/analytics'; // 1. Import the helper
import { track } from '@vercel/analytics'; // 1. Import track
type LightSourcePosition = 'none' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center-stage' | 'top-center';
type SynergyDriveMode = 'atmosphere' | 'rhythm' | 'transient';
type SynergyDriveSetting = SynergyDriveMode | 'smart';

interface AuraRing { id: number; radius: number; opacity: number; thickness: number; hue: number; }
interface AuraParticle { id: number; x: number; y: number; opacity: number; size: number; }

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FullscreenToggleComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnInit, OnDestroy {
  audioService = inject(AudioService);
  holidayService = inject(HolidayService);
  presetService = inject(PresetService);
  
  // Expose signals from service for template binding
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

  // --- Synergy Drive ---
  synergyDriveMode = signal<SynergyDriveSetting>('smart');
  effectiveSynergyDriveMode = computed(() => {
    const mode = this.synergyDriveMode();
    return mode === 'smart' ? this.audioService.detectedMusicProfile() : mode;
  });
  private lastBeatTimestamp = 0;
  private lastTransientTimestamp = 0;

  sensitivity = signal(1.2);
  backgroundImageUrl = signal<string | null>(null);
  private smoothedBars = new Array(64).fill(0);
  
  decayFactor = signal(0.94); // Base decay factor for visualizer bars
  private readonly resizeListener = () => this.updateDecayFactor();

  // --- Ticker Properties ---
  tickerMessages: string[] = [
    'Welcome to the Audio Oasis Equalizer...',
    'Tip: Try the new "Smart" Synergy Drive mode for adaptive visuals!',
    'Tip: You can now save and load your favorite EQ settings as presets!',
    'Tip: Try Microphone Mode to visualize any sound in your room.',
    'By Mr. Muthukumaran Azhagesan ( Kumar ), https://linktr.ee/muthukumaran.azhagesan',
  ];

  currentTickerMessage = signal(this.tickerMessages[0]);
  tickerDirection = signal<'left' | 'right'>('left');
  private tickerInterval: any;
  animationClass = computed(() => 'animate-' + this.tickerDirection());
  
  // --- Auto-Switching Properties ---
  isAutoSwitching = signal(false);
  switchInterval = signal(10000); // ms
  switchMode = signal<'sequential' | 'random'>('sequential');
  private themeSwitchIntervalId: any = null;

  // --- LED Theme Controls ---
  ledSegmentWidth = signal(16);
  ledSegmentHeight = signal(8);
  isKaleidoscope = signal(false);
  kaleidoscopeHueShift = signal(0);
  private kaleidoscopeAnimFrameId: number | null = null;

  // --- Style Fusion ---
  isStyleFusionOn = signal(false);
  private fusionIntervalId: any = null;
  fusionCounter = signal(0);
  fusionInterval = signal(10000); // New signal for fusion interval
  isFusionApplicable = computed(() => !['led', 'fractal', 'neural', 'plasma', 'hyperlane', 'glass-box'].includes(this.effectiveTheme().type));
  fusionEffect = computed(() => {
    if (!this.isStyleFusionOn() || !this.isFusionApplicable()) return 'none';
    const effects = ['concave', 'convex', 'glossy', 'none'];
    return effects[Math.floor(this.fusionCounter() / 2) % effects.length];
  });


  // --- Opportunistic Ticker ---
  showOpportunisticTicker = signal(false);
  opportunisticTickerMessage = signal('Audio Oasis :: Built by Muthukumaran Azhagesan (Kumar). Feel free to check his Linktree for his many AI apps and projects');
  private showTickerTimeout: any;
  private hideTickerTimeout: any;

  // --- Holiday Theming ---
  activeHoliday = this.holidayService.activeHoliday;
  isHolidayAvailable = this.holidayService.isHolidayAvailable;
  isHolidayThemeOn = this.holidayService.holidayThemeEnabled;
  detectedHoliday = this.holidayService.detectedHoliday;
  holidayDecorationClass = computed(() => this.activeHoliday()?.decorations ?? '');

  // --- Lighting Effect ---
  lightSourcePosition = signal<LightSourcePosition>('none');
  isLightingControlVisible = computed(() => this.effectiveTheme().type !== 'led');
  lightingOverlayStyle = computed(() => {
    const position = this.lightSourcePosition();
    if (position === 'none' || !this.isLightingControlVisible()) return 'transparent';

    const isKaleido = this.isKaleidoscope();
    const hue = this.kaleidoscopeHueShift();
    
    const whiteLightColor = 'rgba(255, 255, 255, 0.25)';
    const kaleidoLightColor = `hsla(${hue}, 100%, 70%, 0.35)`;
    const lightColor = isKaleido ? kaleidoLightColor : whiteLightColor;
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

  // --- Fullscreen Controls ---
  fullscreenControlsActive = signal(false);

  // --- EQ Presets ---
  presets = this.presetService.presets;
  newPresetName = signal('');
  selectedPreset = signal<Preset | null>(null);

  // --- Playlist Drag & Drop ---
  draggedTrackIndex = signal<number | null>(null);

  constructor() {
    effect(() => this.isAutoSwitching() ? this.startAutoSwitching() : this.stopAutoSwitching());
    effect(() => (this.isKaleidoscope() && (this.isPlaying() || this.audioSource() === 'microphone')) ? this.startKaleidoscope() : this.stopKaleidoscope());
    effect(() => this.isStyleFusionOn() ? this.startStyleFusion() : this.stopStyleFusion());
  }

  ngOnInit(): void {
    //Call it using the new name
    vercelAnalytics();
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
    this.stopStyleFusion();
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

  visualizerBars = computed(() => {
    const data = this.audioService.frequencyData();
    const sensitivityValue = this.sensitivity();
    const baseDecay = this.decayFactor();
    const driveMode = this.effectiveSynergyDriveMode();
    const beatInfo = this.beat();
    const transientInfo = this.transient();

    const bars = 64;
    const output = new Array(bars);
    const logLength = Math.log(data.length);
    let lastIndex = 0;

    let beatKick = 0;
    const isRhythmic = driveMode === 'rhythm' || driveMode === 'transient';
    if (isRhythmic && beatInfo.timestamp > this.lastBeatTimestamp) {
      this.lastBeatTimestamp = beatInfo.timestamp;
      beatKick = Math.min(1, beatInfo.strength * 0.6);
    }

    let transientSpike = 0;
    let transientJitter = 0;
    if (driveMode === 'transient' && transientInfo.timestamp > this.lastTransientTimestamp) {
      this.lastTransientTimestamp = transientInfo.timestamp;
      transientSpike = Math.min(1, transientInfo.intensity * 1.5);
      transientJitter = transientInfo.intensity * 0.2;
    }
    
    for (let i = 0; i < bars; i++) {
        let index = Math.floor(Math.exp(((i + 1) / bars) * logLength));
        if (index <= lastIndex) index = lastIndex + 1;
        index = Math.min(index, data.length);
        const slice = data.slice(lastIndex, index);
        let normalizedValue = slice.length > 0 ? (Math.max(...slice) / 255) * sensitivityValue : 0;
        normalizedValue = Math.max(0, Math.min(1, normalizedValue));

        // --- Integrated Response Curve Logic ---
        if (driveMode === 'rhythm' || driveMode === 'transient') {
            normalizedValue = Math.pow(normalizedValue, 2); // Punchy polynomial curve
        }

        // --- Synergy Drive Effects Logic ---
        const barProgress = i / (bars - 1);
        const bassKickFactor = 1 - barProgress;
        const transientSpikeFactor = barProgress;
        
        normalizedValue += beatKick * bassKickFactor;
        normalizedValue += transientSpike * transientSpikeFactor;
        if (driveMode === 'transient' && i > bars / 2) {
          normalizedValue += (Math.random() - 0.5) * transientJitter * transientSpikeFactor;
        }
        
        const currentValue = this.smoothedBars[i];
        if (normalizedValue >= currentValue) {
            this.smoothedBars[i] = normalizedValue;
        } else {
            let finalDecay = baseDecay;
            if (driveMode === 'atmosphere') finalDecay = Math.min(0.995, baseDecay + 0.03); // Slower decay for atmosphere
            if (i < bars * 0.15) finalDecay = Math.min(0.99, baseDecay + 0.02);
            else if (i > bars * 0.7) finalDecay = Math.max(0.85, baseDecay - 0.08); // Faster decay for highs
            this.smoothedBars[i] = currentValue * finalDecay;
        }
        output[i] = Math.min(1, this.smoothedBars[i]); // Clamp final value to 1
        lastIndex = index;
    }
    return output;
  });

  fractalCircles = computed(() => {
    const bars = this.visualizerBars();
    const count = bars.length;
    const viewboxWidth = 640;
    const viewboxHeight = 160;
    const barWidth = viewboxWidth / count;
    const maxRadius = barWidth / 2 * 1.8;

    return bars.map((height, i) => ({
      id: `circle-${i}`,
      cx: i * barWidth + barWidth / 2,
      cy: viewboxHeight - Math.max(0.5, height * maxRadius),
      r: Math.max(0.5, height * maxRadius),
    }));
  });

  ledBars = computed(() => {
    const bars = this.visualizerBars();
    const segments = 16;
    return bars.map(barHeight => Math.floor(barHeight * segments));
  });

  neuralNetwork = computed(() => {
    const bars = this.visualizerBars();
    const rows = 5;
    const cols = 13;
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
      
      nodes.push({
        id: `node-${i}`,
        cx: col * xSpacing,
        cy: row * ySpacing,
        r: 2 + barHeight * 8,
        opacity: 0.4 + barHeight * 0.6
      });
    }

    const connections = [];
    for (let i = 0; i < nodeCount; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const barIndex = Math.min(bars.length - 1, Math.floor((i / nodeCount) * bars.length));
      const barHeight = bars[barIndex] || 0;

      if (col < cols - 1) { // Connect to right neighbor
        connections.push({ id: `conn-h-${i}`, x1: nodes[i].cx, y1: nodes[i].cy, x2: nodes[i + 1].cx, y2: nodes[i + 1].cy, opacity: 0.1 + barHeight * 0.4 });
      }
      if (row < rows - 1) { // Connect to bottom neighbor
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
    const bass = bars.slice(0, 8).reduce((sum, val) => sum + val, 0) / 8;
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

        return {
            id: `lane-${i}`, x: centerX - width / 2, y: centerY - height / 2,
            width: width, height: height,
            stroke: `hsl(${layer.hue}, 100%, ${brightness}%)`,
            opacity: perspective * 0.8
        };
    }).sort((a, b) => a.opacity - b.opacity);
  });
  
  // --- New Advanced Visualizers ---
  private auraRingsState: AuraRing[] = [];
  private auraParticlesState: AuraParticle[] = [];
  private nextAuraId = 0;
  
  auraBloom = computed(() => {
    const bars = this.visualizerBars();
    const bass = bars.slice(0, 4).reduce((s, v) => s + v, 0) / 4;
    const mids = bars.slice(4, 28).reduce((s, v) => s + v, 0) / 24;
    const driveMode = this.effectiveSynergyDriveMode();
    const transientInfo = this.transient();
    const beatInfo = this.beat();
    const maxRadius = 150;

    // Update rings
    this.auraRingsState = this.auraRingsState.map(r => ({ ...r, radius: r.radius + 1.2, opacity: r.opacity * 0.985 })).filter(r => r.opacity > 0.01);
    
    // Create new ring on strong mid hits or a strong beat
    let beatFired = false;
    if ((driveMode === 'rhythm' || driveMode === 'transient') && beatInfo.timestamp > this.lastBeatTimestamp) {
       this.auraRingsState.push({ id: this.nextAuraId++, radius: 20 + bass * 20, opacity: 0.6 + beatInfo.strength, thickness: 2 + mids * 4, hue: 180 + bass * 60 });
       beatFired = true;
    }
    if (!beatFired && mids > 0.6 && Math.random() > 0.7) {
        this.auraRingsState.push({ id: this.nextAuraId++, radius: 20 + bass * 20, opacity: 0.5 + mids * 0.5, thickness: 1 + mids * 3, hue: 180 + bass * 60 });
    }
    if (this.auraRingsState.length > 15) this.auraRingsState.shift();

    // Update particles
    this.auraParticlesState = this.auraParticlesState.map(p => ({...p, opacity: p.opacity * 0.96 })).filter(p => p.opacity > 0.01);

    // Create new particles on high frequency hits OR a sharp transient
    let transientFired = false;
    if (driveMode === 'transient' && transientInfo.timestamp > this.lastTransientTimestamp) {
        for (let i = 0; i < Math.floor(transientInfo.intensity * 25); i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 20 + Math.random() * maxRadius;
            this.auraParticlesState.push({ id: this.nextAuraId++, x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, opacity: 0.7 + Math.random() * 0.3, size: 0.8 + Math.random() * 1.8 });
        }
        transientFired = true;
    }
    const highs = bars.slice(28, 64).reduce((s, v) => s + v, 0) / 36;
    if (!transientFired && highs > 0.5) {
      for (let i = 0; i < Math.floor(highs * 5); i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 20 + Math.random() * maxRadius;
        this.auraParticlesState.push({ id: this.nextAuraId++, x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, opacity: 0.5 + Math.random() * 0.5, size: 0.5 + Math.random() * 1.5 });
      }
    }
    if (this.auraParticlesState.length > 150) this.auraParticlesState.splice(0, this.auraParticlesState.length - 150);

    return {
      coreSize: 15 + bass * 25,
      coreOpacity: 0.4 + bass * 0.6,
      rings: this.auraRingsState,
      particles: this.auraParticlesState
    };
  });

  rhythmicGlyphs = computed(() => {
    const bars = this.visualizerBars();
    const bass = bars.slice(0, 3).reduce((s, v) => s + v, 0) / 3;
    const lowMids = bars.slice(3, 10).reduce((s, v) => s + v, 0) / 7;
    const highMids = bars.slice(10, 32).reduce((s, v) => s + v, 0) / 22;
    const time = performance.now() / 1000;
    const driveMode = this.effectiveSynergyDriveMode();
    const transientInfo = this.transient();
    const beatInfo = this.beat();
    
    let beatScale = 1;
    if ((driveMode === 'rhythm' || driveMode === 'transient') && beatInfo.timestamp > this.lastBeatTimestamp) {
       beatScale = 1 + beatInfo.strength * 0.5;
    }

    let sparkleOpacity = 0;
    if (driveMode === 'transient' && transientInfo.timestamp > this.lastTransientTimestamp) {
      sparkleOpacity = transientInfo.intensity;
    }

    return {
      center: { scale: (1 + bass * 0.5) * beatScale, opacity: 0.5 + bass * 0.5 },
      innerRing: { rotation: time * 15, scale: (1 + lowMids * 0.2) * beatScale, opacity: 0.4 + lowMids * 0.6 },
      outerRing: { rotation: -time * 10, scale: (1 + highMids * 0.3) * beatScale, opacity: 0.3 + highMids * 0.7 },
      sparkle: { opacity: sparkleOpacity, scale: 1 + sparkleOpacity * 0.5 }
    };
  });

  liquifyParams = computed(() => {
    const bars = this.visualizerBars();
    const bass = bars.slice(0, 8).reduce((s, v) => s + v, 0) / 8;
    const mids = bars.slice(8, 40).reduce((s, v) => s + v, 0) / 32;

    return {
      turbulence: 0.005 + bass * 0.04,
      scale: 5 + mids * 25
    };
  });

  bandFrequencies = ['60', '170', '310', '600', '1k', '3k', '6k'];

  themes: EqualizerTheme[] = [
    { name: 'Mukyo', type: '3d', base: 'bg-gradient-to-br from-gray-900 via-black to-blue-900', display: 'bg-gray-900/70', bar: 'bg-gradient-to-t from-sky-500 to-cyan-200 shadow-[0_0_8px_#22d3ee,0_0_12px_#67e8f9]', sliderTrack: 'bg-gray-700', sliderThumb: 'bg-gray-300', text: 'text-gray-300', accent: 'text-cyan-400', button: 'bg-gray-700', buttonHover: 'hover:bg-gray-600', highlight: 'bg-gray-800' },
    { name: 'Muknics', type: '3d', base: 'bg-gradient-to-br from-stone-800 via-neutral-900 to-stone-900', display: 'bg-black/60 backdrop-blur-sm', bar: 'bg-gradient-to-t from-orange-600 via-amber-400 to-yellow-200 shadow-[0_0_7px_#f59e0b]', sliderTrack: 'bg-gray-600', sliderThumb: 'bg-amber-500', text: 'text-amber-100', accent: 'text-amber-400', button: 'bg-gray-700', buttonHover: 'hover:bg-gray-600', highlight: 'bg-gray-700/50' },
    { name: 'Pioneer', type: 'shadow', base: 'bg-slate-200', display: 'bg-blue-900/80', bar: 'bg-gradient-to-t from-sky-600 to-sky-400 shadow-[0_0_8px_#38bdf8,-2px_0_5px_rgba(0,0,0,0.4)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-white', text: 'text-gray-800', accent: 'text-blue-600', button: 'bg-gray-400', buttonHover: 'hover:bg-gray-500', highlight: 'bg-slate-300' },
    { name: 'Glass Box', type: 'glass-box', base: 'bg-gray-900', display: 'bg-black/50', bar: 'bg-gradient-to-t from-purple-500 to-cyan-300 text-cyan-300', sliderTrack: 'bg-purple-800/60', sliderThumb: 'bg-cyan-300', text: 'text-purple-200', accent: 'text-cyan-300', button: 'bg-purple-900/70', buttonHover: 'hover:bg-purple-800/70', highlight: 'bg-cyan-500/50' },
    { name: 'Aura Bloom', type: 'aura', base: 'bg-black', display: 'bg-black/50', bar: '', sliderTrack: 'bg-indigo-800/50', sliderThumb: 'bg-violet-400', text: 'text-violet-300', accent: 'text-sky-300', button: 'bg-indigo-900/70', buttonHover: 'hover:bg-indigo-800/70', highlight: 'bg-sky-500/50' },
    { name: 'Rhythmic Glyphs', type: 'glyphs', base: 'bg-slate-900', display: 'bg-black/60', bar: '', sliderTrack: 'bg-teal-800/50', sliderThumb: 'bg-emerald-400', text: 'text-teal-200', accent: 'text-emerald-300', button: 'bg-teal-900/60', buttonHover: 'hover:bg-teal-800/60', highlight: 'bg-emerald-500/50' },
    { name: 'Liquify', type: 'liquid', base: 'bg-gray-800', display: 'bg-black/70', bar: '', sliderTrack: 'bg-slate-600', sliderThumb: 'bg-white', text: 'text-slate-200', accent: 'text-cyan-300', button: 'bg-slate-700', buttonHover: 'hover:bg-slate-600', highlight: 'bg-cyan-500/50' },
    { name: 'Mekyo', type: 'shadow', // Switched to shadow for depth
    base: 'bg-zinc-950', display: 'bg-zinc-900/80 backdrop-blur-sm border border-zinc-800', // Effect: Cyberpunk Neon. Starts dark cyan, goes to white hot at top, with a heavy cyan glow.
    bar: 'bg-gradient-to-t from-cyan-900 via-cyan-500 to-white shadow-[0_0_15px_rgba(34,211,238,0.6)] rounded-t-sm', 
    sliderTrack: 'bg-zinc-800', 
    sliderThumb: 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]', 
    text: 'text-zinc-300', 
    accent: 'text-cyan-400', 
    button: 'bg-zinc-800 border border-zinc-700', 
    buttonHover: 'hover:bg-zinc-700 hover:shadow-[0_0_10px_rgba(34,211,238,0.2)]', 
    highlight: 'bg-zinc-800' 
  },

  { 
    name: 'Meknics', 
    type: 'shadow', 
    base: 'bg-[#1c1917]', // Very dark warm grey
    display: 'bg-black/60 border-t border-orange-900/30', 
    // Effect: Molten Gold. Inner shadow gives it volume (like a glass tube), outer shadow is a warm haze.
    bar: 'bg-gradient-to-t from-orange-900 via-amber-500 to-yellow-100 shadow-[inset_2px_0_4px_rgba(0,0,0,0.6),0_0_12px_rgba(245,158,11,0.4)] rounded-t-sm', 
    sliderTrack: 'bg-stone-800', 
    sliderThumb: 'bg-amber-500 border-2 border-orange-900', 
    text: 'text-stone-300', 
    accent: 'text-amber-400', 
    button: 'bg-stone-800', 
    buttonHover: 'hover:bg-stone-700 hover:text-amber-300', 
    highlight: 'bg-stone-700/50' 
  },

  { 
    name: 'Cosmic Rift 2.0', 
    type: 'shadow', 
    base: 'bg-[#0f0720]', // Deepest violet
    display: 'bg-indigo-950/40 backdrop-blur-md', 
    // Effect: Laser Beam. Intense purple glow with a white core.
    bar: 'bg-gradient-to-t from-indigo-900 via-fuchsia-500 to-white shadow-[0_0_20px_rgba(192,38,211,0.7),inset_0_0_2px_rgba(255,255,255,0.5)] rounded-t-sm', 
    sliderTrack: 'bg-indigo-900/50', 
    sliderThumb: 'bg-fuchsia-400 shadow-[0_0_10px_#e879f9]', 
    text: 'text-indigo-200', 
    accent: 'text-fuchsia-300', 
    button: 'bg-indigo-900/80 border border-indigo-700', 
    buttonHover: 'hover:bg-fuchsia-900/50 hover:border-fuchsia-500', 
    highlight: 'bg-fuchsia-500/20' 
  },  
    { name: 'Pioneer', type: 'shadow', base: 'bg-slate-200', display: 'bg-blue-900/80', bar: 'bg-gradient-to-t from-sky-600 to-sky-400 shadow-[-2px_0_5px_rgba(0,0,0,0.4)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-white', text: 'text-gray-800', accent: 'text-blue-600', button: 'bg-gray-400', buttonHover: 'hover:bg-gray-500', highlight: 'bg-slate-300' },
    { name: 'Glass Box', type: 'glass-box', base: 'bg-gray-900', display: 'bg-black/50', bar: 'bg-gradient-to-t from-purple-500 to-cyan-300', sliderTrack: 'bg-purple-800/60', sliderThumb: 'bg-cyan-300', text: 'text-purple-200', accent: 'text-cyan-300', button: 'bg-purple-900/70', buttonHover: 'hover:bg-purple-800/70', highlight: 'bg-cyan-500/50' },
    { name: 'Pioneer Convex', type: 'convex', base: 'bg-slate-200', display: 'bg-blue-900/80', bar: 'bg-gradient-to-t from-sky-600 to-sky-400 rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-white', text: 'text-gray-800', accent: 'text-blue-600', button: 'bg-gray-400', buttonHover: 'hover:bg-gray-500', highlight: 'bg-slate-300' },
    { name: 'Marantz', type: 'shadow', base: 'bg-amber-100', display: 'bg-black/80', bar: 'bg-gradient-to-t from-blue-700 to-blue-500 shadow-[-3px_0_5px_rgba(0,0,0,0.4)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-gray-700', text: 'text-gray-800', accent: 'text-blue-700', button: 'bg-gray-300', buttonHover: 'hover:bg-gray-400', highlight: 'bg-amber-200' },    
    { name: 'Marantz-variant1', type: 'shadow', base: 'bg-amber-100', display: 'bg-black/90', bar: 'bg-gradient-to-t from-blue-700 to-blue-500 shadow-[-2px_0_2px_rgba(0,0,0,0.6),-8px_0_20px_rgba(0,0,0,0.3)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-gray-700', text: 'text-gray-800', accent: 'text-blue-700', button: 'bg-gray-300', buttonHover: 'hover:bg-gray-400', highlight: 'bg-amber-200' },
    { name: 'Marantz-variant2', type: 'shadow', base: 'bg-amber-100', display: 'bg-black/3k', bar: 'bg-gradient-to-t from-blue-700 to-blue-500 shadow-[-4px_0_1px_rgba(0,0,0,0.5),-6px_0_10px_rgba(0,0,0,0.3)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-gray-700', text: 'text-gray-800', accent: 'text-blue-700', button: 'bg-gray-300', buttonHover: 'hover:bg-gray-400', highlight: 'bg-amber-200' },
    { name: 'Marantz Concave', type: 'concave', base: 'bg-amber-100', display: 'bg-black/80', bar: 'bg-gradient-to-t from-blue-700 to-blue-500 rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-gray-700', text: 'text-gray-800', accent: 'text-blue-700', button: 'bg-gray-300', buttonHover: 'hover:bg-gray-400', highlight: 'bg-amber-200' },
    { name: 'Marantz-concave-variant1', type: 'shadow', base: 'bg-amber-300', display: 'bg-black/3d', bar: 'bg-gradient-to-t from-blue-700 to-blue-500 shadow-[-2px_0_2px_rgba(0,0,0,0.6),-8px_0_20px_rgba(0,0,0,0.3)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-gray-700', text: 'text-gray-800', accent: 'text-blue-700', button: 'bg-gray-300', buttonHover: 'hover:bg-gray-400', highlight: 'bg-amber-200' },
    { name: 'Marantz-concave-variant2', type: 'shadow', base: 'bg-amber-400', display: 'bg-black/3d', bar: 'bg-gradient-to-t from-lime-300 to-purple-300 shadow-[-4px_0_1px_rgba(0,0,0,0.5),-6px_0_10px_rgba(0,0,0,0.3)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-gray-700', text: 'text-gray-800', accent: 'text-blue-700', button: 'bg-gray-300', buttonHover: 'hover:bg-gray-400', highlight: 'bg-amber-300' },
    { name: 'Marantz-concave-variant3', type: 'concave', base: 'bg-amber-400', display: 'bg-black/70', bar: 'bg-gradient-to-t from-rose-300 to-gray-300 shadow-[inset_-1px_0_2px_rgba(255,255,255,0.4),-5px_0_10px_rgba(0,0,0,0.5)], rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-gray-700', text: 'text-gray-800', accent: 'text-blue-700', button: 'bg-gray-300', buttonHover: 'hover:bg-gray-400', highlight: 'bg-amber-300' },
    { name: 'Mintosh', type: '3d', base: 'bg-gray-900', display: 'bg-black/90', bar: 'bg-gradient-to-t from-sky-600 to-sky-300 shadow-[0_0_5px_#38bdf8]', sliderTrack: 'bg-gray-600', sliderThumb: 'bg-green-500', text: 'text-green-400', accent: 'text-sky-400', button: 'bg-gray-800 border border-gray-600', buttonHover: 'hover:bg-gray-700', highlight: 'bg-gray-700/50' },
    { name: 'Cyberpunk', type: 'shadow', base: 'bg-black', display: 'bg-black/80', bar: 'bar-neon-glow bg-cyan-400', sliderTrack: 'bg-gray-800', sliderThumb: 'bg-fuchsia-500', text: 'text-fuchsia-400 font-mono', accent: 'text-cyan-300', button: 'bg-gray-900 border border-fuchsia-700', buttonHover: 'hover:bg-gray-800', highlight: 'bg-fuchsia-600/50' },
    { name: 'Aqua Gloss', type: 'glossy', base: 'bg-gray-800', display: 'bg-black/50', bar: 'bg-gradient-to-t from-teal-500 to-cyan-400 shadow-[0_0_8px_#67e8f9]', sliderTrack: 'bg-gray-600', sliderThumb: 'bg-cyan-300', text: 'text-gray-200', accent: 'text-cyan-300', button: 'bg-gray-700', buttonHover: 'hover:bg-gray-600', highlight: 'bg-cyan-600/50' },
    { name: 'Liquid Sky', type: 'glass', base: 'bg-gradient-to-b from-slate-900 to-sky-900', display: 'bg-black/20', bar: 'rounded-t-md', sliderTrack: 'bg-sky-800/50', sliderThumb: 'bg-slate-300', text: 'text-slate-200', accent: 'text-sky-300', button: 'bg-sky-900/50', buttonHover: 'hover:bg-sky-800/50', highlight: 'bg-sky-700/50' },
    { name: 'Matrix', type: 'shadow', base: 'bg-black', display: 'bg-black/80', bar: 'bg-gradient-to-t from-emerald-700 to-green-400 shadow-[0_0_10px_#4ade80,-1px_0_4px_rgba(0,0,0,0.7)]', sliderTrack: 'bg-gray-800', sliderThumb: 'bg-green-500', text: 'text-green-400 font-mono', accent: 'text-green-300', button: 'bg-gray-900 border border-green-700', buttonHover: 'hover:bg-gray-800', highlight: 'bg-green-600/50' },
    { name: 'Molten Core', type: 'glossy', base: 'bg-stone-900', display: 'bg-black/60', bar: 'bg-gradient-to-t from-red-700 via-orange-500 to-yellow-400 shadow-[0_0_8px_#fb923c]', sliderTrack: 'bg-red-900/50', sliderThumb: 'bg-amber-400', text: 'text-amber-300', accent: 'text-orange-400', button: 'bg-orange-800/50', buttonHover: 'hover:bg-orange-700/50', highlight: 'bg-yellow-500/50' },
    { name: 'Ocean Floor', type: 'glass', base: 'bg-gradient-to-t from-blue-900 to-teal-900', display: 'bg-black/30', bar: 'rounded-t-md', sliderTrack: 'bg-cyan-800/50', sliderThumb: 'bg-teal-300', text: 'text-cyan-200', accent: 'text-teal-300', button: 'bg-cyan-900/60', buttonHover: 'hover:bg-cyan-800/60', highlight: 'bg-teal-600/50' },
    { name: 'Aquamarine Dream', type: 'glossy', base: 'bg-gradient-to-br from-green-900 via-cyan-800 to-teal-900', display: 'bg-black/30', bar: 'bg-gradient-to-t from-emerald-400 to-cyan-200 shadow-[0_0_8px_#67e8f9]', sliderTrack: 'bg-teal-800/60', sliderThumb: 'bg-emerald-300', text: 'text-cyan-200', accent: 'text-emerald-300', button: 'bg-cyan-900/60', buttonHover: 'hover:bg-cyan-800/60', highlight: 'bg-emerald-600/50' },
    { name: 'Gold Standard', type: 'convex', base: 'bg-gray-900', display: 'bg-black/60', bar: 'bg-gradient-to-t from-yellow-700 via-amber-400 to-yellow-100 shadow-[0_0_8px_#facc15] rounded-t-sm', sliderTrack: 'bg-yellow-800/50', sliderThumb: 'bg-amber-300', text: 'text-amber-200', accent: 'text-yellow-400', button: 'bg-yellow-900/60', buttonHover: 'hover:bg-yellow-800/60', highlight: 'bg-amber-500/50' },
    { name: 'Art Deco', type: '3d', base: 'bg-black', display: 'bg-gray-900/50', bar: 'art-deco-bar', sliderTrack: 'bg-gray-700', sliderThumb: 'bg-amber-400', text: 'text-amber-200', accent: 'text-amber-400', button: 'bg-neutral-800', buttonHover: 'hover:bg-neutral-700', highlight: 'bg-amber-500/50' },
    { name: 'Woodgrain', type: 'convex', base: 'woodgrain-bg', display: 'bg-black/40', bar: 'bg-gradient-to-t from-amber-800 to-amber-600 rounded-t-sm', sliderTrack: 'bg-amber-900/70', sliderThumb: 'bg-amber-300', text: 'text-amber-200', accent: 'text-amber-300', button: 'bg-amber-950/50', buttonHover: 'hover:bg-amber-950/70', highlight: 'bg-amber-800/50' },
    { name: 'Platinum Sheen', type: 'convex', base: 'bg-slate-800', display: 'bg-black/50', bar: 'bg-gradient-to-t from-slate-400 via-gray-200 to-white shadow-[0_0_8px_#e2e8f0] rounded-t-sm', sliderTrack: 'bg-slate-600', sliderThumb: 'bg-white', text: 'text-slate-200', accent: 'text-cyan-300', button: 'bg-slate-700', buttonHover: 'hover:bg-slate-600', highlight: 'bg-cyan-500/50' },
    { name: 'Polished Silver', type: 'glossy', base: 'bg-gray-700', display: 'bg-black/50', bar: 'bg-gradient-to-t from-gray-600 via-slate-300 to-gray-400 shadow-[0_0_8px_#cbd5e1]', sliderTrack: 'bg-gray-500', sliderThumb: 'bg-slate-200', text: 'text-gray-200', accent: 'text-sky-300', button: 'bg-gray-600', buttonHover: 'hover:bg-gray-500', highlight: 'bg-sky-600/50' },
    { name: 'Classic LED', type: 'led', base: 'bg-gray-900', display: 'bg-black', bar: 'bg-gray-700', sliderTrack: 'bg-gray-600', sliderThumb: 'bg-gray-400', text: 'text-gray-300', accent: 'text-green-400', button: 'bg-gray-700', buttonHover: 'hover:bg-gray-600', highlight: 'bg-green-600/50' },
    { name: '2030: Neural Network', type: 'neural', base: 'bg-black', display: 'bg-black/80', bar: '', sliderTrack: 'bg-gray-800', sliderThumb: 'bg-cyan-400', text: 'text-cyan-300 font-mono', accent: 'text-lime-300', button: 'bg-gray-900 border border-cyan-700', buttonHover: 'hover:bg-gray-800', highlight: 'bg-cyan-600/50' },
    { name: '2040: Energy Field', type: 'plasma', base: 'bg-gradient-to-br from-indigo-900 to-black', display: 'bg-black/50', bar: '', sliderTrack: 'bg-purple-800/50', sliderThumb: 'bg-fuchsia-500', text: 'text-purple-300', accent: 'text-fuchsia-400', button: 'bg-purple-900/70', buttonHover: 'hover:bg-purple-800/70', highlight: 'bg-fuchsia-500/50' },
    { name: '2050: Hyperlane', type: 'hyperlane', base: 'bg-black', display: 'bg-black/90', bar: '', sliderTrack: 'bg-blue-800/50', sliderThumb: 'bg-white', text: 'text-blue-200', accent: 'text-white', button: 'bg-blue-900/70', buttonHover: 'hover:bg-blue-800/70', highlight: 'bg-blue-500/50' },
  ];
  selectedTheme: WritableSignal<EqualizerTheme> = signal(this.themes[0]);
  effectiveTheme = computed(() => this.activeHoliday()?.theme ?? this.selectedTheme());
  selectedThemeIndex = computed(() => this.themes.findIndex(t => t.name === this.selectedTheme().name));
  
  onFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      this.audioService.loadFiles(input.files);
    }
  }

  onBgImageChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const oldUrl = this.backgroundImageUrl();
      if (oldUrl && oldUrl.startsWith('blob:')) URL.revokeObjectURL(oldUrl);
      this.backgroundImageUrl.set(URL.createObjectURL(input.files[0]));
    }
  }

  onPlayPauseClick(): void {
    if (!this.isPlaying() && this.currentTrack() && window.innerWidth < 1024) {
        setTimeout(() => document.getElementById('visualizer-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    }
    this.audioService.togglePlay();
  }

  onGainChange(event: Event, index: number) { this.audioService.changeGain(index, parseFloat((event.target as HTMLInputElement).value)); }
  onSeek(event: Event) { this.audioService.seek(parseFloat((event.target as HTMLInputElement).value)); }
  onSensitivityChange(event: Event) { this.sensitivity.set(parseFloat((event.target as HTMLInputElement).value)); }
  setLightSource(position: LightSourcePosition) { this.lightSourcePosition.set(position); }
  toggleFullscreenControls() { this.fullscreenControlsActive.update(v => !v); }
  selectTheme(index: string) { const i = parseInt(index, 10); if (!isNaN(i) && i < this.themes.length) this.selectedTheme.set(this.themes[i]); }
  toggleAutoSwitch() { this.isAutoSwitching.update(v => !v); }
  setSwitchInterval(event: Event) { this.switchInterval.set(parseInt((event.target as HTMLSelectElement).value, 10)); }
  setSwitchMode(mode: 'sequential' | 'random') { this.switchMode.set(mode); }
  toggleHolidayTheme(event: Event) { this.holidayService.setHolidayThemeEnabled((event.target as HTMLInputElement).checked); }
  setSynergyDriveMode(mode: SynergyDriveSetting) { this.synergyDriveMode.set(mode); }

  private startAutoSwitching(): void {
    this.stopAutoSwitching();
    this.themeSwitchIntervalId = setInterval(() => this.selectNextTheme(), this.switchInterval());
  }

  private stopAutoSwitching(): void {
    if (this.themeSwitchIntervalId) {
      clearInterval(this.themeSwitchIntervalId);
      this.themeSwitchIntervalId = null;
    }
  }

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

  incrementLedWidth() { this.ledSegmentWidth.update(w => Math.min(24, w + 1)); }
  decrementLedWidth() { this.ledSegmentWidth.update(w => Math.max(2, w - 1)); }
  incrementLedHeight() { this.ledSegmentHeight.update(h => Math.min(16, h + 1)); }
  decrementLedHeight() { this.ledSegmentHeight.update(h => Math.max(1, h - 1)); }
  toggleKaleidoscope() { this.isKaleidoscope.update(k => !k); }
  
  toggleStyleFusion() {
    this.isStyleFusionOn.update(f => {
      const isNowOn = !f;
      if (isNowOn) {
        // If turning fusion ON, make sure auto-switch is OFF.
        this.isAutoSwitching.set(false);
      }
      return isNowOn;
    });
  }

  setFusionInterval(event: Event) { this.fusionInterval.set(parseInt((event.target as HTMLSelectElement).value, 10)); }

  private startKaleidoscope() {
    this.stopKaleidoscope();
    const animate = () => {
      this.kaleidoscopeHueShift.update(h => (h + 0.5) % 360);
      this.kaleidoscopeAnimFrameId = requestAnimationFrame(animate);
    };
    animate();
  }

  private stopKaleidoscope() {
    if (this.kaleidoscopeAnimFrameId !== null) {
      cancelAnimationFrame(this.kaleidoscopeAnimFrameId);
      this.kaleidoscopeAnimFrameId = null;
    }
  }

  private startStyleFusion() {
    this.stopStyleFusion();
    this.fusionIntervalId = setInterval(() => {
        this.selectNextTheme();
    }, this.fusionInterval());
  }

  private stopStyleFusion() {
    if (this.fusionIntervalId) {
        clearInterval(this.fusionIntervalId);
        this.fusionIntervalId = null;
    }
  }

  // --- New Feature Methods ---
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

  // --- Playlist Drag & Drop Methods ---
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
    if (currentIdx === startIndex) {
      this.currentTrackIndex.set(dropIndex);
    } else if (currentIdx !== null && startIndex < currentIdx && dropIndex >= currentIdx) {
      this.currentTrackIndex.update(i => i! - 1);
    } else if (currentIdx !== null && startIndex > currentIdx && dropIndex <= currentIdx) {
      this.currentTrackIndex.update(i => i! + 1);
    }
    this.draggedTrackIndex.set(null);
  }
  onDragEnd() { this.draggedTrackIndex.set(null); }
}
