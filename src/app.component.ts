import { Component, ChangeDetectionStrategy, inject, signal, computed, WritableSignal, OnInit, OnDestroy, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AudioService } from './services/audio.service';
import { HolidayService } from './services/holiday.service';
import { PresetService, Preset } from './services/preset.service';
import { EqualizerTheme } from './models/equalizer-theme.model';
import { FullscreenToggleComponent } from './fullscreen-toggle/fullscreen-toggle.component';

type LightSourcePosition = 'none' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center-stage' | 'top-center';

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

  sensitivity = signal(1.2);
  responseCurve = signal<'linear' | 'polynomial' | 'fractal'>('polynomial');
  backgroundImageUrl = signal<string | null>(null);
  private smoothedBars = new Array(64).fill(0);
  
  decayFactor = signal(0.94); // Base decay factor for visualizer bars
  private readonly resizeListener = () => this.updateDecayFactor();

  // --- Ticker Properties ---
  tickerMessages: string[] = [
    'Welcome to the Audio Oasis Equalizer...',
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
  ledSegmentWidth = signal(8);
  ledSegmentHeight = signal(4);
  isKaleidoscope = signal(false);
  kaleidoscopeHueShift = signal(0);
  private kaleidoscopeAnimFrameId: number | null = null;

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
  }

  ngOnInit(): void {
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

  visualizerBars = computed(() => {
    const data = this.audioService.frequencyData();
    const sensitivityValue = this.sensitivity();
    const responseCurveType = this.responseCurve();
    const baseDecay = this.decayFactor();
    const bars = 64;
    const output = new Array(bars);
    const logLength = Math.log(data.length);
    let lastIndex = 0;

    for (let i = 0; i < bars; i++) {
        let index = Math.floor(Math.exp(((i + 1) / bars) * logLength));
        if (index <= lastIndex) index = lastIndex + 1;
        index = Math.min(index, data.length);
        const slice = data.slice(lastIndex, index);
        let normalizedValue = slice.length > 0 ? (Math.max(...slice) / 255) * sensitivityValue : 0;
        normalizedValue = Math.max(0, Math.min(1, normalizedValue));

        if (responseCurveType === 'polynomial') {
            normalizedValue = Math.pow(normalizedValue, 2);
        } else if (responseCurveType === 'fractal') {
            const modulation = 0.7 + 0.3 * Math.abs(Math.sin((i / bars) * Math.PI * 4));
            normalizedValue = Math.pow(normalizedValue, 1.2) * modulation;
        }
        
        const currentValue = this.smoothedBars[i];
        if (normalizedValue >= currentValue) {
            this.smoothedBars[i] = normalizedValue;
        } else {
            let finalDecay = baseDecay;
            if (i < bars * 0.15) finalDecay = Math.min(0.99, baseDecay + 0.02);
            else if (i > bars * 0.7) finalDecay = Math.max(0.85, baseDecay - 0.08);
            this.smoothedBars[i] = currentValue * finalDecay;
        }
        output[i] = this.smoothedBars[i];
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

  bandFrequencies = ['60', '170', '310', '600', '1k', '3k', '6k'];

  themes: EqualizerTheme[] = [
    { name: 'Mukyo', type: '3d', base: 'bg-black', display: 'bg-gray-900/70', bar: 'bg-gradient-to-t from-cyan-600 to-cyan-300 shadow-[0_0_4px_#22d3ee]', sliderTrack: 'bg-gray-700', sliderThumb: 'bg-gray-300', text: 'text-gray-300', accent: 'text-cyan-400', button: 'bg-gray-700', buttonHover: 'hover:bg-gray-600', highlight: 'bg-gray-800' },
    { name: 'Muknics', type: '3d', base: 'bg-gray-800', display: 'bg-black/50', bar: 'bg-gradient-to-t from-amber-600 to-amber-400 shadow-[0_0_4px_#f59e0b]', sliderTrack: 'bg-gray-600', sliderThumb: 'bg-amber-500', text: 'text-amber-100', accent: 'text-amber-400', button: 'bg-gray-700', buttonHover: 'hover:bg-gray-600', highlight: 'bg-gray-700/50' },
    { name: 'Pioneer', type: 'shadow', base: 'bg-slate-200', display: 'bg-blue-900/80', bar: 'bg-gradient-to-t from-sky-600 to-sky-400 shadow-[-2px_0_5px_rgba(0,0,0,0.4)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-white', text: 'text-gray-800', accent: 'text-blue-600', button: 'bg-gray-400', buttonHover: 'hover:bg-gray-500', highlight: 'bg-slate-300' },
    { name: 'Glass Box', type: 'glass-box', base: 'bg-gray-900', display: 'bg-black/50', bar: 'bg-gradient-to-t from-purple-500 to-cyan-300', sliderTrack: 'bg-purple-800/60', sliderThumb: 'bg-cyan-300', text: 'text-purple-200', accent: 'text-cyan-300', button: 'bg-purple-900/70', buttonHover: 'hover:bg-purple-800/70', highlight: 'bg-cyan-500/50' },
    { name: 'Pioneer Convex', type: 'convex', base: 'bg-slate-200', display: 'bg-blue-900/80', bar: 'bg-gradient-to-t from-sky-600 to-sky-400 rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-white', text: 'text-gray-800', accent: 'text-blue-600', button: 'bg-gray-400', buttonHover: 'hover:bg-gray-500', highlight: 'bg-slate-300' },
    { name: 'Marantz', type: 'shadow', base: 'bg-amber-100', display: 'bg-black/80', bar: 'bg-gradient-to-t from-blue-700 to-blue-500 shadow-[-3px_0_5px_rgba(0,0,0,0.4)] rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-gray-700', text: 'text-gray-800', accent: 'text-blue-700', button: 'bg-gray-300', buttonHover: 'hover:bg-gray-400', highlight: 'bg-amber-200' },
    { name: 'Marantz Concave', type: 'concave', base: 'bg-amber-100', display: 'bg-black/80', bar: 'bg-gradient-to-t from-blue-700 to-blue-500 rounded-t-sm', sliderTrack: 'bg-gray-400', sliderThumb: 'bg-gray-700', text: 'text-gray-800', accent: 'text-blue-700', button: 'bg-gray-300', buttonHover: 'hover:bg-gray-400', highlight: 'bg-amber-200' },
    { name: 'Muntosh', type: '3d', base: 'bg-gray-900', display: 'bg-black/90', bar: 'bg-gradient-to-t from-sky-600 to-sky-300 shadow-[0_0_5px_#38bdf8]', sliderTrack: 'bg-gray-600', sliderThumb: 'bg-green-500', text: 'text-green-400', accent: 'text-sky-400', button: 'bg-gray-800 border border-gray-600', buttonHover: 'hover:bg-gray-700', highlight: 'bg-gray-700/50' },
    { name: 'Cyberpunk', type: 'shadow', base: 'bg-black', display: 'bg-black/80', bar: 'bar-neon-glow bg-cyan-400', sliderTrack: 'bg-gray-800', sliderThumb: 'bg-fuchsia-500', text: 'text-fuchsia-400 font-mono', accent: 'text-cyan-300', button: 'bg-gray-900 border border-fuchsia-700', buttonHover: 'hover:bg-gray-800', highlight: 'bg-fuchsia-600/50' },
    { name: 'Aqua Gloss', type: 'glossy', base: 'bg-gray-800', display: 'bg-black/50', bar: 'bg-gradient-to-t from-teal-500 to-cyan-400', sliderTrack: 'bg-gray-600', sliderThumb: 'bg-cyan-300', text: 'text-gray-200', accent: 'text-cyan-300', button: 'bg-gray-700', buttonHover: 'hover:bg-gray-600', highlight: 'bg-cyan-600/50' },
    { name: 'Liquid Sky', type: 'glass', base: 'bg-gradient-to-b from-slate-900 to-sky-900', display: 'bg-black/20', bar: 'rounded-t-md', sliderTrack: 'bg-sky-800/50', sliderThumb: 'bg-slate-300', text: 'text-slate-200', accent: 'text-sky-300', button: 'bg-sky-900/50', buttonHover: 'hover:bg-sky-800/50', highlight: 'bg-sky-700/50' },
    { name: 'Matrix', type: 'shadow', base: 'bg-black', display: 'bg-black/80', bar: 'bg-gradient-to-t from-emerald-700 to-green-400 shadow-[-1px_0_4px_rgba(0,0,0,0.7)]', sliderTrack: 'bg-gray-800', sliderThumb: 'bg-green-500', text: 'text-green-400 font-mono', accent: 'text-green-300', button: 'bg-gray-900 border border-green-700', buttonHover: 'hover:bg-gray-800', highlight: 'bg-green-600/50' },
    { name: 'Cosmic Rift', type: '3d', base: 'bg-gradient-to-br from-indigo-900 via-purple-900 to-black', display: 'bg-black/40', bar: 'bg-gradient-to-t from-fuchsia-600 to-cyan-400 shadow-[0_0_6px_#a855f7]', sliderTrack: 'bg-purple-800/50', sliderThumb: 'bg-fuchsia-500', text: 'text-purple-300', accent: 'text-cyan-300', button: 'bg-purple-900/70', buttonHover: 'hover:bg-purple-800/70', highlight: 'bg-fuchsia-500/50' },
    { name: 'Celestial Sphere', type: 'fractal', base: 'bg-gradient-to-br from-gray-900 via-blue-900 to-black', display: 'bg-black/40', bar: '', sliderTrack: 'bg-blue-800/50', sliderThumb: 'bg-sky-500', text: 'text-sky-300', accent: 'text-cyan-300', button: 'bg-blue-900/70', buttonHover: 'hover:bg-blue-800/70', highlight: 'bg-sky-500/50' },
    { name: 'Molten Core', type: 'glossy', base: 'bg-stone-900', display: 'bg-black/60', bar: 'bg-gradient-to-t from-red-700 via-orange-500 to-yellow-400', sliderTrack: 'bg-red-900/50', sliderThumb: 'bg-amber-400', text: 'text-amber-300', accent: 'text-orange-400', button: 'bg-orange-800/50', buttonHover: 'hover:bg-orange-700/50', highlight: 'bg-yellow-500/50' },
    { name: 'Ocean Floor', type: 'glass', base: 'bg-gradient-to-t from-blue-900 to-teal-900', display: 'bg-black/30', bar: 'rounded-t-md', sliderTrack: 'bg-cyan-800/50', sliderThumb: 'bg-teal-300', text: 'text-cyan-200', accent: 'text-teal-300', button: 'bg-cyan-900/60', buttonHover: 'hover:bg-cyan-800/60', highlight: 'bg-teal-600/50' },
    { name: 'Gold Standard', type: 'convex', base: 'bg-gray-900', display: 'bg-black/60', bar: 'bg-gradient-to-t from-yellow-700 via-amber-400 to-yellow-100 rounded-t-sm', sliderTrack: 'bg-yellow-800/50', sliderThumb: 'bg-amber-300', text: 'text-amber-200', accent: 'text-yellow-400', button: 'bg-yellow-900/60', buttonHover: 'hover:bg-yellow-800/60', highlight: 'bg-amber-500/50' },
    { name: 'Platinum Sheen', type: 'convex', base: 'bg-slate-800', display: 'bg-black/50', bar: 'bg-gradient-to-t from-slate-400 via-gray-200 to-white rounded-t-sm', sliderTrack: 'bg-slate-600', sliderThumb: 'bg-white', text: 'text-slate-200', accent: 'text-cyan-300', button: 'bg-slate-700', buttonHover: 'hover:bg-slate-600', highlight: 'bg-cyan-500/50' },
    { name: 'Polished Silver', type: 'glossy', base: 'bg-gray-700', display: 'bg-black/50', bar: 'bg-gradient-to-t from-gray-600 via-slate-300 to-gray-400', sliderTrack: 'bg-gray-500', sliderThumb: 'bg-slate-200', text: 'text-gray-200', accent: 'text-sky-300', button: 'bg-gray-600', buttonHover: 'hover:bg-gray-500', highlight: 'bg-sky-600/50' },
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
  setResponseCurve(curve: 'linear' | 'polynomial' | 'fractal') { this.responseCurve.set(curve); }
  setLightSource(position: LightSourcePosition) { this.lightSourcePosition.set(position); }
  toggleFullscreenControls() { this.fullscreenControlsActive.update(v => !v); }
  selectTheme(index: string) { const i = parseInt(index, 10); if (!isNaN(i) && i < this.themes.length) this.selectedTheme.set(this.themes[i]); }
  toggleAutoSwitch() { this.isAutoSwitching.update(v => !v); }
  setSwitchInterval(event: Event) { this.switchInterval.set(parseInt((event.target as HTMLSelectElement).value, 10)); }
  setSwitchMode(mode: 'sequential' | 'random') { this.switchMode.set(mode); }
  toggleHolidayTheme(event: Event) { this.holidayService.setHolidayThemeEnabled((event.target as HTMLInputElement).checked); }

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
