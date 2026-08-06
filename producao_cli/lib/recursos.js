'use strict'

const path = require('path')

// Registro das rotas da area de PRODUCAO e do RPCMTec. Cada recurso aponta para
// o MODULO DE SCHEMA da feature no server/, e o CLI le dali o contrato (campos,
// tipos, obrigatorios, filtros, parametros de rota). Nada de contrato e copiado
// para ca: se o schema mudar, o CLI muda junto no mesmo commit. Este arquivo so
// guarda o que NAO esta no schema: o metodo e o caminho da rota, a GUARDA, a
// escolha de apresentacao (colunas padrao) e o guardrail de acao irreversivel.
//
// A forma e a do efetivo_cli, por operacao NOMEADA, e nao a do orcamento_cli, por
// CRUD uniforme. Aqui nada e CRUD: a execucao mensal e uma CELULA de grade que
// um POST so cria, altera e apaga; fechar e reabrir sao ATOS; a subsecao se
// enderaca por numero de documento ('2.1'); o PDF e a planilha saem fora do
// envelope JSON. Fingir listar/obter/criar/atualizar/deletar produziria um mapa
// mentiroso, e o agente descobriria pelo 404.
//
// DOIS GRUPOS, os dois de PLATAFORMA (sem prefixo de modulo, como /usuarios):
//   /api/metas     o PIT: meta, execucao mensal, exercicio, revisao, Extra-PIT
//                  e o de-para de midia (server/src/pit/)
//   /api/rpcmtec   a edicao mensal, o conteudo, o ciclo, a saida, os anexos e a
//                  capacitacao (server/src/rpcmtec/)
//
// O `/api/efetivo` NAO mora aqui: passagem pela DGEO, impedimento e o mapa de
// aproveitamento sao do `efetivo_cli`.
//
// O require e preguicoso (funcao) para que um recurso com schema faltando quebre
// so o comando daquele recurso, e nao o CLI inteiro.

const RAIZ_SERVER = path.join(__dirname, '..', '..', 'server', 'src')

function carregar (relativo) {
  return () => require(path.join(RAIZ_SERVER, relativo))
}

// COMO A VALIDACAO LOCAL TEM DE SE COMPORTAR, por grupo de rota. Nao e detalhe:
// os tres grupos usam middlewares DIFERENTES no servidor, e o CLI que validasse
// os tres do mesmo jeito aprovaria no --dry-run o que a rota real recusa (ou o
// contrario, que e pior).
//
//   estrito  o corpo com chave desconhecida vira 400, com sugestao de nome.
//            E o `utils/schema_validation_estrito.js`, que /api/metas usa.
//   strip    a chave desconhecida e DESCARTADA em silencio e volta em "avisos"
//            no envelope. E o `utils/schema_validation.js`, que /api/rpcmtec usa.
const VALIDACAO = { ESTRITO: 'estrito', STRIP: 'strip' }

// Como cada `:param` da rota se chama na linha de comando. O nome do parametro
// no Express e camelCase (`:revisaoId`), que e ruim de digitar e pior de ler num
// comando; a flag e a palavra curta. O contrato impresso mostra as duas.
const FLAG_DE_PARAM = {
  id: 'id',
  ano: 'ano',
  numero: 'numero',
  metaId: 'meta',
  revisaoId: 'revisao',
  anexoId: 'anexo'
}

const COL_META = [
  'id', 'ano', 'numero_meta', 'item', 'descricao', 'quantidade_prevista',
  'unidade', 'demandante', 'prazo', 'cancelada', 'origem', 'revisao'
]

const COL_ANEXO_REVISAO = [
  'id', 'revisao_id', 'tipo_anexo', 'nome_original', 'tamanho_bytes', 'descricao'
]

const COL_ANEXO_EDICAO = [
  'id', 'edicao_id', 'nome_original', 'extensao', 'tamanho_bytes', 'descricao'
]

/**
 * As seis operacoes de UM tipo de capacitacao.
 *
 * Molde, e nao dois blocos copiados: o que muda entre ministrada e recebida e o
 * caminho, a guarda e as colunas que fazem sentido em cada uma (a ministrada tem
 * `efetivo_capacitado`, a recebida tem `plano_codigo`). Duas copias divergiriam
 * na primeira correcao aplicada a uma so.
 *
 * `tipo_id` NAO entra no corpo: o servidor o fixa pela rota, e o schema do
 * server ja nao o declara.
 *
 * @param {string} tipo - 'ministrada' ou 'recebida'
 * @param {string} acesso - a chave da guarda (ver ACESSO em lib/schema.js)
 * @param {Array<string>} colunas - a saida padrao do listar
 */
function capacitacaoDoTipo (tipo, acesso, colunas) {
  const base = `/rpcmtec/capacitacao/${tipo}`

  return {
    listar: {
      metodo: 'GET',
      caminho: base,
      query: 'capacitacaoQuery',
      acesso,
      envelope: 'lista',
      colunas
    },
    anos: {
      metodo: 'GET',
      caminho: `${base}/anos`,
      acesso,
      envelope: 'lista',
      nota: 'so os anos DESTE tipo. A lista unica de antes oferecia ano vazio: ' +
        'em 2026-08-06 havia ministrada em oito anos e recebida so em 2026'
    },
    obter: {
      metodo: 'GET',
      caminho: `${base}/:id`,
      params: 'idParams',
      acesso,
      envelope: 'registro',
      nota: 'o id do OUTRO tipo responde 404: por este caminho ele nao existe'
    },
    criar: {
      metodo: 'POST',
      caminho: base,
      corpo: 'criarCapacitacao',
      acesso,
      envelope: 'registro',
      nota: 'sem tipo_id no corpo: quem fixa o tipo e a ROTA, no servidor'
    },
    atualizar: {
      metodo: 'PUT',
      caminho: `${base}/:id`,
      params: 'idParams',
      corpo: 'atualizarCapacitacao',
      acesso,
      envelope: 'registro',
      nota: 'a lista militares é regravada INTEIRA: omiti-la manda lista vazia ' +
        '(o default do Joi), e isso apaga quem estava lá'
    },
    excluir: {
      metodo: 'DELETE',
      caminho: `${base}/:id`,
      params: 'idParams',
      acesso,
      envelope: 'mensagem',
      confirmar: {
        param: 'id',
        motivo: 'a capacitação alimenta a 2.6 ou a 6.2, e pode ser a que ' +
          'cumpre uma meta do PIT'
      }
    }
  }
}

const RECURSOS = {
  // =========================================================================
  // PIT  -  /api/metas  (server/src/pit/)
  // =========================================================================
  meta: {
    nome: 'meta do PIT (o plano anual da Divisão)',
    schema: carregar('pit/pit_schema'),
    validacao: VALIDACAO.ESTRITO,
    operacoes: {
      listar: {
        metodo: 'GET',
        caminho: '/metas',
        query: 'listarQuery',
        acesso: 'login',
        envelope: 'lista',
        colunas: COL_META
      },
      anos: {
        metodo: 'GET',
        caminho: '/metas/anos',
        acesso: 'login',
        envelope: 'lista',
        nota: 'devolve só a lista de anos com meta cadastrada'
      },
      obter: {
        metodo: 'GET',
        caminho: '/metas/:id',
        params: 'idParams',
        acesso: 'login',
        envelope: 'registro'
      },
      historico: {
        metodo: 'GET',
        caminho: '/metas/:id/historico',
        params: 'idParams',
        acesso: 'login',
        envelope: 'lista',
        nota: 'em que revisão a meta mudou, e para quanto'
      },
      criar: {
        metodo: 'POST',
        caminho: '/metas',
        corpo: 'criar',
        acesso: 'admin',
        envelope: 'registro',
        nota: 'exige uma revisão em RASCUNHO no ano: a declaração da meta é o ' +
          'que a revisão declara, e sem ela não há documento que a autorize'
      },
      atualizar: {
        metodo: 'PUT',
        caminho: '/metas/:id',
        params: 'idParams',
        corpo: 'atualizar',
        acesso: 'admin',
        envelope: 'registro',
        nota: 'alterar a PROMESSA cai na revisão em rascunho. Para consertar ' +
          'digitação, use corrigir-transcricao, que é outro ato'
      },
      'corrigir-transcricao': {
        metodo: 'PUT',
        caminho: '/metas/:id/transcricao',
        params: 'idParams',
        corpo: 'corrigirTranscricao',
        acesso: 'admin',
        envelope: 'registro',
        nota: 'edita a linha da revisão EM VIGOR e exige motivo. É para quem ' +
          'digitou 53 onde o documento diz 35, sem inventar revisão que a DSG ' +
          'não emitiu'
      },
      excluir: {
        metodo: 'DELETE',
        caminho: '/metas/:id',
        params: 'idParams',
        acesso: 'admin',
        envelope: 'mensagem',
        confirmar: {
          param: 'id',
          motivo: 'a meta é apontada pela NC, pelo item do PDR, pelo pedido de ' +
            'impressão e pela versão do acervo. Excluir apaga o alvo desses ' +
            'vínculos, e o caminho normal é CANCELAR a meta numa revisão'
        }
      }
    }
  },

  execucao: {
    nome: 'execução mensal das metas (a subseção 2.1 do RPCMTec)',
    schema: carregar('pit/pit_schema'),
    validacao: VALIDACAO.ESTRITO,
    operacoes: {
      grade: {
        metodo: 'GET',
        caminho: '/metas/execucao',
        query: 'gradeQuery',
        acesso: 'gerente',
        envelope: 'lista',
        colunas: [
          'meta_id', 'numero_meta', 'nome', 'item', 'descricao', 'unidade',
          'quantidade_prevista', 'planejado', 'realizado', 'origem'
        ],
        nota: 'o ano inteiro, uma linha por ITEM do PIT. `nome` e o nome da ' +
          'meta que agrupa o item. Os doze meses vêm no campo meses, que só ' +
          'aparece com --json ou --campos meses'
      },
      resumo: {
        metodo: 'GET',
        caminho: '/metas/execucao/resumo',
        query: 'resumoQuery',
        acesso: 'gerente',
        envelope: 'lista',
        colunas: [
          'meta_id', 'numero_meta', 'nome', 'item', 'descricao',
          'quantidade_prevista', 'planejado_ate', 'realizado', 'realizado_mes'
        ],
        nota: 'sem --mes o realizado é o ano inteiro; com --mes são as duas ' +
          'colunas da 2.1 (acumulado até o mês, e o mês)'
      },
      'da-meta': {
        metodo: 'GET',
        caminho: '/metas/execucao/meta/:metaId',
        params: 'metaIdParams',
        acesso: 'gerente',
        envelope: 'lista',
        colunas: [
          'id', 'meta_id', 'mes', 'quantidade_planejada', 'quantidade',
          'data_conclusao', 'observacao'
        ]
      },
      ensaio: {
        metodo: 'GET',
        caminho: '/metas/execucao/ensaio',
        query: 'ensaioQuery',
        acesso: 'login',
        envelope: 'lista',
        colunas: [
          'meta_id', 'numero_meta', 'item', 'mes', 'origem',
          'planejada_digitada', 'planejada_calculada', 'planejada_bate',
          'realizada_digitada', 'realizada_calculada', 'realizada_bate'
        ],
        nota: 'o digitado e o calculado lado a lado, sem escrever nada. É o ' +
          'portão para virar uma meta de Manual para automática'
      },
      lancar: {
        metodo: 'POST',
        caminho: '/metas/execucao',
        corpo: 'salvarExecucao',
        acesso: 'producao_operador',
        envelope: 'registro',
        nota: 'UMA rota cria, altera e APAGA a célula (meta, mês). Omitir um ' +
          'campo é NÃO MEXER; mandar nulo é APAGAR; e a célula sem nenhum dos ' +
          'quatro campos some'
      },
      excluir: {
        metodo: 'DELETE',
        caminho: '/metas/execucao/:id',
        params: 'idParams',
        acesso: 'producao_operador',
        envelope: 'mensagem',
        confirmar: {
          param: 'id',
          motivo: 'apaga o lançamento do mês. O id é o da CÉLULA, e não o da ' +
            'meta: pegue-o em "execucao da-meta"'
        }
      }
    }
  },

  exercicio: {
    nome: 'exercício do PIT (o ano, e se ele está aberto)',
    schema: carregar('pit/pit_schema'),
    validacao: VALIDACAO.ESTRITO,
    operacoes: {
      listar: {
        metodo: 'GET',
        caminho: '/metas/exercicios',
        acesso: 'login',
        envelope: 'lista',
        colunas: ['ano', 'situacao_id', 'situacao', 'metas', 'revisoes', 'observacao']
      },
      criar: {
        metodo: 'POST',
        caminho: '/metas/exercicios',
        corpo: 'criarExercicio',
        acesso: 'admin',
        envelope: 'registro'
      },
      atualizar: {
        metodo: 'PUT',
        caminho: '/metas/exercicios/:ano',
        params: 'anoParams',
        corpo: 'atualizarExercicio',
        acesso: 'admin',
        envelope: 'registro',
        nota: 'encerrar o ano é aqui, com situacao_id 3. É o que faz o servidor ' +
          'recusar alteração em exercício fechado'
      }
    }
  },

  revisao: {
    nome: 'revisão do PIT (o documento da DSG que muda o plano)',
    schema: carregar('pit/pit_schema'),
    validacao: VALIDACAO.ESTRITO,
    operacoes: {
      listar: {
        metodo: 'GET',
        caminho: '/metas/revisoes',
        query: 'revisaoQuery',
        acesso: 'login',
        envelope: 'lista',
        colunas: [
          'id', 'ano', 'codigo', 'rascunho', 'data_documento', 'data_vigencia',
          'assinante', 'alteracoes', 'anexos'
        ]
      },
      obter: {
        metodo: 'GET',
        caminho: '/metas/revisoes/:revisaoId',
        params: 'revisaoIdParams',
        acesso: 'login',
        envelope: 'registro'
      },
      alteracoes: {
        metodo: 'GET',
        caminho: '/metas/revisoes/:revisaoId/alteracoes',
        params: 'revisaoIdParams',
        acesso: 'login',
        envelope: 'lista',
        colunas: [
          'meta_id', 'numero_meta', 'item', 'descricao', 'quantidade_prevista',
          'quantidade_anterior', 'prazo', 'prazo_anterior', 'cancelada', 'meta_nova'
        ],
        nota: 'o que a revisão faz, meta a meta, com o valor anterior ao lado. ' +
          'É o que se lê contra o DIEx ANTES de publicar'
      },
      criar: {
        metodo: 'POST',
        caminho: '/metas/revisoes',
        corpo: 'criarRevisao',
        acesso: 'admin',
        envelope: 'registro',
        nota: 'nasce RASCUNHO: data_vigencia não entra aqui, e é isso que ' +
          'impede a grade de mudar antes da conferência'
      },
      atualizar: {
        metodo: 'PUT',
        caminho: '/metas/revisoes/:revisaoId',
        params: 'revisaoIdParams',
        corpo: 'atualizarRevisao',
        acesso: 'admin',
        envelope: 'registro'
      },
      publicar: {
        metodo: 'POST',
        caminho: '/metas/revisoes/:revisaoId/publicar',
        params: 'revisaoIdParams',
        corpo: 'publicarRevisao',
        acesso: 'admin',
        envelope: 'registro',
        confirmar: {
          param: 'revisao',
          motivo: 'publicar é o ato que faz a revisão PASSAR A REGER. A grade, a ' +
            'subseção 2.1 e o EXEC_PIT do RTM mudam de número na hora, e a data ' +
            'de vigência pode ser retroativa'
        }
      },
      'remover-meta': {
        metodo: 'DELETE',
        caminho: '/metas/revisoes/:revisaoId/meta/:metaId',
        params: 'declaracaoParams',
        acesso: 'admin',
        envelope: 'registro',
        confirmar: {
          param: 'meta',
          motivo: 'remove a DECLARAÇÃO daquela meta do rascunho. A meta em si ' +
            'continua; o que sai é a linha que esta revisão dizia sobre ela'
        }
      },
      excluir: {
        metodo: 'DELETE',
        caminho: '/metas/revisoes/:revisaoId',
        params: 'revisaoIdParams',
        acesso: 'admin',
        envelope: 'mensagem',
        confirmar: {
          param: 'revisao',
          motivo: 'apaga a revisão e as declarações dela. Numa revisão já ' +
            'publicada, isso reescreve o que o PIT prometia'
        }
      },
      anexos: {
        metodo: 'GET',
        caminho: '/metas/revisoes/:revisaoId/anexos',
        params: 'revisaoIdParams',
        acesso: 'login',
        envelope: 'lista',
        colunas: COL_ANEXO_REVISAO
      },
      anexar: {
        metodo: 'POST',
        caminho: '/metas/revisoes/:revisaoId/anexos',
        params: 'revisaoIdParams',
        corpo: 'anexoUploadBody',
        acesso: 'admin',
        envelope: 'registro',
        arquivo: 'arquivo',
        nota: 'multipart no campo "arquivo", com os campos do corpo junto. Quem ' +
          'diz quais extensões aceita é o servidor (pit/anexo_revisao_upload.js), ' +
          'e o teto é 20 MB'
      },
      'baixar-anexo': {
        metodo: 'GET',
        caminho: '/metas/revisoes/anexo/:anexoId/download',
        params: 'anexoIdParams',
        acesso: 'login',
        envelope: 'binario',
        nota: 'grava o arquivo em disco; sem --saida, usa o nome que o servidor ' +
          'manda no Content-Disposition'
      },
      'excluir-anexo': {
        metodo: 'DELETE',
        caminho: '/metas/revisoes/anexo/:anexoId',
        params: 'anexoIdParams',
        acesso: 'admin',
        envelope: 'mensagem',
        confirmar: {
          param: 'anexo',
          motivo: 'os bytes moram na própria linha do banco: excluir apaga o ' +
            'documento assinado, e não um ponteiro para ele'
        }
      }
    }
  },

  extra: {
    nome: 'demanda Extra-PIT (a exceção AUTORIZADA, subseção 3.3)',
    schema: carregar('pit/pit_schema'),
    validacao: VALIDACAO.ESTRITO,
    operacoes: {
      listar: {
        metodo: 'GET',
        caminho: '/metas/extra',
        query: 'listarQuery',
        acesso: 'login',
        envelope: 'lista',
        colunas: [
          'id', 'ano', 'demandante', 'tipo_produto', 'quantidade',
          'quantidade_materializada', 'situacao', 'origem',
          'documento_autorizacao', 'data_entrega'
        ]
      },
      anos: {
        metodo: 'GET',
        caminho: '/metas/extra/anos',
        acesso: 'login',
        envelope: 'lista'
      },
      obter: {
        metodo: 'GET',
        caminho: '/metas/extra/:id',
        params: 'idParams',
        acesso: 'login',
        envelope: 'registro'
      },
      criar: {
        metodo: 'POST',
        caminho: '/metas/extra',
        corpo: 'criarDemandaExtra',
        acesso: 'producao_operador',
        envelope: 'registro'
      },
      atualizar: {
        metodo: 'PUT',
        caminho: '/metas/extra/:id',
        params: 'idParams',
        corpo: 'atualizarDemandaExtra',
        acesso: 'producao_operador',
        envelope: 'registro'
      },
      excluir: {
        metodo: 'DELETE',
        caminho: '/metas/extra/:id',
        params: 'idParams',
        acesso: 'producao_operador',
        envelope: 'mensagem',
        confirmar: {
          param: 'id',
          motivo: 'a versão do acervo aponta a demanda por acervo.versao.' +
            'demanda_extra_id; excluir apaga o alvo desse vínculo'
        }
      }
    }
  },

  midia: {
    nome: 'de-para da mídia impressa para a meta (a fonte da meta 4)',
    schema: carregar('pit/pit_schema'),
    validacao: VALIDACAO.ESTRITO,
    operacoes: {
      listar: {
        metodo: 'GET',
        caminho: '/metas/midia',
        query: 'midiaQuery',
        acesso: 'login',
        envelope: 'lista',
        colunas: [
          'id', 'ano', 'tipo_midia_id', 'tipo_midia', 'meta_pit_id',
          'numero_meta', 'meta_item', 'meta_descricao'
        ]
      },
      criar: {
        metodo: 'POST',
        caminho: '/metas/midia',
        corpo: 'criarMidiaMeta',
        acesso: 'admin',
        envelope: 'registro'
      },
      atualizar: {
        metodo: 'PUT',
        caminho: '/metas/midia/:id',
        params: 'idParams',
        corpo: 'atualizarMidiaMeta',
        acesso: 'admin',
        envelope: 'mensagem'
      },
      excluir: {
        metodo: 'DELETE',
        caminho: '/metas/midia/:id',
        params: 'idParams',
        acesso: 'admin',
        envelope: 'mensagem',
        confirmar: {
          param: 'id',
          motivo: 'sem o de-para, a mídia impressa deixa de contar para a meta ' +
            'que ela cumpre, e o número da 2.1 cai sem nada explicar'
        }
      }
    }
  },

  // =========================================================================
  // RPCMTec  -  /api/rpcmtec  (server/src/rpcmtec/)
  // O grupo INTEIRO exige administrador, inclusive a leitura: a edição cruza os
  // três módulos numa peça só e traz valor de crédito, empenho e liquidação.
  // =========================================================================
  edicao: {
    nome: 'edição mensal do RPCMTec',
    schema: carregar('rpcmtec/rpcmtec_schema'),
    validacao: VALIDACAO.STRIP,
    operacoes: {
      listar: {
        metodo: 'GET',
        caminho: '/rpcmtec',
        query: 'listarQuery',
        acesso: 'admin',
        envelope: 'lista',
        colunas: [
          'id', 'ano', 'mes', 'fechada', 'data_fechamento', 'assinante_posto',
          'assinante_nome', 'data_assinatura', 'anexos'
        ]
      },
      anos: {
        metodo: 'GET',
        caminho: '/rpcmtec/anos',
        acesso: 'admin',
        envelope: 'lista'
      },
      obter: {
        metodo: 'GET',
        caminho: '/rpcmtec/:id',
        params: 'idParams',
        acesso: 'admin',
        envelope: 'registro'
      },
      documento: {
        metodo: 'GET',
        caminho: '/rpcmtec/:id/documento',
        params: 'idParams',
        acesso: 'admin',
        envelope: 'registro',
        nota: 'os 34 blocos montados. É RESPOSTA GRANDE: prefira --campos ou o ' +
          'PDF quando não precisar do conteúdo inteiro'
      },
      pdf: {
        metodo: 'GET',
        caminho: '/rpcmtec/:id/pdf',
        params: 'idParams',
        acesso: 'admin',
        envelope: 'binario'
      },
      conferir: {
        metodo: 'GET',
        caminho: '/rpcmtec/:id/conferir',
        params: 'idParams',
        acesso: 'admin',
        envelope: 'registro',
        nota: 'só em edição FECHADA: recalcula as subseções calculadas e mostra ' +
          'a diferença contra o congelado. É o contrapeso do congelamento'
      },
      criar: {
        metodo: 'POST',
        caminho: '/rpcmtec',
        corpo: 'criar',
        acesso: 'admin',
        envelope: 'registro',
        nota: 'a UNIQUE (ano, mes) volta 409'
      },
      atualizar: {
        metodo: 'PUT',
        caminho: '/rpcmtec/:id',
        params: 'idParams',
        corpo: 'atualizar',
        acesso: 'admin',
        envelope: 'mensagem'
      },
      fechar: {
        metodo: 'POST',
        caminho: '/rpcmtec/:id/fechar',
        params: 'idParams',
        acesso: 'admin',
        envelope: 'registro',
        confirmar: {
          param: 'id',
          motivo: 'CONGELA os 34 blocos: a partir daí o documento não muda mais ' +
            'quando o banco mudar. Recusa com subseção por preencher e sem ' +
            'assinante definido'
        }
      },
      reabrir: {
        metodo: 'POST',
        caminho: '/rpcmtec/:id/reabrir',
        params: 'idParams',
        acesso: 'admin',
        envelope: 'registro',
        confirmar: {
          param: 'id',
          motivo: 'DESCARTA o congelado das subseções calculadas (o digitado ' +
            'fica). O que foi assinado deixa de ser reproduzível, e fechar de ' +
            'novo recalcula tudo com o banco de hoje'
        }
      },
      excluir: {
        metodo: 'DELETE',
        caminho: '/rpcmtec/:id',
        params: 'idParams',
        acesso: 'admin',
        envelope: 'mensagem',
        confirmar: {
          param: 'id',
          motivo: 'o CASCADE leva subseções e anexos junto. Edição FECHADA o ' +
            'servidor recusa: reabra primeiro, o que é gesto explícito de propósito'
        }
      },
      anexos: {
        metodo: 'GET',
        caminho: '/rpcmtec/:id/anexos',
        params: 'idParams',
        acesso: 'admin',
        envelope: 'lista',
        colunas: COL_ANEXO_EDICAO
      },
      anexar: {
        metodo: 'POST',
        caminho: '/rpcmtec/:id/anexos',
        params: 'idParams',
        corpo: 'anexoUploadBody',
        acesso: 'admin',
        envelope: 'registro',
        arquivo: 'arquivo',
        nota: 'o RPCMTec ASSINADO, multipart no campo "arquivo". Quem diz quais ' +
          'extensões aceita é o servidor (rpcmtec/anexo_edicao_upload.js), e o ' +
          'teto é 20 MB'
      },
      'baixar-anexo': {
        metodo: 'GET',
        caminho: '/rpcmtec/anexo/:anexoId/download',
        params: 'anexoIdParams',
        acesso: 'admin',
        envelope: 'binario'
      },
      'excluir-anexo': {
        metodo: 'DELETE',
        caminho: '/rpcmtec/anexo/:anexoId',
        params: 'anexoIdParams',
        acesso: 'admin',
        envelope: 'mensagem',
        confirmar: {
          param: 'anexo',
          motivo: 'os bytes moram na própria linha do banco: excluir apaga o ' +
            'relatório assinado, e não um ponteiro para ele'
        }
      }
    }
  },

  subsecao: {
    nome: 'subseção digitada do RPCMTec (o que o SCA não calcula)',
    schema: carregar('rpcmtec/rpcmtec_schema'),
    validacao: VALIDACAO.STRIP,
    operacoes: {
      gravar: {
        metodo: 'PUT',
        caminho: '/rpcmtec/:id/subsecao/:numero',
        params: 'subsecaoParams',
        corpo: 'gravarSubsecao',
        acesso: 'admin',
        envelope: 'registro',
        nota: 'o número é o rótulo do documento ("2.1", "9.3"). As colunas são ' +
          'fixas: o servidor confere o tamanho de cada linha contra os ' +
          'cabeçalhos da estrutura. Só com a edição ABERTA'
      },
      limpar: {
        metodo: 'DELETE',
        caminho: '/rpcmtec/:id/subsecao/:numero',
        params: 'subsecaoParams',
        acesso: 'admin',
        envelope: 'registro',
        confirmar: {
          param: 'numero',
          motivo: 'a subseção volta a NÃO EXISTIR, que não é o mesmo que ficar ' +
            'vazia: o fechamento a cobra de novo'
        }
      },
      'copiar-mes-anterior': {
        metodo: 'POST',
        caminho: '/rpcmtec/:id/copiar-mes-anterior',
        params: 'idParams',
        corpo: 'copiarMesAnterior',
        acesso: 'admin',
        envelope: 'registro',
        nota: 'sem numero no corpo, copia TODAS as digitadas. Não sobrescreve: ' +
          'a subseção já preenchida volta em "preservadas"'
      }
    }
  },

  // A CAPACITAÇÃO É DOIS RECURSOS, desde a 1.33.0, e não um com filtro de tipo.
  //
  // O servidor separou as rotas por tipo porque a PERMISSÃO é por tipo: a
  // ministrada é do operador de Produção (ela é serviço que a Divisão presta), a
  // recebida é do operador de Efetivo (é gente nossa em curso). A guarda de rota
  // não enxerga o corpo, então `tipo_id` deixou de vir nele e virou o caminho.
  //
  // O CLI acompanha porque ele documenta o CONTRATO: um recurso só, com o tipo
  // numa flag, faria o `producao schema` mentir sobre quem entra em quê.
  //
  // A tabela do banco continua UMA (`rpcmtec.capacitacao`): o que se separou foi
  // o endereço, não o dado.
  'capacitacao-ministrada': {
    nome: 'capacitação MINISTRADA (subseção 2.6), do módulo Produção',
    schema: carregar('rpcmtec/rpcmtec_schema'),
    validacao: VALIDACAO.STRIP,
    operacoes: capacitacaoDoTipo('ministrada', 'producao_operador', [
      'id', 'ano', 'nome', 'situacao', 'instituicoes', 'local_realizacao',
      'data_inicio', 'data_fim', 'efetivo_capacitado', 'meta_pit_item',
      'militares'
    ])
  },

  'capacitacao-recebida': {
    nome: 'capacitação RECEBIDA (subseção 6.2), do módulo Efetivo',
    schema: carregar('rpcmtec/rpcmtec_schema'),
    validacao: VALIDACAO.STRIP,
    operacoes: capacitacaoDoTipo('recebida', 'efetivo_operador', [
      'id', 'ano', 'nome', 'situacao', 'instituicoes', 'local_realizacao',
      'data_inicio', 'data_fim', 'plano_codigo', 'militares'
    ])
  },

  anuario: {
    nome: 'Anuário Estatístico e a aba META4_DETALHADA do RTM',
    schema: carregar('rpcmtec/rpcmtec_schema'),
    validacao: VALIDACAO.STRIP,
    operacoes: {
      previa: {
        metodo: 'GET',
        caminho: '/rpcmtec/anuario',
        query: 'gerarQuery',
        acesso: 'admin',
        envelope: 'registro',
        nota: 'a prévia em tela, no envelope JSON. O arquivo que sobe para a DSG ' +
          'é o da operação ods'
      },
      ods: {
        metodo: 'GET',
        caminho: '/rpcmtec/anuario/ods',
        query: 'gerarQuery',
        acesso: 'admin',
        envelope: 'binario',
        nota: 'a planilha do Anuário, do MÊS, com o nome que a DSG já recebe'
      },
      'rtm-ods': {
        metodo: 'GET',
        caminho: '/rpcmtec/rtm/ods',
        query: 'gerarQuery',
        acesso: 'admin',
        envelope: 'binario',
        nota: 'a aba META4_DETALHADA, ACUMULADA até o mês pedido. É o único ' +
          'download desta área que acumula; os outros são do mês'
      }
    }
  }
}

function obter (chave) {
  const recurso = RECURSOS[chave]
  if (!recurso) {
    throw new Error(
      `Recurso desconhecido: "${chave}". Disponíveis: ${Object.keys(RECURSOS).join(', ')}.`
    )
  }
  return recurso
}

function obterOperacao (chave, acao) {
  const recurso = obter(chave)
  const op = recurso.operacoes[acao]
  if (!op) {
    throw new Error(
      `Operação desconhecida "${acao}" em ${chave}.\n` +
      `Operações de ${chave}: ${Object.keys(recurso.operacoes).join(', ')}.\n` +
      `Contrato: producao schema ${chave}`
    )
  }
  return { recurso, operacao: op }
}

function listarChaves () {
  return Object.keys(RECURSOS)
}

/** Nomes dos `:param` que a rota exige, na ordem em que aparecem. */
function paramsDaRota (caminho) {
  return (String(caminho).match(/:([a-zA-Z_]+)/g) || []).map(p => p.slice(1))
}

/** A flag de linha de comando que preenche um `:param`. */
function flagDoParam (nome) {
  return FLAG_DE_PARAM[nome] || nome
}

/**
 * Le os `:param` da rota a partir das flags, aceitando tanto o nome do parametro
 * quanto a flag curta. Devolve o objeto CRU (texto), para o chamador validar
 * contra o Joi de params antes de montar a URL.
 */
function lerParams (operacao, flags) {
  const valores = {}
  for (const nome of paramsDaRota(operacao.caminho)) {
    const curta = flagDoParam(nome)
    const valor = flags[nome] !== undefined ? flags[nome] : flags[curta]
    if (valor === undefined || valor === null || valor === true || valor === '') {
      throw new Error(
        `A rota ${operacao.metodo} /api${operacao.caminho} exige --${curta}.`
      )
    }
    valores[nome] = valor
  }
  return valores
}

/** Substitui os `:param` do caminho pelos valores ja validados. */
function montarCaminho (operacao, valores) {
  return operacao.caminho.replace(/:([a-zA-Z_]+)/g, (_, nome) =>
    encodeURIComponent(valores[nome])
  )
}

module.exports = {
  RECURSOS,
  RAIZ_SERVER,
  VALIDACAO,
  FLAG_DE_PARAM,
  obter,
  obterOperacao,
  listarChaves,
  paramsDaRota,
  flagDoParam,
  lerParams,
  montarCaminho
}
