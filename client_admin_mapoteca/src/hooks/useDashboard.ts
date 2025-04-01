// Path: hooks\useDashboard.ts
import { useQuery } from '@tanstack/react-query';
import { getDashboardData } from '../services/dashboardService';
import { DashboardData } from '../types/dashboard';
import { createQueryKey, STALE_TIMES, standardizeError } from '@/lib/queryClient';

const QUERY_KEYS = {
  DASHBOARD_DATA: createQueryKey('dashboardData'),
};

/**
 * Custom hook for fetching and managing dashboard data
 */
export const useDashboard = () => {
  const query = useQuery<DashboardData, Error>({
    queryKey: QUERY_KEYS.DASHBOARD_DATA,
    queryFn: getDashboardData,
    staleTime: STALE_TIMES.FREQUENT_DATA, // Dashboard data changes frequently
    refetchInterval: 60000, // Refetch every minute for live data
  });

  return {
    dashboardData: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error ? standardizeError(query.error).message : null,
    refetch: query.refetch,
  };
};