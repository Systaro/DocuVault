import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ContextMenuComponent, ContextMenuItem } from './context-menu.component';

@Component({
  standalone: true,
  imports: [ContextMenuComponent],
  template: `
    @if (open()) {
      <app-context-menu
        [items]="items"
        [x]="40"
        [y]="60"
        (select)="chosen = $event"
        (dismiss)="open.set(false)"
      />
    }
  `
})
class HostComponent {
  open = signal(true);
  items: ContextMenuItem[] = [
    { id: 'comment-selection', label: 'Comment on selection', icon: 'add_comment' },
    { id: 'copy', label: 'Copy', icon: 'content_copy' }
  ];
  chosen: ContextMenuItem | null = null;
}

describe('ContextMenuComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const menu = () => document.querySelector('.context-menu');

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('renders its items on the body, out of any clipping container', () => {
    expect(menu()?.parentElement?.parentElement).toBe(document.body);
    expect(document.querySelectorAll('.context-menu-item').length).toBe(2);
  });

  it('survives the press that opened it, however the platform ordered it', () => {
    // Linux dispatches `contextmenu` from within the press, so the press is
    // still in flight when the menu mounts. Its timestamp predates the menu.
    const press = new MouseEvent('mousedown', { bubbles: true });
    Object.defineProperty(press, 'timeStamp', { value: performance.now() - 5 });

    document.dispatchEvent(press);
    fixture.detectChanges();

    expect(host.open()).toBe(true);
    expect(menu()).not.toBeNull();
  });

  it('closes on the next press outside it', () => {
    const press = new MouseEvent('mousedown', { bubbles: true });
    Object.defineProperty(press, 'timeStamp', { value: performance.now() + 5 });

    document.dispatchEvent(press);
    fixture.detectChanges();

    expect(host.open()).toBe(false);
  });

  it('does not treat a right-press as a dismissal', () => {
    // The press that raises the next `contextmenu`: whoever opened this menu
    // answers that by opening one at the new spot, so closing here would race.
    const press = new MouseEvent('mousedown', { bubbles: true, button: 2 });
    Object.defineProperty(press, 'timeStamp', { value: performance.now() + 5 });

    document.dispatchEvent(press);
    fixture.detectChanges();

    expect(host.open()).toBe(true);
  });

  it('stays open when the press lands on the menu itself', () => {
    const item = document.querySelector('.context-menu-item') as HTMLElement;
    const press = new MouseEvent('mousedown', { bubbles: true });
    Object.defineProperty(press, 'timeStamp', { value: performance.now() + 5 });

    item.dispatchEvent(press);
    fixture.detectChanges();

    expect(host.open()).toBe(true);
  });

  it('reports the chosen item and ignores a disabled one', () => {
    const [enabled] = Array.from(document.querySelectorAll<HTMLButtonElement>('.context-menu-item'));
    enabled.click();

    expect(host.chosen?.id).toBe('comment-selection');
  });
});
