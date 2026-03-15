import { Injectable, inject } from '@angular/core';
import { 
  Auth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  authState,
  sendEmailVerification 
} from '@angular/fire/auth';
import { 
  Firestore, 
  collection, 
  addDoc, 
  deleteDoc, 
  doc, 
  query, 
  where, 
  onSnapshot, 
  updateDoc 
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class FirebaseService {
  // Inject the instances from app.config.ts instead of manual initialization
  private auth = inject(Auth);
  private firestore = inject(Firestore);

  constructor() {}

  async register(email: string, password: string) {
    const result = await createUserWithEmailAndPassword(this.auth, email, password);
    // Send the verification email right after they sign up
    await sendEmailVerification(result.user);
    return result;
  }

  async login(email: string, password: string) {
    return signInWithEmailAndPassword(this.auth, email, password);
  }

  async logout() {
    return signOut(this.auth);
  }

  loadNotes(userEmail: string): Observable<any[]> {
    return new Observable((observer) => {
      const notesRef = collection(this.firestore, 'notes');
      const q = query(notesRef, where('userEmail', '==', userEmail));
      
      // Real-time listener
      return onSnapshot(q, (snapshot) => {
        const notes = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        observer.next(notes);
      }, (error) => {
        observer.error(error);
      });
    });
  }

  async addNote(userEmail: string, content: string) {
    return addDoc(collection(this.firestore, 'notes'), {
      userEmail,
      content,
      created: new Date(),
    });
  }

  async deleteNote(userEmail: string, noteId: string) {
    const docRef = doc(this.firestore, 'notes', noteId);
    return deleteDoc(docRef);
  }

  async updateNote(userEmail: string, noteId: string, content: string) {
    const noteRef = doc(this.firestore, 'notes', noteId);
    return updateDoc(noteRef, {
      content: content,
      updatedAt: new Date(),
    });
  }
}