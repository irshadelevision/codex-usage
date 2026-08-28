interface PreventableEvent {
  preventDefault(): void;
}

export class MenuBarLifecycle {
  readonly #moveToMenuBar: () => void;
  #quitAllowed = false;

  constructor(moveToMenuBar: () => void) {
    this.#moveToMenuBar = moveToMenuBar;
  }

  intercept(event: PreventableEvent): boolean {
    if (this.#quitAllowed) return false;
    event.preventDefault();
    this.#moveToMenuBar();
    return true;
  }

  redirect(beforeMove?: () => void): boolean {
    if (this.#quitAllowed) return false;
    beforeMove?.();
    this.#moveToMenuBar();
    return true;
  }

  requestQuit(senderId: number, menuBarSenderId: number | null): boolean {
    if (menuBarSenderId === null || senderId !== menuBarSenderId) {
      this.#moveToMenuBar();
      return false;
    }
    this.allowQuit();
    return true;
  }

  allowQuit() {
    this.#quitAllowed = true;
  }
}
