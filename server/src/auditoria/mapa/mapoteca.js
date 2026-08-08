'use strict'

/**
 * Mapa de auditoria do modulo MAPOTECA.
 *
 * O contrato de uma entrada esta em `../index.js`.
 *
 * O agregado `pedido` reune quatro tabelas (pedido, item, impressao e etiqueta),
 * e e o que faz o historico do pedido trazer tudo que aconteceu com ele, itens
 * inclusive. As demais tabelas sao cadastros com ficha propria.
 */

module.exports = {
  // --- Agregado: pedido -----------------------------------------------------

  'mapoteca.pedido': {
    modulo: 'mapoteca',
    entidade: 'pedido',
    agregado: (t, linha) => linha.id,
    // O localizador, e nao o id: e por ele que o cliente e a equipe falam do
    // pedido, e e o que aparece na consulta publica.
    resumo: linha => `Pedido ${linha.localizador_pedido || `#${linha.id}`}`,
    campos: {
      situacao_pedido_id: { rotulo: 'Situação', dominio: 'mapoteca.situacao_pedido' },
      cliente_id: { rotulo: 'Cliente', entidade: 'cliente' },
      data_pedido: { rotulo: 'Data do pedido', tipo: 'data' },
      prazo: { rotulo: 'Prazo', tipo: 'data' },
      data_atendimento: { rotulo: 'Data de atendimento', tipo: 'data' },
      forma_entrega_id: { rotulo: 'Forma de entrega', dominio: 'mapoteca.forma_entrega' },
      canal_recebimento_id: { rotulo: 'Canal de recebimento', dominio: 'mapoteca.canal_recebimento' },
      ponto_contato: { rotulo: 'Ponto de contato' },
      documento_solicitacao: { rotulo: 'Documento de solicitação' },
      documento_solicitacao_nup: { rotulo: 'NUP do documento' },
      endereco_entrega: { rotulo: 'Endereço de entrega' },
      demandante: { rotulo: 'Demandante' },
      municipio: { rotulo: 'Município' },
      operacao: { rotulo: 'Operação' },
      qtd_imagens: { rotulo: 'Quantidade de imagens', tipo: 'numero' },
      previsto_pit: { rotulo: 'Previsto no PIT', tipo: 'booleano' },
      meta_pit_id: { rotulo: 'Item do PIT', entidade: 'meta' },
      // O mes PROMETIDO para imprimir, de onde sai o planejado da meta 4 do
      // PIT. Distinto do `prazo` acima, que e o limite do cliente.
      data_prevista: { rotulo: 'Data prevista', tipo: 'data' },
      palavras_chave: { rotulo: 'Palavras-chave', tipo: 'lista' },
      observacao: { rotulo: 'Observação' },
      observacao_envio: { rotulo: 'Observação de envio' },
      observacao_interna: { rotulo: 'Observação interna' },
      localizador_envio: { rotulo: 'Localizador de envio' },
      motivo_cancelamento: { rotulo: 'Motivo do cancelamento' },
      localizador_pedido: { rotulo: 'Localizador' }
    }
  },

  'mapoteca.produto_pedido': {
    modulo: 'mapoteca',
    entidade: 'pedido',
    agregado: (t, linha) => linha.pedido_id,
    // O item avulso se descreve no proprio item; o item de acervo aponta a
    // versao. O resumo diz qual dos dois e, porque a pessoa os trata de formas
    // opostas: o avulso nunca tera arquivo no acervo.
    resumo: linha =>
      linha.nome_avulso
        ? `Item avulso "${linha.nome_avulso}"`
        : `Item da versão ${linha.uuid_versao}`,
    campos: {
      quantidade: { rotulo: 'Quantidade', tipo: 'numero' },
      tipo_midia_id: { rotulo: 'Mídia', dominio: 'mapoteca.tipo_midia' },
      // A MÍDIA fornecida ficou, ao contrário da quantidade fornecida, que saiu
      // em 2026-08-08 sem uma única divergência em 1759 linhas. Esta tem 25.
      tipo_midia_fornecida_id: { rotulo: 'Mídia fornecida', dominio: 'mapoteca.tipo_midia' },
      // O rótulo diz "deste item" porque o pedido TAMBÉM tem um "Item do PIT", e
      // no histórico do pedido os dois eventos aparecem lado a lado.
      meta_pit_id: { rotulo: 'Item do PIT deste item', entidade: 'meta' },
      uuid_versao: { rotulo: 'Versão do acervo' },
      nome_avulso: { rotulo: 'Nome do item avulso' },
      descricao_avulso: { rotulo: 'Descrição do item avulso' },
      producao_especifica: { rotulo: 'Produção específica', tipo: 'booleano' },
      observacao: { rotulo: 'Observação' },
      pedido_id: { rotulo: 'Pedido', entidade: 'pedido' }
    }
  },

  'mapoteca.impressao_item': {
    modulo: 'mapoteca',
    entidade: 'pedido',
    // O dono esta a um salto: a impressao aponta o item, e o item aponta o
    // pedido. Assincrona por isso.
    agregado: async (t, linha) => {
      const item = await t.oneOrNone(
        'SELECT pedido_id FROM mapoteca.produto_pedido WHERE id = $<id>',
        { id: linha.produto_pedido_id }
      )
      return item ? item.pedido_id : null
    },
    resumo: linha => `Impressão de ${linha.quantidade} cópia(s)`,
    campos: {
      quantidade: { rotulo: 'Quantidade impressa', tipo: 'numero' },
      produto_pedido_id: { rotulo: 'Item', entidade: 'produto_pedido' },
      data_impressao: { rotulo: 'Data da impressão', tipo: 'data_hora' },
      observacao: { rotulo: 'Observação' }
    }
  },

  'mapoteca.etiqueta_envio': {
    modulo: 'mapoteca',
    entidade: 'pedido',
    agregado: (t, linha) => linha.pedido_id,
    resumo: linha => `Etiqueta para ${linha.destinatario}`,
    campos: {
      destinatario: { rotulo: 'Destinatário' },
      aos_cuidados: { rotulo: 'Aos cuidados de' },
      endereco: { rotulo: 'Endereço' },
      cep: { rotulo: 'CEP' }
    }
  },

  'mapoteca.anexo_pedido': {
    modulo: 'mapoteca',
    entidade: 'pedido',
    agregado: (t, linha) => linha.pedido_id,
    resumo: linha => `Anexo "${linha.nome_original}"`,
    // BYTEA. O Buffer ja sairia pelo `sanitizar`, mas declarar aqui torna a
    // intencao legivel e nao depende do tipo que o driver devolver.
    omitir: ['conteudo'],
    campos: {
      nome_original: { rotulo: 'Nome do arquivo' },
      tipo_anexo_id: { rotulo: 'Tipo do anexo', dominio: 'mapoteca.tipo_anexo_pedido' },
      descricao: { rotulo: 'Descrição' },
      extensao: { rotulo: 'Extensão' },
      tamanho_bytes: { rotulo: 'Tamanho em bytes', tipo: 'numero' }
    }
  },

  // --- Agregado: cliente ----------------------------------------------------

  'mapoteca.cliente': {
    modulo: 'mapoteca',
    entidade: 'cliente',
    agregado: (t, linha) => linha.id,
    resumo: linha => linha.nome,
    campos: {
      nome: { rotulo: 'Nome' },
      sigla: { rotulo: 'Sigla' },
      tipo_cliente_id: { rotulo: 'Tipo de cliente', dominio: 'mapoteca.tipo_cliente' },
      ponto_contato_principal: { rotulo: 'Ponto de contato' },
      endereco_entrega_principal: { rotulo: 'Endereço de entrega' }
    }
  },

  // --- Agregado: plotter ----------------------------------------------------

  'mapoteca.plotter': {
    modulo: 'mapoteca',
    entidade: 'plotter',
    agregado: (t, linha) => linha.id,
    resumo: linha => `Plotter ${linha.nr_serie || linha.modelo || `#${linha.id}`}`,
    campos: {
      nr_serie: { rotulo: 'Número de série' },
      modelo: { rotulo: 'Modelo' },
      data_aquisicao: { rotulo: 'Data de aquisição', tipo: 'data' },
      vida_util: { rotulo: 'Vida útil', tipo: 'numero' },
      ativo: { rotulo: 'Ativo', tipo: 'booleano' }
    }
  },

  'mapoteca.manutencao_plotter': {
    modulo: 'mapoteca',
    entidade: 'plotter',
    agregado: (t, linha) => linha.plotter_id,
    resumo: linha => `Manutenção de ${linha.data_manutencao || 'data não informada'}`,
    campos: {
      data_manutencao: { rotulo: 'Data da manutenção', tipo: 'data' },
      valor: { rotulo: 'Valor', tipo: 'dinheiro' },
      descricao: { rotulo: 'Descrição' },
      plotter_id: { rotulo: 'Plotter', entidade: 'plotter' }
    }
  },

  // --- Agregado: material ---------------------------------------------------
  // Tipo, estoque e movimento se leem JUNTOS: o saldo e o acumulado do livro, e
  // quem o escreve e o gatilho do movimento. Separa-los em tres agregados
  // esconderia justamente a relacao que a tela mostra -- "o saldo caiu porque
  // alguem lancou este consumo, neste dia".

  'mapoteca.tipo_material': {
    modulo: 'mapoteca',
    entidade: 'material',
    agregado: (t, linha) => linha.id,
    resumo: linha => linha.nome,
    campos: {
      // O nome carrega a UNIDADE (rolo, cartucho, folha) e e UNICO: a 7.2 do
      // RPCMTec casa a linha do mes anterior por ele. Renomear material muda o
      // que aquela coluna acha, entao a troca precisa aparecer no historico.
      nome: { rotulo: 'Nome' },
      descricao: { rotulo: 'Descrição' },
      estoque_minimo: { rotulo: 'Estoque mínimo', tipo: 'numero' },
      ativo: { rotulo: 'Ativo', tipo: 'booleano' }
    }
  },

  'mapoteca.estoque_material': {
    modulo: 'mapoteca',
    entidade: 'material',
    agregado: (t, linha) => linha.tipo_material_id,
    resumo: linha => `Estoque (localização ${linha.localizacao_id})`,
    campos: {
      quantidade: { rotulo: 'Quantidade', tipo: 'numero' },
      localizacao_id: { rotulo: 'Localização', dominio: 'mapoteca.tipo_localizacao' },
      tipo_material_id: { rotulo: 'Material', entidade: 'material' }
    }
  },

  // O LIVRO. Entrou em 2026-08-08 no lugar de `mapoteca.consumo_material`, que
  // guardava so um dos movimentos e por isso nunca explicou um saldo inteiro.
  //
  // O `dominio` traduz TRES codes, e nao quatro: a Contagem foi extinta no mesmo
  // dia e a linha dela saiu do dominio na 1.48.0. Ela chegou a ficar, marcada,
  // para o registro antigo daqui nao virar "Tipo de movimento: 4" cru -- e a
  // medicao mostrou que registro antigo nenhum existia.
  'mapoteca.movimento_material': {
    modulo: 'mapoteca',
    entidade: 'material',
    agregado: (t, linha) => linha.tipo_material_id,
    resumo: linha => `Movimento de ${linha.quantidade}`,
    campos: {
      tipo_movimento_id: {
        rotulo: 'Tipo de movimento',
        dominio: 'mapoteca.tipo_movimento_material'
      },
      quantidade: { rotulo: 'Quantidade', tipo: 'numero' },
      data_movimento: { rotulo: 'Data do movimento', tipo: 'data' },
      localizacao_origem_id: { rotulo: 'Origem', dominio: 'mapoteca.tipo_localizacao' },
      localizacao_destino_id: { rotulo: 'Destino', dominio: 'mapoteca.tipo_localizacao' },
      motivo: { rotulo: 'Motivo' },
      tipo_material_id: { rotulo: 'Material', entidade: 'material' }
    }
  }
}
