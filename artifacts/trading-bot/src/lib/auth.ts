const TOKEN_KEY = "jwt_token";
const USER_KEY = "jwt_user";

export interface AuthUser {
  userId: string;
  username: string;
  role: string;
  token: string;
}

export function getStoredAuth(): AuthUser | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const user = localStorage.getItem(USER_KEY);
    if (!token || !user) return null;
    return { ...(JSON.parse(user) as Omit<AuthUser, "token">), token };
  } catch {
    return null;
  }
}

export function setStoredAuth(auth: AuthUser) {
  try {
    const { token, ...user } = auth;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // ignore
  }
}

export function clearStoredAuth() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    // ignore
  }
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getStoredKey(): string | null {
  return getStoredToken();
}

export function clearStoredKey() {
  clearStoredAuth();
}
