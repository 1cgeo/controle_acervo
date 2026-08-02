'use strict'

/**
 * Mapa de auditoria da PLATAFORMA: o que nao e de modulo nenhum.
 *
 * Usuario, perfil, meta do PIT e edicao do RPCMTec. O contrato de uma entrada
 * esta em `../index.js`.
 *
 * POR QUE ESTE GRUPO E O MAIS SENSIVEL. Aqui mora a unica escrita do sistema que
 * muda o que as OUTRAS escritas podem fazer: promover alguem a administrador
 * global e conceder perfil num modulo. Ate 2026-08-02 nenhuma das duas deixava
 * rastro, e nao havia como saber quem concedeu.
 *
 * O AGREGADO DE `usuario` E O UUID, e nao o `id` serial. E ele que aparece na
 * URL da tela (#/usuarios), e que as dezenas de tabelas dos tres modulos
 * referenciam; o `id` so vive dentro de `dgeo`. Com o `id` no `entidade_id`, o
 * historico de uma pessoa nao casaria com nada do resto do sistema.
 */

module.exports = {
  // --- Agregado: usuario -----------------------------------------------------
  // O cadastro e o perfil por modulo se leem JUNTOS: "foi promovido" e "ganhou
  // gerente no acervo" sao a mesma pergunta feita na mesma tela. Separa-los em
  // dois agregados esconderia a metade que interessa.

  'dgeo.usuario': {
    modulo: 'plataforma',
    entidade: 'usuario',
    agregado: (t, linha) => linha.uuid,
    // O nome de guerra e o login: e assim que a pessoa e chamada e assim que ela
    // e procurada. So o nome completo nao acha ninguem na tela de usuarios.
    resumo: linha => `${linha.nome_guerra || linha.nome} (${linha.login})`,
    // O HASH BCRYPT. Copia-lo criaria uma SEGUNDA copia da credencial, numa
    // tabela que ninguem pensa como guardadora de senha e que so administrador
    // le. Vira null nos dois lados, e `campos_alterados` ja diz que a senha
    // mudou -- que e a informacao toda: quem trocou, quando e de que porta.
    //
    // A rede vale mesmo para quem passar a linha inteira por engano: a
    // sanitizacao roda DEPOIS do diff, sobre a copia que vai para o banco.
    omitir: ['senha'],
    campos: {
      login: { rotulo: 'Login' },
      nome: { rotulo: 'Nome completo' },
      nome_guerra: { rotulo: 'Nome de guerra' },
      tipo_posto_grad_id: { rotulo: 'Posto/graduação', dominio: 'dominio.tipo_posto_grad' },
      // Os dois campos que este rastro existe para guardar.
      administrador: { rotulo: 'Administrador global', tipo: 'booleano' },
      ativo: { rotulo: 'Ativo', tipo: 'booleano' },
      // Declarada mesmo saindo sempre nula: sem a declaracao, a troca de senha
      // apareceria na tela como a coluna crua "senha", no fim da lista, junto do
      // que ninguem declarou. O rotulo e o que diz que a ausencia de valor e
      // deliberada.
      senha: { rotulo: 'Senha' }
    }
  },

  'dgeo.usuario_perfil': {
    modulo: 'plataforma',
    entidade: 'usuario',
    // O dono esta a um salto, e o salto e de TIPO: a tabela aponta o `id`
    // serial, e o agregado e o `uuid`. Assincrona por isso.
    agregado: async (t, linha) => {
      const usuario = await t.oneOrNone(
        'SELECT uuid FROM dgeo.usuario WHERE id = $<id>',
        { id: linha.usuario_id }
      )
      return usuario ? usuario.uuid : null
    },
    // O codigo cru, porque o `resumo` roda sem catalogo de dominio (ele e uma
    // funcao pura sobre a linha). A traducao de modulo e de perfil sai no diff,
    // que e onde ela informa.
    resumo: linha => `Perfil no módulo ${linha.modulo_id}`,
    campos: {
      modulo_id: { rotulo: 'Módulo', dominio: 'dominio.modulo' },
      perfil_id: { rotulo: 'Perfil', dominio: 'dominio.tipo_perfil' }
    }
  },

  // --- Agregado: meta do PIT -------------------------------------------------

  'pit.meta': {
    modulo: 'plataforma',
    entidade: 'meta',
    agregado: (t, linha) => linha.id,
    resumo: linha =>
      `Meta ${linha.numero_meta}${linha.item ? ` (item ${linha.item})` : ''} de ${linha.ano}`,
    campos: {
      // SEM `tipo: 'numero'` de proposito: o formatador de numero e o pt-BR, e
      // 2026 sairia como "2.026". Ano nao e quantidade.
      ano: { rotulo: 'Ano' },
      numero_meta: { rotulo: 'Número da meta', tipo: 'numero' },
      item: { rotulo: 'Item' },
      descricao: { rotulo: 'Descrição' }
    }
  },

  // --- Agregado: edicao do RPCMTec -------------------------------------------

  'rpcmtec.edicao': {
    modulo: 'plataforma',
    entidade: 'edicao',
    agregado: (t, linha) => linha.id,
    resumo: linha => `Edição ${String(linha.mes).padStart(2, '0')}/${linha.ano}`,
    campos: {
      // Mesma razao do `ano` da meta.
      ano: { rotulo: 'Ano' },
      mes: { rotulo: 'Mês', tipo: 'numero' },
      assinante: { rotulo: 'Assinante' },
      data_assinatura: { rotulo: 'Data da assinatura', tipo: 'data' }
    }
  }
}
