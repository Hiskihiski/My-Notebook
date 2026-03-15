import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core'; 
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { FirebaseService } from '../firebase.service';
import { Note } from '../models/note.model';
import { trigger, style, animate, transition } from '@angular/animations'; 
import { Auth, onAuthStateChanged } from '@angular/fire/auth';

@Component({
  selector: 'app-notes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './notes.component.html',
  styleUrls: ['./notes.component.css'],
  animations: [
    trigger('fadeIn', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('600ms ease-in', style({ opacity: 1 })),
      ])
    ])
  ]
})
export class NotesComponent implements OnInit {
  userEmail: string = '';
  notes: Note[] = [];
  typingTimeout: any;
  newNote: string = '';
  isLoading = true;
  isDarkMode = false;
  
  quotes: string[] = [
    "“Ideas fade unless written. Start your first note.”",
    "“A short note is better than a long thought forgotten.”",
    "— Every great idea starts with a simple sentence.”",
    "“Write it down. You’ll thank yourself later.”",
    "“Notizen sind Gedanken mit Zukunft.”",
    "“Your brain is for having ideas, not storing them.” – David Allen",
    "“If it’s not written, it’s forgotten.”",
    "“The faintest ink is better than the best memory.”",
  ];
  randomQuote: string = "";

  constructor(
    private firebaseService: FirebaseService, 
    private router: Router, 
    private auth: Auth
  ) {
    // Constructor is now clean. Logic moved to ngOnInit to prevent double-loading.
  }

  ngOnInit(): void {
    this.randomQuote = this.getRandomQuote();
    
    // This is the ONLY place the listener should live
    onAuthStateChanged(this.auth, (user) => {
      if (user && user.email) {
        this.userEmail = user.email;
        this.firebaseService.loadNotes(this.userEmail).subscribe({
          next: (notes) => {
            this.notes = notes;
            this.isLoading = false;
          },
          error: (err) => {
            console.error("Data fetch error:", err);
            this.isLoading = false;
          }
        });
      } else {
        // If not logged in, boot back to start page
        this.router.navigate(['/']);
      }
    });
  }

  getRandomQuote(): string {
    const index = Math.floor(Math.random() * this.quotes.length);
    return this.quotes[index];
  }

  toggleDarkMode() {
    this.isDarkMode = !this.isDarkMode;
    document.body.classList.toggle('dark-mode', this.isDarkMode);
  }

  addNote() {
    if (!this.newNote.trim()) return;
    this.firebaseService.addNote(this.userEmail, this.newNote).then(() => {
      this.newNote = '';
    });
  }

  deleteNote(noteId: string) {
    this.firebaseService.deleteNote(this.userEmail, noteId);
  }

  goToLogin() {
    this.router.navigate(['/']);
  }

  logout() {
    this.firebaseService.logout().then(() => this.router.navigate(['/']));
  }
}