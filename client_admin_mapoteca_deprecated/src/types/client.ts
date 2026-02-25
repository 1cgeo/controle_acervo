// Path: types\client.ts
/**
 * Client entity - represents a customer requesting products
 */
export interface Client {
    id: number;
    nome: string;
    ponto_contato_principal?: string;
    endereco_entrega_principal?: string;
    tipo_cliente_id: number;
    tipo_cliente_nome?: string;
    total_pedidos?: number;
    data_ultimo_pedido?: string;
    pedidos_em_andamento?: number;
    pedidos_concluidos?: number;
    total_produtos?: number;
  }
  
  /**
   * Client details with statistics and recent orders
   */
  export interface ClientDetails extends Client {
    estatisticas: {
      total_pedidos: number;
      data_ultimo_pedido: string | null;
      data_primeiro_pedido: string | null;
      pedidos_em_andamento: number;
      pedidos_concluidos: number;
      total_produtos: number;
    };
    ultimos_pedidos: Array<{
      id: number;
      data_pedido: string;
      situacao_pedido_id: number;
      situacao_pedido_nome: string;
      documento_solicitacao: string;
      prazo: string;
      quantidade_produtos: number;
    }>;
  }
  
  /**
   * Client type enum
   */
  export interface ClientType {
    code: number;
    nome: string;
  }
  
  /**
   * Create client request
   */
  export interface ClientCreateRequest {
    nome: string;
    ponto_contato_principal?: string;
    endereco_entrega_principal?: string;
    tipo_cliente_id: number;
  }
  
  /**
   * Update client request
   */
  export interface ClientUpdateRequest extends ClientCreateRequest {
    id: number;
  }