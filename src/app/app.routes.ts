import { Routes } from '@angular/router';
import { StartPageComponent } from './start-page/start-page.component';
import { NotesComponent } from './notes/notes.component'; // Import your existing notes component

export const routes: Routes = [
  { path: '', component: StartPageComponent, pathMatch: 'full' },
  { path: 'notes', component: NotesComponent } // This tells Angular "When I type /notes, show the NotesComponent"
];