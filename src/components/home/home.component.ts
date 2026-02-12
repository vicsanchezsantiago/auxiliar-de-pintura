import { Component, ChangeDetectionStrategy, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule],
})
export class HomeComponent {
  @Output() navigate = new EventEmitter<'inventory' | 'newProject'>();

  onNavigate(view: 'inventory' | 'newProject') {
    this.navigate.emit(view);
  }
}
