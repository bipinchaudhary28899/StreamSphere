import {
  AfterViewChecked, Component, ElementRef, HostListener, OnDestroy, QueryList, ViewChild, ViewChildren, inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Subscription, firstValueFrom, lastValueFrom, tap } from 'rxjs';
import {
  AvatarChoice, BannerChoice, MAX_IMAGE_BYTES, ProfileChanges, ProfileImageKind, ProfileService,
} from '../../services/profile.service';
import { AVATAR_PRESETS, BANNER_PRESETS, presetIdFromUrl } from '../../shared/profile-presets';
import {
  CropState, DecodedImage, MAX_ZOOM, MIN_ZOOM, Size,
  centerCrop, clampCrop, decodeImageFile, drawRect, exportCrop, rotateClockwise, sourceRect, zoomAround,
} from '../../shared/image-crop';
import { User } from '../../models/user';

export interface ProfileEditorData {
  tab: ProfileImageKind;
}

export interface ProfileEditorResult {
  message: string;
}

type Mode = 'upload' | 'gallery';

export interface GalleryOption {
  id: string;
  label: string;
  /** Picture to show; null means the option draws itself (initials, theme banner) */
  url: string | null;
  /** What saving it sends; null keeps the saved image */
  choice: AvatarChoice | BannerChoice | null;
}

interface Draft {
  mode: Mode;
  image: DecodedImage | null;
  fileName: string;
  crop: CropState;
  /** The selected gallery option's id */
  selected: string;
  fileError: string | null;
}

/** Size of the saved image */
export const OUTPUT: Record<ProfileImageKind, Size> = {
  avatar: { width: 512, height: 512 },
  banner: { width: 2400, height: 400 },
};

/** Smaller photos are refused: they can't fill even a small avatar or banner. */
const MIN_SOURCE: Record<ProfileImageKind, Size> = {
  avatar: { width: 98, height: 98 },
  banner: { width: 640, height: 107 },
};

const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** How the banner is cut on screens (see .channel-banner): wide desktops, phones */
export const BANNER_VIEWS = [
  { id: 'desktop', label: 'Desktop', aspect: 8 },
  { id: 'phone', label: 'Phone', aspect: 4 },
] as const;

const TAB_LABEL: Record<ProfileImageKind, string> = { avatar: 'Profile picture', banner: 'Banner' };

@Component({
  selector: 'app-profile-editor',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatIconModule],
  templateUrl: './profile-editor.component.html',
  styleUrl: './profile-editor.component.css',
})
export class ProfileEditorComponent implements AfterViewChecked, OnDestroy {
  private readonly dialogRef = inject<MatDialogRef<ProfileEditorComponent, ProfileEditorResult>>(MatDialogRef);
  private readonly profile = inject(ProfileService);
  private readonly data = inject<ProfileEditorData>(MAT_DIALOG_DATA);

  readonly tabs: { id: ProfileImageKind; label: string }[] = [
    { id: 'avatar', label: TAB_LABEL.avatar },
    { id: 'banner', label: TAB_LABEL.banner },
  ];
  readonly modes: { id: Mode; label: string; icon: string }[] = [
    { id: 'upload', label: 'Upload', icon: 'upload' },
    { id: 'gallery', label: 'Gallery', icon: 'apps' },
  ];
  readonly bannerViews = BANNER_VIEWS;
  readonly minZoom = MIN_ZOOM;
  readonly maxZoom = MAX_ZOOM;

  readonly user: User | null = this.profile.user;
  readonly initials = initialsOf(this.user?.name);
  readonly options: Record<ProfileImageKind, GalleryOption[]> = {
    avatar: avatarOptions(this.user),
    banner: bannerOptions(this.user),
  };
  /** The option matching what is saved now */
  private readonly saved: Record<ProfileImageKind, string> = {
    avatar: savedAvatarOption(this.user),
    banner: savedBannerOption(this.user),
  };
  /** What "Remove" goes back to */
  private readonly fallback: Record<ProfileImageKind, string> = {
    avatar: googlePhotoOf(this.user) ? 'google' : 'initials',
    banner: 'default',
  };

  tab: ProfileImageKind = this.data?.tab ?? 'avatar';
  readonly drafts: Record<ProfileImageKind, Draft> = {
    avatar: this.newDraft('avatar'),
    banner: this.newDraft('banner'),
  };

  dragOver = false;
  loadingFile = false;
  saving = false;
  /** Upload progress while saving, 0–100; null while not uploading */
  progress: number | null = null;
  status = '';
  error: string | null = null;

  @ViewChild('fileInput') private fileInput?: ElementRef<HTMLInputElement>;
  @ViewChild('stage') private stage?: ElementRef<HTMLCanvasElement>;
  @ViewChildren('preview') private previews?: QueryList<ElementRef<HTMLCanvasElement>>;

  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch: { distance: number; zoom: number } | null = null;
  private frame = 0;
  private needsDraw = false;
  private readonly subs = new Subscription();
  private resizeObserver?: ResizeObserver;
  private observedStage?: HTMLCanvasElement;

  constructor() {
    // Closing by Escape or the backdrop asks first when there are changes.
    this.subs.add(this.dialogRef.backdropClick().subscribe(() => this.close()));
    this.subs.add(this.dialogRef.keydownEvents().subscribe(event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    }));
  }

  ngAfterViewChecked(): void {
    // The stage canvas comes and goes with the image; track its size.
    const stage = this.stage?.nativeElement;
    if (stage !== this.observedStage) {
      this.resizeObserver?.disconnect();
      this.observedStage = stage;
      if (stage && typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => this.scheduleDraw());
        this.resizeObserver.observe(stage);
      }
      this.scheduleDraw();
    }
    if (this.needsDraw) this.scheduleDraw();
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    this.resizeObserver?.disconnect();
    cancelAnimationFrame(this.frame);
  }

  // ── State ────────────────────────────────────────────────────────────────

  get draft(): Draft {
    return this.drafts[this.tab];
  }

  get output(): Size {
    return OUTPUT[this.tab];
  }

  get tabLabel(): string {
    return TAB_LABEL[this.tab];
  }

  isDirty(kind: ProfileImageKind): boolean {
    const draft = this.drafts[kind];
    return draft.mode === 'upload' ? !!draft.image : draft.selected !== this.saved[kind];
  }

  get hasChanges(): boolean {
    return this.isDirty('avatar') || this.isDirty('banner');
  }

  /** "Remove" shows while something other than the default is saved. */
  get canRemove(): boolean {
    return this.saved[this.tab] !== this.fallback[this.tab];
  }

  selectTab(tab: ProfileImageKind): void {
    this.tab = tab;
    this.error = null;
    this.needsDraw = true;
  }

  selectMode(mode: Mode): void {
    this.draft.mode = mode;
    this.error = null;
    this.needsDraw = true;
  }

  onTabKeydown(event: KeyboardEvent): void {
    moveBetweenTabs(event, this.tabs.map(t => t.id), this.tab, id => this.selectTab(id));
  }

  onModeKeydown(event: KeyboardEvent): void {
    moveBetweenTabs(event, this.modes.map(m => m.id), this.draft.mode, id => this.selectMode(id));
  }

  selectOption(id: string): void {
    this.draft.selected = id;
    this.error = null;
  }

  remove(): void {
    this.draft.mode = 'gallery';
    this.draft.selected = this.fallback[this.tab];
    this.error = null;
  }

  // ── Choosing a file ──────────────────────────────────────────────────────

  chooseFile(): void {
    this.fileInput?.nativeElement.click();
  }

  onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // choosing the same file again should still work
    if (file) void this.loadFile(file);
  }

  onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    this.dragOver = true;
  }

  onDragLeave(event: DragEvent): void {
    const related = event.relatedTarget as Node | null;
    if (!related || !(event.currentTarget as HTMLElement).contains(related)) this.dragOver = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) void this.loadFile(file);
  }

  /** A pasted image goes straight into the cropper. */
  @HostListener('window:paste', ['$event'])
  onPaste(event: ClipboardEvent): void {
    if (this.saving) return;
    const file = Array.from(event.clipboardData?.files ?? []).find(f => f.type.startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    void this.loadFile(file);
  }

  async loadFile(file: File): Promise<void> {
    const kind = this.tab;
    const draft = this.drafts[kind];
    draft.mode = 'upload';
    draft.fileError = null;
    this.error = null;

    if (file.type && !file.type.startsWith('image/')) {
      draft.fileError = 'That file isn’t an image. Choose a JPG, PNG, WebP or GIF.';
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      draft.fileError = 'That image is over 20 MB. Choose a smaller one.';
      return;
    }

    this.loadingFile = true;
    try {
      const image = await decodeImageFile(file);
      const min = MIN_SOURCE[kind];
      if (image.natural.width < min.width || image.natural.height < min.height) {
        draft.fileError = `That image is too small. Use one at least ${min.width} × ${min.height} pixels.`;
        return;
      }
      draft.image = image;
      draft.fileName = file.name || 'Pasted image';
      draft.crop = { zoom: 1, x: 0, y: 0 };
      this.needsDraw = true;
    } catch {
      draft.fileError = 'This image couldn’t be opened. Try a JPG, PNG or WebP file.';
    } finally {
      this.loadingFile = false;
    }
  }

  // ── Cropping ─────────────────────────────────────────────────────────────

  get zoomPercent(): number {
    return Math.round(this.draft.crop.zoom * 100);
  }

  /** The crop keeps less than 60% of the output's pixels: it will look soft. */
  get lowResolution(): boolean {
    const image = this.draft.image;
    if (!image) return false;
    const rect = sourceRect(this.draft.crop, this.output, image.canvas);
    const naturalWidth = rect.width * (image.natural.width / image.canvas.width);
    return naturalWidth < this.output.width * 0.6;
  }

  setZoom(zoom: number): void {
    const image = this.draft.image;
    if (!image) return;
    this.setCrop(zoomAround(this.draft.crop, zoom, { x: 0, y: 0 }, this.output, image.canvas));
  }

  onZoomInput(event: Event): void {
    this.setZoom(Number((event.target as HTMLInputElement).value));
  }

  zoomBy(step: number): void {
    this.setZoom(this.draft.crop.zoom + step);
  }

  rotate(): void {
    const image = this.draft.image;
    if (!image) return;
    this.draft.image = {
      canvas: rotateClockwise(image.canvas),
      natural: { width: image.natural.height, height: image.natural.width },
    };
    this.draft.crop = { zoom: 1, x: 0, y: 0 };
    this.scheduleDraw();
  }

  resetCrop(): void {
    this.setCrop({ zoom: 1, x: 0, y: 0 });
  }

  onPointerDown(event: PointerEvent): void {
    if (!this.draft.image || (event.pointerType === 'mouse' && event.button !== 0)) return;
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) this.pinch = { distance: this.pointerDistance(), zoom: this.draft.crop.zoom };
  }

  onPointerMove(event: PointerEvent): void {
    const image = this.draft.image;
    const last = this.pointers.get(event.pointerId);
    if (!image || !last) return;
    event.preventDefault();
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const scale = this.outputPerCssPixel();
    if (this.pointers.size === 1) {
      const crop = this.draft.crop;
      this.setCrop({ ...crop, x: crop.x + (event.clientX - last.x) * scale, y: crop.y + (event.clientY - last.y) * scale });
    } else if (this.pinch && this.pointers.size === 2) {
      const zoom = this.pinch.zoom * (this.pointerDistance() / this.pinch.distance);
      const [a, b] = [...this.pointers.values()];
      this.setCrop(zoomAround(this.draft.crop, zoom, this.fromStageCenter((a.x + b.x) / 2, (a.y + b.y) / 2), this.output, image.canvas));
    }
  }

  onPointerUp(event: PointerEvent): void {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
  }

  onWheel(event: WheelEvent): void {
    const image = this.draft.image;
    if (!image) return;
    event.preventDefault();
    const zoom = this.draft.crop.zoom * Math.exp(-event.deltaY * 0.002);
    this.setCrop(zoomAround(this.draft.crop, zoom, this.fromStageCenter(event.clientX, event.clientY), this.output, image.canvas));
  }

  onStageKeydown(event: KeyboardEvent): void {
    const crop = this.draft.crop;
    const step = this.output.width * (event.shiftKey ? 0.1 : 0.02);
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    };
    if (moves[event.key]) {
      const [dx, dy] = moves[event.key];
      this.setCrop({ ...crop, x: crop.x + dx, y: crop.y + dy });
    } else if (event.key === '+' || event.key === '=') {
      this.zoomBy(0.1);
    } else if (event.key === '-' || event.key === '_') {
      this.zoomBy(-0.1);
    } else if (event.key === '0') {
      this.resetCrop();
    } else {
      return;
    }
    event.preventDefault();
  }

  private setCrop(crop: CropState): void {
    const image = this.draft.image;
    if (!image) return;
    this.draft.crop = clampCrop(crop, this.output, image.canvas);
    this.scheduleDraw();
  }

  private pointerDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }

  /** Output pixels per CSS pixel of the stage */
  private outputPerCssPixel(): number {
    const width = this.stage?.nativeElement.clientWidth || 1;
    return this.output.width / width;
  }

  /** A screen point as output pixels from the stage's centre */
  private fromStageCenter(clientX: number, clientY: number): { x: number; y: number } {
    const box = this.stage?.nativeElement.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    const scale = this.outputPerCssPixel();
    return { x: (clientX - box.left - box.width / 2) * scale, y: (clientY - box.top - box.height / 2) * scale };
  }

  // ── Drawing ──────────────────────────────────────────────────────────────

  private scheduleDraw(): void {
    this.needsDraw = false;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.draw());
  }

  private draw(): void {
    const image = this.draft.image;
    if (!image || this.draft.mode !== 'upload') return;
    const rect = sourceRect(this.draft.crop, this.output, image.canvas);

    const stage = this.stage?.nativeElement;
    if (stage) {
      fitToDisplay(stage);
      drawRect(stage, image.canvas, rect);
    }
    for (const { nativeElement: canvas } of this.previews ?? []) {
      const aspect = Number(canvas.dataset['aspect']) || this.output.width / this.output.height;
      fitToDisplay(canvas);
      drawRect(canvas, image.canvas, centerCrop(rect, aspect));
    }
  }

  // ── Saving ───────────────────────────────────────────────────────────────

  async save(): Promise<void> {
    if (this.saving || !this.hasChanges) return;
    this.saving = true;
    this.dialogRef.disableClose = true;
    this.error = null;

    try {
      const changes: ProfileChanges = {};
      const saved: string[] = [];
      for (const kind of ['avatar', 'banner'] as const) {
        if (!this.isDirty(kind)) continue;
        const choice = await this.choiceFor(kind);
        if (!choice) continue;
        if (kind === 'avatar') changes.avatar = choice as AvatarChoice;
        else changes.banner = choice as BannerChoice;
        saved.push(kind === 'avatar' ? 'Profile picture' : 'Banner');
      }

      if (saved.length) {
        this.progress = null;
        this.status = 'Saving…';
        await firstValueFrom(this.profile.save(changes));
      }
      this.dialogRef.close({
        message: saved.length === 2 ? 'Profile picture and banner updated' : `${saved[0] ?? 'Profile'} updated`,
      });
    } catch (error) {
      this.error = describeError(error);
    } finally {
      this.saving = false;
      this.progress = null;
      this.status = '';
      this.dialogRef.disableClose = false;
    }
  }

  /** Uploads the crop if needed; returns what to send for this image. */
  private async choiceFor(kind: ProfileImageKind): Promise<AvatarChoice | BannerChoice | null> {
    const draft = this.drafts[kind];
    if (draft.mode === 'gallery') {
      return this.options[kind].find(option => option.id === draft.selected)?.choice ?? null;
    }

    const image = draft.image!;
    this.status = kind === 'avatar' ? 'Preparing your picture…' : 'Preparing your banner…';
    let blob: Blob;
    try {
      blob = await exportCrop(image.canvas, draft.crop, OUTPUT[kind], MAX_IMAGE_BYTES[kind]);
    } catch {
      throw new EditorError('This image is too detailed to save. Zoom in, or try another image.');
    }

    const ticket = await firstValueFrom(this.profile.requestUpload(kind, blob.type, blob.size));
    this.status = kind === 'avatar' ? 'Uploading your picture' : 'Uploading your banner';
    this.progress = 0;
    await lastValueFrom(this.profile.upload(ticket, blob).pipe(tap(progress => (this.progress = progress))));
    return { source: 'upload', key: ticket.key };
  }

  close(): void {
    if (this.saving) return;
    if (this.hasChanges && !confirm('Discard your changes?')) return;
    this.dialogRef.close();
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private newDraft(kind: ProfileImageKind): Draft {
    const selected = kind === 'avatar' ? savedAvatarOption(this.user) : savedBannerOption(this.user);
    // Someone using a built-in look most likely wants to browse; others upload.
    const browsing = kind === 'avatar' ? this.user?.avatarSource === 'preset' : this.user?.bannerSource === 'preset';
    return {
      mode: browsing ? 'gallery' : 'upload',
      image: null,
      fileName: '',
      crop: { zoom: 1, x: 0, y: 0 },
      selected,
      fileError: null,
    };
  }

  trackById(_: number, option: GalleryOption): string {
    return option.id;
  }
}

class EditorError extends Error {}

/** Arrow keys, Home and End move between tabs (WAI-ARIA tabs pattern). */
function moveBetweenTabs<T>(event: KeyboardEvent, ids: T[], current: T, select: (id: T) => void): void {
  const index = ids.indexOf(current);
  let next: number;
  switch (event.key) {
    case 'ArrowRight': next = (index + 1) % ids.length; break;
    case 'ArrowLeft':  next = (index - 1 + ids.length) % ids.length; break;
    case 'Home':       next = 0; break;
    case 'End':        next = ids.length - 1; break;
    default: return;
  }
  event.preventDefault();
  select(ids[next]);
  const tabs = (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="tab"]');
  setTimeout(() => tabs[next]?.focus());
}

function describeError(error: unknown): string {
  if (error instanceof EditorError) return error.message;
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return 'The upload didn’t finish. Check your connection and try again.';
    const fromApi = error.error?.message || error.error?.details?.[0]?.message;
    if (fromApi && error.status < 500) return fromApi;
    // S3 answers in XML; any refusal there means the signed upload didn't match.
    if (error.url && !error.url.includes('/api/')) return 'The upload was refused. Try again.';
  }
  return 'Something went wrong while saving. Try again.';
}

/** Sizes a canvas's pixels to its displayed size (sharp on high-DPI screens). */
function fitToDisplay(canvas: HTMLCanvasElement): void {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

/** The Google photo; older sign-ins only stored it as profileImage (as the server's toProfile). */
export function googlePhotoOf(user: User | null): string {
  if (!user) return '';
  return user.googlePicture || ((user.avatarSource ?? 'google') === 'google' ? user.profileImage || '' : '');
}

export function initialsOf(name: string | null | undefined): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'U';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function avatarOptions(user: User | null): GalleryOption[] {
  const options: GalleryOption[] = [];
  if (user?.avatarSource === 'upload' && user.profileImage) {
    options.push({ id: 'current', label: 'Current picture', url: user.profileImage, choice: null });
  }
  const google = googlePhotoOf(user);
  if (google) {
    options.push({ id: 'google', label: 'Google photo', url: google, choice: { source: 'google' } });
  }
  options.push({ id: 'initials', label: 'Initials', url: null, choice: { source: 'initials' } });
  for (const preset of AVATAR_PRESETS) {
    options.push({ id: preset.id, label: preset.label, url: preset.url, choice: { source: 'preset', presetId: preset.id } });
  }
  return options;
}

export function bannerOptions(user: User | null): GalleryOption[] {
  const options: GalleryOption[] = [];
  if (user?.bannerSource === 'upload' && user.bannerImage) {
    options.push({ id: 'current', label: 'Current banner', url: user.bannerImage, choice: null });
  }
  options.push({ id: 'default', label: 'Default', url: null, choice: { source: 'default' } });
  for (const preset of BANNER_PRESETS) {
    options.push({ id: preset.id, label: preset.label, url: preset.url, choice: { source: 'preset', presetId: preset.id } });
  }
  return options;
}

export function savedAvatarOption(user: User | null): string {
  switch (user?.avatarSource) {
    case 'upload':   return 'current';
    case 'preset':   return presetIdFromUrl(user.profileImage) ?? 'initials';
    case 'initials': return 'initials';
    default:         return googlePhotoOf(user) ? 'google' : 'initials';
  }
}

export function savedBannerOption(user: User | null): string {
  switch (user?.bannerSource) {
    case 'upload': return 'current';
    case 'preset': return presetIdFromUrl(user.bannerImage) ?? 'default';
    default:       return 'default';
  }
}
