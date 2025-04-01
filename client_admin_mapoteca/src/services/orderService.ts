// Path: services\orderService.ts
import apiClient from '@/lib/axios';
import { ApiResponse } from '@/types/api';
import {
  Order,
  OrderDetail,
  OrderStatus,
  MediaType,
  OrderCreateRequest,
  OrderUpdateRequest,
  OrderProduct,
  OrderProductCreateRequest,
  OrderProductUpdateRequest,
} from '@/types/order';

/**
 * Get all orders
 */
export const getOrders = async (): Promise<ApiResponse<Order[]>> => {
  try {
    const response = await apiClient.get<ApiResponse<Order[]>>('/api/mapoteca/pedido');
    return response.data;
  } catch (error) {
    console.error('Error fetching orders:', error);
    throw error;
  }
};

/**
 * Get order by ID
 */
export const getOrderById = async (id: number): Promise<ApiResponse<OrderDetail>> => {
  try {
    const response = await apiClient.get<ApiResponse<OrderDetail>>(`/api/mapoteca/pedido/${id}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching order with ID ${id}:`, error);
    throw error;
  }
};

/**
 * Get order by locator
 */
export const getOrderByLocator = async (locator: string): Promise<ApiResponse<Order>> => {
  try {
    const response = await apiClient.get<ApiResponse<Order>>(`/api/mapoteca/pedido/localizador/${locator}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching order with locator ${locator}:`, error);
    throw error;
  }
};

/**
 * Get order statuses
 */
export const getOrderStatuses = async (): Promise<ApiResponse<OrderStatus[]>> => {
  try {
    const response = await apiClient.get<ApiResponse<OrderStatus[]>>('/api/mapoteca/dominio/situacao_pedido');
    return response.data;
  } catch (error) {
    console.error('Error fetching order statuses:', error);
    throw error;
  }
};

/**
 * Get media types
 */
export const getMediaTypes = async (): Promise<ApiResponse<MediaType[]>> => {
  try {
    const response = await apiClient.get<ApiResponse<MediaType[]>>('/api/mapoteca/dominio/tipo_midia');
    return response.data;
  } catch (error) {
    console.error('Error fetching media types:', error);
    throw error;
  }
};

/**
 * Create a new order
 */
export const createOrder = async (
  orderData: OrderCreateRequest,
): Promise<ApiResponse<{id: number, localizador_pedido: string}>> => {
  try {
    const response = await apiClient.post<ApiResponse<{id: number, localizador_pedido: string}>>('/api/mapoteca/pedido', orderData);
    return response.data;
  } catch (error) {
    console.error('Error creating order:', error);
    throw error;
  }
};

/**
 * Update an existing order
 */
export const updateOrder = async (
  orderData: OrderUpdateRequest,
): Promise<ApiResponse<void>> => {
  try {
    const response = await apiClient.put<ApiResponse<void>>('/api/mapoteca/pedido', orderData);
    return response.data;
  } catch (error) {
    console.error('Error updating order:', error);
    throw error;
  }
};

/**
 * Delete orders
 */
export const deleteOrders = async (
  orderIds: number[],
): Promise<ApiResponse<void>> => {
  try {
    const response = await apiClient.delete<ApiResponse<void>>('/api/mapoteca/pedido', {
      data: { pedido_ids: orderIds },
    });
    return response.data;
  } catch (error) {
    console.error('Error deleting orders:', error);
    throw error;
  }
};

/**
 * Add product to order
 */
export const addProductToOrder = async (
  productData: OrderProductCreateRequest,
): Promise<ApiResponse<void>> => {
  try {
    const response = await apiClient.post<ApiResponse<void>>('/api/mapoteca/produto_pedido', productData);
    return response.data;
  } catch (error) {
    console.error('Error adding product to order:', error);
    throw error;
  }
};

/**
 * Update order product
 */
export const updateOrderProduct = async (
  productData: OrderProductUpdateRequest,
): Promise<ApiResponse<void>> => {
  try {
    const response = await apiClient.put<ApiResponse<void>>('/api/mapoteca/produto_pedido', productData);
    return response.data;
  } catch (error) {
    console.error('Error updating order product:', error);
    throw error;
  }
};

/**
 * Delete order products
 */
export const deleteOrderProducts = async (
  productIds: number[],
): Promise<ApiResponse<void>> => {
  try {
    const response = await apiClient.delete<ApiResponse<void>>('/api/mapoteca/produto_pedido', {
      data: { produto_pedido_ids: productIds },
    });
    return response.data;
  } catch (error) {
    console.error('Error deleting order products:', error);
    throw error;
  }
};