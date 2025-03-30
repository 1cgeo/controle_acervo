import apiClient from '../lib/axios';
import { ApiResponse } from '../types/api';

// Define the responses for various dashboard endpoints
export interface DashboardStatsResponse {
  total_produtos?: number;
  total_gb?: number;
  total_usuarios?: number;
}

export interface ProductsByTypeResponse {
  tipo_produto_id: number;
  tipo_produto: string;
  quantidade: number;
}

export interface StorageByTypeResponse {
  tipo_produto_id: number;
  tipo_produto: string;
  total_gb: number;
}

export interface StorageByVolumeResponse {
  volume_armazenamento_id: number;
  nome_volume: string;
  volume: string;
  capacidade_gb_volume: number;
  total_gb: number;
}

export interface ActivityByDayResponse {
  dia: string;
  quantidade: number;
}

export interface VersionStatisticsResponse {
  stats: {
    total_versions: number;
    products_with_versions: number;
    avg_versions_per_product: number;
    max_versions_per_product: number;
  };
  distribution: {
    versions_per_product: number;
    product_count: number;
  }[];
  type_distribution: {
    version_type: string;
    version_count: number;
  }[];
}

export interface StorageGrowthResponse {
  month: string;
  gb_added: number;
  cumulative_gb: number;
}

export interface ProjectStatusResponse {
  project_status: {
    status: string;
    project_count: number;
  }[];
  lot_status: {
    status: string;
    lot_count: number;
  }[];
  projects_without_lots: number;
}

export interface UserActivityResponse {
  usuario_nome: string;
  usuario_login: string;
  uploads: number;
  modifications: number;
  downloads: number;
  total_activity: number;
}

export interface RecentFileResponse {
  id: number;
  uuid_arquivo: string;
  nome: string;
  nome_arquivo: string;
  versao_id: number;
  tipo_arquivo_id: number;
  volume_armazenamento_id: number | null;
  extensao: string | null;
  tamanho_mb: number | null;
  checksum: string | null;
  metadado: any | null;
  tipo_status_id: number;
  situacao_carregamento_id: number;
  descricao: string | null;
  data_cadastramento: string;
  usuario_cadastramento_uuid: string;
  data_modificacao: string | null;
  usuario_modificacao_uuid: string | null;
}

export interface DeletedFileResponse extends RecentFileResponse {
  motivo_exclusao: string;
  data_delete: string;
  usuario_delete_uuid: string;
}

export interface DownloadResponse {
  id: number;
  arquivo_id: number;
  usuario_uuid: string;
  data_download: string;
  apagado: boolean;
}

export interface ProductActivityTimelineResponse {
  month: string;
  new_products: number;
  modified_products: number;
}

// Function to fetch total products statistics
export const getTotalProducts = async (): Promise<ApiResponse<DashboardStatsResponse>> => {
  const response = await apiClient.get<ApiResponse<DashboardStatsResponse>>('/api/dashboard/produtos_total');
  return response.data;
};

// Function to fetch total storage statistics
export const getTotalStorage = async (): Promise<ApiResponse<DashboardStatsResponse>> => {
  const response = await apiClient.get<ApiResponse<DashboardStatsResponse>>('/api/dashboard/arquivos_total_gb');
  return response.data;
};

// Function to fetch total users
export const getTotalUsers = async (): Promise<ApiResponse<DashboardStatsResponse>> => {
  const response = await apiClient.get<ApiResponse<DashboardStatsResponse>>('/api/dashboard/usuarios_total');
  return response.data;
};

// Function to fetch products by type
export const getProductsByType = async (): Promise<ApiResponse<ProductsByTypeResponse[]>> => {
  const response = await apiClient.get<ApiResponse<ProductsByTypeResponse[]>>('/api/dashboard/produtos_tipo');
  return response.data;
};

// Function to fetch storage by product type
export const getStorageByType = async (): Promise<ApiResponse<StorageByTypeResponse[]>> => {
  const response = await apiClient.get<ApiResponse<StorageByTypeResponse[]>>('/api/dashboard/gb_tipo_produto');
  return response.data;
};

// Function to fetch storage by volume
export const getStorageByVolume = async (): Promise<ApiResponse<StorageByVolumeResponse[]>> => {
  const response = await apiClient.get<ApiResponse<StorageByVolumeResponse[]>>('/api/dashboard/gb_volume');
  return response.data;
};

// Function to fetch files uploaded per day
export const getFilesByDay = async (): Promise<ApiResponse<ActivityByDayResponse[]>> => {
  const response = await apiClient.get<ApiResponse<ActivityByDayResponse[]>>('/api/dashboard/arquivos_dia');
  return response.data;
};

// Function to fetch downloads per day
export const getDownloadsByDay = async (): Promise<ApiResponse<ActivityByDayResponse[]>> => {
  const response = await apiClient.get<ApiResponse<ActivityByDayResponse[]>>('/api/dashboard/downloads_dia');
  return response.data;
};

// Function to fetch recent uploads
export const getRecentUploads = async (): Promise<ApiResponse<RecentFileResponse[]>> => {
  const response = await apiClient.get<ApiResponse<RecentFileResponse[]>>('/api/dashboard/ultimos_carregamentos');
  return response.data;
};

// Function to fetch recent modifications
export const getRecentModifications = async (): Promise<ApiResponse<RecentFileResponse[]>> => {
  const response = await apiClient.get<ApiResponse<RecentFileResponse[]>>('/api/dashboard/ultimas_modificacoes');
  return response.data;
};

// Function to fetch recent deletions
export const getRecentDeletions = async (): Promise<ApiResponse<DeletedFileResponse[]>> => {
  const response = await apiClient.get<ApiResponse<DeletedFileResponse[]>>('/api/dashboard/ultimos_deletes');
  return response.data;
};

// Function to fetch download history
export const getDownloadHistory = async (): Promise<ApiResponse<DownloadResponse[]>> => {
  const response = await apiClient.get<ApiResponse<DownloadResponse[]>>('/api/dashboard/download');
  return response.data;
};

// Function to fetch product activity timeline
export const getProductActivityTimeline = async (months: number = 12): Promise<ApiResponse<ProductActivityTimelineResponse[]>> => {
  const response = await apiClient.get<ApiResponse<ProductActivityTimelineResponse[]>>(
    `/api/dashboard/produto_activity_timeline?months=${months}`
  );
  return response.data;
};

// Function to fetch version statistics
export const getVersionStatistics = async (): Promise<ApiResponse<VersionStatisticsResponse>> => {
  const response = await apiClient.get<ApiResponse<VersionStatisticsResponse>>('/api/dashboard/version_statistics');
  return response.data;
};

// Function to fetch storage growth trends
export const getStorageGrowthTrends = async (months: number = 12): Promise<ApiResponse<StorageGrowthResponse[]>> => {
  const response = await apiClient.get<ApiResponse<StorageGrowthResponse[]>>(
    `/api/dashboard/storage_growth_trends?months=${months}`
  );
  return response.data;
};

// Function to fetch project status summary
export const getProjectStatusSummary = async (): Promise<ApiResponse<ProjectStatusResponse>> => {
  const response = await apiClient.get<ApiResponse<ProjectStatusResponse>>('/api/dashboard/project_status_summary');
  return response.data;
};

// Function to fetch user activity metrics
export const getUserActivityMetrics = async (limit: number = 10): Promise<ApiResponse<UserActivityResponse[]>> => {
  const response = await apiClient.get<ApiResponse<UserActivityResponse[]>>(
    `/api/dashboard/user_activity_metrics?limit=${limit}`
  );
  return response.data;
};