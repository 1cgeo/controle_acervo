// Path: services\plotterService.ts
import apiClient from '@/lib/axios';
import { ApiResponse } from '@/types/api';
import {
  Plotter,
  PlotterDetail,
  MaintenanceItem,
  PlotterCreateRequest,
  PlotterUpdateRequest,
  MaintenanceItemCreateRequest,
  MaintenanceItemUpdateRequest,
} from '@/types/plotter';

/**
 * Get all plotters
 */
export const getPlotters = async (): Promise<ApiResponse<Plotter[]>> => {
  try {
    const response = await apiClient.get<ApiResponse<Plotter[]>>('/api/mapoteca/plotter');
    return response.data;
  } catch (error) {
    console.error('Error fetching plotters:', error);
    throw error;
  }
};

/**
 * Get plotter by ID
 */
export const getPlotterById = async (id: number): Promise<ApiResponse<PlotterDetail>> => {
  try {
    const response = await apiClient.get<ApiResponse<PlotterDetail>>(`/api/mapoteca/plotter/${id}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching plotter with ID ${id}:`, error);
    throw error;
  }
};

/**
 * Create plotter
 */
export const createPlotter = async (
  plotterData: PlotterCreateRequest,
): Promise<ApiResponse<void>> => {
  try {
    const response = await apiClient.post<ApiResponse<void>>('/api/mapoteca/plotter', plotterData);
    return response.data;
  } catch (error) {
    console.error('Error creating plotter:', error);
    throw error;
  }
};

/**
 * Update plotter
 */
export const updatePlotter = async (
  plotterData: PlotterUpdateRequest,
): Promise<ApiResponse<void>> => {
  try {
    const response = await apiClient.put<ApiResponse<void>>('/api/mapoteca/plotter', plotterData);
    return response.data;
  } catch (error) {
    console.error('Error updating plotter:', error);
    throw error;
  }
};

/**
 * Delete plotters
 */
export const deletePlotters = async (
  plotterIds: number[],
): Promise<ApiResponse<void>> => {
  try {
    const response = await apiClient.delete<ApiResponse<void>>('/api/mapoteca/plotter', {
      data: { plotter_ids: plotterIds },
    });
    return response.data;
  } catch (error) {
    console.error('Error deleting plotters:', error);
    throw error;
  }
};

/**
 * Get all maintenance items
 */
export const getMaintenanceItems = async (): Promise<ApiResponse<MaintenanceItem[]>> => {
  try {
    const response = await apiClient.get<ApiResponse<MaintenanceItem[]>>('/api/mapoteca/manutencao_plotter');
    return response.data;
  } catch (error) {
    console.error('Error fetching maintenance items:', error);
    throw error;
  }
};

/**
 * Create maintenance item
 */
export const createMaintenanceItem = async (
  maintenanceData: MaintenanceItemCreateRequest,
): Promise<ApiResponse<void>> => {
  try {
    const response = await apiClient.post<ApiResponse<void>>('/api/mapoteca/manutencao_plotter', maintenanceData);
    return response.data;
  } catch (error) {
    console.error('Error creating maintenance item:', error);
    throw error;
  }
};

/**
 * Update maintenance item
 */
export const updateMaintenanceItem = async (
  maintenanceData: MaintenanceItemUpdateRequest,
): Promise<ApiResponse<void>> => {
  try {
    const response = await apiClient.put<ApiResponse<void>>('/api/mapoteca/manutencao_plotter', maintenanceData);
    return response.data;
  } catch (error) {
    console.error('Error updating maintenance item:', error);
    throw error;
  }
};

/**
 * Delete maintenance items
 */
export const deleteMaintenanceItems = async (
  maintenanceItemIds: number[],
): Promise<ApiResponse<void>> => {
  try {
    const response = await apiClient.delete<ApiResponse<void>>('/api/mapoteca/manutencao_plotter', {
      data: { manutencao_ids: maintenanceItemIds },
    });
    return response.data;
  } catch (error) {
    console.error('Error deleting maintenance items:', error);
    throw error;
  }
};