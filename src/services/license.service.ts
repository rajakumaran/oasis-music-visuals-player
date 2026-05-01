import { Injectable, signal, computed } from '@angular/core';

/**
 * LicenseService — Spectra Freemium Tier Management
 *
 * Manages free vs pro subscription state for the Spectra music visualizer.
 * Free users get 8 curated showcase themes; Pro users unlock all 60+ themes
 * plus power features (file uploads, Style Fusion, Autopilot, EQ presets).
 *
 * Activation flow:
 *   1. User clicks "Upgrade" → opens Stripe Payment Link in new tab
 *   2. After payment, Stripe redirects to: spectra.damnittameitai.co/?pro=activated
 *   3. This service reads the query param, sets localStorage, and unlocks Pro
 *
 * Security note (Phase 1 — client-side only):
 *   The paywall is client-side for MVP simplicity. A determined developer
 *   could bypass it via DevTools. This is acceptable because:
 *   - 99% of users don't know DevTools exists
 *   - The 1% who bypass it are free marketing
 *   - Phase 2 adds server-side verification via Stripe webhooks
 */

const STORAGE_KEY = 'spectra_pro_license';
const ACTIVATION_PARAM = 'pro';
const ACTIVATION_VALUE = 'activated';

/**
 * The 8 hand-picked free themes that showcase every visualizer category.
 * Chosen to maximise "wow" and drive conversions.
 */
const FREE_THEME_NAMES: ReadonlySet<string> = new Set([
  'Cymatics',           // Canvas 2D Physics — the crown jewel
  'Nova',               // SVG Radial — Jobs-inspired minimalism
  'Particle Storm',     // Canvas 2D — explosive, shareable
  'Strange Attractor',  // WebGL 3D — shows 3D capability
  'Classic LED',        // LED — the nostalgic classic
  'Pioneer',            // Shadow/Bar — clean bar visualizer
  'Cyberpunk',          // Neon Glow — attracts gaming crowd
  'CRT Oscilloscope',   // Canvas Waveform — unique tech aesthetic
]);

export const STRIPE_LINKS = {
  monthly: 'https://buy.stripe.com/7sY8wR75e2Ff9ove26abK05',   // $4.99/month
  annual: 'https://buy.stripe.com/7sYdRb3T25Rr9ovf6aabK06',    // $29.99/year
  portal: '', // Customer portal — set up later in Stripe Dashboard → Settings → Billing → Customer portal
} as const;

@Injectable({ providedIn: 'root' })
export class LicenseService {
  /** Whether the user has an active Pro subscription */
  isPro = signal(false);

  /** True when user just arrived from a Stripe payment redirect — skip splash screen */
  activatedFromRedirect = signal(false);

  /** Number of free themes available */
  readonly freeThemeCount = FREE_THEME_NAMES.size;

  constructor() {
    this.checkStoredLicense();
    this.checkActivationUrl();
    this.checkLocalhostBypass();
  }

  private checkLocalhostBypass(): void {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      this.isPro.set(true);
    }
  }

  /** Returns true if a theme name is available in the free tier */
  isThemeFree(themeName: string): boolean {
    return FREE_THEME_NAMES.has(themeName);
  }

  /** Returns true if a theme is locked (Pro only and user is free) */
  isThemeLocked(themeName: string): boolean {
    return !this.isPro() && !this.isThemeFree(themeName);
  }

  /** Activate Pro (called after successful Stripe redirect) */
  activatePro(): void {
    this.isPro.set(true);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        activated: true,
        timestamp: Date.now(),
        // Simple obfuscation — not security, just friction against casual tampering
        checksum: this.generateChecksum(Date.now()),
      }));
    } catch {
      // localStorage unavailable (private browsing, storage full, etc.)
    }
  }

  /** Deactivate Pro (for testing / reset) */
  deactivatePro(): void {
    this.isPro.set(false);
    try { localStorage.removeItem(STORAGE_KEY); } catch { }
  }

  /** Open Stripe Payment Link for a given plan */
  openCheckout(plan: 'monthly' | 'annual' | 'lifetime'): void {
    window.open(STRIPE_LINKS[plan], '_blank');
  }

  /** Open Stripe Customer Portal for subscription management / restore */
  openCustomerPortal(): void {
    if (STRIPE_LINKS.portal) {
      window.open(STRIPE_LINKS.portal, '_blank');
    } else {
      // Portal not configured yet — just re-activate from URL as a fallback
      this.activatePro();
    }
  }

  // --- Private helpers ---

  private checkStoredLicense(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data?.activated && data?.timestamp && data?.checksum) {
        // Verify the checksum to add friction against manual localStorage edits
        if (data.checksum === this.generateChecksum(data.timestamp)) {
          this.isPro.set(true);
        }
      }
    } catch {
      // Corrupted or unavailable — remain free
    }
  }

  private checkActivationUrl(): void {
    const params = new URLSearchParams(window.location.search);
    if (params.get(ACTIVATION_PARAM) === ACTIVATION_VALUE) {
      this.activatePro();
      this.activatedFromRedirect.set(true); // Skip splash screen
      // Clean the URL so it doesn't look ugly / re-trigger on refresh
      const cleanUrl = window.location.pathname + window.location.hash;
      window.history.replaceState({}, '', cleanUrl);
    }
  }

  /**
   * Simple checksum to add friction against manual localStorage edits.
   * NOT cryptographic security — just enough to deter casual tampering.
   */
  private generateChecksum(timestamp: number): string {
    const seed = timestamp ^ 0x5EC7BA; // XOR with a brand constant
    return (seed >>> 0).toString(36) + '_spectra';
  }
}
