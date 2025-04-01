// Path: hooks\useMapotecaClient.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import {
  Client,
  ClientDetails,
  ClientType,
  ClientCreateRequest,
  ClientUpdateRequest,
} from '@/types/client';
import { ApiResponse } from '@/types/api';
import { standardizeError } from '@/lib/queryClient';
import {
  getClients,
  getClientById,
  getClientTypes,
  createClient,
  updateClient,
  deleteClients,
} from '@/services/clientService';

// Query keys
const CLIENTS_KEY = ['clients'];
const CLIENT_DETAIL_KEY = ['clientDetail'];
const CLIENT_TYPES_KEY = ['clientTypes'];

/**
 * Custom hook for client management
 */
export const useMapotecaClient = () => {
  const queryClient = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();

  // Get all clients
  const clientsQuery = useQuery({
    queryKey: CLIENTS_KEY,
    queryFn: async () => {
      const response = await getClients();
      return response.dados;
    },
  });

  // Get client types - New query for reference data
  const clientTypesQuery = useQuery({
    queryKey: CLIENT_TYPES_KEY,
    queryFn: async () => {
      const response = await getClientTypes();
      return response.dados;
    },
  });

  // Get client by ID
  const getClient = (id?: number) => {
    return useQuery({
      queryKey: [...CLIENT_DETAIL_KEY, id],
      queryFn: async () => {
        if (!id) throw new Error('Client ID is required');
        const response = await getClientById(id);
        return response.dados;
      },
      enabled: !!id,
    });
  };

  // Create client mutation
  const createClientMutation = useMutation({
    mutationFn: (data: ClientCreateRequest) => createClient(data),
    onSuccess: (data: ApiResponse<any>) => {
      queryClient.invalidateQueries({ queryKey: CLIENTS_KEY });
      enqueueSnackbar(data.message || 'Cliente criado com sucesso', {
        variant: 'success',
      });
    },
    onError: error => {
      const standardizedError = standardizeError(error);
      enqueueSnackbar(standardizedError.message || 'Erro ao criar cliente', {
        variant: 'error',
      });
    },
  });

  // Update client mutation
  const updateClientMutation = useMutation({
    mutationFn: (data: ClientUpdateRequest) => updateClient(data),
    onSuccess: (data: ApiResponse<any>) => {
      queryClient.invalidateQueries({ queryKey: CLIENTS_KEY });
      queryClient.invalidateQueries({ 
        queryKey: [...CLIENT_DETAIL_KEY, data.dados?.id]
      });
      enqueueSnackbar(data.message || 'Cliente atualizado com sucesso', {
        variant: 'success',
      });
    },
    onError: error => {
      const standardizedError = standardizeError(error);
      enqueueSnackbar(standardizedError.message || 'Erro ao atualizar cliente', {
        variant: 'error',
      });
    },
  });

  // Delete clients mutation
  const deleteClientsMutation = useMutation({
    mutationFn: (ids: number[]) => deleteClients(ids),
    onSuccess: (data: ApiResponse<any>) => {
      queryClient.invalidateQueries({ queryKey: CLIENTS_KEY });
      enqueueSnackbar(data.message || 'Cliente(s) removido(s) com sucesso', {
        variant: 'success',
      });
    },
    onError: error => {
      const standardizedError = standardizeError(error);
      enqueueSnackbar(standardizedError.message || 'Erro ao remover cliente(s)', {
        variant: 'error',
      });
    },
  });

  return {
    // Queries
    clients: clientsQuery.data || [],
    clientTypes: clientTypesQuery.data || [], // Added client types
    isLoadingClients: clientsQuery.isLoading,
    isLoadingClientTypes: clientTypesQuery.isLoading, // Added loading state
    getClient,

    // Mutations
    createClient: createClientMutation.mutate,
    updateClient: updateClientMutation.mutate,
    deleteClients: deleteClientsMutation.mutate,

    // Mutation states
    isCreating: createClientMutation.isPending,
    isUpdating: updateClientMutation.isPending,
    isDeleting: deleteClientsMutation.isPending,

    // Refetch functions
    refetchClients: clientsQuery.refetch,
    refetchClientTypes: clientTypesQuery.refetch, // Added refetch for client types
  };
};