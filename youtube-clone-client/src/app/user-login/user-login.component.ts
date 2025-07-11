import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service'; // Ensure correct import path

declare const google: any;

@Component({
  selector: 'app-user-login',
  standalone: true, // Marking the component as standalone
  imports: [], // No need for CommonModule or HttpClientModule as we're using HttpClient directly in the service
  templateUrl: './user-login.component.html',
  styleUrls: ['./user-login.component.css']
})
export class UserLoginComponent {
  avail: boolean = false;
  msg: string = '';

  constructor(
    private router: Router,
    private auth: AuthService, // Your AuthService will now directly use HttpClient
  ) {}

  ngOnInit(): void {
    console.log("ngoninit");
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => this.initializeGoogleSignIn();
    document.head.appendChild(script);
  }

  initializeGoogleSignIn() {
    console.log("its working");
    google.accounts.id.initialize({
      client_id: '696274223099-m83j37fcauhli1or0a4afjt6eut6f4or.apps.googleusercontent.com',
      callback: this.handleCredentialResponse.bind(this)
    });

    google.accounts.id.renderButton(
      document.getElementById("googleLoginButton"),
      { theme: "outline", size: "large", text: "continue_with" }
    );

    google.accounts.id.prompt();
  }

  handleCredentialResponse(response: any) {
    this.auth.googleLogin(response.credential).subscribe(
      (res) => {
        if (res.isNewUser) {
          console.log('New user registered via Google');
        } else {
          console.log('Existing user logged in via Google');
        }

        const redirectUrl = this.auth.getRedirectUrl();
        const defaultRedirectUrl = '/home/userdetail';

        this.router.navigateByUrl(redirectUrl || defaultRedirectUrl).then(() => {
          window.location.reload();
        });
      },
      (error) => {
        console.error('Google authentication failed', error);
        this.avail = true;
        this.msg = 'Google authentication failed. Please try again.';
      }
    );
  }
}
