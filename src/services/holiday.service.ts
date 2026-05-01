import { Injectable, signal, computed } from '@angular/core';
import { EqualizerTheme } from '../models/equalizer-theme.model';

export interface Holiday {
  name: string;
  // Month is 0-indexed (0 = Jan, 11 = Dec)
  startMonth: number;
  startDate: number;
  endMonth: number;
  endDate: number;
  theme: EqualizerTheme;
  decorations: string;
}

const HOLIDAYS: Holiday[] = [
  {
    name: "Valentine's Day",
    startMonth: 1, startDate: 12, endMonth: 1, endDate: 15,
    decorations: '',
    theme: { name: "Valentine's", type: 'glossy', base: 'bg-gradient-to-br from-red-500 via-pink-400 to-red-600', display: 'bg-black/40', bar: 'bg-gradient-to-t from-pink-300 to-white', sliderTrack: 'bg-red-400/50', sliderThumb: 'bg-white', text: 'text-white', accent: 'text-pink-200', button: 'bg-red-400/50', buttonHover: 'hover:bg-red-400/70', highlight: 'bg-pink-300/50' }
  },
  {
    name: "4th of July",
    startMonth: 6, startDate: 2, endMonth: 6, endDate: 5,
    decorations: '',
    theme: { name: "Independence Day", type: '3d', base: 'bg-gradient-to-b from-blue-900 to-gray-800', display: 'bg-black/30', bar: 'bg-gradient-to-t from-red-600 to-gray-200 shadow-[0_0_4px_#fff]', sliderTrack: 'bg-red-700', sliderThumb: 'bg-gray-300', text: 'text-gray-200', accent: 'text-white', button: 'bg-blue-800/70', buttonHover: 'hover:bg-blue-700/70', highlight: 'bg-red-600/50' }
  },
  {
    name: "Halloween",
    startMonth: 9, startDate: 28, endMonth: 9, endDate: 31,
    decorations: '',
    theme: { name: "Halloween", type: 'shadow', base: 'bg-gradient-to-br from-gray-900 via-purple-900 to-black', display: 'bg-black/50', bar: 'bg-gradient-to-t from-orange-600 to-yellow-400', sliderTrack: 'bg-purple-800/50', sliderThumb: 'bg-orange-500', text: 'text-orange-300', accent: 'text-purple-400', button: 'bg-purple-900/70', buttonHover: 'hover:bg-purple-800/70', highlight: 'bg-orange-500/50' }
  },
  {
    name: "Christmas",
    startMonth: 11, startDate: 15, endMonth: 11, endDate: 28,
    decorations: 'holiday-christmas',
    theme: { name: "Christmas", type: '3d', base: 'bg-gradient-to-b from-red-900 to-green-900', display: 'bg-black/40', bar: 'bg-gradient-to-t from-yellow-300 to-white shadow-[0_0_4px_#fff]', sliderTrack: 'bg-red-800/70', sliderThumb: 'bg-yellow-400', text: 'text-gray-200', accent: 'text-yellow-300', button: 'bg-green-800/80', buttonHover: 'hover:bg-green-700/80', highlight: 'bg-red-700/50' }
  }
];


@Injectable({ providedIn: 'root' })
export class HolidayService {
  private _detectedHoliday = signal<Holiday | null>(null);
  private _holidayThemeEnabled = signal(false);

  // Public readonly signals for UI binding
  public readonly detectedHoliday = this._detectedHoliday.asReadonly();
  public readonly holidayThemeEnabled = this._holidayThemeEnabled.asReadonly();

  // The final active holiday, which is null if the theme is not enabled by the user
  public readonly activeHoliday = computed(() => this._holidayThemeEnabled() ? this._detectedHoliday() : null);
  
  // A signal to let the UI know if a holiday is available to be turned on
  public readonly isHolidayAvailable = computed(() => this._detectedHoliday() !== null);

  constructor() {
    this.checkForActiveHoliday();
  }
  
  // Method for the UI to toggle the theme
  setHolidayThemeEnabled(enabled: boolean): void {
    this._holidayThemeEnabled.set(enabled);
  }

  private checkForActiveHoliday(): void {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentDate = now.getDate();
    const currentYear = now.getFullYear();

    for (const holiday of HOLIDAYS) {
      const startDate = new Date(currentYear, holiday.startMonth, holiday.startDate);
      const endDate = new Date(currentYear, holiday.endMonth, holiday.endDate, 23, 59, 59);

      if (now >= startDate && now <= endDate) {
        this._detectedHoliday.set(holiday);
        return; // Stop after finding the first active holiday
      }
    }
  }
}
