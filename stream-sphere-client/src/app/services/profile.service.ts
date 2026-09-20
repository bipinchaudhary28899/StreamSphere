import { Injectable, inject } from '@angular/core';
import { HttpBackend, HttpClient, HttpEventType } from '@angular/common/http';
import { BehaviorSubject, Observable, filter, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { User } from '../models/user';
import { AuthService } from './auth.service';

export type ProfileImageKind = 'avatar' | 'banner';

export type AvatarChoice =
  | { source: 'upload'; key: string }
  | { source: 'preset'; presetId: string }
  | { source: 'google' }
  | { source: 'initials' };

export type BannerChoice =
  | { source: 'upload'; key: string }
  | { source: 'preset'; presetId: string }
  | { source: 'default' };

export interface ProfileChanges {
  avatar?: AvatarChoice;
  banner?: BannerChoice;
}

/** A signed, single-use S3 PUT for a cropped image */
export interface ImageUploadTicket {
  uploadUrl: string;
  key: string;
  /** Must be sent exactly: they are part of the signature */
  headers: Record<string, string>;
}

/** Largest image the backend signs for (MAX_IMAGE_BYTES in services/profile.service.ts) */
export const MAX_IMAGE_BYTES: Record<ProfileImageKind, number> = {
  avatar: 1024 * 1024,
  banner: 2 * 1024 * 1024,
};

/**
 * The signed-in user's profile: avatar and banner.
 *
 * localStorage 'user' stays the source every component reads at start-up;
 * this service keeps it current and announces changes on `user$`.
 */
@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly http = inject(HttpClient);
  /**
   * For the S3 PUT: skips the interceptors, so the session token never goes
   * to S3 and an S3 error can't sign the user out.
   */
  private readonly storage = new HttpClient(inject(HttpBackend));
  private readonly api = environment.apiUrl;
  private readonly userSubject = new BehaviorSubject<User | null>(readStoredUser());

  readonly user$ = this.userSubject.asObservable();

  constructor() {
    // Sign-in and sign-out rewrite localStorage; follow them.
    inject(AuthService).getLoginState().subscribe(() => this.userSubject.next(readStoredUser()));
  }

  get user(): User | null {
    return this.userSubject.value;
  }

  /** Loads the saved profile, which another device may have changed. */
  refresh(): Observable<User | null> {
    return this.http.get<{ user: Partial<User> }>(`${this.api}/profile`).pipe(
      map(({ user }) => this.store(user)),
    );
  }

  requestUpload(kind: ProfileImageKind, contentType: string, size: number): Observable<ImageUploadTicket> {
    return this.http.post<ImageUploadTicket>(`${this.api}/profile/image-upload`, { kind, contentType, size });
  }

  /** PUTs the image straight to S3. Emits progress (0–100); completes when stored. */
  upload(ticket: ImageUploadTicket, image: Blob): Observable<number> {
    return this.storage
      .put(ticket.uploadUrl, image, { headers: ticket.headers, reportProgress: true, observe: 'events' })
      .pipe(
        filter(event => event.type === HttpEventType.UploadProgress || event.type === HttpEventType.Response),
        map(event => event.type === HttpEventType.UploadProgress
          ? Math.round((100 * event.loaded) / (event.total || image.size))
          : 100),
      );
  }

  /** Saves the choices. The reply carries a fresh token with the new avatar. */
  save(changes: ProfileChanges): Observable<User | null> {
    return this.http.patch<{ user: Partial<User>; token?: string }>(`${this.api}/profile`, changes).pipe(
      map(({ user, token }) => {
        const stored = this.store(user);
        if (stored && token) localStorage.setItem('token', token);
        return stored;
      }),
    );
  }

  /** Merges a profile into the stored user, unless that user has since signed out or changed. */
  private store(profile: Partial<User>): User | null {
    const current = readStoredUser();
    if (!current || (profile.userId && current.userId !== profile.userId)) return null;

    const merged = { ...current, ...profile } as User;
    localStorage.setItem('user', JSON.stringify(merged));
    this.userSubject.next(merged);
    return merged;
  }
}

function readStoredUser(): User | null {
  try {
    const raw = localStorage.getItem('user');
    return raw && raw !== 'undefined' ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
