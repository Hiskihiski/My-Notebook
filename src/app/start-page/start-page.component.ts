import { Component, inject } from '@angular/core'; 
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
// 1. IMPORT YOUR SERVICE INSTEAD OF DIRECT AUTH
import { FirebaseService } from '../firebase.service'; 

interface User {
  username: string;
  password: string;
  vorname: string;
  nachname?: string;
  adresse?: string;
  stadt?: string;
  email?: string;
  isAdmin: boolean;
}

@Component({
  selector: 'app-start-page',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './start-page.component.html',
  styleUrls: ['./start-page.component.css']
})
export class StartPageComponent {
  // 2. INJECT YOUR SERVICE
  private firebaseService = inject(FirebaseService);
  private router = inject(Router);

  // Form data
  username: string = ''; // <-- Type your EMAIL in here on the login form!
  password: string = '';
  vorname: string = '';
  nachname: string = '';
  adresse: string = '';
  stadt: string = '';
  email: string = '';
  password01: string = '';
  vorname01: string = '';
  nachname01: string = '';
  
  // System variables
  message: string = '';
  isSuccess: boolean = false;
  isLoggedIn: boolean = false;
  secretContent: boolean = false;
  currentUser: User | null = null;
  isSubmitting: boolean = false;
  isLoading: boolean = false;

  constructor(private http: HttpClient) { }

  // ----------------------------------------------------------------
  // REAL FIREBASE LOGIN
  // ----------------------------------------------------------------
  onLogin() {
    this.isLoading = true;
    
    // 3. USE YOUR SERVICE FOR LOGIN
    this.firebaseService.login(this.username, this.password)
      .then((userCredential) => {
        this.isLoading = false;
        this.isLoggedIn = true;
        this.isSuccess = true;
        this.message = 'Erfolgreich angemeldet!';
        console.log('Login successful:', userCredential.user);
        
        // REDIRECT TO NOTES PAGE
        this.router.navigate(['/notes']); 
      })
      .catch((error) => {
        this.isLoading = false;
        this.isSuccess = false;
        this.message = 'Falsche Login-Daten!';
        console.error('Firebase Login Error:', error);
      });
  }

  logout() {
    // USE YOUR SERVICE FOR LOGOUT
    this.firebaseService.logout().then(() => {
      this.isLoggedIn = false;
      this.currentUser = null;
      this.secretContent = false;
      this.message = 'Erfolgreich abgemeldet';
    });
  }
  
  showSecret() {
    alert('🏐 Geheime Website.settings aktiviert!');
  }

  // ----------------------------------------------------------------
  // REAL FIREBASE REGISTER
  // ----------------------------------------------------------------
  createUser() {
    this.isSubmitting = true;
    
    // 4. USE YOUR SERVICE FOR REGISTER (This will now trigger the email verification!)
    this.firebaseService.register(this.email, this.password01)
      .then((userCredential) => {
        this.isSubmitting = false;
        console.log('User created:', userCredential.user);
        this.isSuccess = true;
        
        // REDIRECT TO NOTES PAGE
        this.router.navigate(['/notes']); 
      })
      .catch((error) => {
        this.isSubmitting = false;
        console.error('Firebase Error:', error);
        window.alert('Error: ' + error.message);
        this.isSuccess = false;
      });
  }
}