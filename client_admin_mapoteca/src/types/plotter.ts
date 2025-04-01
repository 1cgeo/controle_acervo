// Path: types\plotter.ts
/**
 * Plotter entity
 */
export interface Plotter {
    id: number;
    ativo: boolean;
    nr_serie: string;
    modelo: string;
    data_aquisicao?: string;
    vida_util?: number;
    data_ultima_manutencao?: string;
    quantidade_manutencoes?: number;
  }
  
  /**
   * Plotter detail with maintenance information
   */
  export interface PlotterDetail extends Plotter {
    estatisticas: {
      total_manutencoes: number;
      data_ultima_manutencao?: string;
      valor_total_manutencoes: number;
      valor_medio_manutencoes: number;
      tempo_medio_entre_manutencoes_dias?: number;
    };
    manutencoes: MaintenanceItem[];
  }
  
  /**
   * Maintenance item for a plotter
   */
  export interface MaintenanceItem {
    id: number;
    plotter_id: number;
    data_manutencao: string;
    valor: number;
    descricao?: string;
    usuario_criacao_id?: number;
    usuario_criacao_nome?: string;
    data_criacao?: string;
    usuario_atualizacao_id?: number;
    usuario_atualizacao_nome?: string;
    data_atualizacao?: string;
  }
  
  /**
   * Create plotter request
   */
  export interface PlotterCreateRequest {
    ativo: boolean;
    nr_serie: string;
    modelo: string;
    data_aquisicao?: string;
    vida_util?: number;
  }
  
  /**
   * Update plotter request
   */
  export interface PlotterUpdateRequest extends PlotterCreateRequest {
    id: number;
  }
  
  /**
   * Create maintenance item request
   */
  export interface MaintenanceItemCreateRequest {
    plotter_id: number;
    data_manutencao: string;
    valor: number;
    descricao?: string;
  }
  
  /**
   * Update maintenance item request
   */
  export interface MaintenanceItemUpdateRequest extends MaintenanceItemCreateRequest {
    id: number;
  }