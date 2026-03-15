import { ApplicationConfig, ErrorHandler } from '@angular/core'; // 1. Added ErrorHandler
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { routes } from './app.routes';
import { GlobalErrorHandler } from './global-error-handler'; // 2. Import your new file

// Firebase Imports
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { provideFirestore, getFirestore } from '@angular/fire/firestore';
import { provideAuth, getAuth } from '@angular/fire/auth';

const firebaseConfig = {
  apiKey: "YOUR_API_KEY_GOES_HERE",
  authDomain: "my-notebook-web.firebaseapp.com",
  projectId: "my-notebook-web",
  storageBucket: "my-notebook-web.firebasestorage.app",
  messagingSenderId: "774734979683",
  appId: "1:774734979683:web:137ae2206e6b0f59560e56",
  measurementId: "G-B8HHF0C91C"
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(),
    provideAnimations(),
    
    // 3. Register the Global Error Handler here
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    
    // Firebase Setup
    provideFirebaseApp(() => initializeApp(firebaseConfig)),
    provideFirestore(() => getFirestore()),
    provideAuth(() => getAuth())
  ]
};


