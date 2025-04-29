import { Component, Output, EventEmitter } from '@angular/core';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { UserLoginComponent } from "../user-login/user-login.component";
import { Router } from '@angular/router';


@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, MatToolbarModule, MatFormFieldModule, MatInputModule, MatIconModule, MatButtonModule, UserLoginComponent],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.css']
})
export class HeaderComponent {
  constructor(
    private router: Router,
  ){ 
  }
  isLoggedIn: boolean = false;
  @Output() search = new EventEmitter<string>();

  onSearchChange(event: any) {
    this.search.emit(event.target.value);
  }
  redirectToHome() {
    const userString = localStorage.getItem('user');
    if (userString) {
      const user = JSON.parse(userString);
      this.isLoggedIn = true;
      this.router.navigate([`/home/${user.userId}`]);
    } else {
      this.router.navigate(['/home']);
    }
  }
}