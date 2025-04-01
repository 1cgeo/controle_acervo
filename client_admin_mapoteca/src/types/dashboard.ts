// Path: types\dashboard.ts
/**
 * Order status distribution for the dashboard
 */
export interface OrderStatusDistribution {
    total: number;
    em_andamento: number;
    concluidos: number;
    pendentes: number;
    distribuicao: Array<{
      id: number;
      nome: string;
      quantidade: number;
    }>;
  }
  
  /**
   * Orders timeline for the dashboard
   */
  export interface OrdersTimeline {
    semana_inicio: string;
    semana_fim: string;
    total_pedidos: number;
    total_produtos: number;
  }
  
  /**
   * Average fulfillment time for orders
   */
  export interface AverageFulfillmentTime {
    media_geral: string; // in days, formatted with 1 decimal place
    por_tipo_cliente: Array<{
      tipo_cliente_id: number;
      tipo_cliente: string;
      media_dias: string; // formatted with 1 decimal place
      quantidade_pedidos: number;
    }>;
    mensal: Array<{
      mes: string;
      media_dias: string; // formatted with 1 decimal place
      quantidade_pedidos: number;
    }>;
  }
  
  /**
   * Client activity for the dashboard
   */
  export interface ClientActivity {
    id: number;
    nome: string;
    tipo_cliente_id: number;
    tipo_cliente: string;
    total_pedidos: number;
    pedidos_concluidos: number;
    total_produtos: number;
    ultimo_pedido: string;
  }
  
  /**
   * Pending order for the dashboard
   */
  export interface PendingOrder {
    id: number;
    data_pedido: string;
    prazo?: string;
    cliente_id: number;
    cliente_nome: string;
    situacao_pedido_id: number;
    situacao_nome: string;
    documento_solicitacao?: string;
    quantidade_produtos: number;
    atrasado?: boolean;
    dias_ate_prazo?: number;
  }
  
  /**
   * Stock by location for the dashboard
   */
  export interface StockByLocation {
    localizacao_id: number;
    localizacao: string;
    quantidade_total: number;
  }
  
  /**
   * Material consumption trends
   */
  export interface MaterialConsumptionTrends {
    consumo_mensal_total: Array<{
      mes: string;
      quantidade_total: number;
    }>;
    materiais_mais_consumidos: Array<{
      id: number;
      nome: string;
      quantidade_total: number;
    }>;
    consumo_por_material: Array<{
      mes: string;
      material_id: number;
      material_nome: string;
      quantidade: number;
    }>;
  }
  
  /**
   * Plotter status for the dashboard
   */
  export interface PlotterStatus {
    sumario: {
      total: number;
      ativos: number;
      inativos: number;
    };
    plotters: Array<{
      id: number;
      ativo: boolean;
      nr_serie: string;
      modelo: string;
      data_aquisicao?: string;
      vida_util?: number;
      data_ultima_manutencao?: string;
      custo_total_manutencao: number;
      fim_vida_util?: boolean;
    }>;
  }
  
  /**
   * Dashboard data aggregating all widgets
   */
  export interface DashboardData {
    orderStatusDistribution: OrderStatusDistribution;
    ordersTimeline: OrdersTimeline[];
    averageFulfillmentTime: AverageFulfillmentTime;
    clientActivity: ClientActivity[];
    pendingOrders: PendingOrder[];
    stockByLocation: StockByLocation[];
    materialConsumptionTrends: MaterialConsumptionTrends;
    plotterStatus: PlotterStatus;
  }