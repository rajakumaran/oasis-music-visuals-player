import { Injectable, signal, inject } from '@angular/core';
import { AudioService } from './audio.service';

export interface Preset {
  name: string;
  gains: number[];
}

const STORAGE_KEY = 'audio-oasis-presets';

@Injectable({ providedIn: 'root' })
export class PresetService {
  private audioService = inject(AudioService);
  presets = signal<Preset[]>([]);

  // Gains map to 10-band EQ: [32Hz, 64Hz, 125Hz, 250Hz, 500Hz, 1kHz, 2kHz, 4kHz, 8kHz, 16kHz]
  private defaultPresets: Preset[] = [
    { name: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { name: 'Rock', gains: [5, 4, 3, -1, -2, 0, 2, 4, 5, 6] },
    { name: 'Pop', gains: [-1, 0, 2, 4, 3, 1, 0, -1, -1, -2] },
    { name: 'Bass Boost', gains: [8, 7, 5, 2, 0, -1, -1, 0, 0, 0] },
    { name: 'Vocal Boost', gains: [-3, -2, 0, 2, 4, 4, 3, 1, 0, 0] },
    { name: 'Clarity', gains: [-4, -3, -2, 0, 1, 2, 3, 5, 6, 7] },
    // Brand-inspired presets
    { name: 'B-Signature (Warm)', gains: [6, 5, 4, 1, -1, 0, 1, 2, 3, 4] },
    { name: 'S-Deep (Punchy)', gains: [8, 7, 5, -1, -2, 0, 1, 3, 4, 5] },
    { name: 'J-Power (V-Shape)', gains: [7, 5, 3, -2, -4, -3, 0, 3, 5, 7] },
    { name: 'O-Pure (Hi-Fi)', gains: [1, 1, 0, 0, 0, 0, 1, 1, 2, 3] },
    { name: 'A-Balanced (Studio)', gains: [0, 0, 1, 2, 1, 0, 0, 1, 1, 2] },
    { name: 'Sen-Pro (Reference)', gains: [-1, 0, 0, 1, 2, 3, 2, 1, 0, -1] },
  ];

  constructor() {
    this.loadPresets();
  }

  private loadPresets(): void {
    try {
      const storedPresets = localStorage.getItem(STORAGE_KEY);
      if (storedPresets) {
        const parsed: Preset[] = JSON.parse(storedPresets);
        const bandCount = this.audioService.gainValues().length;
        // Migrate any stale preset that doesn't have the right number of bands
        const migrated = parsed.map(p => ({
          ...p,
          gains: this.normalizeBands(p.gains, bandCount)
        }));
        this.presets.set(migrated);
      } else {
        // If no presets are stored, load the defaults
        this.presets.set(this.defaultPresets);
        this.saveToStorage();
      }
    } catch (e) {
      console.error('Failed to load presets from localStorage', e);
      this.presets.set(this.defaultPresets);
    }
  }

  /** Pad with zeros or truncate so gains always matches the current EQ band count. */
  private normalizeBands(gains: number[], targetLength: number): number[] {
    if (gains.length === targetLength) return gains;
    if (gains.length > targetLength) return gains.slice(0, targetLength);
    return [...gains, ...new Array(targetLength - gains.length).fill(0)];
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.presets()));
    } catch (e) {
      console.error('Failed to save presets to localStorage', e);
    }
  }

  savePreset(name: string, gains: number[]): void {
    this.presets.update(presets => {
      const existingIndex = presets.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
      const newPreset = { name, gains };
      if (existingIndex > -1) {
        presets[existingIndex] = newPreset;
      } else {
        presets.push(newPreset);
      }
      return [...presets.sort((a, b) => a.name.localeCompare(b.name))];
    });
    this.saveToStorage();
  }

  deletePreset(name: string): void {
    this.presets.update(presets => presets.filter(p => p.name !== name));
    this.saveToStorage();
  }

  applyPreset(preset: Preset): void {
    const bandCount = this.audioService.gainValues().length;
    const normalizedGains = this.normalizeBands(preset.gains, bandCount);
    normalizedGains.forEach((gain, index) => {
      this.audioService.changeGain(index, gain);
    });
  }
}
