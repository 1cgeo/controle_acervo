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
        acesso: 'consulta',
        envelope: 'paginado',
        colunas: COL_PRODUTO
      },
      'obter-produto': {
        metodo: 'GET',
        caminho: '/acervo/produto/:produto_id',
        params: 'produtoByIdParams',
        acesso: 'consulta',
        envelope: 'registro'
      },
      'detalhar-produto': {
        metodo: 'GET',
        caminho: '/acervo/produto/detalhado/:produto_id',
        params: 'produtoByIdParams',
        acesso: 'consulta',
        envelope: 'registro',
        nota: 'traz produto + versoes + relacionamentos + arquivos aninhados (caro); ' +
          'o verbo `acervo produto` recorta isso'
      },
      'obter-versao': {
        metodo: 'GET',
        caminho: '/acervo/versao/:versao_id',
        params: 'versaoByIdParams',
        acesso: 'consulta',
        envelope: 'registro'
      },
      'listar-camadas': {
        metodo: 'GET',
        caminho: '/acervo/camadas_produto',
        acesso: 'consulta',
        envelope: 'lista',
        colunas: ['matviewname', 'tipo_produto', 'tipo_escala', 'quantidade_produtos'],
        nota: 'a resposta inclui credencial de leitura do banco (para o plugin QGIS); ' +
          'nunca grave essa saida em arquivo versionado'
      },
      'preparar-download-arquivos': {
        metodo: 'POST',
        caminho: '/acervo/prepare-download/arquivos',
        corpo: 'arquivosIds',
        acesso: 'consulta',
        envelope: 'registro'
      },
      'preparar-download-produtos': {
        metodo: 'POST',
        caminho: '/acervo/prepare-download/produtos',
        corpo: 'produtosIdsComTipos',
        acesso: 'consulta',
        envelope: 'registro'
      },
      'confirmar-download': {
        metodo: 'POST',
        caminho: '/acervo/confirm-download',
        corpo: 'downloadConfirmations',
        acesso: 'consulta',
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
      },
      'limpar-downloads-expirados': {
        metodo: 'POST',
        caminho: '/acervo/cleanup-expired-downloads',
        acesso: 'admin',
        // Envelope `registro`: a resposta e um OBJETO de contadores, e nao lista
        // nem mensagem. Com `mensagem` o CLI imprimiria so a prosa do servidor e
        // o numero medido pelo UPDATE se perderia, que e justamente o que a rota
        // passou a devolver em 06/08/2026.
        envelope: 'registro',
        destrutivo: 'muda o status do download de `pending` para `failed`. Nao ha ' +
          'rota que desfaca: o pedido reprovado se refaz com um prepare-download novo',
        nota: 'so o download que ja passou da expiration_time. A linha FICA (nada ' +
          'e apagado) e a trilha continua em /gerencia/downloads_deletados. Devolve ' +
          '{ fechados }, contado pelo proprio UPDATE. Nao ha cron: quem roda e uma ' +
          'pessoa, e ela aparece no rastro de auditoria'
      },
      // A FILA DE MINIATURA, que e DIVIDA VISIVEL. A miniatura nao e gerada no
      // cadastro de proposito: renderizar custa segundos e roda processo
      // externo, dentro da transacao que confirma o envio. Desde que o cron
      // saiu, nada esvazia a fila sozinho: o GET diz o tamanho dela e o POST
      // paga um lote.
      'miniaturas-pendentes': {
        metodo: 'GET',
        caminho: '/acervo/miniaturas/pendentes',
        // CONSULTA, e nao admin: o GET so conta. Quem paga a fila e o admin.
        acesso: 'consulta',
        envelope: 'registro',
        nota: 'devolve { pendentes, lote }: quantas versoes esperam miniatura, e ' +
          'quantas cabem numa passada de `varrer-miniaturas`. Numero grande e ' +
          'parado significa que ninguem esta rodando a varredura'
      },
      'varrer-miniaturas': {
        metodo: 'POST',
        caminho: '/acervo/miniaturas/varrer',
        acesso: 'admin',
        envelope: 'registro',
        pesado: 'renderiza um LOTE de miniaturas; cada uma custa segundos e roda ' +
          'processo externo, entao a chamada demora e pesa na maquina do servidor',
        nota: 'tres desfechos, e o envelope os distingue. Normal devolve ' +
          '{ sucessos, falhas, restante }. `pulada: true` significa que outra ' +
          'varredura ja estava em curso e NADA foi feito agora. `abortada` traz o ' +
          'motivo da parada, com os sucessos obtidos antes dela. Repetir a chamada ' +
          'ate `restante` chegar a zero e o uso normal'
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
        acesso: 'operador',
        envelope: 'mensagem',
        objetoInteiro: true
      },
      'atualizar-versao': {
        metodo: 'PUT',
        caminho: '/produtos/versao',
        corpo: 'versaoAtualizacao',
        acesso: 'operador',
        envelope: 'mensagem',
        objetoInteiro: true
      },
      'corrigir-uuid-versao': {
        metodo: 'POST',
        caminho: '/produtos/versao/uuid',
        corpo: 'versaoUuidCorrecao',
        acesso: 'gerente',
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
        acesso: 'gerente',
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
        acesso: 'gerente',
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
        acesso: 'operador',
        envelope: 'mensagem',
        nota: 'cria produto SEM versao e SEM arquivo (a casca). Para produto com ' +
          'arquivo, o caminho e o prepare-upload/product do recurso arquivo'
      },
      'criar-versoes-historicas': {
        metodo: 'POST',
        caminho: '/produtos/versao_historica',
        corpo: 'versoesHistoricas',
        acesso: 'operador',
        envelope: 'mensagem',
        corpoArray: true
      },
      'criar-produtos-historicos': {
        metodo: 'POST',
        caminho: '/produtos/produto_versao_historica',
        corpo: 'produtosVersoesHistoricas',
        acesso: 'operador',
        envelope: 'mensagem',
        corpoArray: true
      },
      'criar-versoes-planejadas': {
        metodo: 'POST',
        caminho: '/produtos/versao_planejada',
        corpo: 'versoesPlanejadas',
        acesso: 'operador',
        envelope: 'mensagem',
        corpoArray: true,
        nota: 'a versao PLANEJADA e a folha que ainda vai ser produzida: nasce sem ' +
          'arquivo, para o item de pedido da mapoteca poder apontar para ela, e o ' +
          'arquivo entra nesta MESMA versao quando a producao terminar. O corpo e o ' +
          'mesmo de criar-versoes-historicas; quem separa e a rota'
      },
      'criar-produtos-planejados': {
        metodo: 'POST',
        caminho: '/produtos/produto_versao_planejada',
        corpo: 'produtosVersoesPlanejadas',
        acesso: 'operador',
        envelope: 'mensagem',
        corpoArray: true,
        nota: 'como criar-produtos-historicos, mas a versao nasce PLANEJADA: aqui o ' +
          'produto tambem nasce junto'
      },
      'mover-arquivos': {
        metodo: 'POST',
        caminho: '/produtos/mover-arquivos',
        corpo: 'moverArquivos',
        acesso: 'operador',
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
        acesso: 'operador',
        envelope: 'registro',
        confirmar: {
          campo: 'produto_id',
          motivo: 'desloca o rotulo de TODAS as versoes da familia naquele ' +
            'produto/subtipo para abrir espaco. Renumerar sem antes provar que a ' +
            'edicao e nova (comparando o checksum) cria edicao-fantasma'
        }
      },
      folha: {
        metodo: 'GET',
        caminho: '/produtos/folha',
        query: 'folhaQuery',
        acesso: 'consulta',
        envelope: 'registro',
        nota: 'a moldura de UMA folha da grade, por --inom ou por --mi. Os dois ' +
          'juntos sao recusados; o MI nu resolve em 100k, e a folha de 250k exige ' +
          '--tipo_escala_id'
      },
      'listar-relacionamentos': {
        metodo: 'GET',
        caminho: '/produtos/versao_relacionamento',
        acesso: 'consulta',
        envelope: 'lista',
        colunas: ['id', 'versao_id_1', 'versao_id_2', 'tipo_relacionamento_id']
      },
      'criar-relacionamentos': {
        metodo: 'POST',
        caminho: '/produtos/versao_relacionamento',
        corpo: 'versaoRelacionamento',
        acesso: 'operador',
        envelope: 'mensagem'
      },
      'atualizar-relacionamentos': {
        metodo: 'PUT',
        caminho: '/produtos/versao_relacionamento',
        corpo: 'versaoRelacionamentoAtualizacao',
        acesso: 'operador',
        envelope: 'mensagem'
      },
      'excluir-relacionamentos': {
        metodo: 'DELETE',
        caminho: '/produtos/versao_relacionamento',
        corpo: 'versaoRelacionamentoIds',
        acesso: 'gerente',
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
        acesso: 'operador',
        envelope: 'mensagem',
        objetoInteiro: true
      },
      excluir: {
        metodo: 'DELETE',
        caminho: '/arquivo/arquivo',
        corpo: 'arquivoIds',
        acesso: 'gerente',
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
        acesso: 'operador',
        envelope: 'registro'
      },
      'preparar-versao': {
        metodo: 'POST',
        caminho: '/arquivo/prepare-upload/version',
        corpo: 'prepareAddVersion',
        acesso: 'operador',
        envelope: 'registro'
      },
      'preparar-produto': {
        metodo: 'POST',
        caminho: '/arquivo/prepare-upload/product',
        corpo: 'prepareAddProduct',
        acesso: 'operador',
        envelope: 'registro'
      },
      catalogar: {
        metodo: 'POST',
        caminho: '/arquivo/catalogar/product',
        corpo: 'catalogarProduto',
        acesso: 'operador',
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
        acesso: 'operador',
        envelope: 'registro',
        nota: 'substitui o conteudo do slot (versao_id, nome_arquivo, extensao) sem ' +
          'criar versao nova'
      },
      'confirmar-upload': {
        metodo: 'POST',
        caminho: '/arquivo/confirm-upload',
        corpo: 'confirmUpload',
        acesso: 'operador',
        envelope: 'registro',
        nota: 'fecha a sessao e devolve os ids REAIS do que entrou no acervo: em ' +
          'add_version, versoes[].versao_id e versoes[].produto_id; em add_product, ' +
          'produtos[].produto_id e produtos[].versoes[].versao_id. Status failed nao ' +
          'traz id nenhum, so `detalhes` com o arquivo que reprovou'
      },
      'cancelar-upload': {
        metodo: 'POST',
        caminho: '/arquivo/cancel-upload',
        corpo: 'cancelUpload',
        acesso: 'operador',
        envelope: 'mensagem'
      },
      'listar-sessoes': {
        metodo: 'GET',
        caminho: '/arquivo/upload-sessions',
        acesso: 'operador',
        envelope: 'lista'
      },
      'listar-problemas': {
        metodo: 'GET',
        caminho: '/arquivo/problem-uploads',
        acesso: 'operador',
        envelope: 'lista'
      },
      'limpar-uploads-expirados': {
        metodo: 'POST',
        caminho: '/arquivo/cleanup-expired-uploads',
        acesso: 'admin',
        // Mesmo motivo do limpar-downloads-expirados: sao DOIS contadores, e o
        // envelope `mensagem` jogaria os dois fora.
        envelope: 'registro',
        destrutivo: 'APAGA a sessao de envio ja encerrada (completed, failed ou ' +
          'cancelled) cuja expiration_time passou ha mais de 30 dias. O DELETE e ' +
          'definitivo, e com a linha some o destination_path que `listar-problemas` ' +
          'mostra. Rode `listar-problemas` antes, se ainda for investigar algum envio',
        nota: 'faz duas coisas e devolve as duas contagens: `fechadas` e a sessao ' +
          'vencida que virou failed (a linha fica), `apagadas` e a encerrada ha mais ' +
          'de 30 dias que saiu da tabela. Os dois numeros vem da funcao do banco ' +
          'acervo.cleanup_expired_uploads(). ROTA PROPRIA desde 06/08/2026: antes ' +
          'esta limpeza pegava carona em /acervo/cleanup-expired-downloads, e quem ' +
          'procurasse a limpeza de ENVIO nao a achava atras de um nome de download'
      },
      'atualizar-checksum': {
        metodo: 'POST',
        caminho: '/arquivo/atualizar-checksum',
        corpo: 'atualizarChecksum',
        acesso: 'admin',
        envelope: 'registro',
        nota: 'para o arquivo que foi RECOMPRIMIDO sem perda no volume: os bytes ' +
          'mudaram e o pixel nao. So a lista de ids viaja; quem rele o arquivo e ' +
          'mede o checksum e o tamanho e o servidor'
      },
      'renomear-padrao': {
        metodo: 'POST',
        caminho: '/arquivo/renomear-padrao',
        corpo: 'renomearPadrao',
        acesso: 'admin',
        envelope: 'registro',
        nota: 'renomeia o arquivo fisico para o nome derivado dos metadados (a mesma ' +
          'funcao que o invariante 7a audita). O corpo tem dry_run, que vem true por ' +
          'DEFAULT: mande dry_run=false para renomear de verdade. Sem arquivo_ids ele ' +
          'pega os divergentes ate `limite`; chame em laco ate `restantes` zerar'
      },
      'corrigir-nome-fisico': {
        metodo: 'POST',
        caminho: '/arquivo/corrigir-nome-fisico',
        corpo: 'corrigirNomeFisico',
        acesso: 'admin',
        envelope: 'registro',
        nota: 'a IRMA INVERSA do renomear-padrao: la o catalogo manda e o BYTE se ' +
          'move, aqui o DISCO manda e o CATALOGO se corrige. Nenhum byte e tocado. ' +
          'Serve o volume com layout_origem, onde o arquivo e do fornecedor e ' +
          'renomear o .img do ERDAS quebraria a referencia interna ao .ige. O nome ' +
          'novo vem no corpo porque ele nao e computavel: e uma entrada de ' +
          'diretorio. O servidor NAO acredita no corpo, ele le o diretorio e compara ' +
          'caractere a caractere (readdir, e nao fs.access, que ignora caixa no ' +
          'Windows e nao no Linux). Recusa se o nome atual ainda existir no volume ' +
          '(seria renome), se o nome novo nao existir, se o tamanho nao bater ou se ' +
          'o sha256 nao bater. dry_run e conferir_checksum vem TRUE por default. ' +
          'NAO mexe em tipo_status_id: quem marcou o erro foi a verificacao do ' +
          'acervo, e e ela que tira a marca'
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
        acesso: 'consulta',
        envelope: 'lista',
        colunas: ['id', 'nome', 'data_inicio', 'data_fim', 'status_execucao_id']
      },
      criar: {
        metodo: 'POST',
        caminho: '/projetos/projeto',
        corpo: 'projeto',
        acesso: 'operador',
        envelope: 'registro'
      },
      atualizar: {
        metodo: 'PUT',
        caminho: '/projetos/projeto',
        corpo: 'projetoAtualizacao',
        acesso: 'operador',
        envelope: 'registro',
        objetoInteiro: true
      },
      excluir: {
        metodo: 'DELETE',
        caminho: '/projetos/projeto',
        corpo: 'projetoIds',
        acesso: 'gerente',
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
        acesso: 'consulta',
        envelope: 'lista',
        colunas: ['id', 'nome', 'pit', 'projeto_id', 'data_inicio', 'data_fim', 'status_execucao_id']
      },
      'criar-lote': {
        metodo: 'POST',
        caminho: '/projetos/lote',
        corpo: 'lote',
        acesso: 'operador',
        envelope: 'registro'
      },
      'atualizar-lote': {
        metodo: 'PUT',
        caminho: '/projetos/lote',
        corpo: 'loteAtualizacao',
        acesso: 'operador',
        envelope: 'registro',
        objetoInteiro: true
      },
      'excluir-lote': {
        metodo: 'DELETE',
        caminho: '/projetos/lote',
        corpo: 'loteIds',
        acesso: 'gerente',
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
        acesso: 'operador',
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
        acesso: 'operador',
        envelope: 'mensagem'
      },
      atualizar: {
        metodo: 'PUT',
        caminho: '/volumes/volume_armazenamento',
        corpo: 'volumeArmazenamentoAtualizacao',
        acesso: 'operador',
        envelope: 'mensagem',
        objetoInteiro: true
      },
      excluir: {
        metodo: 'DELETE',
        caminho: '/volumes/volume_armazenamento',
        corpo: 'volumeArmazenamentoIds',
        acesso: 'gerente',
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
        acesso: 'operador',
        envelope: 'lista',
        colunas: ['id', 'tipo_produto_id', 'volume_armazenamento_id', 'primario']
      },
      'criar-tipo': {
        metodo: 'POST',
        caminho: '/volumes/volume_tipo_produto',
        corpo: 'volumeTipoProduto',
        acesso: 'operador',
        envelope: 'mensagem'
      },
      'atualizar-tipo': {
        metodo: 'PUT',
        caminho: '/volumes/volume_tipo_produto',
        corpo: 'volumeTipoProdutoAtualizacao',
        acesso: 'operador',
        envelope: 'mensagem',
        objetoInteiro: true
      },
      'excluir-tipo': {
        metodo: 'DELETE',
        caminho: '/volumes/volume_tipo_produto',
        corpo: 'volumeTipoProdutoIds',
        acesso: 'gerente',
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
        acesso: 'gerente',
        envelope: 'registro',
        nota: 'so LE (o POST e por ser caro, nao por escrever). Rode ao fim de toda ' +
          'carga ou correcao em lote'
      },
      'arquivos-deletados': {
        metodo: 'GET',
        caminho: '/gerencia/arquivos_deletados',
        query: 'paginationParams',
        acesso: 'gerente',
        envelope: 'lista'
      },
      'arquivos-incorretos': {
        metodo: 'GET',
        caminho: '/gerencia/arquivos_incorretos',
        query: 'paginationParams',
        acesso: 'gerente',
        envelope: 'lista'
      },
      'downloads-deletados': {
        metodo: 'GET',
        caminho: '/gerencia/downloads_deletados',
        query: 'paginationParams',
        acesso: 'gerente',
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
      'produtos-total': { metodo: 'GET', caminho: '/dashboard/produtos_total', acesso: 'consulta', envelope: 'registro' },
      'produtos-tipo': { metodo: 'GET', caminho: '/dashboard/produtos_tipo', acesso: 'consulta', envelope: 'lista' },
      'produtos-escala': { metodo: 'GET', caminho: '/dashboard/produtos_escala', acesso: 'consulta', envelope: 'lista' },
      'arquivos-total-gb': { metodo: 'GET', caminho: '/dashboard/arquivos_total_gb', acesso: 'consulta', envelope: 'registro' },
      'gb-volume': { metodo: 'GET', caminho: '/dashboard/gb_volume', acesso: 'consulta', envelope: 'lista' },
      'situacao-carregamento': { metodo: 'GET', caminho: '/dashboard/situacao_carregamento', acesso: 'consulta', envelope: 'lista' },
      'ultimos-carregamentos': { metodo: 'GET', caminho: '/dashboard/ultimos_carregamentos', query: 'totalQuery', acesso: 'consulta', envelope: 'lista' },
      'ultimas-modificacoes': { metodo: 'GET', caminho: '/dashboard/ultimas_modificacoes', query: 'totalQuery', acesso: 'consulta', envelope: 'lista' },
      'ultimos-deletes': { metodo: 'GET', caminho: '/dashboard/ultimos_deletes', query: 'totalQuery', acesso: 'consulta', envelope: 'lista' },
      'ultimas-versoes': { metodo: 'GET', caminho: '/dashboard/ultimas_versoes', query: 'limitParam', acesso: 'consulta', envelope: 'lista' },
      'saude-sistema': { metodo: 'GET', caminho: '/dashboard/system_health', acesso: 'consulta', envelope: 'registro' }
    }
  },

  // -------------------------------------------------------------------------
  // SEM recurso `usuarios` nem `efetivo`: os dois sao PLATAFORMA, e o CLI deles
  // e o efetivo_cli (`node efetivo_cli/efetivo.js --ajuda`). Cadastro, senha,
  // perfil por modulo, historico de acesso e quem esteve na Divisao nao
  // pertencem ao modulo acervo.

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
  // O RPCMTec e o relatorio mensal da DIVISAO, e nao do acervo: a mesma edicao
  // fala de acervo, mapoteca, orcamento, PIT, efetivo e equipamento.
  //
  // Nao ha rota que GERE o relatorio sob demanda. O documento pertence a uma
  // EDICAO mensal (rpcmtec.edicao), que alguem cria uma vez por mes: primeiro se
  // acha a edicao do ano/mes na listagem, depois se pede o documento dela pelo
  // id. Edicao aberta calcula do banco; edicao fechada devolve o congelado.
  //
  // A GUARDA TEM DOIS NIVEIS DESDE 2026-08-08, e ate ali tudo aqui era `admin`.
  // LER e `verifyGerente` (administrador global OU gerente de QUALQUER modulo),
  // porque o relatorio e a prestacao de contas da Divisao inteira e sao os
  // gerentes que a conferem antes de o chefe assinar. ASSINAR continua
  // `verifyAdmin`: abrir o mes, fechar e reabrir sao atos de quem responde pelo
  // documento, e nao de quem responde por uma das nove secoes dele. Ver o
  // cabecalho de rpcmtec/rpcmtec_route.js.
  //
  // A ESCRITA DE SUBSECAO nao entra nesta registry: ela e `verifyGerente` mais
  // `verifyModuloSubsecao()`, ou seja, o gerente so altera a subsecao do modulo
  // DELE, e anuncia-la aqui com uma guarda so mentiria sobre o recorte.
  rpcmtec: {
    nome: 'RPCMTec (relatorio mensal da Divisao) e Anuario Estatistico',
    schema: carregar('rpcmtec/rpcmtec_schema'),
    operacoes: {
      listar: {
        metodo: 'GET',
        caminho: '/rpcmtec/',
        query: 'listarQuery',
        acesso: 'gerente_qualquer',
        envelope: 'lista',
        colunas: ['id', 'ano', 'mes', 'fechada', 'assinante_uuid', 'data_assinatura'],
        nota: 'e por aqui que se descobre o id da edicao de um mes; o verbo ' +
          '`acervo rpcmtec --ano A --mes M` faz esse passo sozinho'
      },
      anos: {
        metodo: 'GET',
        caminho: '/rpcmtec/anos',
        acesso: 'gerente_qualquer',
        envelope: 'lista'
      },
      obter: {
        metodo: 'GET',
        caminho: '/rpcmtec/:id',
        params: 'idParams',
        acesso: 'gerente_qualquer',
        envelope: 'registro'
      },
      documento: {
        metodo: 'GET',
        caminho: '/rpcmtec/:id/documento',
        params: 'idParams',
        acesso: 'gerente_qualquer',
        envelope: 'registro',
        nota: 'o documento INTEIRO, secao por secao. Edicao aberta calcula do ' +
          'banco, edicao fechada devolve o congelado. E a mesma fonte do PDF'
      },
      conferir: {
        metodo: 'GET',
        caminho: '/rpcmtec/:id/conferir',
        params: 'idParams',
        acesso: 'gerente_qualquer',
        envelope: 'registro',
        nota: 'o que o banco diria HOJE ao lado do que foi congelado. So vale em ' +
          'edicao FECHADA'
      },
      criar: {
        metodo: 'POST',
        caminho: '/rpcmtec/',
        corpo: 'criar',
        acesso: 'admin',
        envelope: 'registro',
        nota: 'abre a edicao do mes. O par (ano, mes) e unico, e repetir volta 409'
      },
      fechar: {
        metodo: 'POST',
        caminho: '/rpcmtec/:id/fechar',
        params: 'idParams',
        acesso: 'admin',
        envelope: 'registro',
        confirmar: {
          campo: 'id',
          motivo: 'CONGELA os 33 blocos da edicao: a partir dai o documento para ' +
            'de acompanhar o banco. Reabrir e outra rota, e o congelado se perde'
        }
      },
      reabrir: {
        metodo: 'POST',
        caminho: '/rpcmtec/:id/reabrir',
        params: 'idParams',
        acesso: 'admin',
        envelope: 'registro',
        confirmar: {
          campo: 'id',
          motivo: 'descongela a edicao, e o documento volta a calcular do banco. ' +
            'O texto congelado que foi assinado deixa de ser o que a rota devolve'
        }
      },
      anuario: {
        metodo: 'GET',
        caminho: '/rpcmtec/anuario',
        query: 'gerarQuery',
        acesso: 'gerente_qualquer',
        envelope: 'registro',
        nota: 'previa do Anuario Estatistico em JSON; o arquivo .ods sai por ' +
          '`acervo rpcmtec --ano A --mes M --anuario`'
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
