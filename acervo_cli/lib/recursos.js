// Path: lib\recursos.js
'use strict'

const path = require('path')

// Registro dos recursos da API. Cada entrada aponta para o MODULO DE SCHEMA da
// feature no server/, e o CLI le dali o contrato (campos, tipos, obrigatorios,
// filtros). Nada de contrato e copiado para ca: se o schema mudar, o CLI muda
// junto no mesmo commit. Este arquivo so guarda o que NAO esta no schema: o
// caminho da rota, o nivel de acesso, a escolha de apresentacao (colunas) e o
// guardrail de acao irreversivel.
//
// Por que a forma e diferente da do orcamento_cli: o SCO e CRUD uniforme
// (/recurso, /recurso/:id) e cabe num crud.js generico. O SCA NAO e: as rotas
// sao operacoes em LOTE nomeadas (PUT /produtos/versao com o objeto inteiro no
// corpo, DELETE /arquivo/arquivo com a lista de ids no corpo, POST
// /produtos/mover-arquivos). Fingir CRUD aqui produziria um mapa mentiroso.
// Entao cada recurso declara suas OPERACOES, uma por rota real.
//
// O require e preguicoso (funcao) para que um recurso com schema faltando
// quebre so o comando daquele recurso, e nao o CLI inteiro.

const RAIZ_SERVER = path.join(__dirname, '..', '..', 'server', 'src')

function carregar (relativo) {
  return () => require(path.join(RAIZ_SERVER, relativo))
}

// Colunas padrao reusadas. Os quatro campos de auditoria (data/usuario de
// cadastramento e modificacao) ficam de fora de proposito: sao ruido para quem
// so quer ler, e continuam disponiveis com --campos ou --json.
const COL_PRODUTO = ['id', 'nome', 'mi', 'inom', 'escala', 'tipo_produto', 'num_versoes']

const RECURSOS = {
  // -------------------------------------------------------------------------
  acervo: {
    nome: 'consulta ao acervo (produtos, versoes, download)',
    schema: carregar('acervo/acervo_schema'),
    operacoes: {
      buscar: {
        metodo: 'GET',
        caminho: '/acervo/busca',
        query: 'buscaProdutos',
        acesso: 'login',
        envelope: 'paginado',
        colunas: COL_PRODUTO
      },
      'obter-produto': {
        metodo: 'GET',
        caminho: '/acervo/produto/:produto_id',
        params: 'produtoByIdParams',
        acesso: 'login',
        envelope: 'registro'
      },
      'detalhar-produto': {
        metodo: 'GET',
        caminho: '/acervo/produto/detalhado/:produto_id',
        params: 'produtoByIdParams',
        acesso: 'login',
        envelope: 'registro',
        nota: 'traz produto + versoes + relacionamentos + arquivos aninhados (caro); ' +
          'o verbo `acervo produto` recorta isso'
      },
      'obter-versao': {
        metodo: 'GET',
        caminho: '/acervo/versao/:versao_id',
        params: 'versaoByIdParams',
        acesso: 'login',
        envelope: 'registro'
      },
      'listar-camadas': {
        metodo: 'GET',
        caminho: '/acervo/camadas_produto',
        acesso: 'login',
        envelope: 'lista',
        colunas: ['matviewname', 'tipo_produto', 'tipo_escala', 'quantidade_produtos'],
        nota: 'a resposta inclui credencial de leitura do banco (para o plugin QGIS); ' +
          'nunca grave essa saida em arquivo versionado'
      },
      'preparar-download-arquivos': {
        metodo: 'POST',
        caminho: '/acervo/prepare-download/arquivos',
        corpo: 'arquivosIds',
        acesso: 'login',
        envelope: 'registro'
      },
      'preparar-download-produtos': {
        metodo: 'POST',
        caminho: '/acervo/prepare-download/produtos',
        corpo: 'produtosIdsComTipos',
        acesso: 'login',
        envelope: 'registro'
      },
      'confirmar-download': {
        metodo: 'POST',
        caminho: '/acervo/confirm-download',
        corpo: 'downloadConfirmations',
        acesso: 'login',
        envelope: 'mensagem'
      },
      'atualizar-views': {
        metodo: 'POST',
        caminho: '/acervo/refresh_materialized_views',
        acesso: 'admin',
        envelope: 'lista',
        pesado: 'refaz as views materializadas de TODO o acervo; leva minutos e pesa no banco'
      },
      'criar-views': {
        metodo: 'POST',
        caminho: '/acervo/create_materialized_views',
        acesso: 'admin',
        envelope: 'lista',
        pesado: 'recria as views materializadas de TODO o acervo; leva minutos e pesa no banco'
      }
    }
  },

  // -------------------------------------------------------------------------
  produtos: {
    nome: 'escrita de produto, versao e relacionamento',
    schema: carregar('produto/produto_schema'),
    operacoes: {
      'atualizar-produto': {
        metodo: 'PUT',
        caminho: '/produtos/produto',
        corpo: 'produtoAtualizacao',
        acesso: 'admin',
        envelope: 'mensagem',
        objetoInteiro: true
      },
      'atualizar-versao': {
        metodo: 'PUT',
        caminho: '/produtos/versao',
        corpo: 'versaoAtualizacao',
        acesso: 'admin',
        envelope: 'mensagem',
        objetoInteiro: true
      },
      'corrigir-uuid-versao': {
        metodo: 'POST',
        caminho: '/produtos/versao/uuid',
        corpo: 'versaoUuidCorrecao',
        acesso: 'admin',
        envelope: 'lista',
        confirmar: {
          campo: 'correcoes',
          subcampo: 'versao_id',
          motivo: 'troca o IDENTIFICADOR da versao no acervo. Use so quando o ' +
            'BDGEx ja publicou o produto com outro uuid e o acervo e que precisa ' +
            'se acertar. O item de pedido da mapoteca acompanha por cascata, e o ' +
            'uuid antigo fica no metadado da versao'
        },
        nota: 'o PUT de versao RECUSA trocar uuid_versao, e continua certo: la o ' +
          'campo chega junto de vinte outros e a troca seria acidente. Esta rota ' +
          'existe para a troca DELIBERADA, em lote, com motivo'
      },
      'excluir-produto': {
        metodo: 'DELETE',
        caminho: '/produtos/produto',
        corpo: 'produtoIds',
        acesso: 'admin',
        envelope: 'mensagem',
        confirmar: {
          campo: 'produto_ids',
          motivo: 'exclui o produto E todas as suas versoes e arquivos (soft-delete: ' +
            'as linhas vao para as tabelas *_deletado e os bytes ficam no volume, ' +
            'mas o acervo deixa de enxerga-los)'
        }
      },
      'excluir-versao': {
        metodo: 'DELETE',
        caminho: '/produtos/versao',
        corpo: 'versaoIds',
        acesso: 'admin',
        envelope: 'mensagem',
        confirmar: {
          campo: 'versao_ids',
          motivo: 'exclui a versao E os arquivos dela (soft-delete)'
        }
      },
      'criar-produtos': {
        metodo: 'POST',
        caminho: '/produtos/produtos',
        corpo: 'produtos',
        acesso: 'admin',
        envelope: 'mensagem',
        nota: 'cria produto SEM versao e SEM arquivo (a casca). Para produto com ' +
          'arquivo, o caminho e o prepare-upload/product do recurso arquivo'
      },
      'criar-versoes-historicas': {
        metodo: 'POST',
        caminho: '/produtos/versao_historica',
        corpo: 'versoesHistoricas',
        acesso: 'admin',
        envelope: 'mensagem',
        corpoArray: true
      },
      'criar-produtos-historicos': {
        metodo: 'POST',
        caminho: '/produtos/produto_versao_historica',
        corpo: 'produtosVersoesHistoricas',
        acesso: 'admin',
        envelope: 'mensagem',
        corpoArray: true
      },
      'mover-arquivos': {
        metodo: 'POST',
        caminho: '/produtos/mover-arquivos',
        corpo: 'moverArquivos',
        acesso: 'admin',
        envelope: 'mensagem',
        confirmar: {
          campo: 'arquivo_ids',
          motivo: 'reamarra arquivo a outra versao. Com permitir_entre_produtos=true ' +
            'o arquivo muda de PRODUTO, e nao ha rota inversa automatica: desfazer ' +
            'e outro mover-arquivos, montado a mao'
        }
      },
      'renumerar-versoes': {
        metodo: 'POST',
        caminho: '/produtos/renumerar-versoes',
        corpo: 'renumeraVersoes',
        acesso: 'admin',
        envelope: 'registro',
        confirmar: {
          campo: 'produto_id',
          motivo: 'desloca o rotulo de TODAS as versoes da familia naquele ' +
            'produto/subtipo para abrir espaco. Renumerar sem antes provar que a ' +
            'edicao e nova (comparando o checksum) cria edicao-fantasma'
        }
      },
      'listar-relacionamentos': {
        metodo: 'GET',
        caminho: '/produtos/versao_relacionamento',
        acesso: 'login',
        envelope: 'lista',
        colunas: ['id', 'versao_id_1', 'versao_id_2', 'tipo_relacionamento_id']
      },
      'criar-relacionamentos': {
        metodo: 'POST',
        caminho: '/produtos/versao_relacionamento',
        corpo: 'versaoRelacionamento',
        acesso: 'admin',
        envelope: 'mensagem'
      },
      'atualizar-relacionamentos': {
        metodo: 'PUT',
        caminho: '/produtos/versao_relacionamento',
        corpo: 'versaoRelacionamentoAtualizacao',
        acesso: 'admin',
        envelope: 'mensagem'
      },
      'excluir-relacionamentos': {
        metodo: 'DELETE',
        caminho: '/produtos/versao_relacionamento',
        corpo: 'versaoRelacionamentoIds',
        acesso: 'admin',
        envelope: 'mensagem',
        confirmar: {
          campo: 'versao_relacionamento_ids',
          motivo: 'apaga o vinculo (o DELETE de relacionamento e hard, nao ha tabela ' +
            'de deletados); recriar exige saber os dois versao_id de novo'
        }
      }
    }
  },

  // -------------------------------------------------------------------------
  arquivo: {
    nome: 'arquivo e sessoes de upload',
    schema: carregar('arquivo/arquivo_schema'),
    operacoes: {
      atualizar: {
        metodo: 'PUT',
        caminho: '/arquivo/arquivo',
        corpo: 'arquivoAtualizacao',
        acesso: 'admin',
        envelope: 'mensagem',
        objetoInteiro: true
      },
      excluir: {
        metodo: 'DELETE',
        caminho: '/arquivo/arquivo',
        corpo: 'arquivoIds',
        acesso: 'admin',
        envelope: 'mensagem',
        confirmar: {
          campo: 'arquivo_ids',
          motivo: 'soft-delete: a linha vai para acervo.arquivo_deletado e o acervo ' +
            'deixa de enxergar o arquivo (os bytes seguem no volume)'
        }
      },
      'preparar-arquivos': {
        metodo: 'POST',
        caminho: '/arquivo/prepare-upload/files',
        corpo: 'prepareAddFiles',
        acesso: 'admin',
        envelope: 'registro'
      },
      'preparar-versao': {
        metodo: 'POST',
        caminho: '/arquivo/prepare-upload/version',
        corpo: 'prepareAddVersion',
        acesso: 'admin',
        envelope: 'registro'
      },
      'preparar-produto': {
        metodo: 'POST',
        caminho: '/arquivo/prepare-upload/product',
        corpo: 'prepareAddProduct',
        acesso: 'admin',
        envelope: 'registro'
      },
      catalogar: {
        metodo: 'POST',
        caminho: '/arquivo/catalogar/product',
        corpo: 'catalogarProduto',
        acesso: 'admin',
        envelope: 'registro',
        nota: 'produto que JA ESTA no volume: cadastra sem transferir nem renomear ' +
          'byte, e devolve os ids criados. So aceita volume marcado com ' +
          '`layout_origem`, e o `volume_armazenamento_id` vem no corpo, porque o ' +
          'volume e onde o arquivo ja esta. NAO mande checksum nem tamanho_mb: quem ' +
          'le o arquivo e mede e o servidor, uma vez so. Nao ha sessao para fechar, ' +
          'e a resposta ja e definitiva'
      },
      'preparar-substituicao': {
        metodo: 'POST',
        caminho: '/arquivo/prepare-upload/replace-files',
        corpo: 'prepareReplaceFiles',
        acesso: 'admin',
        envelope: 'registro',
        nota: 'substitui o conteudo do slot (versao_id, nome_arquivo, extensao) sem ' +
          'criar versao nova'
      },
      'confirmar-upload': {
        metodo: 'POST',
        caminho: '/arquivo/confirm-upload',
        corpo: 'confirmUpload',
        acesso: 'admin',
        envelope: 'registro'
      },
      'cancelar-upload': {
        metodo: 'POST',
        caminho: '/arquivo/cancel-upload',
        corpo: 'cancelUpload',
        acesso: 'login',
        envelope: 'mensagem'
      },
      'listar-sessoes': {
        metodo: 'GET',
        caminho: '/arquivo/upload-sessions',
        acesso: 'admin',
        envelope: 'lista'
      },
      'listar-problemas': {
        metodo: 'GET',
        caminho: '/arquivo/problem-uploads',
        acesso: 'admin',
        envelope: 'lista'
      }
    }
  },

  // -------------------------------------------------------------------------
  projetos: {
    nome: 'projeto e lote',
    schema: carregar('projeto/projeto_schema'),
    operacoes: {
      listar: {
        metodo: 'GET',
        caminho: '/projetos/projeto',
        acesso: 'login',
        envelope: 'lista',
        colunas: ['id', 'nome', 'data_inicio', 'data_fim', 'status_execucao_id']
      },
      criar: {
        metodo: 'POST',
        caminho: '/projetos/projeto',
        corpo: 'projeto',
        acesso: 'admin',
        envelope: 'registro'
      },
      atualizar: {
        metodo: 'PUT',
        caminho: '/projetos/projeto',
        corpo: 'projetoAtualizacao',
        acesso: 'admin',
        envelope: 'registro',
        objetoInteiro: true
      },
      excluir: {
        metodo: 'DELETE',
        caminho: '/projetos/projeto',
        corpo: 'projetoIds',
        acesso: 'admin',
        envelope: 'registro',
        confirmar: {
          campo: 'projeto_ids',
          motivo: 'projeto com lote associado nao deve ser excluido; o vinculo de ' +
            'versao ao lote e o que amarra a producao ao PIT'
        }
      },
      'listar-lotes': {
        metodo: 'GET',
        caminho: '/projetos/lote',
        acesso: 'login',
        envelope: 'lista',
        colunas: ['id', 'nome', 'pit', 'projeto_id', 'data_inicio', 'data_fim', 'status_execucao_id']
      },
      'criar-lote': {
        metodo: 'POST',
        caminho: '/projetos/lote',
        corpo: 'lote',
        acesso: 'admin',
        envelope: 'registro'
      },
      'atualizar-lote': {
        metodo: 'PUT',
        caminho: '/projetos/lote',
        corpo: 'loteAtualizacao',
        acesso: 'admin',
        envelope: 'registro',
        objetoInteiro: true
      },
      'excluir-lote': {
        metodo: 'DELETE',
        caminho: '/projetos/lote',
        corpo: 'loteIds',
        acesso: 'admin',
        envelope: 'registro',
        confirmar: {
          campo: 'lote_ids',
          motivo: 'o lote e o que liga a versao ao PIT; versao orfa de lote perde a ' +
            'rastreabilidade da producao'
        }
      }
    }
  },

  // -------------------------------------------------------------------------
  volumes: {
    nome: 'volume de armazenamento',
    schema: carregar('volume/volume_schema'),
    operacoes: {
      listar: {
        metodo: 'GET',
        caminho: '/volumes/volume_armazenamento',
        acesso: 'admin',
        envelope: 'lista',
        // `layout_origem` entra na projecao porque decide como o nome fisico do
        // arquivo se le. Sem ela na lista, quem opera nao tem como saber que o
        // volume guarda o layout do fornecedor, e conclui que o nome fora do
        // padrao e defeito. Coluna que muda a interpretacao das outras nao pode
        // ficar so no --json.
        colunas: ['id', 'nome', 'volume', 'capacidade_gb', 'layout_origem'],
        nota: 'a coluna `volume` e o caminho de rede do armazenamento: nunca grave ' +
          'essa saida em arquivo versionado nem na wiki. `layout_origem` = o volume ' +
          'guarda a entrega no layout do fornecedor: ali o nome fisico e o caminho ' +
          'relativo de origem, e o padrao derivado nao se aplica'
      },
      criar: {
        metodo: 'POST',
        caminho: '/volumes/volume_armazenamento',
        corpo: 'volumeArmazenamento',
        acesso: 'admin',
        envelope: 'mensagem'
      },
      atualizar: {
        metodo: 'PUT',
        caminho: '/volumes/volume_armazenamento',
        corpo: 'volumeArmazenamentoAtualizacao',
        acesso: 'admin',
        envelope: 'mensagem',
        objetoInteiro: true
      },
      excluir: {
        metodo: 'DELETE',
        caminho: '/volumes/volume_armazenamento',
        corpo: 'volumeArmazenamentoIds',
        acesso: 'admin',
        envelope: 'mensagem',
        confirmar: {
          campo: 'volume_armazenamento_ids',
          motivo: 'volume referenciado por arquivo e o que diz ONDE o byte mora; ' +
            'sem ele o acervo nao sabe montar o caminho'
        }
      },
      'listar-tipos': {
        metodo: 'GET',
        caminho: '/volumes/volume_tipo_produto',
        acesso: 'admin',
        envelope: 'lista',
        colunas: ['id', 'tipo_produto_id', 'volume_armazenamento_id', 'primario']
      },
      'criar-tipo': {
        metodo: 'POST',
        caminho: '/volumes/volume_tipo_produto',
        corpo: 'volumeTipoProduto',
        acesso: 'admin',
        envelope: 'mensagem'
      },
      'atualizar-tipo': {
        metodo: 'PUT',
        caminho: '/volumes/volume_tipo_produto',
        corpo: 'volumeTipoProdutoAtualizacao',
        acesso: 'admin',
        envelope: 'mensagem',
        objetoInteiro: true
      },
      'excluir-tipo': {
        metodo: 'DELETE',
        caminho: '/volumes/volume_tipo_produto',
        corpo: 'volumeTipoProdutoIds',
        acesso: 'admin',
        envelope: 'mensagem',
        confirmar: {
          campo: 'volume_tipo_produto_ids',
          motivo: 'e o mapa tipo de produto -> volume que a carga usa para decidir ' +
            'o destino do arquivo'
        }
      }
    }
  },

  // -------------------------------------------------------------------------
  gerencia: {
    nome: 'consistencia e trilha de exclusao',
    schema: carregar('gerencia/gerencia_schema'),
    operacoes: {
      'verificar-inconsistencias': {
        metodo: 'POST',
        caminho: '/gerencia/verificar_inconsistencias',
        acesso: 'admin',
        envelope: 'registro',
        nota: 'so LE (o POST e por ser caro, nao por escrever). Rode ao fim de toda ' +
          'carga ou correcao em lote'
      },
      'arquivos-deletados': {
        metodo: 'GET',
        caminho: '/gerencia/arquivos_deletados',
        query: 'paginationParams',
        acesso: 'admin',
        envelope: 'lista'
      },
      'arquivos-incorretos': {
        metodo: 'GET',
        caminho: '/gerencia/arquivos_incorretos',
        query: 'paginationParams',
        acesso: 'admin',
        envelope: 'lista'
      },
      'downloads-deletados': {
        metodo: 'GET',
        caminho: '/gerencia/downloads_deletados',
        query: 'paginationParams',
        acesso: 'admin',
        envelope: 'lista'
      }
    }
  },

  // -------------------------------------------------------------------------
  // Do dashboard entram so os paineis que respondem pergunta de chefe. O resto
  // das rotas /api/dashboard e encanamento de grafico do acervo_client (serie
  // temporal por dia, metrica de atividade por usuario) e nao ganharia nada em
  // passar por um CLI de agente.
  dashboard: {
    nome: 'paineis agregados (subconjunto util a agente)',
    schema: carregar('dashboard/dashboard_schema'),
    operacoes: {
      'produtos-total': { metodo: 'GET', caminho: '/dashboard/produtos_total', acesso: 'login', envelope: 'registro' },
      'produtos-tipo': { metodo: 'GET', caminho: '/dashboard/produtos_tipo', acesso: 'login', envelope: 'lista' },
      'produtos-escala': { metodo: 'GET', caminho: '/dashboard/produtos_escala', acesso: 'login', envelope: 'lista' },
      'arquivos-total-gb': { metodo: 'GET', caminho: '/dashboard/arquivos_total_gb', acesso: 'login', envelope: 'registro' },
      'gb-volume': { metodo: 'GET', caminho: '/dashboard/gb_volume', acesso: 'login', envelope: 'lista' },
      'situacao-carregamento': { metodo: 'GET', caminho: '/dashboard/situacao_carregamento', acesso: 'login', envelope: 'lista' },
      'ultimos-carregamentos': { metodo: 'GET', caminho: '/dashboard/ultimos_carregamentos', query: 'totalQuery', acesso: 'login', envelope: 'lista' },
      'ultimas-modificacoes': { metodo: 'GET', caminho: '/dashboard/ultimas_modificacoes', query: 'totalQuery', acesso: 'login', envelope: 'lista' },
      'ultimos-deletes': { metodo: 'GET', caminho: '/dashboard/ultimos_deletes', query: 'totalQuery', acesso: 'login', envelope: 'lista' },
      'ultimas-versoes': { metodo: 'GET', caminho: '/dashboard/ultimas_versoes', query: 'limitParam', acesso: 'login', envelope: 'lista' },
      'saude-sistema': { metodo: 'GET', caminho: '/dashboard/system_health', acesso: 'login', envelope: 'registro' }
    }
  },

  // -------------------------------------------------------------------------
  usuarios: {
    nome: 'usuario (importado do servico de autenticacao)',
    schema: carregar('usuario/usuario_schema'),
    operacoes: {
      listar: {
        metodo: 'GET',
        caminho: '/usuarios',
        acesso: 'admin',
        envelope: 'lista',
        colunas: ['id', 'uuid', 'login', 'nome', 'administrador', 'ativo']
      },
      'listar-auth': {
        metodo: 'GET',
        caminho: '/usuarios/servico_autenticacao',
        acesso: 'admin',
        envelope: 'lista'
      },
      criar: {
        metodo: 'POST',
        caminho: '/usuarios',
        corpo: 'listaUsuario',
        acesso: 'admin',
        envelope: 'mensagem',
        nota: 'importa usuarios do servico de autenticacao pelo uuid; o SCA nunca ' +
          'guarda senha'
      },
      atualizar: {
        metodo: 'PUT',
        caminho: '/usuarios/:uuid',
        corpo: 'updateUsuario',
        params: 'uuidParams',
        acesso: 'admin',
        envelope: 'mensagem'
      },
      'atualizar-lista': {
        metodo: 'PUT',
        caminho: '/usuarios',
        corpo: 'updateUsuarioLista',
        acesso: 'admin',
        envelope: 'mensagem'
      },
      sincronizar: {
        metodo: 'PUT',
        caminho: '/usuarios/sincronizar',
        acesso: 'admin',
        envelope: 'mensagem'
      }
    }
  },

  // -------------------------------------------------------------------------
  integracao: {
    nome: 'rotas publicas de integracao (sem login)',
    schema: carregar('integracao/integracao_schema'),
    operacoes: {
      'situacao-geral': {
        metodo: 'GET',
        caminho: '/integracao/acervo/situacao_geral',
        query: 'situacaoGeralQuery',
        acesso: 'publico',
        envelope: 'registro',
        nota: 'devolve { escala: [Feature] }; o verbo `acervo cobertura` recorta isso'
      },
      finalizados: {
        metodo: 'GET',
        caminho: '/integracao/acervo/produtos_finalizados',
        query: 'produtosFinalizadosQuery',
        acesso: 'publico',
        envelope: 'registro'
      }
    }
  },

  // -------------------------------------------------------------------------
  relatorio: {
    nome: 'RPCMTec, secao acervo',
    schema: carregar('relatorio/relatorio_schema'),
    operacoes: {
      rpcmtec: {
        metodo: 'GET',
        caminho: '/relatorio/rpcmtec',
        query: 'rpcmtecQuery',
        acesso: 'admin',
        envelope: 'registro'
      }
    }
  },

  // -------------------------------------------------------------------------
  login: {
    nome: 'autenticacao (use os verbos login/status/logout)',
    schema: carregar('login/login_schema'),
    operacoes: {
      autenticar: {
        metodo: 'POST',
        caminho: '/login',
        corpo: 'login',
        acesso: 'publico',
        envelope: 'registro',
        nota: 'prefira `acervo login`, que guarda o token em cache e nao pede a senha ' +
          'na linha de comando'
      }
    }
  }
}

function obter (chave) {
  const recurso = RECURSOS[chave]
  if (!recurso) {
    throw new Error(
      `Recurso desconhecido: "${chave}". Disponiveis: ${Object.keys(RECURSOS).join(', ')}.`
    )
  }
  return recurso
}

function obterOperacao (chave, acao) {
  const recurso = obter(chave)
  const op = recurso.operacoes[acao]
  if (!op) {
    throw new Error(
      `Operacao desconhecida "${acao}" em ${chave}.\n` +
      `Operacoes de ${chave}: ${Object.keys(recurso.operacoes).join(', ')}.\n` +
      `Contrato: acervo schema ${chave}`
    )
  }
  return { recurso, operacao: op }
}

function listarChaves () {
  return Object.keys(RECURSOS)
}

/** Substitui :param no caminho pelos valores das flags de mesmo nome. */
function montarCaminho (operacao, flags) {
  return operacao.caminho.replace(/:([a-z_]+)/g, (_, nome) => {
    const valor = flags[nome]
    if (valor === undefined || valor === true) {
      throw new Error(
        `A rota ${operacao.metodo} /api${operacao.caminho} exige --${nome}.`
      )
    }
    return encodeURIComponent(valor)
  })
}

module.exports = { RECURSOS, RAIZ_SERVER, obter, obterOperacao, listarChaves, montarCaminho }
