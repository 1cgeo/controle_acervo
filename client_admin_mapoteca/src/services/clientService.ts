// Path: services\clientService.ts
import apiClient from '@/lib/axios';
import { ApiResponse } from '@/types/api';
import {
  Client,
  ClientDetails,
  ClientType,
  ClientCreateRequest,
  ClientUpdateRequest,
} from '@/types/client';

/**
 * Get all clients
 */
export const getClients = async (): Promise<ApiResponse<Client[]>> => {
  try {
    const response = await apiClient.get<ApiResponse<Client[]>>('/api/mapoteca/cliente');
    return response.data;
  } catch (error) {
    console.error('Error fetching clients:', error);
    throw error;
  }
};

/**
 * Get client by ID
 */
export const getClientById = async (id: number): Promise<ApiResponse<ClientDetails>> => {
  try {
    const response = await apiClient.get<ApiResponse<ClientDetails>>(`/api/mapoteca/cliente/${id}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching client with ID ${id}:`, error);
    throw error;
  }
};

/**
 * Get client types
 */
export const getClientTypes = async (): Promise<ApiResponse<ClientType[]>> => {
  try {
    const response = await apiClient.get<ApiResponse<ClientType[]>>('/api/mapoteca/dominio/tipo_cliente');
    return response.data;
  } catch (error) {
    console.error('Error fetching client types:', error);
    throw error;
  }
};

/**
 * Create client
 */
export const createClient = async (
  clientData: ClientCreateRequest,
): Promise<ApiResponse<{ id: number }>> => {
  try {
    const response = await apiClient.post<ApiResponse<{ id: number }>>('/api/mapoteca/cliente', clientData);
    return response.data;
  } catch (error) {
    console.error('Error creating client:', error);
    throw error;
  }
};

/**
 * Update client
 */
export const updateClient = async (
  clientData: ClientUpdateRequest,
): Promise<ApiResponse<void>> => {
  try {
    const response = await apiClient.put<ApiResponse<void>>('/api/mapoteca/cliente', clientData);
    return response.data;
  } catch (error) {
    console.error('Error updating client:', error);
    throw error;
  }
};

/**
 * Delete clients
 */
export const deleteClients = async (
  clientIds: number[],
): Promise<ApiResponse<void>> => {
  try {
    const response = await apiClient.delete<ApiResponse<void>>('/api/mapoteca/cliente', {
      data: { cliente_ids: clientIds },
    });
    return response.data;
  } catch (error) {
    console.error('Error deleting clients:', error);
    throw error;
  }
};