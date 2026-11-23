import { Component, inject, HostListener } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UiService } from './ui.service';

/** Popups (confirm / delete password) + toast, shown above every page */
@Component({
  selector: 'app-dialog',
  standalone: true,
  imports: [FormsModule],
  template: `
  @if (ui.dialog(); as d) {
    <div class="modal-bg" (click)="$event.target === $event.currentTarget && ui.close(d.kind === 'pin' ? null : false)">
      <div class="modal">
        <h2>{{ d.title }}</h2>
        @if (d.kind === 'confirm') {
          <ol class="csum">@for (l of d.lines; track $index) { <li [innerHTML]="l"></li> }</ol>
        } @else {
          <p class="big">{{ d.lines[0] }}</p>
          <label>Enter 4-number delete password</label>
          <input #pin type="password" inputmode="numeric" maxlength="4" autocomplete="off" class="pinbox"
                 [(ngModel)]="pinVal" (keydown.enter)="ui.close(pinVal); pinVal=''" autofocus>
        }
        <div class="acts">
          <button class="pr" [class.danger]="d.danger" (click)="ui.close(d.kind === 'pin' ? pinVal : true); pinVal=''">{{ d.ok }}</button>
          <button (click)="ui.close(d.kind === 'pin' ? null : false); pinVal=''">{{ d.kind === 'pin' ? 'Cancel' : '✏️ Go back' }}</button>
        </div>
      </div>
    </div>
  }
  @if (ui.toastMsg()) { <div class="toast">{{ ui.toastMsg() }}</div> }
  `,
})
export class DialogComponent {
  ui = inject(UiService);
  pinVal = '';
  @HostListener('document:keydown.escape')
  esc() {
    const d = this.ui.dialog();
    const ae = document.activeElement as HTMLElement | null;
    if (d && !(ae && ae.tagName === 'INPUT')) this.ui.close(d.kind === 'pin' ? null : false);
  }
}
