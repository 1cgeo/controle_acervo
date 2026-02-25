// Path: services\materialService.ts
import apiClient from '@/lib/axios';
import { ApiResponse } from '@/types/api';
import {
  MaterialType,
  MaterialTypeDetail,
  StockItem,
  ConsumptionItem,
  StockLocationSummary,
  MonthlyConsumption,
  LocationType,
  MaterialTypeCreateRequest,
  MaterialTypeUpdateRequest,
  StockItemCreateRequest,
  StockItemUpdateRequest,
  ConsumptionItemCreateRequest,
  ConsumptionItemUpdateRequest,
  ConsumptionFilterRequest,
} from '@/types/material';

/**
 * Get all location types
 */
export const getLocationTypes = async (): Promise<ApiResponse<LocationType[]>> => {
  try {
    const response = await apiClient.get<ApiResponse<LocationType[]>>('/api/mapoteca/dominio/tipo_localizacao');
    return response.data;
  } catch (error) {
    console.error('Error fetching location types:', error);
    throw error;
  }
};

/**
 * Get all material types
 */
export const getMaterialTypes = async (): Promise<ApiResponse<MaterialType[]>> => {
  try {
    const response = await apiClient.get<ApiResponse<MaterialType[]>>('/api/mapoteca/tipo_material');
    return response.data;
  } catch (error) {
    console.error('Error fetching material types:', error);
    throw error;
  }
};

/**
 * Get material type by ID
 */
export const getMaterialTypeById = async (id: number): Promise<ApiResponse<MaterialTypeDetail>> => {
  try {
    const response = await apiClient.get<ApiResponse<MaterialTypeDetail>>(`/api/mapoteca/tipo_material/${id}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching material type with ID ${id}:`, error);
    throw error;
  }
};

/**
 * Create material type
 */
export const createMaterialType = async (
  materialData: MaterialTypeCreateRequest,
): Promise<ApiResponse<{id: number}>> => {
  try {
    const response = await apiClient.post<ApiResponse<{id: number}>>('/api/mapoteca/tipo_material', materialData);
    return response.data;
  } catch (error) {
    console.error('Error creating material type:', error);
    throw error;
  }
};

/**
 * Update material type
 */
export const updateMaterialType = async (
  materialData: MaterialTypeUpdateRequest,
): Promise<ApiResponse<void>> => {
  try {
    const response = await apiClient.put<ApiResponse<void>>('/api/mapoteca/tipo_material', materialData);
    return response.data;
  } catch (error) {
    console.error('Error updating material type:', error);
    throw error;
  }
};

/**
 * Delete material types
 */
export const deleteMaterialTypes = async (
  materialTypeIds: number[],
): Promise<ApiResponse<void>> => {
  try {
    const response = await apiClient.delete<ApiResponse<void>>('/api/mapoteca/tipo_material', {
      data: { tipo_material_ids: materialTypeIds },
    });
    return response.data;
  } catch (error) {
    console.error('Error deleting material types:', error);
    throw error;
  }
};

/**
 * Get all stock items
 */
export const getStockItems = async (): Promise<ApiResponse<StockItem[]>> => {
  try {
    const response = await apiClient.get<ApiResponse<StockItem[]>>('/api/mapoteca/estoque_material');
    return response.data;
  } catch (error) {
    console.error('Error fetching stock items:', error);
    throw error;
  }
};

/**
 * Get stock by location summary
 */
export const getStockByLocation = async (): Promise<ApiResponse<StockLocationSummary[]>> => {
  try {
    const response = await apiClient.get<ApiResponse<StockLocationSummary[]>>('/api/mapoteca/estoque_por_localizacao');
    return response.data;
  } catch (error) {
    console.error('Error fetching stock by location:', error);
    throw error;
  }
};

/**
 * Create stock item
 */
export const createStockItem = async (
  stockData: StockItemCreateRequest,
): Promise<ApiResponse<{id: number}>> => {
  try {
    const response = await apiClient.post<ApiResponse<{id: number}>>('/api/mapoteca/estoque_material', stockData);
    return response.data;
  } catch (error) {
    console.error('Error creating stock item:', error);
    throw error;
  }
};

/**
 * Update stock item
 */
export const updateStockItem = async (
  stockData: StockItemUpdateRequest,
): Promise<ApiResponse<void>> => {
  try {
    const response = await apiClient.put<ApiResponse<void>>('/api/mapoteca/estoque_material', stockData);
    return response.data;
  } catch (error) {
    console.error('Error updating stock item:', error);
    throw error;
  }
};

/**
 * Delete stock items
 */
export const deleteStockItems = async (
  stockItemIds: number[],
): Promise<ApiResponse<void>> => {
  try {
    const response = await apiClient.delete<ApiResponse<void>>('/api/mapoteca/estoque_material', {
      data: { estoque_material_ids: stockItemIds },
    });
    return response.data;
  } catch (error) {
    console.error('Error deleting stock items:', error);
    throw error;
  }
};

/**
 * Get consumption items with optional filters
 */
export const getConsumptionItems = async (
  filters?: ConsumptionFilterRequest,
): Promise<ApiResponse<ConsumptionItem[]>> => {
  try {
    const response = await apiClient.get<ApiResponse<ConsumptionItem[]>>('/api/mapoteca/consumo_material', {
      params: filters,
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching consumption items:', error);
    throw error;
  }
};

/**
 * Get monthly consumption by material type
 */
export const getMonthlyConsumption = async (
  year?: number,
): Promise<ApiResponse<MonthlyConsumption[]>> => {
  try {
    const response = await apiClient.get<ApiResponse<MonthlyConsumption[]>>('/api/mapoteca/consumo_mensal', {
      params: { ano: year || new Date().getFullYear() },
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching monthly consumption:', error);
    throw error;
  }
};

/**
 * Create consumption item
 */
export const createConsumptionItem = async (
  consumptionData: ConsumptionItemCreateRequest,
): Promise<ApiResponse<{id: number}>> => {
  try {
    const response = await apiClient.post<ApiResponse<{id: number}>>('/api/mapoteca/consumo_material', consumptionData);
    return response.data;
  } catch (error) {
    console.error('Error creating consumption item:', error);
    throw error;
  }
};

/**
 * Update consumption item
 */
export const updateConsumptionItem = async (
  consumptionData: ConsumptionItemUpdateRequest,
): Promise<ApiResponse<void>> => {
  try {
    const response = await apiClient.put<ApiResponse<void>>('/api/mapoteca/consumo_material', consumptionData);
    return response.data;
  } catch (error) {
    console.error('Error updating consumption item:', error);
    throw error;
  }
};

/**
 * Delete consumption items
 */
export const deleteConsumptionItems = async (
  consumptionItemIds: number[],
): Promise<ApiResponse<void>> => {
  try {
    const response = await apiClient.delete<ApiResponse<void>>('/api/mapoteca/consumo_material', {
      data: { consumo_material_ids: consumptionItemIds },
    });
    return response.data;
  } catch (error) {
    console.error('Error deleting consumption items:', error);
    throw error;
  }
};