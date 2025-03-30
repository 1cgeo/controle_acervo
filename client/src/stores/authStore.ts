import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { User, UserRole, LoginResponse, LoginRequest } from '../types/auth';
import { login as loginApi } from '../services/authService';

// Storage keys for localStorage
const STORAGE_KEYS = {
  TOKEN: '@sca_dashboard-Token',
  USER_AUTHORIZATION: '@sca_dashboard-User-Authorization',
  USER_UUID: '@sca_dashboard-User-uuid',
  USER_NAME: '@sca_dashboard-User-username',
  TOKEN_EXPIRY: '@sca_dashboard-Token-Expiry',
} as const;

// Helper functions for token management
const tokenStorage = {
  get: () => localStorage.getItem(STORAGE_KEYS.TOKEN),
  set: (token: string) => localStorage.setItem(STORAGE_KEYS.TOKEN, token),
  remove: () => localStorage.removeItem(STORAGE_KEYS.TOKEN),
};

const tokenExpiryStorage = {
  get: () => localStorage.getItem(STORAGE_KEYS.TOKEN_EXPIRY),
  set: (expiry: string) =>
    localStorage.setItem(STORAGE_KEYS.TOKEN_EXPIRY, expiry),
  remove: () => localStorage.removeItem(STORAGE_KEYS.TOKEN_EXPIRY),
};

// Function to check if token is expired
export const isTokenExpired = (): boolean => {
  try {
    const expiry = tokenExpiryStorage.get();
    if (!expiry) return false; // No expiry time means we don't know, assume not expired

    const expiryTime = new Date(expiry);
    return expiryTime <= new Date();
  } catch (error) {
    console.error('Error checking token expiry:', error);
    return false; // In case of any error, assume token is not expired
  }
};

// Store user data to localStorage for legacy compatibility
const saveUserDataToLocalStorage = (userData: {
  token: string;
  role: UserRole;
  uuid: string;
  username?: string;
}): void => {
  // Save token with expiration (1 hour based on the backend config)
  tokenStorage.set(userData.token);
  const expiryTime = new Date();
  expiryTime.setHours(expiryTime.getHours() + 1);
  tokenExpiryStorage.set(expiryTime.toISOString());

  // Save other user info
  localStorage.setItem(STORAGE_KEYS.USER_AUTHORIZATION, userData.role);
  localStorage.setItem(STORAGE_KEYS.USER_UUID, userData.uuid);
  if (userData.username) {
    localStorage.setItem(STORAGE_KEYS.USER_NAME, userData.username);
  }
};

// Clear all user data from localStorage
const clearUserDataFromLocalStorage = (): void => {
  tokenStorage.remove();
  tokenExpiryStorage.remove();
  localStorage.removeItem(STORAGE_KEYS.USER_AUTHORIZATION);
  localStorage.removeItem(STORAGE_KEYS.USER_UUID);
  localStorage.removeItem(STORAGE_KEYS.USER_NAME);
};

// Define the AuthState interface
interface AuthState {
  // State
  user: User | null;
  isAuthenticated: boolean;
  isAdmin: boolean;

  // Actions
  login: (credentials: LoginRequest) => Promise<boolean>;
  setUser: (loginResponse: LoginResponse, username: string) => void;
  logout: () => void;
  getRole: () => UserRole | null;
}

// Create the AuthStore with Zustand
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // Initial state
      user: null,
      isAuthenticated: false,
      isAdmin: false,

      // Actions
      login: async (credentials: LoginRequest) => {
        try {
          const response = await loginApi(credentials);

          if (response.success) {
            get().setUser(response.dados, credentials.usuario);
            return true;
          }
          return false;
        } catch (error) {
          console.error('Login error:', error);
          return false;
        }
      },

      setUser: (loginResponse: LoginResponse, username: string) => {
        const role = loginResponse.administrador
          ? UserRole.ADMIN
          : UserRole.USER;

        // Create user data object
        const userData = {
          uuid: loginResponse.uuid,
          role,
          token: loginResponse.token,
          username,
        };

        // Save to localStorage for legacy compatibility
        saveUserDataToLocalStorage(userData);

        // Update Zustand state
        set({
          user: userData,
          isAuthenticated: true,
          isAdmin: role === UserRole.ADMIN,
        });
      },

      logout: () => {
        // Clear localStorage
        clearUserDataFromLocalStorage();

        // Reset Zustand state
        set({
          user: null,
          isAuthenticated: false,
          isAdmin: false,
        });
      },

      getRole: () => get().user?.role || null,
    }),
    {
      name: 'auth-storage',
      // Only persist these fields
      partialize: state => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        isAdmin: state.isAdmin,
      }),
      // Use a custom storage to handle JSON parsing/stringifying
      storage: createJSONStorage(() => localStorage),
      // Add an onRehydrate callback to check token expiration when store loads
      onRehydrateStorage: () => state => {
        // Check token expiration on rehydration
        try {
          if (state?.isAuthenticated && isTokenExpired()) {
            // Clear the store if token is expired
            clearUserDataFromLocalStorage();
            // This will update the state after rehydration
            setTimeout(() => {
              const authStore = useAuthStore.getState();
              authStore.logout();
            }, 0);
          }
        } catch (error) {
          console.error('Error in rehydration:', error);
        }
      },
    },
  ),
);

// Selectors for performance optimization
export const selectIsAuthenticated = (state: AuthState) =>
  state.isAuthenticated;
export const selectIsAdmin = (state: AuthState) => state.isAdmin;
export const selectUser = (state: AuthState) => state.user;
export const selectUsername = (state: AuthState) => state.user?.username;

// Use consistent navigation approach for auth-related redirects
export const logoutAndRedirect = () => {
  // Get the logout function from the store
  const logout = useAuthStore.getState().logout;

  // Logout the user
  logout();

  // Navigate to login page
  window.location.href = '/login';
};