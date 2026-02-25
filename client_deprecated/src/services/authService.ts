import apiClient from '../lib/axios';
import { ApiResponse } from '../types/api';
import { LoginRequest, LoginResponse } from '../types/auth';

/**
 * Login user with username and password
 */
export const login = async (
  credentials: LoginRequest,
): Promise<ApiResponse<LoginResponse>> => {
  try {
    const response = await apiClient.post<ApiResponse<LoginResponse>>(
      '/api/login',
      {
        usuario: credentials.usuario,
        senha: credentials.senha,
        cliente: 'sca_web' // Client identifier
      },
    );

    // If login is successful, store token expiry (assuming token valid for 1 hour based on the backend config)
    if (response.data.success && response.data.dados.token) {
      const expiryTime = new Date();
      expiryTime.setHours(expiryTime.getHours() + 1); // Token expires in 1 hour
      localStorage.setItem('@sca_dashboard-Token-Expiry', expiryTime.toISOString());
    }

    return response.data;
  } catch (error) {
    console.error('Error during login:', error);
    throw error;
  }
};