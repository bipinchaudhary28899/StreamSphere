import { ChangeDetectorRef, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationStart, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { filter } from 'rxjs';

declare const google: any;

@Component({
  selector: 'app-user-login',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatMenuModule],
  templateUrl: './user-login.component.html',
  styleUrls: ['./user-login.component.css'],
})
export class UserLoginComponent {
  avail: boolean = false;
  msg: string = '';
  isLoggedIn: boolean = false;
  private isGoogleBtnRenderedViaLogout = false;
  private googleScriptLoaded = false;

  constructor(
    private router: Router,
    private auth: AuthService,
    private cdr: ChangeDetectorRef
  ) {
    this.router.events
    .pipe(filter((event: any) => event instanceof NavigationStart))
    .subscribe((event: NavigationStart) => {
      console.log('NavigationStart:', event.url);

      // If user is navigating to Login page ("/"), force logout
      if (event.url === '/') {
        console.log('Navigating to login, clearing session.');
        this.clearSession();
      }
    });
  }

  ngOnInit(): void {
    this.checkLoginState();
    console.log('START (ngOnInit) isLoggedIn is ', this.isLoggedIn);
    this.loadGoogleScript();
    console.log('END (ngOnInit) isLoggedIn is ', this.isLoggedIn);
  }

  private loadGoogleScript(): void {
    // Check if script is already loaded
    if (document.querySelector('script[src="https://accounts.google.com/gsi/client"]')) {
      console.log('Google script already loaded');
      this.googleScriptLoaded = true;
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;

    script.onload = () => {
      console.log('Google script loaded successfully');
      this.googleScriptLoaded = true;
      // Wait a bit for the script to fully initialize
      setTimeout(() => {
        console.log('Google script fully initialized');
        // Check if google object is available
        if (typeof google !== 'undefined' && google.accounts) {
          console.log('Google object is ready to use');
        } else {
          console.warn('Google object not yet available after script load');
        }
      }, 100);
    };
    
    script.onerror = (error) => {
      console.error('Failed to load Google script:', error);
      this.googleScriptLoaded = false;
    };
    
    // Add error handling for script loading
    script.addEventListener('error', (error) => {
      console.error('Script loading error:', error);
      this.googleScriptLoaded = false;
    });
    
    document.head.appendChild(script);
  }

  private waitForGoogleScript(): Promise<boolean> {
    return new Promise((resolve) => {
      const checkGoogle = () => {
        if (typeof google !== 'undefined' && google.accounts) {
          console.log('Google script is ready');
          resolve(true);
        } else {
          console.log('Waiting for Google script to be ready...');
          setTimeout(checkGoogle, 100);
        }
      };
      checkGoogle();
    });
  }

  ngAfterViewInit(): void {
    // Only initialize if user is not logged in
    if (!this.isLoggedIn) {
      // Add a small delay to ensure the script has time to load
      setTimeout(() => {
        this.initializeGoogleSignIn();
      }, 100);
    }
  }

  checkLoginState() {
    const storedUser = localStorage.getItem('user');
    console.log('START storedUser is ', storedUser);

    if (storedUser && storedUser !== 'undefined') {
      try {
        const parsedUser = JSON.parse(storedUser);
        if (parsedUser?.name || parsedUser?.email) {
          this.isLoggedIn = true;
          // Use setTimeout to defer the state update to the next change detection cycle
          setTimeout(() => {
            this.auth.updateLoginState(true);
          });
          console.log('User is logged in');
        } else {
          this.isLoggedIn = false;
          setTimeout(() => {
            this.auth.updateLoginState(false);
          });
        }
      } catch (e) {
        console.error('Error parsing user:', e);
        this.isLoggedIn = false;
        setTimeout(() => {
          this.auth.updateLoginState(false);
        });
        localStorage.removeItem('user');
      }
    } else {
      this.isLoggedIn = false;
      setTimeout(() => {
        this.auth.updateLoginState(false);
      });
    }
    this.cdr.detectChanges();
    console.log('END storedUser is ', storedUser);
    console.log('END (checkLoginState) isLoggedIn is ', this.isLoggedIn);
  }

  initializeGoogleSignIn() {
    console.log('Google Sign-In button is being rendered');
    console.log('Google script loaded:', this.googleScriptLoaded);
    
    // Safe check for google object
    const googleExists = typeof google !== 'undefined';
    const googleAccountsExists = googleExists && typeof google.accounts !== 'undefined';
    
    console.log('Google object exists:', googleExists);
    console.log('Google accounts object exists:', googleAccountsExists);
    
    this.retryCount = 0;
    
    const tryRender = async () => {
      const buttonElement = document.getElementById('googleLoginButton');
      console.log('Button element found:', buttonElement);
      
      // Safe check for google object
      const googleExists = typeof google !== 'undefined';
      const googleAccountsExists = googleExists && typeof google.accounts !== 'undefined';
      
      // Wait for Google script to be ready
      if (!this.googleScriptLoaded || !googleExists || !googleAccountsExists) {
        this.retryCount++;
        console.warn('Waiting for Google script to be ready...', {
          buttonElement: !!buttonElement,
          scriptLoaded: this.googleScriptLoaded,
          googleExists: googleExists,
          googleAccounts: googleAccountsExists,
          retryCount: this.retryCount
        });
        
        // If we've tried too many times, add a fallback
        if (this.retryCount > 20) {
          console.error('Failed to load Google button after multiple attempts');
          if (buttonElement) {
            this.addFallbackButton(buttonElement);
          }
          return;
        }
        
        setTimeout(tryRender, 300); // Retry after 300ms
        return;
      }
      
      // Check if both the script is loaded and google object exists
      if (buttonElement && this.googleScriptLoaded && googleExists && googleAccountsExists) {
        try {
          // Clear any existing content
          buttonElement.innerHTML = '';
          
          google.accounts.id.initialize({
            client_id:
              '696274223099-m83j37fcauhli1or0a4afjt6eut6f4or.apps.googleusercontent.com',
            callback: this.handleCredentialResponse.bind(this),
          });

          google.accounts.id.renderButton(
            buttonElement,
            { theme: 'outline', size: 'large', text: 'continue_with' }
          );

          google.accounts.id.prompt();
          console.log('Google button rendered successfully');
        } catch (error) {
          console.error('Error rendering Google button:', error);
          // Add a fallback button if Google button fails
          this.addFallbackButton(buttonElement);
        }
      } else {
        this.retryCount++;
        console.warn('Retrying Google button render...', {
          buttonElement: !!buttonElement,
          scriptLoaded: this.googleScriptLoaded,
          googleExists: googleExists,
          googleAccounts: googleAccountsExists,
          retryCount: this.retryCount
        });
        
        // If we've tried too many times, add a fallback
        if (this.retryCount > 20) {
          console.error('Failed to load Google button after multiple attempts');
          if (buttonElement) {
            this.addFallbackButton(buttonElement);
          }
          return;
        }
        
        setTimeout(tryRender, 500); // Retry after 500ms
      }
    };

    tryRender();
  }

  private retryCount = 0;

  private addFallbackButton(container: HTMLElement): void {
    console.log('Adding fallback login button');
    container.innerHTML = `
      <button style="
        background: #4285f4;
        color: white;
        border: none;
        padding: 12px 24px;
        border-radius: 4px;
        font-size: 14px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
      " onclick="window.location.href='/auth/google'">
        <svg width="18" height="18" viewBox="0 0 24 24">
          <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Continue with Google
      </button>
    `;
  }

  handleCredentialResponse(response: any) {
    console.log('Google Sign-In response received');
    
    if (response.credential) {
      this.auth.googleLogin(response.credential).subscribe({
        next: (result) => {
          console.log('Google login successful:', result);
          
          // Store user data and token in localStorage
          if (result.user && result.token) {
            localStorage.setItem('user', JSON.stringify(result.user));
            localStorage.setItem('token', result.token);
            console.log('User data and token stored in localStorage');
          }
          
          this.isLoggedIn = true;
          this.cdr.detectChanges();
          
          // Update the auth service login state with setTimeout to avoid ExpressionChangedAfterItHasBeenCheckedError
          setTimeout(() => {
            this.auth.updateLoginState(true);
          });
          
          // Navigate to home page after successful login
          this.router.navigate(['/home']);
        },
        error: (error) => {
          console.error('Google login failed:', error);
          this.msg = 'Login failed. Please try again.';
          this.cdr.detectChanges();
        }
      });
    } else {
      console.error('No credential received from Google');
      this.msg = 'Login failed. Please try again.';
      this.cdr.detectChanges();
    }
  }

  clearSession() {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    this.isLoggedIn = false;
    setTimeout(() => {
      this.auth.updateLoginState(false);
    });
    this.cdr.detectChanges();
  }
}
