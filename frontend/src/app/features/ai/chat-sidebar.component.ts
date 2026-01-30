import { Component, Input, Output, EventEmitter, signal, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AiService, ChatHistory, ChatMessage } from '../../core/api/ai.service';

@Component({
  selector: 'app-chat-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="fixed right-0 top-16 bottom-0 w-96 bg-white border-l border-gray-200 flex flex-col z-40 shadow-lg">
      <!-- Header -->
      <div class="p-4 border-b border-gray-200 flex items-center justify-between">
        <h2 class="font-semibold text-gray-900">AI Assistant</h2>
        <button (click)="close.emit()" class="text-gray-400 hover:text-gray-600">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        </button>
      </div>

      <!-- Chat History List -->
      @if (!currentChat()) {
        <div class="flex-1 overflow-y-auto">
          <div class="p-4">
            <button
              (click)="startNewChat()"
              class="w-full btn btn-primary mb-4"
            >
              New Conversation
            </button>

            @if (chatHistories().length > 0) {
              <div class="text-sm font-medium text-gray-500 mb-2">Recent Conversations</div>
              @for (history of chatHistories(); track history.id) {
                <button
                  (click)="loadChat(history)"
                  class="w-full text-left p-3 rounded-lg hover:bg-gray-100 mb-2"
                >
                  <div class="font-medium text-gray-900 truncate">{{ history.title || 'Untitled' }}</div>
                  <div class="text-sm text-gray-500">{{ formatDate(history.updatedAt) }}</div>
                </button>
              }
            } @else {
              <p class="text-gray-500 text-sm text-center py-8">
                No conversations yet. Start asking questions about your documentation!
              </p>
            }
          </div>
        </div>
      } @else {
        <!-- Chat View -->
        <div class="flex-1 overflow-y-auto p-4">
          <button
            (click)="currentChat.set(null)"
            class="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 mb-4"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>
            </svg>
            Back to conversations
          </button>

          @for (msg of currentChat()!.messages; track $index) {
            <div class="mb-4" [class.ml-8]="msg.role === 'user'">
              <div
                class="rounded-lg p-3"
                [class.bg-primary-100]="msg.role === 'user'"
                [class.bg-gray-100]="msg.role === 'assistant'"
              >
                <div class="text-sm font-medium mb-1">
                  {{ msg.role === 'user' ? 'You' : 'AI' }}
                </div>
                <div class="text-sm text-gray-700 whitespace-pre-wrap">{{ msg.content }}</div>
                @if (msg.sources && msg.sources.length > 0) {
                  <div class="mt-2 pt-2 border-t border-gray-200">
                    <div class="text-xs font-medium text-gray-500 mb-1">Sources:</div>
                    @for (source of msg.sources; track source) {
                      <span class="inline-block text-xs bg-gray-200 px-2 py-0.5 rounded mr-1 mb-1">
                        {{ source }}
                      </span>
                    }
                  </div>
                }
              </div>
            </div>
          }

          @if (loading()) {
            <div class="flex items-center gap-2 text-gray-500">
              <svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              Thinking...
            </div>
          }
        </div>

        <!-- Input -->
        <div class="p-4 border-t border-gray-200">
          <form (ngSubmit)="sendMessage()" class="flex gap-2">
            <input
              type="text"
              [(ngModel)]="messageInput"
              name="message"
              placeholder="Ask about your documentation..."
              class="input flex-1"
              [disabled]="loading()"
            />
            <button
              type="submit"
              [disabled]="!messageInput.trim() || loading()"
              class="btn btn-primary"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
              </svg>
            </button>
          </form>
        </div>
      }
    </div>
  `
})
export class ChatSidebarComponent implements OnChanges {
  @Input() spaceId!: string;
  @Output() close = new EventEmitter<void>();

  chatHistories = signal<ChatHistory[]>([]);
  currentChat = signal<ChatHistory | null>(null);
  loading = signal(false);
  messageInput = '';

  constructor(private aiService: AiService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['spaceId'] && this.spaceId) {
      this.loadChatHistories();
    }
  }

  loadChatHistories(): void {
    this.aiService.getChatHistory(this.spaceId).subscribe({
      next: (histories) => this.chatHistories.set(histories)
    });
  }

  startNewChat(): void {
    this.currentChat.set({
      id: '',
      spaceId: this.spaceId,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  loadChat(history: ChatHistory): void {
    this.aiService.getChatHistoryById(history.id).subscribe({
      next: (chat) => this.currentChat.set(chat)
    });
  }

  sendMessage(): void {
    if (!this.messageInput.trim() || this.loading()) return;

    const message = this.messageInput;
    this.messageInput = '';

    const chat = this.currentChat();
    if (chat) {
      // Add user message to UI immediately
      chat.messages = [...chat.messages, {
        role: 'user',
        content: message,
        timestamp: new Date().toISOString()
      }];
      this.currentChat.set({ ...chat });
    }

    this.loading.set(true);

    this.aiService.chat(this.spaceId, message, this.currentChat()?.id || undefined).subscribe({
      next: (response) => {
        const updatedChat = this.currentChat();
        if (updatedChat) {
          updatedChat.id = response.chatHistoryId || updatedChat.id;
          updatedChat.messages = [...updatedChat.messages, {
            role: 'assistant',
            content: response.message,
            sources: response.sources,
            timestamp: new Date().toISOString()
          }];
          this.currentChat.set({ ...updatedChat });
        }
        this.loading.set(false);
        this.loadChatHistories();
      },
      error: () => {
        this.loading.set(false);
      }
    });
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString();
  }
}
