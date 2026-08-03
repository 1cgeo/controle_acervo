'use strict'

/**
 * Mapa de auditoria do modulo ACERVO.
 *
 * O contrato de uma entrada esta em `../index.js`.
 *
 * SAO QUATRO AGREGADOS, e a regra para escolher foi a do DDL: e a ficha que a
 * pessoa abre na tela.
 *
 *   produto  reune `produto`, `versao`, `arquivo` e `versao_relacionamento`.
 *            Ninguem abre "arquivo n.o 4812": abre a ficha do produto e olha os
 *            arquivos dele. Separar em quatro agregados esconderia justamente a
 *            relacao que a ficha mostra -- o arquivo que entrou, a versao que o
 *            recebeu e o produto que as duas descrevem.
 *   projeto  reune `projeto` e `lote`. Lote nao existe sem projeto, e a aba de
 *            administracao os le juntos.
 *   volume   reune `volume_armazenamento` e `volume_tipo_produto`. A associacao
 *            volume x tipo nao se confere sem a lista de volumes.
 *   ponto    reune `ponto_controle.ponto` e `ponto_controle.arquivo`. O ponto de
 *            controle e trabalho do modulo ACERVO (as rotas dele sao
 *            `verifyPerfil(..., 'acervo')`), e por isso `modulo` e 'acervo'
 *            mesmo com o schema tendo nome proprio.
 *
 * O DOMINIO DE `ponto_controle.*` USA A FORMA DE OBJETO, com `rotulo: 'code_name'`.
 * Das 14 tabelas de dominio do ponto de controle, 12 chamam a coluna de rotulo
 * de `code_name`; so `tipo_situacao` e `classificacao_ponto` usam `nome`.
 * Enquanto o carregador de catalogos falava so `nome`, elas simplesmente nao
 * podiam ser declaradas -- e o efeito de declarar uma errada nao seria um campo
 * sem traducao, seria a tela de rastreabilidade INTEIRA caindo com 42703, porque
 * o `enriquecer` roda sobre a pagina toda e uma tabela quebrada leva junto os
 * eventos dos outros modulos. Hoje `dominiosCitados` normaliza as duas formas, e
 * a varredura de `__tests__/auditoria/mapa.test.js` confere chave e rotulo de
 * cada dominio contra os `er/*.sql`.
 */

/**
 * O produto dono de um arquivo do acervo, que esta a UM SALTO de distancia: o
 * arquivo aponta a versao, e a versao aponta o produto.
 *
 * Quem apaga ou cria em LOTE nao deve passar por aqui: `registrar` aceita
 * `entidadeId` pronto, e uma exclusao de produto com 400 arquivos faria 400
 * consultas identicas. Os chamadores de lote resolvem o mapa versao -> produto
 * numa consulta so e passam o id. Esta funcao cobre o caso avulso, onde a ida a
 * mais custa o que uma ida ao banco custa.
 */
const produtoDaVersao = async (t, versaoId) => {
  if (versaoId == null) return null
  const versao = await t.oneOrNone(
    'SELECT produto_id FROM acervo.versao WHERE id = $<id>',
    { id: versaoId }
  )
  return versao ? versao.produto_id : null
}

module.exports = {
  // --- Agregado: produto ----------------------------------------------------

  'acervo.produto': {
    modulo: 'acervo',
    entidade: 'produto',
    agregado: (t, linha) => linha.id,
    // MI e INOM antes do nome: e por eles que a folha do SCN e chamada. O nome
    // so identifica o produto especial, que e justamente o que nao tem MI.
    resumo: linha =>
      `Produto ${linha.mi || linha.inom || linha.nome || `#${linha.id}`}`,
    // Sem isto o `SELECT *` traria o WKB em hexadecimal, ilegivel e longo. O
    // `lerAntes` troca a coluna pelo EWKT, e o teto por valor do `sanitizar`
    // resume a geometria grande -- a folha do SCN tem 5 vertices e cabe inteira,
    // que e o caso em que o estado anterior serve para desfazer um redesenho.
    geometrias: ['geom'],
    campos: {
      nome: { rotulo: 'Nome' },
      mi: { rotulo: 'MI' },
      inom: { rotulo: 'INOM' },
      tipo_escala_id: { rotulo: 'Escala', dominio: 'dominio.tipo_escala' },
      denominador_escala_especial: { rotulo: 'Denominador da escala especial', tipo: 'numero' },
      tipo_produto_id: { rotulo: 'Tipo de produto', dominio: 'dominio.tipo_produto' },
      // Refina a IDENTIDADE do produto: nulo e o produto civil, preenchido o
      // torna distinto do civil no mesmo MI. Trocar este campo muda o que o
      // produto e, e por isso ele merece rotulo proprio no historico.
      subtipo_produto_id: { rotulo: 'Subtipo que define o produto', dominio: 'dominio.subtipo_produto' },
      descricao: { rotulo: 'Descrição' },
      geom: { rotulo: 'Geometria', tipo: 'geometria' }
    }
  },

  'acervo.versao': {
    modulo: 'acervo',
    entidade: 'produto',
    agregado: (t, linha) => linha.produto_id,
    resumo: linha => `Versão ${linha.versao}`,
    campos: {
      versao: { rotulo: 'Edição' },
      nome: { rotulo: 'Nome' },
      // Muda o que a versao PROMETE, e o RPCMTec conta produto entregue por ele.
      tipo_versao_id: { rotulo: 'Tipo de versão', dominio: 'dominio.tipo_versao' },
      subtipo_produto_id: { rotulo: 'Subtipo de produto', dominio: 'dominio.subtipo_produto' },
      produto_id: { rotulo: 'Produto', entidade: 'produto' },
      lote_id: { rotulo: 'Lote', entidade: 'lote' },
      // As duas contam a folha, e sao EXCLUSIVAS entre si pelo CHECK
      // `versao_plano_ou_excecao`: a folha cumpre o plano ou e a excecao
      // autorizada. Trocar uma pela outra move o numero de uma subsecao do
      // RPCMTec para outra, entao as duas precisam de rastro nomeado.
      meta_pit_id: { rotulo: 'Meta do PIT', entidade: 'meta' },
      demanda_extra_id: { rotulo: 'Demanda Extra-PIT', entidade: 'extra_pit' },
      orgao_produtor: { rotulo: 'Órgão produtor' },
      data_criacao: { rotulo: 'Data de criação', tipo: 'data' },
      // Dia de calendario, e e ela que conta produto entregue no MES.
      data_edicao: { rotulo: 'Data de edição', tipo: 'data' },
      palavras_chave: { rotulo: 'Palavras-chave', tipo: 'lista' },
      descricao: { rotulo: 'Descrição' },
      metadado: { rotulo: 'Metadado' },
      // Identifica a versao no acervo E na publicacao do BDGEx. Trocar exige
      // rota propria e motivo, e o rastro dela e este campo.
      uuid_versao: { rotulo: 'Identificador da versão' }
    }
  },

  'acervo.arquivo': {
    modulo: 'acervo',
    entidade: 'produto',
    agregado: (t, linha) => produtoDaVersao(t, linha.versao_id),
    // O evento de OPERACAO da verificacao contra o volume tambem cai aqui: ele
    // grava `acervo.arquivo` sem lista de ids, entao o `dados_depois` dele e o
    // RESULTADO (as contagens), e nao uma linha de arquivo. Sem este ramo o
    // resumo sairia "Arquivo undefined.undefined" na tela.
    resumo: linha =>
      linha.nome_arquivo
        ? `Arquivo ${linha.nome_arquivo}${linha.extensao ? `.${linha.extensao}` : ''}`
        : `Verificação do acervo contra o volume: ${linha.arquivos_atualizados ?? 0} arquivo(s) marcado(s)`,
    campos: {
      nome: { rotulo: 'Nome' },
      // O nome FISICO no volume. Sai de acervo.nome_arquivo_padrao, e o renome
      // padrao muda so ele: e este campo que o invariante 7a audita.
      nome_arquivo: { rotulo: 'Nome do arquivo no volume' },
      extensao: { rotulo: 'Extensão' },
      versao_id: { rotulo: 'Versão', entidade: 'versao' },
      tipo_arquivo_id: { rotulo: 'Tipo de arquivo', dominio: 'dominio.tipo_arquivo' },
      volume_armazenamento_id: { rotulo: 'Volume', entidade: 'volume' },
      tamanho_mb: { rotulo: 'Tamanho (MB)', tipo: 'numero' },
      checksum: { rotulo: 'Checksum SHA-256' },
      tipo_status_id: { rotulo: 'Status', dominio: 'dominio.tipo_status_arquivo' },
      situacao_carregamento_id: { rotulo: 'Situação de carregamento', dominio: 'dominio.situacao_carregamento' },
      crs_original: { rotulo: 'CRS original' },
      descricao: { rotulo: 'Descrição' },
      metadado: { rotulo: 'Metadado' },
      uuid_arquivo: { rotulo: 'Identificador do arquivo' },
      // Os dois campos abaixo NAO sao colunas de `acervo.arquivo`: sao o
      // RESULTADO da verificacao contra o volume, que grava um evento de
      // operacao nesta tabela porque e ela que a verificacao reescreve -- e
      // reescreve sem lista de ids, o que impede a linha por arquivo.
      arquivos_verificados: { rotulo: 'Arquivos verificados', tipo: 'numero', sintetico: true },
      arquivos_atualizados: { rotulo: 'Arquivos marcados com erro', tipo: 'numero', sintetico: true },
      arquivos_deletados_verificados: { rotulo: 'Arquivos excluídos verificados', tipo: 'numero', sintetico: true },
      arquivos_deletados_atualizados: { rotulo: 'Arquivos excluídos marcados com erro', tipo: 'numero', sintetico: true },
      segundos: { rotulo: 'Duração (s)', tipo: 'numero', sintetico: true }
    }
  },

  'acervo.versao_relacionamento': {
    modulo: 'acervo',
    entidade: 'produto',
    // O dono sai da PRIMEIRA versao. O relacionamento liga duas versoes que
    // costumam ser de produtos diferentes (insumo), e um evento so pode ter um
    // agregado: escolher a segunda esconderia o vinculo da ficha de quem o
    // criou, que e de onde a acao partiu.
    agregado: (t, linha) => produtoDaVersao(t, linha.versao_id_1),
    resumo: linha =>
      `Relacionamento entre as versões ${linha.versao_id_1} e ${linha.versao_id_2}`,
    campos: {
      versao_id_1: { rotulo: 'Versão de origem', entidade: 'versao' },
      versao_id_2: { rotulo: 'Versão de destino', entidade: 'versao' },
      tipo_relacionamento_id: { rotulo: 'Tipo de relacionamento', dominio: 'dominio.tipo_relacionamento' },
      data_relacionamento: { rotulo: 'Data do relacionamento', tipo: 'data_hora' },
      usuario_relacionamento_uuid: { rotulo: 'Usuário do relacionamento' }
    }
  },

  // As visoes materializadas do acompanhamento, como evento de OPERACAO.
  //
  // A chave e a FAMILIA, e nao uma tabela: `acervo.criar_views_materializadas()`
  // cria uma visao por par (tipo de produto, escala) -- `acervo.mv_produto_2_1`,
  // `mv_produto_2_2` e assim por diante, dezenas delas. Citar uma so seria
  // escolher arbitrariamente qual das dezenas representa a operacao, e listar
  // todas seria uma linha de evento por visao para uma acao que e uma so.
  'acervo.mv_produto': {
    // Nao existe `CREATE TABLE acervo.mv_produto` em `er/`: a chave nomeia a
    // FAMILIA de visoes, e o evento e de OPERACAO. Sem esta marca a varredura de
    // `__tests__/auditoria/mapa.test.js` a reprovaria, e com razao.
    pseudoTabela: true,
    modulo: 'acervo',
    entidade: 'manutencao',
    // Nao ha ficha para abrir: quem dispara isto esta na aba Manutencao, e a
    // pergunta que a acao produz e "quem mandou rodar, e quando".
    agregado: () => 'operacao',
    resumo: linha => linha.message || 'Visões materializadas do acompanhamento',
    campos: {
      message: { rotulo: 'Resultado' },
      success: { rotulo: 'Concluída', tipo: 'booleano' }
    }
  },

  // --- Agregado: projeto ----------------------------------------------------

  'acervo.projeto': {
    modulo: 'acervo',
    entidade: 'projeto',
    agregado: (t, linha) => linha.id,
    resumo: linha => `Projeto ${linha.nome}`,
    campos: {
      nome: { rotulo: 'Nome' },
      descricao: { rotulo: 'Descrição' },
      data_inicio: { rotulo: 'Data de início', tipo: 'data' },
      data_fim: { rotulo: 'Data de fim', tipo: 'data' },
      status_execucao_id: { rotulo: 'Status de execução', dominio: 'dominio.tipo_status_execucao' }
    }
  },

  'acervo.lote': {
    modulo: 'acervo',
    entidade: 'projeto',
    agregado: (t, linha) => linha.projeto_id,
    resumo: linha => `Lote ${linha.nome} (PIT ${linha.pit})`,
    campos: {
      nome: { rotulo: 'Nome' },
      // Unico por projeto, e e por ele que o lote e chamado no PIT.
      pit: { rotulo: 'PIT' },
      projeto_id: { rotulo: 'Projeto', entidade: 'projeto' },
      descricao: { rotulo: 'Descrição' },
      data_inicio: { rotulo: 'Data de início', tipo: 'data' },
      data_fim: { rotulo: 'Data de fim', tipo: 'data' },
      status_execucao_id: { rotulo: 'Status de execução', dominio: 'dominio.tipo_status_execucao' }
    }
  },

  // --- Agregado: volume -----------------------------------------------------

  'acervo.volume_armazenamento': {
    modulo: 'acervo',
    entidade: 'volume',
    agregado: (t, linha) => linha.id,
    resumo: linha => `Volume ${linha.nome}`,
    campos: {
      nome: { rotulo: 'Nome' },
      // O CAMINHO do volume. Muda para onde o acervo inteiro daquele volume
      // aponta, e por isso e o campo que mais importa aqui.
      volume: { rotulo: 'Caminho do volume' },
      capacidade_gb: { rotulo: 'Capacidade (GB)', tipo: 'numero' },
      // Decide se o volume guarda a entrega no layout do fornecedor: e ela que
      // abre a porta do `/catalogar/product` e que tira o volume do renome
      // padrao e do invariante 7a. Marcar por engano so apareceria depois.
      layout_origem: { rotulo: 'Guarda o layout de origem', tipo: 'booleano' }
    }
  },

  'acervo.volume_tipo_produto': {
    modulo: 'acervo',
    entidade: 'volume',
    agregado: (t, linha) => linha.volume_armazenamento_id,
    resumo: linha =>
      `Destino do tipo de produto ${linha.tipo_produto_id}${linha.primario ? ' (primário)' : ''}`,
    campos: {
      tipo_produto_id: { rotulo: 'Tipo de produto', dominio: 'dominio.tipo_produto' },
      volume_armazenamento_id: { rotulo: 'Volume', entidade: 'volume' },
      // O destino que o upload web escolhe sozinho para aquele tipo. Um por tipo
      // de produto, e a UNIQUE parcial faz cumprir.
      primario: { rotulo: 'Volume primário do tipo', tipo: 'booleano' }
    }
  },

  // --- Agregado: ponto ------------------------------------------------------

  'ponto_controle.ponto': {
    modulo: 'acervo',
    entidade: 'ponto',
    agregado: (t, linha) => linha.id,
    resumo: linha => `Ponto ${linha.cod_ponto}`,
    geometrias: ['geom'],
    campos: {
      // Identidade GLOBAL do ponto: e por ela que a importacao decide entre
      // inserir e substituir.
      cod_ponto: { rotulo: 'Código do ponto' },
      lote_id: { rotulo: 'Lote', entidade: 'lote' },
      data_rastreio: { rotulo: 'Data do rastreio', tipo: 'data' },
      tipo_situacao: { rotulo: 'Situação', dominio: 'ponto_controle.tipo_situacao' },
      classificacao_ponto: { rotulo: 'Classificação', dominio: 'ponto_controle.classificacao_ponto' },
      latitude: { rotulo: 'Latitude', tipo: 'numero' },
      longitude: { rotulo: 'Longitude', tipo: 'numero' },
      altitude_ortometrica: { rotulo: 'Altitude ortométrica', tipo: 'numero' },
      altitude_geometrica: { rotulo: 'Altitude geométrica', tipo: 'numero' },
      norte: { rotulo: 'Norte', tipo: 'numero' },
      leste: { rotulo: 'Leste', tipo: 'numero' },
      // Os codigos abaixo NAO levam `dominio`: ver o cabecalho deste arquivo.
      tipo_ref: {
        rotulo: 'Tipo de referência',
        dominio: { tabela: 'ponto_controle.tipo_ref', rotulo: 'code_name' }
      },
      sistema_geodesico: {
        rotulo: 'Sistema geodésico',
        dominio: { tabela: 'ponto_controle.sistema_geodesico', rotulo: 'code_name' }
      },
      referencial_altim: {
        rotulo: 'Referencial altimétrico',
        dominio: { tabela: 'ponto_controle.referencial_altim', rotulo: 'code_name' }
      },
      referencial_grav: {
        rotulo: 'Referencial gravimétrico',
        dominio: { tabela: 'ponto_controle.referencial_grav', rotulo: 'code_name' }
      },
      metodo_posicionamento: {
        rotulo: 'Método de posicionamento',
        dominio: { tabela: 'ponto_controle.metodo_posicionamento', rotulo: 'code_name' }
      },
      situacao_marco: {
        rotulo: 'Situação do marco',
        dominio: { tabela: 'ponto_controle.situacao_marco', rotulo: 'code_name' }
      },
      tipo_marco_limite: {
        rotulo: 'Tipo de marco de limite',
        dominio: { tabela: 'ponto_controle.tipo_marco_limite', rotulo: 'code_name' }
      },
      tipo_pto_ref_geod_topo: {
        rotulo: 'Tipo de ponto de referência',
        dominio: { tabela: 'ponto_controle.tipo_pto_ref_geod_topo', rotulo: 'code_name' }
      },
      rede_referencia: {
        rotulo: 'Rede de referência',
        dominio: { tabela: 'ponto_controle.rede_referencia', rotulo: 'code_name' }
      },
      orbita: {
        rotulo: 'Órbita',
        dominio: { tabela: 'ponto_controle.orbita', rotulo: 'code_name' }
      },
      medidor: { rotulo: 'Medidor' },
      orgao_executante: { rotulo: 'Órgão executante' },
      projeto: { rotulo: 'Projeto' },
      inicio_rastreio: { rotulo: 'Início do rastreio', tipo: 'data_hora' },
      fim_rastreio: { rotulo: 'Fim do rastreio', tipo: 'data_hora' },
      data_visita: { rotulo: 'Data da visita', tipo: 'data' },
      data_processamento: { rotulo: 'Data do processamento', tipo: 'data' },
      materializado: { rotulo: 'Materializado', tipo: 'booleano' },
      reserva: { rotulo: 'Reserva', tipo: 'booleano' },
      geometria_aproximada: { rotulo: 'Geometria aproximada', tipo: 'booleano' },
      observacao: { rotulo: 'Observação' },
      geom: { rotulo: 'Geometria', tipo: 'geometria' }
    }
  },

  'ponto_controle.arquivo': {
    modulo: 'acervo',
    entidade: 'ponto',
    agregado: (t, linha) => linha.ponto_id,
    resumo: linha =>
      `Arquivo ${linha.nome_arquivo}${linha.extensao ? `.${linha.extensao}` : ''}`,
    campos: {
      nome_arquivo: { rotulo: 'Nome do arquivo no volume' },
      extensao: { rotulo: 'Extensão' },
      // Um pacote e uma monografia por ponto: o dominio e da propria feature, e
      // nao o do acervo. Este e traduzido porque a coluna dele se chama `nome`;
      // os do ponto ficam de fora pela razao do cabecalho deste arquivo.
      tipo_arquivo_id: { rotulo: 'Tipo de arquivo', dominio: 'ponto_controle.tipo_arquivo' },
      ponto_id: { rotulo: 'Ponto', entidade: 'ponto' },
      volume_armazenamento_id: { rotulo: 'Volume', entidade: 'volume' },
      tamanho_mb: { rotulo: 'Tamanho (MB)', tipo: 'numero' },
      checksum: { rotulo: 'Checksum SHA-256' },
      metadado: { rotulo: 'Metadado' },
      uuid_arquivo: { rotulo: 'Identificador do arquivo' }
    }
  }
}
