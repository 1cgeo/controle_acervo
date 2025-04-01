// Path: hooks\useMapotecaMaterials.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import {
  MaterialType,
  MaterialTypeDetail,
  StockItem,
  ConsumptionItem,
  LocationType,
  MaterialTypeCreateRequest,
  MaterialTypeUpdateRequest,
  StockItemCreateRequest,
  StockItemUpdateRequest,
  ConsumptionItemCreateRequest,
  ConsumptionItemUpdateRequest,
  ConsumptionFilterRequest
} from '@/types/material';
import { ApiResponse } from '@/types/api';
import { standardizeError } from '@/lib/queryClient';
import {
  getLocationTypes,
  getMaterialTypes,
  getMaterialTypeById,
  createMaterialType,
  updateMaterialType,
  deleteMaterialTypes,
  getStockItems,
  getStockByLocation,
  createStockItem,
  updateStockItem,
  deleteStockItems,
  getConsumptionItems,
  getMonthlyConsumption,
  createConsumptionItem,
  updateConsumptionItem,
  deleteConsumptionItems
} from '@/services/materialService';

// Query keys
const LOCATION_TYPES_KEY = ['locationTypes'];
const MATERIAL_TYPES_KEY = ['materialTypes'];
const MATERIAL_TYPE_DETAIL_KEY = ['materialTypeDetail'];
const STOCK_ITEMS_KEY = ['stockItems'];
const STOCK_BY_LOCATION_KEY = ['stockByLocation'];
const CONSUMPTION_ITEMS_KEY = ['consumptionItems'];
const MONTHLY_CONSUMPTION_KEY = ['monthlyConsumption'];

/**
 * Custom hook for material management
 */
export const useMapotecaMaterials = () => {
  const queryClient = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();

  // Get location types (references)
  const locationTypesQuery = useQuery({
    queryKey: LOCATION_TYPES_KEY,
    queryFn: async () => {
      const response = await getLocationTypes();
      return response.dados;
    },
  });

  // Get all material types
  const materialTypesQuery = useQuery({
    queryKey: MATERIAL_TYPES_KEY,
    queryFn: async () => {
      const response = await getMaterialTypes();
      return response.dados;
    },
  });

  // Get material type by ID
  const getMaterialType = (id?: number) => {
    return useQuery({
      queryKey: [...MATERIAL_TYPE_DETAIL_KEY, id],
      queryFn: async () => {
        if (!id) throw new Error('Material Type ID is required');
        const response = await getMaterialTypeById(id);
        return response.dados;
      },
      enabled: !!id,
    });
  };

  // Get stock items
  const stockItemsQuery = useQuery({
    queryKey: STOCK_ITEMS_KEY,
    queryFn: async () => {
      const response = await getStockItems();
      return response.dados;
    },
  });

  // Get stock by location
  const stockByLocationQuery = useQuery({
    queryKey: STOCK_BY_LOCATION_KEY,
    queryFn: async () => {
      const response = await getStockByLocation();
      return response.dados;
    },
  });

  // Get consumption items with optional filters
  const getConsumption = (filters?: ConsumptionFilterRequest) => {
    return useQuery({
      queryKey: [...CONSUMPTION_ITEMS_KEY, filters],
      queryFn: async () => {
        const response = await getConsumptionItems(filters);
        return response.dados;
      },
    });
  };

  // Get monthly consumption
  const getMonthlyConsumptionData = (year?: number) => {
    return useQuery({
      queryKey: [...MONTHLY_CONSUMPTION_KEY, year],
      queryFn: async () => {
        const response = await getMonthlyConsumption(year);
        return response.dados;
      },
    });
  };

  // Create material type mutation
  const createMaterialTypeMutation = useMutation({
    mutationFn: (data: MaterialTypeCreateRequest) => createMaterialType(data),
    onSuccess: (data: ApiResponse<any>) => {
      queryClient.invalidateQueries({ queryKey: MATERIAL_TYPES_KEY });
      enqueueSnackbar(data.message || 'Tipo de material criado com sucesso', {
        variant: 'success',
      });
    },
    onError: error => {
      const standardizedError = standardizeError(error);
      enqueueSnackbar(standardizedError.message || 'Erro ao criar tipo de material', {
        variant: 'error',
      });
    },
  });

  // Update material type mutation
  const updateMaterialTypeMutation = useMutation({
    mutationFn: (data: MaterialTypeUpdateRequest) => updateMaterialType(data),
    onSuccess: (data: ApiResponse<any>) => {
      queryClient.invalidateQueries({ queryKey: MATERIAL_TYPES_KEY });
      queryClient.invalidateQueries({ 
        queryKey: [...MATERIAL_TYPE_DETAIL_KEY, data.dados?.id]
      });
      enqueueSnackbar(data.message || 'Tipo de material atualizado com sucesso', {
        variant: 'success',
      });
    },
    onError: error => {
      const standardizedError = standardizeError(error);
      enqueueSnackbar(standardizedError.message || 'Erro ao atualizar tipo de material', {
        variant: 'error',
      });
    },
  });

  // Delete material types mutation
  const deleteMaterialTypesMutation = useMutation({
    mutationFn: (ids: number[]) => deleteMaterialTypes(ids),
    onSuccess: (data: ApiResponse<any>) => {
      queryClient.invalidateQueries({ queryKey: MATERIAL_TYPES_KEY });
      enqueueSnackbar(data.message || 'Tipo(s) de material removido(s) com sucesso', {
        variant: 'success',
      });
    },
    onError: error => {
      const standardizedError = standardizeError(error);
      enqueueSnackbar(standardizedError.message || 'Erro ao remover tipo(s) de material', {
        variant: 'error',
      });
    },
  });

  // Create stock item mutation
  const createStockItemMutation = useMutation({
    mutationFn: (data: StockItemCreateRequest) => createStockItem(data),
    onSuccess: (data: ApiResponse<any>) => {
      queryClient.invalidateQueries({ queryKey: STOCK_ITEMS_KEY });
      queryClient.invalidateQueries({ queryKey: STOCK_BY_LOCATION_KEY });
      queryClient.invalidateQueries({ queryKey: MATERIAL_TYPES_KEY });
      enqueueSnackbar(data.message || 'Estoque criado com sucesso', {
        variant: 'success',
      });
    },
    onError: error => {
      const standardizedError = standardizeError(error);
      enqueueSnackbar(standardizedError.message || 'Erro ao criar estoque', {
        variant: 'error',
      });
    },
  });

  // Update stock item mutation
  const updateStockItemMutation = useMutation({
    mutationFn: (data: StockItemUpdateRequest) => updateStockItem(data),
    onSuccess: (data: ApiResponse<any>) => {
      queryClient.invalidateQueries({ queryKey: STOCK_ITEMS_KEY });
      queryClient.invalidateQueries({ queryKey: STOCK_BY_LOCATION_KEY });
      queryClient.invalidateQueries({ queryKey: MATERIAL_TYPES_KEY });
      enqueueSnackbar(data.message || 'Estoque atualizado com sucesso', {
        variant: 'success',
      });
    },
    onError: error => {
      const standardizedError = standardizeError(error);
      enqueueSnackbar(standardizedError.message || 'Erro ao atualizar estoque', {
        variant: 'error',
      });
    },
  });

  // Delete stock items mutation
  const deleteStockItemsMutation = useMutation({
    mutationFn: (ids: number[]) => deleteStockItems(ids),
    onSuccess: (data: ApiResponse<any>) => {
      queryClient.invalidateQueries({ queryKey: STOCK_ITEMS_KEY });
      queryClient.invalidateQueries({ queryKey: STOCK_BY_LOCATION_KEY });
      queryClient.invalidateQueries({ queryKey: MATERIAL_TYPES_KEY });
      enqueueSnackbar(data.message || 'Estoque(s) removido(s) com sucesso', {
        variant: 'success',
      });
    },
    onError: error => {
      const standardizedError = standardizeError(error);
      enqueueSnackbar(standardizedError.message || 'Erro ao remover estoque(s)', {
        variant: 'error',
      });
    },
  });

  // Create consumption item mutation
  const createConsumptionItemMutation = useMutation({
    mutationFn: (data: ConsumptionItemCreateRequest) => createConsumptionItem(data),
    onSuccess: (data: ApiResponse<any>) => {
      queryClient.invalidateQueries({ queryKey: CONSUMPTION_ITEMS_KEY });
      queryClient.invalidateQueries({ queryKey: MONTHLY_CONSUMPTION_KEY });
      queryClient.invalidateQueries({ queryKey: MATERIAL_TYPES_KEY });
      enqueueSnackbar(data.message || 'Consumo registrado com sucesso', {
        variant: 'success',
      });
    },
    onError: error => {
      const standardizedError = standardizeError(error);
      enqueueSnackbar(standardizedError.message || 'Erro ao registrar consumo', {
        variant: 'error',
      });
    },
  });

  // Update consumption item mutation
  const updateConsumptionItemMutation = useMutation({
    mutationFn: (data: ConsumptionItemUpdateRequest) => updateConsumptionItem(data),
    onSuccess: (data: ApiResponse<any>) => {
      queryClient.invalidateQueries({ queryKey: CONSUMPTION_ITEMS_KEY });
      queryClient.invalidateQueries({ queryKey: MONTHLY_CONSUMPTION_KEY });
      queryClient.invalidateQueries({ queryKey: MATERIAL_TYPES_KEY });
      enqueueSnackbar(data.message || 'Consumo atualizado com sucesso', {
        variant: 'success',
      });
    },
    onError: error => {
      const standardizedError = standardizeError(error);
      enqueueSnackbar(standardizedError.message || 'Erro ao atualizar consumo', {
        variant: 'error',
      });
    },
  });

  // Delete consumption items mutation
  const deleteConsumptionItemsMutation = useMutation({
    mutationFn: (ids: number[]) => deleteConsumptionItems(ids),
    onSuccess: (data: ApiResponse<any>) => {
      queryClient.invalidateQueries({ queryKey: CONSUMPTION_ITEMS_KEY });
      queryClient.invalidateQueries({ queryKey: MONTHLY_CONSUMPTION_KEY });
      queryClient.invalidateQueries({ queryKey: MATERIAL_TYPES_KEY });
      enqueueSnackbar(data.message || 'Consumo(s) removido(s) com sucesso', {
        variant: 'success',
      });
    },
    onError: error => {
      const standardizedError = standardizeError(error);
      enqueueSnackbar(standardizedError.message || 'Erro ao remover consumo(s)', {
        variant: 'error',
      });
    },
  });

  return {
    // Queries
    locationTypes: locationTypesQuery.data || [],
    materialTypes: materialTypesQuery.data || [],
    stockItems: stockItemsQuery.data || [],
    stockByLocation: stockByLocationQuery.data || [],
    getMaterialType,
    getConsumption,
    getMonthlyConsumption: getMonthlyConsumptionData,

    // Loading states
    isLoadingLocationTypes: locationTypesQuery.isLoading,
    isLoadingMaterialTypes: materialTypesQuery.isLoading,
    isLoadingStockItems: stockItemsQuery.isLoading,
    isLoadingStockByLocation: stockByLocationQuery.isLoading,

    // Mutations for material types
    createMaterialType: createMaterialTypeMutation.mutate,
    updateMaterialType: updateMaterialTypeMutation.mutate,
    deleteMaterialTypes: deleteMaterialTypesMutation.mutate,

    // Mutations for stock
    createStockItem: createStockItemMutation.mutate,
    updateStockItem: updateStockItemMutation.mutate,
    deleteStockItems: deleteStockItemsMutation.mutate,

    // Mutations for consumption
    createConsumptionItem: createConsumptionItemMutation.mutate,
    updateConsumptionItem: updateConsumptionItemMutation.mutate,
    deleteConsumptionItems: deleteConsumptionItemsMutation.mutate,

    // Mutation states
    isCreatingMaterialType: createMaterialTypeMutation.isPending,
    isUpdatingMaterialType: updateMaterialTypeMutation.isPending,
    isDeletingMaterialTypes: deleteMaterialTypesMutation.isPending,
    isCreatingStockItem: createStockItemMutation.isPending,
    isUpdatingStockItem: updateStockItemMutation.isPending,
    isDeletingStockItems: deleteStockItemsMutation.isPending,
    isCreatingConsumptionItem: createConsumptionItemMutation.isPending,
    isUpdatingConsumptionItem: updateConsumptionItemMutation.isPending,
    isDeletingConsumptionItems: deleteConsumptionItemsMutation.isPending,

    // Refetch functions
    refetchMaterialTypes: materialTypesQuery.refetch,
    refetchStockItems: stockItemsQuery.refetch,
    refetchStockByLocation: stockByLocationQuery.refetch,
  };
};