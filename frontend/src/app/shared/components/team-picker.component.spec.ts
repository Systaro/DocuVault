import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TeamPickerComponent, teamTint } from './team-picker.component';
import { Team } from '../../core/api/teams.service';

const team = (id: string, name: string, color?: string): Team => ({
  id,
  name,
  color,
  slug: name.toLowerCase(),
  memberCount: 3,
  spaceCount: 2,
  createdAt: '2026-08-01T00:00:00Z'
});

@Component({
  standalone: true,
  imports: [TeamPickerComponent],
  template: `<app-team-picker [teams]="teams" [(selected)]="chosen" (added)="lastAdded = $event" />`
})
class HostComponent {
  teams: Team[] = [team('a', 'Engineering'), team('b', 'Design', '#ff8800'), team('c', 'Support')];
  chosen = signal<string[]>([]);
  lastAdded: string | null = null;
}

describe('TeamPickerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let picker: TeamPickerComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    picker = fixture.debugElement.children[0].componentInstance;
  });

  it('offers every team when none is chosen', () => {
    expect(picker.availableOptions().map((o) => o.label)).toEqual(['Engineering', 'Design', 'Support']);
  });

  it('stops offering a team once it is chosen, and tells the host', () => {
    picker.add('b');
    fixture.detectChanges();

    expect(host.chosen()).toEqual(['b']);
    expect(host.lastAdded).toBe('b');
    expect(picker.availableOptions().map((o) => o.value)).toEqual(['a', 'c']);
  });

  it('ignores an empty pick and a team that is already in', () => {
    picker.add('a');
    picker.add('a');
    picker.add('');

    expect(host.chosen()).toEqual(['a']);
  });

  it('lists the chosen teams by name, whatever order they were picked in', () => {
    picker.add('c');
    picker.add('a');

    expect(picker.chosen().map((t) => t.name)).toEqual(['Engineering', 'Support']);
  });

  it('removes a team without touching the others', () => {
    picker.add('a');
    picker.add('b');
    picker.remove('a');

    expect(host.chosen()).toEqual(['b']);
  });

  it('renders a chip per chosen team and the hint when there are none', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.empty-hint')).not.toBeNull();

    picker.add('b');
    fixture.detectChanges();

    expect(el.querySelectorAll('.team-chip').length).toBe(1);
    expect(el.querySelector('.chip-name')?.textContent?.trim()).toBe('Design');
    expect(el.querySelector('.empty-hint')).toBeNull();
  });

  it('falls back to the house tint for a team with no colour', () => {
    expect(teamTint('#ff8800')).toContain('#ff8800');
    expect(teamTint()).toBe('rgba(111, 179, 184, 0.12)');
  });
});
