// Path: hooks\useMapotecaOrders.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { 
  Order,
  OrderDetail,
  OrderStatus,
  MediaType,
  OrderCreateRequest,
  OrderUpdateRequest,
  OrderProductCreateRequest,
  OrderProductUpdateRequest 
} from '@/types/order';
import { ApiResponse } from '@/types/api';
import { standardizeError } from '@/lib/queryClient';
import {
  getOrders,
  getOrderById,
  getOrderByLocator,
  getOrderStatuses,
  getMediaTypes,
  createOrder,
  updateOrder,
  deleteOrders,
  addProductToOrder,
  updateOrderProduct,
  deleteOrderProducts
} from '@/services/orderService';

// Query keys
const ORDERS_KEY = ['orders'];
const ORDER_DETAIL_KEY = ['orderDetail'];
const ORDER_STATUSES_KEY = ['orderStatuses'];
const MEDIA_TYPES_KEY = ['mediaTypes'];

/**
 * Custom hook for order management
 */
export const useMapotecaOrders = () => {
  const queryClient = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();

  // Get all orders
  const ordersQuery = useQuery({
    queryKey: ORDERS_KEY,
    queryFn: async () => {
      const response = await getOrders();
      return response.dados;
    },
  });

  // Get order statuses
  const statusesQuery = useQuery({
    queryKey: ORDER_STATUSES_KEY,
    queryFn: async () => {
      const response = await getOrderStatuses();
      return response.dados;
    },
  });

  // Get media types
  const mediaTypesQuery = useQuery({
    queryKey: MEDIA_TYPES_KEY,
    queryFn: async () => {
      const response = await getMediaTypes();
      return response.dados;
    },
  });

  // Get order by ID
  const getOrder = (id?: number) => {
    return useQuery({
      queryKey: [...ORDER_DETAIL_KEY, id],
      queryFn: async () => {
        if (!id) throw new Error('Order ID is required');
        const response = await getOrderById(id);
        return response.dados;
      },
      enabled: !!id,
    });
  };

  // Get order by locator
  const getOrderByLocatorCode = (locator?: string) => {
    return useQuery({
      queryKey: ['orderLocator', locator],
      queryFn: async () => {
        if (!locator) throw new Error('Locator is required');
        const response = await getOrderByLocator(locator);
        return response.dados;
      },
      enabled: !!locator,
    });
  };

  // Create order mutation
  const createOrderMutation = useMutation({
    mutationFn: (orderData: OrderCreateRequest) => createOrder(orderData),
    onSuccess: (data: ApiResponse<any>) => {
      queryClient.invalidateQueries({ queryKey: ORDERS_KEY });
      enqueueSnackbar(data.message || 'Pedido criado com sucesso', {
        variant: 'success',
      });
    },
    onError: error => {
      const standardizedError = standardizeError(error);
      enqueueSnackbar(standardizedError.message || 'Erro ao criar pedido', {
        variant: 'error',
      });
    },
  });

  // Update order mutation
  const updateOrderMutation = useMutation({
    mutationFn: (orderData: OrderUpdateRequest) => updateOrder(orderData),
    onSuccess: (data: ApiResponse<any>) => {
      queryClient.invalidateQueries({ queryKey: ORDERS_KEY });
      queryClient.invalidateQueries({ 
        queryKey: [...ORDER_DETAIL_KEY, data.dados?.id]
      });
      enqueueSnackbar(data.message || 'Pedido atualizado com sucesso', {
        variant: 'success',
      });
    },
    onError: error => {
      const standardizedError = standardizeError(error);
      enqueueSnackbar(standardizedError.message || 'Erro ao atualizar pedido', {
        variant: 'error',
      });
    },
  });

  // Delete order mutation
  const deleteOrdersMutation = useMutation({
    mutationFn: (orderIds: number[]) => deleteOrders(orderIds),
    onSuccess: (data: ApiResponse<any>) => {
      queryClient.invalidateQueries({ queryKey: ORDERS_KEY });
      enqueueSnackbar(data.message || 'Pedido(s) removido(s) com sucesso', {
        variant: 'success',
      });
    },
    onError: error => {
      const standardizedError = standardizeError(error);
      enqueueSnackbar(standardizedError.message || 'Erro ao remover pedido(s)', {
        variant: 'error',
      });
    },
  });

  // Add product to order mutation
  const addProductMutation = useMutation({
    mutationFn: (productData: OrderProductCreateRequest) => addProductToOrder(productData),
    onSuccess: (data: ApiResponse<any>) => {
      queryClient.invalidateQueries({ 
        queryKey: [...ORDER_DETAIL_KEY, data.dados?.pedido_id] 
      });
      enqueueSnackbar(data.message || 'Produto adicionado com sucesso', {
        variant: 'success',
      });
    },
    onError: error => {
      const standardizedError = standardizeError(error);
      enqueueSnackbar(standardizedError.message || 'Erro ao adicionar produto', {
        variant: 'error',
      });
    },
  });

  // Update order product mutation
  const updateProductMutation = useMutation({
    mutationFn: (productData: OrderProductUpdateRequest) => updateOrderProduct(productData),
    onSuccess: (data: ApiResponse<any>) => {
      queryClient.invalidateQueries({ 
        queryKey: [...ORDER_DETAIL_KEY, data.dados?.pedido_id] 
      });
      enqueueSnackbar(data.message || 'Produto atualizado com sucesso', {
        variant: 'success',
      });
    },
    onError: error => {
      const standardizedError = standardizeError(error);
      enqueueSnackbar(standardizedError.message || 'Erro ao atualizar produto', {
        variant: 'error',
      });
    },
  });

  // Delete order products mutation
  const deleteProductsMutation = useMutation({
    mutationFn: (productIds: number[]) => deleteOrderProducts(productIds),
    onSuccess: (data: ApiResponse<any>) => {
      // A bit tricky as we don't know which order was affected, 
      // so we'll invalidate all order details
      queryClient.invalidateQueries({ 
        queryKey: ORDER_DETAIL_KEY
      });
      enqueueSnackbar(data.message || 'Produto(s) removido(s) com sucesso', {
        variant: 'success',
      });
    },
    onError: error => {
      const standardizedError = standardizeError(error);
      enqueueSnackbar(standardizedError.message || 'Erro ao remover produto(s)', {
        variant: 'error',
      });
    },
  });

  return {
    // Queries
    orders: ordersQuery.data || [],
    statuses: statusesQuery.data || [],
    mediaTypes: mediaTypesQuery.data || [],
    isLoadingOrders: ordersQuery.isLoading,
    isLoadingStatuses: statusesQuery.isLoading,
    isLoadingMediaTypes: mediaTypesQuery.isLoading,
    getOrder,
    getOrderByLocator: getOrderByLocatorCode,

    // Mutations for orders
    createOrder: createOrderMutation.mutate,
    updateOrder: updateOrderMutation.mutate,
    deleteOrders: deleteOrdersMutation.mutate,
    
    // Mutations for order products
    addProduct: addProductMutation.mutate,
    updateProduct: updateProductMutation.mutate,
    deleteProducts: deleteProductsMutation.mutate,

    // Mutation states
    isCreatingOrder: createOrderMutation.isPending,
    isUpdatingOrder: updateOrderMutation.isPending,
    isDeletingOrders: deleteOrdersMutation.isPending,
    isAddingProduct: addProductMutation.isPending,
    isUpdatingProduct: updateProductMutation.isPending,
    isDeletingProducts: deleteProductsMutation.isPending,

    // Refetch functions
    refetchOrders: ordersQuery.refetch,
    refetchStatuses: statusesQuery.refetch,
    refetchMediaTypes: mediaTypesQuery.refetch,
  };
};