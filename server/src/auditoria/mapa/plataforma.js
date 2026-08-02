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
      descricao: { rotulo: 'Descrição' },
      // O que o PIT PROMETE, absorvido do SAP em 2026-08-02. Sem estes quatro a
      // subsecao 2.1 do relatorio nao tinha como sair.
      quantidade_prevista: { rotulo: 'Quantidade prevista', tipo: 'numero' },
      unidade: { rotulo: 'Unidade' },
      demandante: { rotulo: 'Demandante' },
      prazo: { rotulo: 'Previsão de término', tipo: 'data' }
    }
  },

  // O lancamento mensal NAO e agregado proprio: ele e da meta, e e na ficha
  // dela que se le. "Lancou 12 em marco na 6.1" so faz sentido ao lado das
  // outras mudancas daquela meta; sozinho, seria um numero sem dono. E a mesma
  // regra do item do pedido na mapoteca.
  'pit.execucao': {
    modulo: 'plataforma',
    entidade: 'meta',
    agregado: (t, linha) => linha.meta_id,
    resumo: linha => `Execução do mês ${String(linha.mes).padStart(2, '0')}`,
    campos: {
      meta_id: { rotulo: 'Meta do PIT', entidade: 'meta' },
      mes: { rotulo: 'Mês', tipo: 'numero' },
      quantidade: { rotulo: 'Quantidade realizada', tipo: 'numero' },
      data_conclusao: { rotulo: 'Data de conclusão', tipo: 'data' },
      observacao: { rotulo: 'Observação' }
    }
  },

  // --- Agregado: demanda Extra-PIT -------------------------------------------
  // Agregado PROPRIO, e nao da meta: o Extra-PIT e justamente o que NAO tem
  // meta. Pendura-lo em alguma seria inventar o vinculo que ele nao tem.

  'pit.demanda_extra': {
    modulo: 'plataforma',
    entidade: 'extra_pit',
    agregado: (t, linha) => linha.id,
    resumo: linha =>
      `${linha.tipo_produto} para ${linha.demandante} (${linha.ano})`,
    campos: {
      // Mesma razao do `ano` da meta: sem `tipo: 'numero'`, senao 2026 sairia
      // como "2.026".
      ano: { rotulo: 'Ano' },
      demandante: { rotulo: 'Demandante' },
      tipo_produto: { rotulo: 'Tipo de produto' },
      quantidade: { rotulo: 'Quantidade', tipo: 'numero' },
      situacao_id: { rotulo: 'Situação', dominio: 'dominio.situacao_extra_pit' },
      documento_autorizacao: { rotulo: 'Documento de autorização' },
      descricao: { rotulo: 'Descrição' },
      data_entrega: { rotulo: 'Data de entrega', tipo: 'data' }
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
  },

  // --- Agregado: aproveitamento do efetivo -----------------------------------
  //
  // O AGREGADO E O MES, e nao a linha. A pergunta que se faz aqui e "quem mexeu
  // no efetivo de julho", e nao "o que aconteceu com a linha 412": a tela e por
  // (ano, mes), o retrato inteiro se preenche de uma vez e se confere de uma
  // vez. Com a linha por agregado, a ficha do mes teria de juntar trinta
  // historicos para contar uma historia so.
  //
  // Por isso o id do agregado e TEXTO no formato 'AAAA-MM'. A coluna
  // `auditoria.evento.entidade_id` e VARCHAR justamente porque o sistema
  // identifica registro de mais de uma forma.
  //
  // As duas partidas rapidas (iniciar do efetivo, copiar o mes anterior) criam
  // dezenas de linhas de uma vez, e cada uma vira um evento. O que impede a
  // tela de virar trinta linhas iguais e o `lote_id`, que `montarContexto` ja
  // emite um por REQUISICAO -- e cada partida rapida e uma requisicao so.

  'rpcmtec.aproveitamento_mes': {
    modulo: 'plataforma',
    entidade: 'aproveitamento',
    agregado: (t, linha) => `${linha.ano}-${String(linha.mes).padStart(2, '0')}`,
    // O UUID de quem e a linha, e nao o nome: o resumo e montado a partir da
    // PROPRIA linha, que nao traz o cadastro. Quem le a tela ve o nome, porque
    // a tela consulta o cadastro; o rastro guarda o que identifica sem depender
    // de o cadastro continuar existindo.
    resumo: linha => `Efetivo de ${String(linha.mes).padStart(2, '0')}/${linha.ano}`,
    campos: {
      ano: { rotulo: 'Ano' },
      mes: { rotulo: 'Mês', tipo: 'numero' },
      usuario_uuid: { rotulo: 'Militar', entidade: 'usuario' },
      // CONGELADO no mês: é o posto da época, e não o de hoje. Alterá-lo aqui é
      // corrigir o retrato, e não promover ninguém.
      tipo_posto_grad_id: { rotulo: 'Posto/graduação no mês', dominio: 'dominio.tipo_posto_grad' },
      atividades: { rotulo: 'Atividades e encargos' }
    }
  },

  // --- Agregado: capacitacao -------------------------------------------------

  'rpcmtec.capacitacao': {
    modulo: 'plataforma',
    entidade: 'capacitacao',
    agregado: (t, linha) => linha.id,
    resumo: linha => `${linha.nome} (${linha.ano})`,
    campos: {
      ano: { rotulo: 'Ano' },
      nome: { rotulo: 'Nome' },
      tipo_id: { rotulo: 'Tipo', dominio: 'dominio.tipo_capacitacao' },
      situacao_id: { rotulo: 'Situação', dominio: 'dominio.situacao_capacitacao' },
      instituicoes: { rotulo: 'Instituições' },
      local_realizacao: { rotulo: 'Local' },
      data_inicio: { rotulo: 'Início', tipo: 'data' },
      data_fim: { rotulo: 'Término', tipo: 'data' },
      // Só na MINISTRADA: quantos de fora nós treinamos.
      efetivo_capacitado: { rotulo: 'Efetivo capacitado', tipo: 'numero' },
      // Só na RECEBIDA: quem foi, e sob que Plano/Código.
      militares: { rotulo: 'Militares' },
      plano_codigo: { rotulo: 'Plano/Código' },
      documento: { rotulo: 'Documento' }
    }
  }
}
