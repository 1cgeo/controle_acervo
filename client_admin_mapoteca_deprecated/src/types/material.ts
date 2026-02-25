// Path: types\material.ts
/**
 * Location type
 */
export interface LocationType {
    code: number;
    nome: string;
  }
  
  /**
   * Material type entity
   */
  export interface MaterialType {
    id: number;
    nome: string;
    descricao?: string;
    estoque_total?: number;
    localizacoes_armazenadas?: number;
  }
  
  /**
   * Material type details
   */
  export interface MaterialTypeDetail extends MaterialType {
    estoque: {
      registros: StockItem[];
      total: number;
      localizacoes: number;
    };
    consumo: {
      registros_recentes: ConsumptionItem[];
      total_consumido: number;
      media_por_consumo: number;
      total_registros: number;
      ultimo_consumo?: string;
    };
  }
  
  /**
   * Stock item entity
   */
  export interface StockItem {
    id: number;
    tipo_material_id: number;
    tipo_material_nome?: string;
    quantidade: number;
    localizacao_id: number;
    localizacao_nome?: string;
    usuario_criacao_id?: number;
    usuario_criacao_nome?: string;
    data_criacao?: string;
    usuario_atualizacao_id?: number;
    usuario_atualizacao_nome?: string;
    data_atualizacao?: string;
  }
  
  /**
   * Consumption item entity
   */
  export interface ConsumptionItem {
    id: number;
    tipo_material_id: number;
    tipo_material_nome?: string;
    quantidade: number;
    data_consumo: string;
    usuario_criacao_id?: number;
    usuario_criacao_nome?: string;
    data_criacao?: string;
    usuario_atualizacao_id?: number;
    usuario_atualizacao_nome?: string;
    data_atualizacao?: string;
  }
  
  /**
   * Stock location summary
   */
  export interface StockLocationSummary {
    localizacao_id: number;
    localizacao_nome: string;
    quantidade_total: number;
    tipos_materiais_diferentes: number;
  }
  
  /**
   * Monthly material consumption
   */
  export interface MonthlyConsumption {
    tipo_material_id: number;
    tipo_material_nome: string;
    mes: number;
    quantidade: number;
  }
  
  /**
   * Create material type request
   */
  export interface MaterialTypeCreateRequest {
    nome: string;
    descricao?: string;
  }
  
  /**
   * Update material type request
   */
  export interface MaterialTypeUpdateRequest extends MaterialTypeCreateRequest {
    id: number;
  }
  
  /**
   * Create stock item request
   */
  export interface StockItemCreateRequest {
    tipo_material_id: number;
    quantidade: number;
    localizacao_id: number;
  }
  
  /**
   * Update stock item request
   */
  export interface StockItemUpdateRequest extends StockItemCreateRequest {
    id: number;
  }
  
  /**
   * Create consumption item request
   */
  export interface ConsumptionItemCreateRequest {
    tipo_material_id: number;
    quantidade: number;
    data_consumo: string;
  }
  
  /**
   * Update consumption item request
   */
  export interface ConsumptionItemUpdateRequest extends ConsumptionItemCreateRequest {
    id: number;
  }
  
  /**
   * Consumption filter request
   */
  export interface ConsumptionFilterRequest {
    data_inicio?: string;
    data_fim?: string;
    tipo_material_id?: number;
  }