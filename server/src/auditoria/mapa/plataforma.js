'use strict'

/**
 * Mapa de auditoria da PLATAFORMA: o que nao e de modulo nenhum.
 *
 * Usuario, perfil, meta do PIT e edicao do RPCMTec. O contrato de uma entrada
 * esta em `../index.js`.
 *
 * POR QUE ESTE GRUPO E O MAIS SENSIVEL. Aqui mora a unica escrita do sistema que
 * muda o que as OUTRAS escritas podem fazer: promover alguem a administrador
 * global e conceder perfil num modulo. Sem rastro delas nao ha como saber quem
 * concedeu.
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

  // Passagem pela DGEO e impedimento sao do agregado PESSOA, e nao agregados
  // proprios. "Chegou em marco", "saiu em novembro" e "acumulou o S5 de junho a
  // dezembro" sao a historia daquela pessoa, e e na ficha dela que se leem. Um
  // agregado proprio para cada um daria duas fichas que ninguem abre.
  //
  // O aproveitamento e INTERVALO, e nao retrato mensal, justamente por isto: com
  // retrato, editar o mes de marco aparece como um evento por mes, e nunca como
  // "a passagem mudou de data".
  'dgeo.efetivo_periodo': {
    modulo: 'plataforma',
    entidade: 'usuario',
    agregado: (t, linha) => linha.usuario_uuid,
    resumo: linha =>
      `Passagem pela DGEO desde ${linha.data_inicio}${linha.data_fim ? ` até ${linha.data_fim}` : ''}`,
    campos: {
      usuario_uuid: { rotulo: 'Militar', entidade: 'usuario' },
      data_inicio: { rotulo: 'Entrada na DGEO', tipo: 'data' },
      // Nulo e "sem previsao de saida", e nao "esqueceram de preencher". A tela
      // mostra isso como uma caixa marcada.
      data_fim: { rotulo: 'Saída da DGEO', tipo: 'data' },
      observacao: { rotulo: 'Observação' }
    }
  },

  'dgeo.impedimento': {
    modulo: 'plataforma',
    entidade: 'usuario',
    agregado: (t, linha) => linha.usuario_uuid,
    resumo: linha => `${linha.descricao} (${linha.percentual}%)`,
    campos: {
      usuario_uuid: { rotulo: 'Militar', entidade: 'usuario' },
      // TEXTO LIVRE, sem catalogo de tipo: a lista de motivos nao fecha, e
      // classificar antes de escrever atrapalha.
      descricao: { rotulo: 'Impedimento' },
      percentual: { rotulo: 'Percentual do tempo', tipo: 'numero' },
      data_inicio: { rotulo: 'Início', tipo: 'data' },
      data_fim: { rotulo: 'Término', tipo: 'data' }
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
      // A DESCRICAO, A QUANTIDADE, O PRAZO E O DEMANDANTE NAO ESTAO AQUI: eles
      // sao o que a DSG declara, e mudam por REVISAO. O rastro deles esta em
      // `pit.meta_revisao`, que cai na ficha desta mesma meta.
      //
      // O que sobrou e o que o SCA decide, e e por isso que muda sem revisao.
      unidade_id: { rotulo: 'Unidade', dominio: 'dominio.unidade_meta' },
      origem_id: { rotulo: 'Origem do número', dominio: 'dominio.origem_meta' }
    }
  },

  // --- A revisao do PIT, e a meta como cada uma a declara ---------------------
  // As tres caem na entidade que o leitor procura: o EXERCICIO para a revisao e
  // o anexo (a pergunta e "o que mudou no PIT de 2026"), e a META para a linha
  // de declaracao (a pergunta e "por que a 4.2 virou 252").

  'pit.exercicio': {
    modulo: 'plataforma',
    entidade: 'exercicio',
    agregado: (t, linha) => linha.ano,
    resumo: linha => `Exercício de ${linha.ano}`,
    campos: {
      ano: { rotulo: 'Ano' },
      situacao_id: { rotulo: 'Situação', dominio: 'dominio.situacao_exercicio' },
      observacao: { rotulo: 'Observação' }
    }
  },

  'pit.revisao': {
    modulo: 'plataforma',
    entidade: 'exercicio',
    agregado: (t, linha) => linha.ano,
    resumo: linha => `Revisão ${linha.codigo} do PIT de ${linha.ano}`,
    campos: {
      ano: { rotulo: 'Ano' },
      codigo: { rotulo: 'Código' },
      data_documento: { rotulo: 'Data do documento', tipo: 'data' },
      data_assinatura: { rotulo: 'Data da assinatura', tipo: 'data' },
      assinante: { rotulo: 'Assinante' },
      // Preencher esta data e PUBLICAR: e o instante em que a grade do ano passa
      // a ler outros numeros. Nulo e rascunho.
      data_vigencia: { rotulo: 'Vigência a partir de', tipo: 'data' },
      observacao: { rotulo: 'Observação' }
    }
  },

  'pit.anexo_revisao': {
    modulo: 'plataforma',
    entidade: 'exercicio',
    agregado: (t, linha) =>
      t.one('SELECT ano FROM pit.revisao WHERE id = $<id>', { id: linha.revisao_id })
        .then(r => r.ano),
    resumo: linha => `Anexo ${linha.nome_original}`,
    campos: {
      revisao_id: { rotulo: 'Revisão' },
      tipo_anexo_id: { rotulo: 'Tipo de anexo', dominio: 'pit.tipo_anexo_revisao' },
      nome_original: { rotulo: 'Arquivo' },
      extensao: { rotulo: 'Extensão' },
      mimetype: { rotulo: 'Tipo MIME' },
      tamanho_bytes: { rotulo: 'Tamanho em bytes', tipo: 'numero' },
      descricao: { rotulo: 'Descrição' }
      // `conteudo` fica de FORA: o evento guardaria uma segunda copia dos bytes.
    }
  },

  'pit.meta_revisao': {
    modulo: 'plataforma',
    entidade: 'meta',
    agregado: (t, linha) => linha.meta_id,
    resumo: linha => `Declaração da meta na revisão ${linha.revisao_id}`,
    campos: {
      meta_id: { rotulo: 'Meta do PIT', entidade: 'meta' },
      revisao_id: { rotulo: 'Revisão do PIT' },
      descricao: { rotulo: 'Descrição' },
      quantidade_prevista: { rotulo: 'Quantidade prevista', tipo: 'numero' },
      demandante: { rotulo: 'Demandante' },
      prazo: { rotulo: 'Previsão de término', tipo: 'data' },
      // O UNICO ato de situacao que e da DSG. O andamento e a conclusao a grade
      // calcula do que foi lancado.
      cancelada: { rotulo: 'Cancelada' }
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
    resumo: linha => `Mês ${String(linha.mes).padStart(2, '0')}`,
    campos: {
      meta_id: { rotulo: 'Meta do PIT', entidade: 'meta' },
      mes: { rotulo: 'Mês', tipo: 'numero' },
      // O PLANEJADO e o REALIZADO do mes sao colunas separadas: a planilha da
      // Divisao tem duas abas com as mesmas linhas, e a diferenca entre elas e
      // qual dos dois numeros a celula guarda.
      quantidade_planejada: { rotulo: 'Quantidade planejada', tipo: 'numero' },
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
      // Reusa o dominio da meta e aceita so Manual e Producao. Mudar a origem
      // muda quem PROVA a demanda: em Producao ela nao fecha sem versao no
      // acervo, em Manual fecha por decisao de quem edita.
      origem_id: { rotulo: 'Origem', dominio: 'dominio.origem_meta' },
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
      assinante_uuid: { rotulo: 'Assinante', entidade: 'usuario' },
      data_assinatura: { rotulo: 'Data da assinatura', tipo: 'data' },
      // FECHAR e REABRIR sao os dois atos mais consequentes da tela, e passam
      // por estas duas colunas: fechar congela o documento que o chefe assina,
      // reabrir descongela. "Quem reabriu a edicao de julho" e pergunta que se
      // faz depois de o documento ter saido.
      data_fechamento: { rotulo: 'Fechamento', tipo: 'data_hora' },
      usuario_fechamento_uuid: { rotulo: 'Fechada por', entidade: 'usuario' }
    }
  },

  // O CONTEUDO de um bloco do relatorio. O evento e do bloco, e nao da edicao,
  // porque a pergunta que se faz e "quem mudou a 7.1", e nao "quantas vezes a
  // edicao de julho foi tocada" -- esta ultima daria dezenas de linhas iguais.
  'rpcmtec.subsecao': {
    modulo: 'plataforma',
    entidade: 'edicao',
    agregado: (t, linha) => linha.edicao_id,
    resumo: linha => `Subseção ${linha.numero}`,
    campos: {
      numero: { rotulo: 'Subseção' },
      // A celula ja em TEXTO, como vai impressa: o rastro guarda o que o
      // documento DISSE, e nao o dado normalizado.
      linhas: { rotulo: 'Linhas', tipo: 'lista' },
      texto: { rotulo: 'Texto' },
      sem_ocorrencia: { rotulo: 'Sem ocorrência no mês', tipo: 'booleano' }
    }
  },

  'rpcmtec.anexo_edicao': {
    modulo: 'plataforma',
    entidade: 'edicao',
    agregado: (t, linha) => linha.edicao_id,
    resumo: linha => `Anexo ${linha.nome_original}`,
    campos: {
      nome_original: { rotulo: 'Arquivo' },
      extensao: { rotulo: 'Extensão' },
      tamanho_bytes: { rotulo: 'Tamanho', tipo: 'numero' },
      descricao: { rotulo: 'Descrição' }
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
      // Só na RECEBIDA: sob que Plano/Código.
      plano_codigo: { rotulo: 'Plano/Código' },
      documento: { rotulo: 'Documento' },
      // O VINCULO COM A META. Trocá-lo muda o número que a grade do PIT calcula
      // quando a meta declara origem Capacitação, então é dos campos que mais
      // pedem rastro legível. Sem a declaração ele saía no fim da lista, com o
      // nome cru da coluna e sem o link para a ficha da meta.
      meta_pit_id: { rotulo: 'Meta do PIT', entidade: 'meta' },
      // O MES PROMETIDO, de onde a grade tira o planejado. Anda com o campo
      // acima, e mexer nela move a coluna com que o realizado se compara.
      data_prevista: { rotulo: 'Data prevista', tipo: 'data' }
    }
  },

  // Quem da Divisao participou. ESTA ENTRADA DESCREVE A LISTA, e nao a linha: o
  // vinculo e regravado INTEIRO a cada salvamento, entao auditar linha a linha
  // faria o historico dizer "removeu 3, acrescentou 3" toda vez que alguem
  // abrisse e salvasse. E o mesmo desenho dos itens do DFD.
  'rpcmtec.capacitacao_militar': {
    modulo: 'plataforma',
    entidade: 'capacitacao',
    agregado: (t, linha) => linha.capacitacao_id,
    resumo: linha => `${(linha.militares || []).length} militar(es) da Divisão`,
    campos: {
      // SINTETICO: nao ha coluna `militares` em `rpcmtec.capacitacao_militar`.
      // Ela e montada pelo controller com a lista inteira em texto, que e o que
      // permite o evento ser do PAI.
      militares: { rotulo: 'Militares da Divisão', tipo: 'lista', sintetico: true },
      capacitacao_id: { rotulo: 'Capacitação', entidade: 'capacitacao' }
    }
  }
}
