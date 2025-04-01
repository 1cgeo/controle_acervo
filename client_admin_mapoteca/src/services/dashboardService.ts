// Path: services\dashboardService.ts
import apiClient from '@/lib/axios';
import { ApiResponse } from '@/types/api';
import {
  OrderStatusDistribution,
  OrdersTimeline,
  AverageFulfillmentTime,
  ClientActivity,
  PendingOrder,
  StockByLocation,
  MaterialConsumptionTrends,
  PlotterStatus,
} from '@/types/dashboard';

/**
 * Get order status distribution
 */
export const getOrderStatusDistribution = async (): Promise<ApiResponse<OrderStatusDistribution>> => {
  try {
    const response = await apiClient.get<ApiResponse<OrderStatusDistribution>>('/api/mapoteca/dashboard/order_status');
    return response.data;
  } catch (error) {
    console.error('Error fetching order status distribution:', error);
    throw error;
  }
};

/**
 * Get orders timeline
 */
export const getOrdersTimeline = async (months = 6): Promise<ApiResponse<OrdersTimeline[]>> => {
  try {
    const response = await apiClient.get<ApiResponse<OrdersTimeline[]>>('/api/mapoteca/dashboard/orders_timeline', {
      params: { meses: months },
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching orders timeline:', error);
    throw error;
  }
};

/**
 * Get average fulfillment time
 */
export const getAverageFulfillmentTime = async (): Promise<ApiResponse<AverageFulfillmentTime>> => {
  try {
    const response = await apiClient.get<ApiResponse<AverageFulfillmentTime>>('/api/mapoteca/dashboard/avg_fulfillment_time');
    return response.data;
  } catch (error) {
    console.error('Error fetching average fulfillment time:', error);
    throw error;
  }
};

/**
 * Get client activity
 */
export const getClientActivity = async (limit = 10): Promise<ApiResponse<ClientActivity[]>> => {
  try {
    const response = await apiClient.get<ApiResponse<ClientActivity[]>>('/api/mapoteca/dashboard/client_activity', {
      params: { limite: limit },
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching client activity:', error);
    throw error;
  }
};

/**
 * Get pending orders
 */
export const getPendingOrders = async (): Promise<ApiResponse<PendingOrder[]>> => {
  try {
    const response = await apiClient.get<ApiResponse<PendingOrder[]>>('/api/mapoteca/dashboard/pending_orders');
    return response.data;
  } catch (error) {
    console.error('Error fetching pending orders:', error);
    throw error;
  }
};

/**
 * Get stock by location
 */
export const getStockByLocation = async (): Promise<ApiResponse<StockByLocation[]>> => {
  try {
    const response = await apiClient.get<ApiResponse<StockByLocation[]>>('/api/mapoteca/dashboard/stock_by_location');
    return response.data;
  } catch (error) {
    console.error('Error fetching stock by location:', error);
    throw error;
  }
};

/**
 * Get material consumption trends
 */
export const getMaterialConsumptionTrends = async (months = 12): Promise<ApiResponse<MaterialConsumptionTrends>> => {
  try {
    const response = await apiClient.get<ApiResponse<MaterialConsumptionTrends>>('/api/mapoteca/dashboard/material_consumption', {
      params: { meses: months },
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching material consumption trends:', error);
    throw error;
  }
};

/**
 * Get plotter status
 */
export const getPlotterStatus = async (): Promise<ApiResponse<PlotterStatus>> => {
  try {
    const response = await apiClient.get<ApiResponse<PlotterStatus>>('/api/mapoteca/dashboard/plotter_status');
    return response.data;
  } catch (error) {
    console.error('Error fetching plotter status:', error);
    throw error;
  }
};

/**
 * Get all dashboard data in a single request
 * This combines multiple API calls to load the entire dashboard at once
 */
export const getDashboardData = async (): Promise<{
  orderStatusDistribution: OrderStatusDistribution;
  ordersTimeline: OrdersTimeline[];
  averageFulfillmentTime: AverageFulfillmentTime;
  clientActivity: ClientActivity[];
  pendingOrders: PendingOrder[];
  stockByLocation: StockByLocation[];
  materialConsumptionTrends: MaterialConsumptionTrends;
  plotterStatus: PlotterStatus;
}> => {
  try {
    const [
      orderStatusResponse,
      ordersTimelineResponse,
      averageFulfillmentTimeResponse,
      clientActivityResponse,
      pendingOrdersResponse,
      stockByLocationResponse,
      materialConsumptionTrendsResponse,
      plotterStatusResponse,
    ] = await Promise.all([
      getOrderStatusDistribution(),
      getOrdersTimeline(),
      getAverageFulfillmentTime(),
      getClientActivity(),
      getPendingOrders(),
      getStockByLocation(),
      getMaterialConsumptionTrends(),
      getPlotterStatus(),
    ]);

    return {
      orderStatusDistribution: orderStatusResponse.dados,
      ordersTimeline: ordersTimelineResponse.dados,
      averageFulfillmentTime: averageFulfillmentTimeResponse.dados,
      clientActivity: clientActivityResponse.dados,
      pendingOrders: pendingOrdersResponse.dados,
      stockByLocation: stockByLocationResponse.dados,
      materialConsumptionTrends: materialConsumptionTrendsResponse.dados,
      plotterStatus: plotterStatusResponse.dados,
    };
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    throw error;
  }
};