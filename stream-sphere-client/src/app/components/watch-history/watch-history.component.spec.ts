import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { WatchHistoryComponent } from './watch-history.component';

describe('WatchHistoryComponent', () => {
  let component: WatchHistoryComponent;
  let fixture: ComponentFixture<WatchHistoryComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WatchHistoryComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WatchHistoryComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
