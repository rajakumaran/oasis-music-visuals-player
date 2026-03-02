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

  private defaultPresets: Preset[] = [
    { name: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0] },
    { name: 'Rock', gains: [5, 3, -2, -3, 0, 4, 6] },
    { name: 'Pop', gains: [-1, 2, 4, 3, 1, -1, -2] },
    { name: 'Bass Boost', gains: [7, 5, 2, 0, 0, 0, 0] },
    { name: 'Vocal Boost', gains: [-2, 0, 2, 4, 3, 1, 0] },
    { name: 'Clarity', gains: [-4, -2, 0, 1, 3, 5, 7] },
    // Brand-inspired presets
    { name: 'B-Signature (Warm)', gains: [6, 4, 1, -1, 0, 2, 4] },
    { name: 'S-Deep (Punchy)', gains: [8, 5, -1, -2, 1, 3, 5] },
    { name: 'J-Power (V-Shape)', gains: [7, 3, -3, -4, 0, 4, 7] },
    { name: 'O-Pure (Hi-Fi)', gains: [1, 0, 0, 0, 1, 2, 3] },
    { name: 'A-Balanced (Studio)', gains: [0, 1, 2, 1, 0, 1, 2] },
    { name: 'Sen-Pro (Reference)', gains: [-1, 0, 1, 2, 3, 2, 1] },
  ];

  constructor() {
    this.loadPresets();
  }

  private loadPresets(): void {
    try {
      const storedPresets = localStorage.getItem(STORAGE_KEY);
      if (storedPresets) {
        this.presets.set(JSON.parse(storedPresets));
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
    // Ensure preset has the correct number of bands before applying
    if (preset.gains.length === this.audioService.gainValues().length) {
      preset.gains.forEach((gain, index) => {
        this.audioService.changeGain(index, gain);
      });
    } else {
      console.warn(`Preset "${preset.name}" has an incorrect number of bands. Applying a flat EQ instead.`);
      this.audioService.gainValues().forEach((_, index) => {
        this.audioService.changeGain(index, 0);
      });
    }
  }
}
