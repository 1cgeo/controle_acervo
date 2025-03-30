import { useQuery } from '@tanstack/react-query';
import * as dashboardService from '../services/dashboardService';
import { createQueryKey, STALE_TIMES, standardizeError } from '@/lib/queryClient';

// Define the query keys
const QUERY_KEYS = {
  TOTAL_PRODUCTS: createQueryKey('dashboard', 'totalProducts'),
  TOTAL_STORAGE: createQueryKey('dashboard', 'totalStorage'),
  TOTAL_USERS: createQueryKey('dashboard', 'totalUsers'),
  PRODUCTS_BY_TYPE: createQueryKey('dashboard', 'productsByType'),
  STORAGE_BY_TYPE: createQueryKey('dashboard', 'storageByType'),
  STORAGE_BY_VOLUME: createQueryKey('dashboard', 'storageByVolume'),
  FILES_BY_DAY: createQueryKey('dashboard', 'filesByDay'),
  DOWNLOADS_BY_DAY: createQueryKey('dashboard', 'downloadsByDay'),
  RECENT_UPLOADS: createQueryKey('dashboard', 'recentUploads'),
  RECENT_MODIFICATIONS: createQueryKey('dashboard', 'recentModifications'),
  RECENT_DELETIONS: createQueryKey('dashboard', 'recentDeletions'),
  DOWNLOAD_HISTORY: createQueryKey('dashboard', 'downloadHistory'),
  PRODUCT_ACTIVITY: createQueryKey('dashboard', 'productActivity'),
  VERSION_STATISTICS: createQueryKey('dashboard', 'versionStatistics'),
  STORAGE_GROWTH: createQueryKey('dashboard', 'storageGrowth'),
  PROJECT_STATUS: createQueryKey('dashboard', 'projectStatus'),
  USER_ACTIVITY: createQueryKey('dashboard', 'userActivity'),
};

// Hook for total products
export const useTotalProducts = () => {
  const query = useQuery({
    queryKey: QUERY_KEYS.TOTAL_PRODUCTS,
    queryFn: dashboardService.getTotalProducts,
    staleTime: STALE_TIMES.FREQUENT_DATA,
  });

  return {
    data: query.data?.dados,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error ? standardizeError(query.error) : null,
    refetch: query.refetch,
  };
};

// Hook for total storage
export const useTotalStorage = () => {
  const query = useQuery({
    queryKey: QUERY_KEYS.TOTAL_STORAGE,
    queryFn: dashboardService.getTotalStorage,
    staleTime: STALE_TIMES.FREQUENT_DATA,
  });

  return {
    data: query.data?.dados,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error ? standardizeError(query.error) : null,
    refetch: query.refetch,
  };
};

// Hook for total users
export const useTotalUsers = () => {
  const query = useQuery({
    queryKey: QUERY_KEYS.TOTAL_USERS,
    queryFn: dashboardService.getTotalUsers,
    staleTime: STALE_TIMES.FREQUENT_DATA,
  });

  return {
    data: query.data?.dados,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error ? standardizeError(query.error) : null,
    refetch: query.refetch,
  };
};

// Hook for products by type
export const useProductsByType = () => {
  const query = useQuery({
    queryKey: QUERY_KEYS.PRODUCTS_BY_TYPE,
    queryFn: dashboardService.getProductsByType,
    staleTime: STALE_TIMES.FREQUENT_DATA,
  });

  return {
    data: query.data?.dados,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error ? standardizeError(query.error) : null,
    refetch: query.refetch,
  };
};

// Hook for storage by type
export const useStorageByType = () => {
  const query = useQuery({
    queryKey: QUERY_KEYS.STORAGE_BY_TYPE,
    queryFn: dashboardService.getStorageByType,
    staleTime: STALE_TIMES.FREQUENT_DATA,
  });

  return {
    data: query.data?.dados,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error ? standardizeError(query.error) : null,
    refetch: query.refetch,
  };
};

// Hook for storage by volume
export const useStorageByVolume = () => {
  const query = useQuery({
    queryKey: QUERY_KEYS.STORAGE_BY_VOLUME,
    queryFn: dashboardService.getStorageByVolume,
    staleTime: STALE_TIMES.FREQUENT_DATA,
  });

  return {
    data: query.data?.dados,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error ? standardizeError(query.error) : null,
    refetch: query.refetch,
  };
};

// Hook for files by day
export const useFilesByDay = () => {
  const query = useQuery({
    queryKey: QUERY_KEYS.FILES_BY_DAY,
    queryFn: dashboardService.getFilesByDay,
    staleTime: STALE_TIMES.FREQUENT_DATA,
  });

  return {
    data: query.data?.dados,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error ? standardizeError(query.error) : null,
    refetch: query.refetch,
  };
};

// Hook for downloads by day
export const useDownloadsByDay = () => {
  const query = useQuery({
    queryKey: QUERY_KEYS.DOWNLOADS_BY_DAY,
    queryFn: dashboardService.getDownloadsByDay,
    staleTime: STALE_TIMES.FREQUENT_DATA,
  });

  return {
    data: query.data?.dados,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error ? standardizeError(query.error) : null,
    refetch: query.refetch,
  };
};

// Hook for recent uploads
export const useRecentUploads = () => {
  const query = useQuery({
    queryKey: QUERY_KEYS.RECENT_UPLOADS,
    queryFn: dashboardService.getRecentUploads,
    staleTime: STALE_TIMES.FREQUENT_DATA,
  });

  return {
    data: query.data?.dados,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error ? standardizeError(query.error) : null,
    refetch: query.refetch,
  };
};

// Hook for recent modifications
export const useRecentModifications = () => {
  const query = useQuery({
    queryKey: QUERY_KEYS.RECENT_MODIFICATIONS,
    queryFn: dashboardService.getRecentModifications,
    staleTime: STALE_TIMES.FREQUENT_DATA,
  });

  return {
    data: query.data?.dados,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error ? standardizeError(query.error) : null,
    refetch: query.refetch,
  };
};

// Hook for recent deletions
export const useRecentDeletions = () => {
  const query = useQuery({
    queryKey: QUERY_KEYS.RECENT_DELETIONS,
    queryFn: dashboardService.getRecentDeletions,
    staleTime: STALE_TIMES.FREQUENT_DATA,
  });

  return {
    data: query.data?.dados,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error ? standardizeError(query.error) : null,
    refetch: query.refetch,
  };
};

// Hook for download history
export const useDownloadHistory = () => {
  const query = useQuery({
    queryKey: QUERY_KEYS.DOWNLOAD_HISTORY,
    queryFn: dashboardService.getDownloadHistory,
    staleTime: STALE_TIMES.FREQUENT_DATA,
  });

  return {
    data: query.data?.dados,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error ? standardizeError(query.error) : null,
    refetch: query.refetch,
  };
};

// Hook for product activity timeline
export const useProductActivityTimeline = (months: number = 12) => {
  const query = useQuery({
    queryKey: [...QUERY_KEYS.PRODUCT_ACTIVITY, months],
    queryFn: () => dashboardService.getProductActivityTimeline(months),
    staleTime: STALE_TIMES.FREQUENT_DATA,
  });

  return {
    data: query.data?.dados,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error ? standardizeError(query.error) : null,
    refetch: query.refetch,
  };
};

// Hook for version statistics
export const useVersionStatistics = () => {
  const query = useQuery({
    queryKey: QUERY_KEYS.VERSION_STATISTICS,
    queryFn: dashboardService.getVersionStatistics,
    staleTime: STALE_TIMES.FREQUENT_DATA,
  });

  return {
    data: query.data?.dados,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error ? standardizeError(query.error) : null,
    refetch: query.refetch,
  };
};

// Hook for storage growth trends
export const useStorageGrowthTrends = (months: number = 12) => {
  const query = useQuery({
    queryKey: [...QUERY_KEYS.STORAGE_GROWTH, months],
    queryFn: () => dashboardService.getStorageGrowthTrends(months),
    staleTime: STALE_TIMES.FREQUENT_DATA,
  });

  return {
    data: query.data?.dados,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error ? standardizeError(query.error) : null,
    refetch: query.refetch,
  };
};

// Hook for project status summary
export const useProjectStatusSummary = () => {
  const query = useQuery({
    queryKey: QUERY_KEYS.PROJECT_STATUS,
    queryFn: dashboardService.getProjectStatusSummary,
    staleTime: STALE_TIMES.FREQUENT_DATA,
  });

  return {
    data: query.data?.dados,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error ? standardizeError(query.error) : null,
    refetch: query.refetch,
  };
};

// Hook for user activity metrics
export const useUserActivityMetrics = (limit: number = 10) => {
  const query = useQuery({
    queryKey: [...QUERY_KEYS.USER_ACTIVITY, limit],
    queryFn: () => dashboardService.getUserActivityMetrics(limit),
    staleTime: STALE_TIMES.FREQUENT_DATA,
  });

  return {
    data: query.data?.dados,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error ? standardizeError(query.error) : null,
    refetch: query.refetch,
  };
};