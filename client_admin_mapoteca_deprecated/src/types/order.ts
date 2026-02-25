// Path: types\order.ts
/**
 * Order status type
 */
export interface OrderStatus {
    code: number;
    nome: string;
  }
  
  /**
   * Media type
   */
  export interface MediaType {
    code: number;
    nome: string;
  }
  
  /**
   * Order product - product associated with an order
   */
  export interface OrderProduct {
    id: number;
    uuid_versao: string;
    quantidade: number;
    tipo_midia_id: number;
    tipo_midia_nome?: string;
    producao_especifica: boolean;
    versao?: string;
    produto_id?: number;
    produto_nome?: string;
    mi?: string;
    inom?: string;
    escala?: string;
    usuario_criacao_id?: number;
    usuario_criacao_nome?: string;
    data_criacao?: string;
    usuario_atualizacao_id?: number;
    usuario_atualizacao_nome?: string;
    data_atualizacao?: string;
  }
  
  /**
   * Order entity - represents a customer request
   */
  export interface Order {
    id: number;
    data_pedido: string;
    data_atendimento?: string;
    cliente_id: number;
    cliente_nome?: string;
    situacao_pedido_id: number;
    situacao_pedido_nome?: string;
    documento_solicitacao?: string;
    documento_solicitacao_nup?: string;
    prazo?: string;
    localizador_pedido: string;
    localizador_envio?: string;
    observacao_envio?: string;
    quantidade_produtos?: number;
  }
  
  /**
   * Order detail - full order information with products
   */
  export interface OrderDetail extends Order {
    ponto_contato?: string;
    endereco_entrega?: string;
    palavras_chave?: string[];
    operacao?: string;
    observacao?: string;
    motivo_cancelamento?: string;
    tipo_cliente_id?: number;
    tipo_cliente_nome?: string;
    usuario_criacao_id?: number;
    usuario_criacao_nome?: string;
    usuario_atualizacao_id?: number;
    usuario_atualizacao_nome?: string;
    data_criacao?: string;
    data_atualizacao?: string;
    produtos: OrderProduct[];
  }
  
  /**
   * Create order request
   */
  export interface OrderCreateRequest {
    data_pedido: string;
    data_atendimento?: string;
    cliente_id: number;
    situacao_pedido_id: number;
    ponto_contato?: string;
    documento_solicitacao?: string;
    documento_solicitacao_nup?: string;
    endereco_entrega?: string;
    palavras_chave?: string[];
    operacao?: string;
    prazo?: string;
    observacao?: string;
    localizador_envio?: string;
    observacao_envio?: string;
    motivo_cancelamento?: string;
  }
  
  /**
   * Update order request
   */
  export interface OrderUpdateRequest extends OrderCreateRequest {
    id: number;
  }
  
  /**
   * Create order product request
   */
  export interface OrderProductCreateRequest {
    uuid_versao: string;
    pedido_id: number;
    quantidade: number;
    tipo_midia_id: number;
    producao_especifica: boolean;
  }
  
  /**
   * Update order product request
   */
  export interface OrderProductUpdateRequest extends OrderProductCreateRequest {
    id: number;
  }