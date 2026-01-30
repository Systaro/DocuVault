import { Injectable, signal } from '@angular/core';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: number;
  type: ToastType;
  title: string;
  message: string;
  action?: {
    label: string;
    handler: () => void;
  };
  duration: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 0;
  toasts = signal<Toast[]>([]);

  show(
    type: ToastType,
    title: string,
    message: string,
    options?: {
      duration?: number;
      action?: { label: string; handler: () => void };
    }
  ): number {
    const id = this.nextId++;
    const toast: Toast = {
      id,
      type,
      title,
      message,
      action: options?.action,
      duration: options?.duration ?? (type === 'error' ? 8000 : 5000)
    };

    this.toasts.update(toasts => [...toasts, toast]);

    if (toast.duration > 0) {
      setTimeout(() => this.dismiss(id), toast.duration);
    }

    return id;
  }

  success(title: string, message: string, options?: { duration?: number; action?: { label: string; handler: () => void } }): number {
    return this.show('success', title, message, options);
  }

  error(title: string, message: string, options?: { duration?: number; action?: { label: string; handler: () => void } }): number {
    return this.show('error', title, message, { duration: 8000, ...options });
  }

  warning(title: string, message: string, options?: { duration?: number; action?: { label: string; handler: () => void } }): number {
    return this.show('warning', title, message, options);
  }

  info(title: string, message: string, options?: { duration?: number; action?: { label: string; handler: () => void } }): number {
    return this.show('info', title, message, options);
  }

  dismiss(id: number): void {
    this.toasts.update(toasts => toasts.filter(t => t.id !== id));
  }

  dismissAll(): void {
    this.toasts.set([]);
  }
}
