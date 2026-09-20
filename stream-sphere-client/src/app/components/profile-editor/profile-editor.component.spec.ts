import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Subject, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ProfileEditorComponent, avatarOptions, bannerOptions, googlePhotoOf, savedAvatarOption, savedBannerOption,
} from './profile-editor.component';
import { ProfileService } from '../../services/profile.service';
import { User } from '../../models/user';

const google = 'https://lh3.googleusercontent.com/a/photo';
const base: User = { userId: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', role: 'user', isVerified: true };

describe('profile editor choices', () => {
  it('treats an older account’s profileImage as its Google photo', () => {
    expect(googlePhotoOf({ ...base, profileImage: google })).toBe(google);
    expect(googlePhotoOf({ ...base, profileImage: '/assets/profile/avatars/orbit.svg', avatarSource: 'preset' })).toBe('');
  });

  it('finds the saved avatar option', () => {
    expect(savedAvatarOption({ ...base, profileImage: google, googlePicture: google, avatarSource: 'google' })).toBe('google');
    expect(savedAvatarOption({ ...base, profileImage: '/assets/profile/avatars/orbit.svg', avatarSource: 'preset' })).toBe('orbit');
    expect(savedAvatarOption({ ...base, profileImage: 'https://cdn/x.webp', avatarSource: 'upload' })).toBe('current');
    expect(savedAvatarOption({ ...base, avatarSource: 'initials' })).toBe('initials');
    expect(savedAvatarOption(base)).toBe('initials'); // no photo at all
  });

  it('finds the saved banner option', () => {
    expect(savedBannerOption(base)).toBe('default');
    expect(savedBannerOption({ ...base, bannerSource: 'preset', bannerImage: '/assets/profile/banners/noir.svg' })).toBe('noir');
    expect(savedBannerOption({ ...base, bannerSource: 'upload', bannerImage: 'https://cdn/b.webp' })).toBe('current');
  });

  it('offers the current upload, the Google photo, initials and every preset', () => {
    const ids = avatarOptions({ ...base, profileImage: 'https://cdn/x.webp', avatarSource: 'upload', googlePicture: google })
      .map(o => o.id);
    expect(ids.slice(0, 3)).toEqual(['current', 'google', 'initials']);
    expect(ids).toContain('orbit');
    expect(avatarOptions(base).map(o => o.id)).not.toContain('google');
  });

  it('offers the default banner first', () => {
    expect(bannerOptions(base)[0]).toEqual(jasmine.objectContaining({ id: 'default', choice: { source: 'default' } }));
  });
});

describe('ProfileEditorComponent', () => {
  let fixture: ComponentFixture<ProfileEditorComponent>;
  let component: ProfileEditorComponent;
  let profile: jasmine.SpyObj<ProfileService> & { user: User | null };
  let dialogRef: jasmine.SpyObj<MatDialogRef<ProfileEditorComponent>>;

  function create(user: User, tab: 'avatar' | 'banner' = 'avatar'): void {
    profile = jasmine.createSpyObj('ProfileService', ['save', 'requestUpload', 'upload']) as any;
    profile.user = user;
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close', 'backdropClick', 'keydownEvents']);
    dialogRef.backdropClick.and.returnValue(new Subject<MouseEvent>());
    dialogRef.keydownEvents.and.returnValue(new Subject<KeyboardEvent>());

    TestBed.configureTestingModule({
      imports: [ProfileEditorComponent],
      providers: [
        { provide: ProfileService, useValue: profile },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { tab } },
      ],
    });
    fixture = TestBed.createComponent(ProfileEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('opens on the requested tab with nothing to save', () => {
    create({ ...base, profileImage: google, googlePicture: google, avatarSource: 'google' }, 'banner');
    expect(component.tab).toBe('banner');
    expect(component.hasChanges).toBeFalse();
    const save = fixture.nativeElement.querySelector('.editor-save') as HTMLButtonElement;
    expect(save.disabled).toBeTrue();
  });

  it('saves a gallery avatar and closes with a message', async () => {
    create({ ...base, profileImage: google, googlePicture: google, avatarSource: 'google' });
    profile.save.and.returnValue(of(null));

    component.selectMode('gallery');
    component.selectOption('nebula');
    expect(component.hasChanges).toBeTrue();
    await component.save();

    expect(profile.save).toHaveBeenCalledWith({ avatar: { source: 'preset', presetId: 'nebula' } });
    expect(dialogRef.close).toHaveBeenCalledWith({ message: 'Profile picture updated' });
  });

  it('saves changes to both tabs in one request', async () => {
    create({ ...base, profileImage: google, googlePicture: google, avatarSource: 'google' });
    profile.save.and.returnValue(of(null));

    component.selectMode('gallery');
    component.selectOption('initials');
    component.selectTab('banner');
    component.selectMode('gallery');
    component.selectOption('synthwave');
    await component.save();

    expect(profile.save).toHaveBeenCalledWith({
      avatar: { source: 'initials' },
      banner: { source: 'preset', presetId: 'synthwave' },
    });
    expect(dialogRef.close).toHaveBeenCalledWith({ message: 'Profile picture and banner updated' });
  });

  it('"Remove" goes back to the Google photo', () => {
    create({ ...base, profileImage: '/assets/profile/avatars/orbit.svg', googlePicture: google, avatarSource: 'preset' });
    expect(component.canRemove).toBeTrue();
    component.remove();
    expect(component.draft.mode).toBe('gallery');
    expect(component.draft.selected).toBe('google');
    expect(component.hasChanges).toBeTrue();
  });

  it('keeps the dialog open and shows the API’s reason when saving fails', async () => {
    create({ ...base, avatarSource: 'initials' });
    profile.save.and.returnValue(throwError(() =>
      new HttpErrorResponse({ status: 400, url: 'http://localhost:3000/api/profile', error: { message: 'Unknown avatar' } })));

    component.selectMode('gallery');
    component.selectOption('pulse');
    await component.save();

    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(component.error).toBe('Unknown avatar');
    expect(component.saving).toBeFalse();
  });

  it('asks before discarding changes', () => {
    create({ ...base, avatarSource: 'initials' });
    component.selectMode('gallery');
    component.selectOption('bloom');

    spyOn(window, 'confirm').and.returnValue(false);
    component.close();
    expect(dialogRef.close).not.toHaveBeenCalled();

    (window.confirm as jasmine.Spy).and.returnValue(true);
    component.close();
    expect(dialogRef.close).toHaveBeenCalled();
  });

  it('rejects files that are not images', async () => {
    create({ ...base, avatarSource: 'initials' });
    await component.loadFile(new File(['x'], 'notes.txt', { type: 'text/plain' }));
    expect(component.draft.fileError).toContain('isn’t an image');
    expect(component.draft.image).toBeNull();
  });
});
