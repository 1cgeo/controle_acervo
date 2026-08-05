'use strict'

const path = require('path')

// Registro dos recursos da API. Cada entrada aponta para o MODULO DE SCHEMA da
// feature no server/, e o CLI le dali o contrato (campos, tipos, obrigatorios,
// filtros). Nada de contrato e copiado para ca: se o schema mudar, o CLI muda
// junto no mesmo commit. Este arquivo so guarda o que NAO esta no schema: o
// caminho da rota, o nivel de acesso, a escolha de apresentacao (colunas) e o
// guardrail de acao irreversivel.
//
// A forma e a do acervo_cli, e nao a do orcamento_cli: identidade tambem NAO e
// CRUD uniforme. `POST /usuarios/senha/reset` e `PUT /usuarios` (lote) sao
// operacoes NOMEADAS, e o proprio cadastro vive em `/usuarios/perfil`, que e
// outra rota com outra guarda. Fingir listar/obter/criar/atualizar/deletar aqui
// produziria um mapa mentiroso.
//
// O require e preguicoso (funcao) para que um recurso com schema faltando
// quebre so o comando daquele recurso, e nao o CLI inteiro.
//
// NAO EXISTE recurso `aplicacao`: nao ha catalogo de aplicacao no SCA. A lista
// de clientes de auth e fechada e vive no `.valid()` de
// `login/login_schema.js`, que e de onde `lib/config.js` a le.

const RAIZ_SERVER = path.join(__dirname, '..', '..', 'server', 'src')

function carregar (relativo) {
  return () => require(path.join(RAIZ_SERVER, relativo))
}

// Colunas padrao da listagem de usuarios. `uuid` vem primeiro porque e o que
// todas as outras operacoes pedem, e `senha_definida` entra porque muda a
// interpretacao de `ativo`: pessoa ativa SEM senha definida nao consegue entrar,
// e sem esta coluna ela so apareceria ao reclamar. Coluna que muda a leitura das
// outras nao pode ficar so no --json.
const COL_USUARIO = [
  'uuid', 'login', 'tipo_posto_grad', 'nome_guerra', 'nome',
  'administrador', 'ativo', 'senha_definida', 'perfis'
]

const RECURSOS = {
  // -------------------------------------------------------------------------
  usuario: {
    nome: 'usuario, perfil por modulo e senha',
    schema: carregar('usuario/usuario_schema'),
    operacoes: {
      listar: {
        metodo: 'GET',
        caminho: '/usuarios',
        acesso: 'admin',
        envelope: 'lista',
        colunas: COL_USUARIO
      },
      obter: {
        metodo: 'GET',
        caminho: '/usuarios',
        acesso: 'admin',
        envelope: 'registro',
        derivado: true,
        nota: 'o servidor NAO tem GET /usuarios/:uuid. O CLI le a listagem e ' +
          'recorta a pessoa pedida, em vez de anunciar uma rota que nao existe. ' +
          'Custa a listagem inteira numa requisicao, o que e barato aqui (dezenas ' +
          'de linhas) e honesto: ver `divergencias` no README'
      },
      criar: {
        metodo: 'POST',
        caminho: '/usuarios',
        corpo: 'criaUsuario',
        acesso: 'admin',
        envelope: 'registro',
        nota: 'cria a pessoa COM senha. O uuid nasce do default da coluna e NAO e ' +
          'aceito no corpo. Sem `perfis`, ela entra e nao ve nada: conceder e ato ' +
          'explicito'
      },
      editar: {
        metodo: 'PUT',
        caminho: '/usuarios/:uuid',
        corpo: 'updateUsuario',
        params: 'uuidParams',
        acesso: 'admin',
        envelope: 'mensagem',
        nota: 'administrador e ativo sao OBRIGATORIOS; os campos de identidade sao ' +
          'opcionais e omitir vale "nao mexe"'
      },
      'editar-lista': {
        metodo: 'PUT',
        caminho: '/usuarios',
        corpo: 'updateUsuarioLista',
        acesso: 'admin',
        envelope: 'mensagem',
        confirmar: {
          campo: 'usuarios',
          subcampo: 'uuid',
          motivo: 'muda administrador, ativo e perfil de VARIAS pessoas de uma vez. ' +
            'Desativar corta o login nos tres modulos, e nada avisa a pessoa'
        }
      },
      excluir: {
        metodo: 'DELETE',
        caminho: '/usuarios/:uuid',
        params: 'uuidParams',
        acesso: 'admin',
        envelope: 'mensagem',
        confirmar: {
          campo: 'uuid',
          motivo: 'exclusao e definitiva e nao tem tabela de deletados. Na pratica ' +
            'quase sempre falha, porque a FK protege quem ja trabalhou no sistema: ' +
            'o caminho normal e DESATIVAR'
        }
      },
      'resetar-senha': {
        metodo: 'POST',
        caminho: '/usuarios/senha/reset',
        corpo: 'listaUsuario',
        acesso: 'admin',
        envelope: 'registro',
        confirmar: {
          campo: 'usuarios',
          motivo: 'a senha de CADA pessoa da lista passa a ser o LOGIN dela. ' +
            'Enquanto ela nao trocar, o acesso esta aberto a quem souber o login'
        }
      },
      perfis: {
        metodo: 'PUT',
        caminho: '/usuarios/:uuid',
        corpo: 'updateUsuario',
        params: 'uuidParams',
        acesso: 'admin',
        envelope: 'mensagem',
        nota: 'a MESMA rota do editar. Nao ha rota so de perfil, e `administrador` ' +
          'e `ativo` sao obrigatorios no corpo: o verbo `efetivo usuario perfis` le os ' +
          'dois da listagem e os reenvia intactos, para conceder acesso nao ' +
          'desativar ninguem por omissao'
      },
      'meu-perfil': {
        metodo: 'GET',
        caminho: '/usuarios/perfil',
        acesso: 'login',
        envelope: 'registro',
        nota: 'o PROPRIO cadastro. Registrado ANTES de /:uuid no servidor, senao o ' +
          'Express casaria "perfil" como uuid'
      },
      'editar-meu-perfil': {
        metodo: 'PUT',
        caminho: '/usuarios/perfil',
        corpo: 'updatePerfilProprio',
        acesso: 'login',
        envelope: 'mensagem',
        nota: 'sem login, administrador, ativo nem perfis: quem muda quem a pessoa ' +
          'e, e o que ela pode, e o administrador'
      },
      'trocar-senha': {
        metodo: 'PUT',
        caminho: '/usuarios/perfil/senha',
        corpo: 'updateSenhaPropria',
        acesso: 'login',
        envelope: 'mensagem',
        nota: 'exige a senha VIGENTE: sem isso um token esquecido aberto viraria ' +
          'uma conta tomada'
      },
      modulos: {
        metodo: 'GET',
        caminho: '/usuarios/dominio/modulo',
        acesso: 'admin',
        envelope: 'lista',
        colunas: ['code', 'nome_abrev', 'nome'],
        nota: 'nome_abrev e a CHAVE do mapa `perfis`'
      },
      niveis: {
        metodo: 'GET',
        caminho: '/usuarios/dominio/tipo_perfil',
        acesso: 'admin',
        envelope: 'lista',
        colunas: ['code', 'nome'],
        nota: 'os niveis sao hierarquicos: verifyPerfil compara perfil_id >= minimo'
      },
      postos: {
        metodo: 'GET',
        caminho: '/usuarios/dominio/tipo_posto_grad',
        acesso: 'login',
        envelope: 'lista',
        colunas: ['code', 'nome_abrev', 'nome'],
        nota: 'exige so login, e nao admin como os dois acima: a tela de "meu ' +
          'perfil" tambem escolhe posto. E daqui que sai o tipo_posto_grad_id do criar'
      }
    }
  },

  // -------------------------------------------------------------------------
  acessos: {
    nome: 'historico de acesso (quem entrou, quando, por qual cliente)',
    schema: carregar('acessos/acessos_schema'),
    operacoes: {
      resumo: {
        metodo: 'GET',
        caminho: '/acessos/resumo',
        acesso: 'admin',
        envelope: 'registro'
      },
      logados: {
        metodo: 'GET',
        caminho: '/acessos/logados',
        acesso: 'admin',
        envelope: 'lista',
        colunas: ['ultimo_login', 'tipo_posto_grad', 'nome_guerra', 'login', 'cliente']
      },
      'logins-dia': {
        metodo: 'GET',
        caminho: '/acessos/logins/dia',
        query: 'loginsDiaQuery',
        acesso: 'admin',
        envelope: 'lista',
        colunas: ['data', 'logins']
      },
      'logins-usuarios': {
        metodo: 'GET',
        caminho: '/acessos/logins/usuarios',
        query: 'loginsUsuariosQuery',
        acesso: 'admin',
        envelope: 'lista',
        colunas: ['usuario', 'logins']
      }
    }
  },

  // -------------------------------------------------------------------------
  // O aproveitamento do efetivo. Duas tabelas e tres leituras agregadas, todas
  // sobre a MESMA base por dia: o mapa por semana, o fechamento por ano e o
  // resumo por mes (a subsecao 6.1 do RPCMTec).
  //
  // Guarda: verifyAdmin em TUDO, inclusive na leitura. A resposta traz licenca
  // de saude e funcao acumulada de cada militar, nominalmente, e isso e dado de
  // pessoal. E a mesma regua de /api/acessos.
  efetivo: {
    nome: 'aproveitamento do efetivo (passagem pela DGEO e impedimento)',
    schema: carregar('efetivo/efetivo_schema'),
    operacoes: {
      mapa: {
        metodo: 'GET',
        caminho: '/efetivo/mapa',
        query: 'anoObrigatorioQuery',
        acesso: 'admin',
        envelope: 'registro',
        nota: 'devolve { ano, semanas, anual }: o mapa semana a semana e o ' +
          'fechamento do ano, da mesma base. O verbo `efetivo mapa` recorta isso'
      },
      mes: {
        metodo: 'GET',
        caminho: '/efetivo/mes',
        query: 'anoMesQuery',
        acesso: 'admin',
        envelope: 'lista',
        nota: 'o recorte que vira a subsecao 6.1 do RPCMTec'
      },
      periodos: {
        metodo: 'GET',
        caminho: '/efetivo/periodos',
        query: 'anoQuery',
        acesso: 'admin',
        envelope: 'lista',
        colunas: ['id', 'usuario_uuid', 'tipo_posto_grad', 'nome_guerra', 'data_inicio', 'data_fim', 'observacao']
      },
      'periodos criar': {
        metodo: 'POST',
        caminho: '/efetivo/periodos',
        corpo: 'criarPeriodo',
        acesso: 'admin',
        envelope: 'registro',
        nota: 'a passagem NAO sobrepoe outra da mesma pessoa: quem cobra e um ' +
          'EXCLUDE no banco, e a colisao volta como recusa. data_fim nula e ' +
          '"sem previsao de saida", que e o caso comum'
      },
      'periodos editar': {
        metodo: 'PUT',
        caminho: '/efetivo/periodos/:id',
        corpo: 'atualizarPeriodo',
        params: 'idParams',
        acesso: 'admin',
        envelope: 'registro',
        nota: 'o MILITAR nao entra no corpo: trocar de dono reescreveria de quem ' +
          'e o periodo. Para isso, exclua e cadastre de novo'
      },
      'periodos excluir': {
        metodo: 'DELETE',
        caminho: '/efetivo/periodos/:id',
        params: 'idParams',
        acesso: 'admin',
        envelope: 'mensagem',
        confirmar: {
          campo: 'id',
          motivo: 'apaga a passagem da pessoa pela DGEO, e nao ha tabela de ' +
            'deletados. Todo mes e semana que ela cobria mudam de numero no mapa ' +
            'e no RPCMTec'
        }
      },
      impedimentos: {
        metodo: 'GET',
        caminho: '/efetivo/impedimentos',
        query: 'anoQuery',
        acesso: 'admin',
        envelope: 'lista',
        colunas: ['id', 'usuario_uuid', 'tipo_posto_grad', 'nome_guerra', 'descricao', 'percentual', 'data_inicio', 'data_fim']
      },
      'impedimentos criar': {
        metodo: 'POST',
        caminho: '/efetivo/impedimentos',
        corpo: 'criarImpedimento',
        acesso: 'admin',
        envelope: 'registro',
        nota: 'impedimento SOBREPOE outro (ao contrario da passagem), e os ' +
          'percentuais somam ate 100. `descricao` e texto livre e vale o que TIRA ' +
          'a pessoa do trabalho da Divisao, nunca o que ela faz aqui'
      },
      'impedimentos editar': {
        metodo: 'PUT',
        caminho: '/efetivo/impedimentos/:id',
        corpo: 'atualizarImpedimento',
        params: 'idParams',
        acesso: 'admin',
        envelope: 'registro',
        nota: 'como no periodo, o MILITAR nao entra no corpo'
      },
      'impedimentos excluir': {
        metodo: 'DELETE',
        caminho: '/efetivo/impedimentos/:id',
        params: 'idParams',
        acesso: 'admin',
        envelope: 'mensagem',
        confirmar: {
          campo: 'id',
          motivo: 'apaga o impedimento, e nao ha tabela de deletados. O ' +
            'aproveitamento do periodo que ele cobria sobe, e o RPCMTec do mes muda'
        }
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
        nota: 'prefira `efetivo login`, que guarda o token em cache e nao pede a senha ' +
          'na linha de comando. A resposta traz token, administrador, uuid, perfis ' +
          'e o catalogo de modulos'
      },
      sessao: {
        metodo: 'GET',
        caminho: '/login/sessao',
        acesso: 'login',
        envelope: 'registro',
        nota: 'perfil ATUAL de quem ja tem token, lido do BANCO e nunca do token: ' +
          'e o que faz rebaixar perfil valer na hora'
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
      `Contrato: efetivo schema ${chave}`
    )
  }
  return { recurso, operacao: op }
}

function listarChaves () {
  return Object.keys(RECURSOS)
}

/** Substitui :param no caminho pelo valor informado. */
function montarCaminho (operacao, valores) {
  return operacao.caminho.replace(/:([a-z_]+)/g, (_, nome) => {
    const valor = valores && valores[nome]
    if (valor === undefined || valor === null || valor === true) {
      throw new Error(
        `A rota ${operacao.metodo} /api${operacao.caminho} exige --${nome}.`
      )
    }
    return encodeURIComponent(valor)
  })
}

module.exports = { RECURSOS, RAIZ_SERVER, obter, obterOperacao, listarChaves, montarCaminho }
