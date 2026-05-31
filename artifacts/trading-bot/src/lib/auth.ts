const KEY = "bot_api_key";

export function getStoredKey(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setStoredKey(key: string) {
  try {
    localStorage.setItem(KEY, key);
  } catch {
    // ignore
  }
}

export function clearStoredKey() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
