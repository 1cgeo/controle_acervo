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
// NAO EXISTE recurso `aplicacao`: o catalogo `dgeo.aplicacao` do Auth Server
// externo nao veio na fusao de 2026-08-02, por decisao do chefe. A lista de
// clientes e fechada e vive no `.valid()` de `login/login_schema.js`, que e de
// onde `lib/config.js` a le.

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
          'e `ativo` sao obrigatorios no corpo: o verbo `auth usuario perfis` le os ' +
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
      'logins-mes': {
        metodo: 'GET',
        caminho: '/acessos/logins/mes',
        query: 'loginsMesQuery',
        acesso: 'admin',
        envelope: 'lista',
        colunas: ['data', 'logins'],
        nota: 'a data e o PRIMEIRO dia do mes, e nao um rotulo AAAA-MM: dia de ' +
          'calendario e mais facil de ordenar'
      },
      'logins-usuarios': {
        metodo: 'GET',
        caminho: '/acessos/logins/usuarios',
        query: 'loginsUsuariosQuery',
        acesso: 'admin',
        envelope: 'lista',
        colunas: ['usuario', 'logins']
      },
      'logins-clientes': {
        metodo: 'GET',
        caminho: '/acessos/logins/clientes',
        query: 'loginsClientesQuery',
        acesso: 'admin',
        envelope: 'lista',
        colunas: ['cliente', 'logins']
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
        nota: 'prefira `auth login`, que guarda o token em cache e nao pede a senha ' +
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
      `Contrato: auth schema ${chave}`
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
