// Path: hooks\useMapotecaPlotters.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import {
  Plotter,
  PlotterDetail,
  MaintenanceItem,
  PlotterCreateRequest,
  PlotterUpdateRequest,
  MaintenanceItemCreateRequest,
  MaintenanceItemUpdateRequest,
} from '@/types/plotter';
import { ApiResponse } from '@/types/api';
import { standardizeError } from '@/lib/queryClient';
import {
  getPlotters,
  getPlotterById,
  createPlotter,
  updatePlotter,
  deletePlotters,
  getMaintenanceItems,
  createMaintenanceItem,
  updateMaintenanceItem,
  deleteMaintenanceItems,
} from '@/services/plotterService';

// Query keys
const PLOTTERS_KEY = ['plotters'];
const PLOTTER_DETAIL_KEY = ['plotterDetail'];
const MAINTENANCE_ITEMS_KEY = ['maintenanceItems'];

/**
 * Custom hook for plotter and maintenance management
 */
export const useMapotecaPlotters = () => {
  const queryClient = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();

  // Get all plotters
  const plottersQuery = useQuery({
    queryKey: PLOTTERS_KEY,
    queryFn: async () => {
      const response = await getPlotters();
      return response.dados;
    },
  });

  // Get plotter by ID
  const getPlotter = (id?: number) => {
    return useQuery({
      queryKey: [...PLOTTER_DETAIL_KEY, id],
      queryFn: async () => {
        if (!id) throw new Error('Plotter ID is required');
        const response = await getPlotterById(id);
        return response.dados;
      },
      enabled: !!id,
    });
  };

  // Get all maintenance items
  const maintenanceItemsQuery = useQuery({
    queryKey: MAINTENANCE_ITEMS_KEY,
    queryFn: async () => {
      const response = await getMaintenanceItems();
      return response.dados;
    },
  });

  // Create plotter mutation
  const createPlotterMutation = useMutation({
    mutationFn: (data: PlotterCreateRequest) => createPlotter(data),
    onSuccess: (data: ApiResponse<any>) => {
      queryClient.invalidateQueries({ queryKey: PLOTTERS_KEY });
      enqueueSnackbar(data.message || 'Plotter criado com sucesso', {
        variant: 'success',
      });
    },
    onError: error => {
      const standardizedError = standardizeError(error);
      enqueueSnackbar(standardizedError.message || 'Erro ao criar plotter', {
        variant: 'error',
      });
    },
  });

  // Update plotter mutation
  const updatePlotterMutation = useMutation({
    mutationFn: (data: PlotterUpdateRequest) => updatePlotter(data),
    onSuccess: (data: ApiResponse<any>) => {
      queryClient.invalidateQueries({ queryKey: PLOTTERS_KEY });
      queryClient.invalidateQueries({ 
        queryKey: [...PLOTTER_DETAIL_KEY, data.dados?.id]
      });
      enqueueSnackbar(data.message || 'Plotter atualizado com sucesso', {
        variant: 'success',
      });
    },
    onError: error => {
      const standardizedError = standardizeError(error);
      enqueueSnackbar(standardizedError.message || 'Erro ao atualizar plotter', {
        variant: 'error',
      });
    },
  });

  // Delete plotters mutation
  const deletePlottersMutation = useMutation({
    mutationFn: (ids: number[]) => deletePlotters(ids),
    onSuccess: (data: ApiResponse<any>) => {
      queryClient.invalidateQueries({ queryKey: PLOTTERS_KEY });
      enqueueSnackbar(data.message || 'Plotter(s) removido(s) com sucesso', {
        variant: 'success',
      });
    },
    onError: error => {
      const standardizedError = standardizeError(error);
      enqueueSnackbar(standardizedError.message || 'Erro ao remover plotter(s)', {
        variant: 'error',
      });
    },
  });

  // Create maintenance item mutation
  const createMaintenanceItemMutation = useMutation({
    mutationFn: (data: MaintenanceItemCreateRequest) => createMaintenanceItem(data),
    onSuccess: (data: ApiResponse<any>) => {
      queryClient.invalidateQueries({ queryKey: MAINTENANCE_ITEMS_KEY });
      queryClient.invalidateQueries({ 
        queryKey: [...PLOTTER_DETAIL_KEY, data.dados?.plotter_id]
      });
      queryClient.invalidateQueries({ queryKey: PLOTTERS_KEY });
      enqueueSnackbar(data.message || 'Manutenção registrada com sucesso', {
        variant: 'success',
      });
    },
    onError: error => {
      const standardizedError = standardizeError(error);
      enqueueSnackbar(standardizedError.message || 'Erro ao registrar manutenção', {
        variant: 'error',
      });
    },
  });

  // Update maintenance item mutation
  const updateMaintenanceItemMutation = useMutation({
    mutationFn: (data: MaintenanceItemUpdateRequest) => updateMaintenanceItem(data),
    onSuccess: (data: ApiResponse<any>) => {
      queryClient.invalidateQueries({ queryKey: MAINTENANCE_ITEMS_KEY });
      queryClient.invalidateQueries({ 
        queryKey: [...PLOTTER_DETAIL_KEY, data.dados?.plotter_id]
      });
      queryClient.invalidateQueries({ queryKey: PLOTTERS_KEY });
      enqueueSnackbar(data.message || 'Manutenção atualizada com sucesso', {
        variant: 'success',
      });
    },
    onError: error => {
      const standardizedError = standardizeError(error);
      enqueueSnackbar(standardizedError.message || 'Erro ao atualizar manutenção', {
        variant: 'error',
      });
    },
  });

  // Delete maintenance items mutation
  const deleteMaintenanceItemsMutation = useMutation({
    mutationFn: (ids: number[]) => deleteMaintenanceItems(ids),
    onSuccess: (data: ApiResponse<any>) => {
      queryClient.invalidateQueries({ queryKey: MAINTENANCE_ITEMS_KEY });
      // Since we don't know which plotter(s) were affected, invalidate all plotter details
      queryClient.invalidateQueries({ queryKey: PLOTTER_DETAIL_KEY });
      queryClient.invalidateQueries({ queryKey: PLOTTERS_KEY });
      enqueueSnackbar(data.message || 'Manutenção(ões) removida(s) com sucesso', {
        variant: 'success',
      });
    },
    onError: error => {
      const standardizedError = standardizeError(error);
      enqueueSnackbar(standardizedError.message || 'Erro ao remover manutenção(ões)', {
        variant: 'error',
      });
    },
  });

  return {
    // Queries
    plotters: plottersQuery.data || [],
    maintenanceItems: maintenanceItemsQuery.data || [],
    getPlotter,
    
    // Loading states
    isLoadingPlotters: plottersQuery.isLoading,
    isLoadingMaintenanceItems: maintenanceItemsQuery.isLoading,

    // Mutations for plotters
    createPlotter: createPlotterMutation.mutate,
    updatePlotter: updatePlotterMutation.mutate,
    deletePlotters: deletePlottersMutation.mutate,

    // Mutations for maintenance
    createMaintenanceItem: createMaintenanceItemMutation.mutate,
    updateMaintenanceItem: updateMaintenanceItemMutation.mutate,
    deleteMaintenanceItems: deleteMaintenanceItemsMutation.mutate,

    // Mutation states
    isCreatingPlotter: createPlotterMutation.isPending,
    isUpdatingPlotter: updatePlotterMutation.isPending,
    isDeletingPlotters: deletePlottersMutation.isPending,
    isCreatingMaintenanceItem: createMaintenanceItemMutation.isPending,
    isUpdatingMaintenanceItem: updateMaintenanceItemMutation.isPending,
    isDeletingMaintenanceItems: deleteMaintenanceItemsMutation.isPending,

    // Refetch functions
    refetchPlotters: plottersQuery.refetch,
    refetchMaintenanceItems: maintenanceItemsQuery.refetch,
  };
};