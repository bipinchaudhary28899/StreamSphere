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
  standalone: true, // Marking the component as standalone
  imports: [CommonModule, MatButtonModule, MatMenuModule], // No need for CommonModule or HttpClientModule as we're using HttpClient directly in the service
  templateUrl: './user-login.component.html',
  styleUrls: ['./user-login.component.css'],
})
export class UserLoginComponent {
  avail: boolean = false;
  msg: string = '';
  isLoggedIn: boolean = false;
  private isGoogleBtnRenderedViaLogout = false;
  userName: string = '';

  constructor(
    private router: Router,
    private auth: AuthService, // Your AuthService will now directly use HttpClient
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
    this.checkLoginState(); // Check login state from localStorage on page load
    console.log('START (ngOnInit) isLoggedIn is ', this.isLoggedIn);
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;

    script.onload = () => {
      // Only render Google Sign-In button if NOT already logged in
      if (!this.isLoggedIn) {
        setTimeout(() => {
          this.initializeGoogleSignIn();
        }, 0);
      }
    };
    document.head.appendChild(script);
    console.log('END (ngOnInit) isLoggedIn is ', this.isLoggedIn);
  }

  checkLoginState() {
    const storedUser = localStorage.getItem('user');
    console.log('START storedUser is ', storedUser);

    if (storedUser && storedUser !== 'undefined') {
      try {
        const parsedUser = JSON.parse(storedUser);
        if (parsedUser?.userName) {
          this.isLoggedIn = true;
          this.userName = parsedUser.userName; // Extract userName from the user object
          console.log('UserName from localStorage:', this.userName);
        } else {
          this.isLoggedIn = false;
          this.userName = '';
        }
      } catch (e) {
        console.error('Error parsing user:', e);
        this.isLoggedIn = false;
        localStorage.removeItem('user');
      }
    } else {
      this.isLoggedIn = false;
      this.userName = '';
    }
    this.cdr.detectChanges();
    console.log('END storedUser is ', storedUser);
    console.log('END (checkLoginState) isLoggedIn is ', this.isLoggedIn);
  }

  initializeGoogleSignIn() {
    if (this.isLoggedIn) return;

    console.log('Google Sign-In button is being rendered');
    google.accounts.id.initialize({
      client_id:
        '696274223099-m83j37fcauhli1or0a4afjt6eut6f4or.apps.googleusercontent.com',
      callback: this.handleCredentialResponse.bind(this),
    });
    google.accounts.id.renderButton(
      document.getElementById('googleLoginButton'),
      { theme: 'outline', size: 'large', text: 'continue_with' }
    );

    google.accounts.id.prompt();
  }

  handleCredentialResponse(response: any) {
    this.auth.googleLogin(response.credential).subscribe({
      next: (res) => {
        console.log('(handleCredentialResponse) user details  ', res);
    
        // Save user and token to localStorage
        localStorage.setItem('token', res.token);
        localStorage.setItem('user', JSON.stringify(res.user)); // ✅ SAVE FIRST
    
        this.checkLoginState(); // ✅ THEN SET STATE FROM STORAGE
    
        console.log('(handleCredentialResponse) token  ', localStorage.getItem('token'));
        console.log('(handleCredentialResponse) user  ', localStorage.getItem('user'));
    
        const redirectUrl = this.auth.getRedirectUrl();
        const defaultRedirectUrl = `/home/${res.user.userId}`;
    
        this.router.navigateByUrl(redirectUrl || defaultRedirectUrl);
      },
      error: (error) => {
        console.error('Google authentication failed', error);
        this.avail = true;
        this.msg = 'Google authentication failed. Please try again.';
      },
    });
    
  }

  logOut() {
    this.isGoogleBtnRenderedViaLogout=true;
    this.clearSession();
    console.log("(logOut) isLoggedIn - ",this.isLoggedIn);
    this.router.navigate(['']).then(() => {
      // After navigation, reinitialize the Google login button
      if(this.isGoogleBtnRenderedViaLogout)
        this.initializeGoogleSignIn();
    });
  }
  openUserProfile(){
    this.router.navigate(['/user-profile']);
  }
  clearSession() {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    this.isLoggedIn = false;
    this.userName = '';
    this.cdr.detectChanges();
    console.log('Session cleared, re-rendering Google login button.');
  
  // Call initializeGoogleSignIn to re-render the button
    if(!this.isGoogleBtnRenderedViaLogout)
      this.initializeGoogleSignIn();

  }
}
