type Subscriber = (key: string, value: string | null) => void;

class UrlStateManager {
  private subscribers = new Map<string, Set<Subscriber>>();

  constructor() {
    // Ensure listener is added only once and in a browser context
    if (typeof window !== 'undefined') {
        window.addEventListener('popstate', this.handlePopState);
    }
  }

  // Clean up the event listener when it's no longer needed (e.g., in a SPA teardown)
  // This is harder to manage with a simple singleton export, but important for robustness.
  // For now, we'll assume it lives for the app's lifetime.
  // destroy() {
  //   if (typeof window !== 'undefined') {
  //      window.removeEventListener('popstate', this.handlePopState);
  //   }
  // }

  private handlePopState = () => {
    // Notify relevant subscribers about the change
    this.notifyAllForPopState();
  };

  // Modified notifyAll to be specific for popstate
  private notifyAllForPopState() {
    console.debug('Handling popstate event');
    const params = new URLSearchParams(window.location.search);
    this.subscribers.forEach((subs, key) => {
      const currentValue = params.get(key);
      // Consider only notifying if the value actually changed,
      // though simply notifying might be easier.
      subs.forEach(cb => {
          try {
              cb(key, currentValue);
          } catch (e) {
              console.error(`Error in popstate subscriber for key "${key}":`, e);
          }
      });
    });
  }

  // --- ADD THIS METHOD ---
  getParam(key: string): string | null {
    if (typeof window === 'undefined') {
      return null; // Return null in non-browser environments
    }
    const params = new URLSearchParams(window.location.search);
    return params.get(key);
  }
  // ----------------------

  updateParam(key: string, value: string | null) {
    if (typeof window === 'undefined') return; // Guard for non-browser

    const currentVal = this.getParam(key);
    // Only proceed if the value has actually changed
    if (currentVal === value) {
        return;
    }

    const url = new URL(window.location.href);
    if (value !== null && value !== undefined && value !== '') { // Check explicitly against null/undefined/empty string
      url.searchParams.set(key, value);
    } else {
      url.searchParams.delete(key);
    }

    // Use replaceState to avoid polluting browser history for filters/pagination
    window.history.replaceState({}, '', url.toString()); // Use toString() for safety
    this.notify(key, value); // Notify subscribers of the change
  }

  private notify(key: string, value: string | null) {
    const subs = this.subscribers.get(key);
    // Use optional chaining and iterate safely
    subs?.forEach(cb => {
        try {
            cb(key, value);
        } catch (e) {
            console.error(`Error in subscriber for key "${key}":`, e);
        }
    });
  }

  subscribe(key: string, callback: Subscriber): () => void { // Return unsubscribe function
    const subs = this.subscribers.get(key) || new Set<Subscriber>(); // Ensure type
    subs.add(callback);
    this.subscribers.set(key, subs);

    // Return the unsubscribe function
    return () => this.unsubscribe(key, callback);
  }

  unsubscribe(key: string, callback: Subscriber) {
    const subs = this.subscribers.get(key);
    if (subs) { // Check if subs exist
        subs.delete(callback);
        if (subs.size === 0) {
            this.subscribers.delete(key); // Clean up map entry if no subscribers left
        }
    }
  }
}

// Export a single instance (Singleton pattern)
export const urlStateManager = new UrlStateManager();