import { Injectable, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { inject } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly STORAGE_KEY = 'ss-theme';
  private readonly doc = inject(DOCUMENT);

  private _isDark = signal<boolean>(this._getInitialTheme());

  /** Readonly signal — components can bind to this to react to theme changes */
  readonly isDark = this._isDark.asReadonly();

  constructor() {
    // Apply the initial theme immediately so there is no flash
    this._applyTheme(this._isDark());
  }

  toggle(): void {
    this._isDark.update(v => !v);
    this._applyTheme(this._isDark());
    try {
      localStorage.setItem(this.STORAGE_KEY, this._isDark() ? 'dark' : 'light');
    } catch { /* ignore quota / private-mode errors */ }
  }

  private _getInitialTheme(): boolean {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored !== null) return stored === 'dark';
    } catch { /* ignore */ }
    // Fall back to the OS preference
    return (typeof window !== 'undefined' &&
            window.matchMedia?.('(prefers-color-scheme: dark)').matches) ?? false;
  }

  private _applyTheme(dark: boolean): void {
    this.doc.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }
}
