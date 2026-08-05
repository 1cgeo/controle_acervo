"use strict";

const { db } = require("../database");
const { arquivarArquivos, idsDosArquivosDasVersoes } = require("../arquivo/arquivo_deletado");
const { AppError, httpCode, preserveOmitted, domainConstants: { TIPO_VERSAO, TIPO_RELACIONAMENTO } } = require("../utils");
const { conferirIdentidadeLivre } = require("../utils/identidade_produto");
const { auditoriaCtrl } = require("../auditoria");
const scn = require("../utils/scn");
const { v4: uuidv4 } = require('uuid');

const controller = {};

// A GEOMETRIA do produto é lida por `lerAntes`/`lerDepois`, e nunca por um
// `RETURNING *` cru. `SELECT *` numa coluna geométrica devolve o WKB em
// hexadecimal, ilegível e longo; as duas funções trocam a coluna pelo EWKT, que
// é o formato em que o estado anterior de uma folha redesenhada serve para
// desfazer o redesenho. É por isso que os INSERTs de produto abaixo continuam
// com `RETURNING id` e leem a linha em seguida: uma ida a mais ao banco por
// produto, contra copiar a regra do EWKT para cinco lugares.

controller.atualizaProduto = async (produto, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    // Antes do `preserveOmitted`, que já lê a linha para preencher a chave
    // omitida: ler depois dele descreveria um estado intermediário.
    const antes = await auditoriaCtrl.lerAntes(t, 'acervo.produto', produto.id, 'Produto')

    produto.data_modificacao = new Date()
    produto.usuario_modificacao_uuid = usuarioUuid

    // Chave ausente = "não mexe neste campo". Antes, omitir subtipo_produto_id
    // apagava a identidade do produto em silêncio (Joi .default(null) + def:null
    // no ColumnSet), e bastava reenviar o que o GET devolvia para uma Carta
    // Militar deixar de ser militar. Enviar null explícito ainda despina.
    await preserveOmitted(t, {
      table: 'produto',
      id: produto.id,
      fields: ['subtipo_produto_id'],
      body: produto
    })

    // O trigger acervo.validate_version recusa versão cujo subtipo divirja do subtipo do
    // produto. Fixar o produto num subtipo conflitante não falha aqui: falha na próxima
    // carga, longe da causa. Por isso valida-se contra as versões que já existem.
    // Passar null (despinar) é sempre permitido: é o estado da maioria dos produtos e é o
    // que permite guardar mais de uma geração no mesmo produto (ex.: EDGV 2.1.3 e 3.0).
    if (produto.subtipo_produto_id !== null && produto.subtipo_produto_id !== undefined) {
      const conflito = await t.oneOrNone(`
        SELECT string_agg(DISTINCT v.subtipo_produto_id::text, ', ') AS subtipos
        FROM acervo.versao v
        WHERE v.produto_id = $1 AND v.subtipo_produto_id <> $2
      `, [produto.id, produto.subtipo_produto_id])

      if (conflito && conflito.subtipos) {
        throw new AppError(
          `Produto tem versões de subtipo ${conflito.subtipos}; não pode ser fixado no subtipo ${produto.subtipo_produto_id}`,
          httpCode.BadRequest
        )
      }
    }

    if (produto.geom) {
      // Atualizar com geometria usando query parametrizada
      await t.none(`
        UPDATE acervo.produto SET
          nome = $2, mi = $3, inom = $4, tipo_escala_id = $5,
          denominador_escala_especial = $6, tipo_produto_id = $7, descricao = $8,
          geom = ST_GeomFromEWKT($9), data_modificacao = $10, usuario_modificacao_uuid = $11,
          subtipo_produto_id = $12
        WHERE id = $1
      `, [produto.id, produto.nome, produto.mi, produto.inom, produto.tipo_escala_id,
          produto.denominador_escala_especial, produto.tipo_produto_id, produto.descricao,
          produto.geom, produto.data_modificacao, produto.usuario_modificacao_uuid,
          produto.subtipo_produto_id === undefined ? null : produto.subtipo_produto_id])
    } else {
      // mi/inom são opcionais no Joi, def evita "Property doesn't exist" do pgp
      const colunasProduto = [
        'nome',
        { name: 'mi', def: null },
        { name: 'inom', def: null },
        'tipo_escala_id', 'denominador_escala_especial',
        'tipo_produto_id', 'descricao',
        { name: 'subtipo_produto_id', def: null },
        'data_modificacao', 'usuario_modificacao_uuid'
      ]

      const cs = new db.pgp.helpers.ColumnSet(colunasProduto, { table: { table: 'produto', schema: 'acervo' } })
      const query = db.pgp.helpers.update(produto, cs) + ' WHERE id = $1'

      await t.none(query, [produto.id])
    }

    const depois = await auditoriaCtrl.lerDepois(t, 'acervo.produto', produto.id)

    await auditoriaCtrl.registrar(t, {
      tabela: 'acervo.produto',
      registroId: produto.id,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto
    })
  })
}

controller.atualizaVersao = async (versao, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    versao.data_modificacao = new Date();
    versao.usuario_modificacao_uuid = usuarioUuid;

    // SUBSTITUI o `SELECT uuid_versao` que existia só para o 404 e para a
    // conferência de imutabilidade: a linha inteira sai pela mesma ida ao banco,
    // e a mensagem de "não encontrada" continua sendo a que a rota já dava.
    const versaoAtual = await auditoriaCtrl.lerAntes(t, 'acervo.versao', versao.id, 'Versão');

    // uuid_versao é aceito pelo schema mas NÃO está no ColumnSet abaixo: é
    // imutável (o pedido da mapoteca referencia a versão por ele). Antes, mandar
    // um uuid_versao diferente devolvia 200 sem gravar nada, ou seja, o cliente
    // achava que tinha corrigido o identificador. Reenviar o mesmo valor que o
    // GET devolveu continua válido; divergir é erro explícito.
    if (versao.uuid_versao !== undefined && versao.uuid_versao !== versaoAtual.uuid_versao) {
      throw new AppError(
        'uuid_versao é imutável e não pode ser alterado por esta rota',
        httpCode.BadRequest
      );
    }

    // Chave ausente = "não mexe": omitir palavras_chave zerava as gravadas
    await preserveOmitted(t, {
      table: 'versao',
      id: versao.id,
      // `meta_pit_id` entra aqui pela mesma razão: ele é opcional no schema, e o
      // cliente que não conhece o campo desligaria da meta do PIT toda versão
      // que editasse. Enviar null continua desligando de propósito.
      //
      // `data_prevista` anda junto com ele: os dois formam o vínculo com o PIT
      // (a meta e o mês prometido), e preservar um sem o outro deixaria a versão
      // ligada à meta sem dizer em que mês, que é o buraco que o diagnóstico
      // acusa.
      fields: ['palavras_chave', 'meta_pit_id', 'demanda_extra_id', 'data_prevista'],
      body: versao
    });

    // Espelha o CHECK `versao_plano_ou_excecao` com erro amigável, e por isso
    // vem DEPOIS do preserveOmitted: quem manda só `demanda_extra_id` numa
    // versão que já tinha meta receberia o erro do banco sem saber que a chave
    // omitida foi preservada.
    if (versao.meta_pit_id != null && versao.demanda_extra_id != null) {
      throw new AppError(
        'A versão cumpre uma meta do PIT ou materializa uma demanda Extra-PIT, ' +
        'nunca as duas. Envie null na que deve sair.',
        httpCode.BadRequest
      );
    }

    // Espelha a UNIQUE unique_version_per_product com erro amigável.
    //
    // O SUBTIPO faz parte da chave, e omiti-lo aqui tornava esta checagem mais
    // rígida que a constraint que ela diz espelhar: o produto que tem a Carta
    // Ortoimagem SCN e a Especial, ambas rotuladas "1ª Edição" (legítimo, e é o
    // que a UNIQUE permite), passava a REJEITAR qualquer edição de qualquer uma
    // das duas, com 409. Apareceu ao marcar palavra-chave nos mosaicos
    // RADAMBRASIL: 16 dos 42 produtos têm as duas versões, e os 16 falharam.
    const versaoExistente = await t.oneOrNone(
      `SELECT id FROM acervo.versao
       WHERE produto_id = (SELECT produto_id FROM acervo.versao WHERE id = $1)
       AND versao = $2 AND subtipo_produto_id = $3 AND id != $1`,
      [versao.id, versao.versao, versao.subtipo_produto_id]
    );
    if (versaoExistente) {
      throw new AppError(
        `Já existe a versão "${versao.versao}" para este produto neste subtipo`,
        httpCode.Conflict
      );
    }

    const colunasVersao = [
      'versao', 'nome', 'tipo_versao_id', 'subtipo_produto_id',
      'descricao', 'metadado', 'lote_id', 'meta_pit_id', 'demanda_extra_id',
      'orgao_produtor', 'palavras_chave',
      'data_criacao', 'data_edicao',
      // `def: null` porque a chave pode chegar ausente do schema, e o
      // `preserveOmitted` acima só a repõe quando ela já existia gravada.
      { name: 'data_prevista', cast: 'date', def: null },
      'data_modificacao', 'usuario_modificacao_uuid'
    ];

    const cs = new db.pgp.helpers.ColumnSet(colunasVersao, { table: { table: 'versao', schema: 'acervo' } });
    const query = db.pgp.helpers.update(versao, cs) + ' WHERE id = $1 RETURNING *';

    const depois = await t.one(query, [versao.id]);

    await auditoriaCtrl.registrar(t, {
      tabela: 'acervo.versao',
      registroId: versao.id,
      operacao: 'U',
      antes: versaoAtual,
      depois,
      usuarioUuid,
      contexto
    });
  });
};

/**
 * Corrige o `uuid_versao` de uma ou mais versões para o identificador que o
 * BDGEx já publicou.
 *
 * POR QUE existe uma rota só para isto. O `uuid_versao` identifica a versão nos
 * DOIS lados: no acervo e na publicação. Quando a carga no BDGEx vem antes da
 * catalogação (ou é refeita), quem já atribuiu o número é o BDGEx, e é o acervo
 * que se acerta. Sem esta rota a única saída seria apagar e recadastrar a
 * versão, o que perderia arquivo, relacionamento e histórico de pedido.
 *
 * O `atualizaVersao` continua RECUSANDO a troca, e continua certo: lá o
 * uuid_versao chega junto de vinte outros campos, e trocá-lo seria acidente.
 * Aqui a troca é o propósito declarado, com motivo obrigatório.
 *
 * O item de pedido que aponta a versão acompanha, pela cascata da chave
 * estrangeira. Sem ela, o UPDATE falharia por integridade referencial.
 *
 * @param {Array<{versao_id: number, uuid_versao: string}>} correcoes
 * @param {string} motivo - de onde saiu o identificador novo
 * @param {string} usuarioUuid
 * @returns {Promise<Array<{versao_id: number, uuid_anterior: string, uuid_versao: string, itens_pedido: number}>>}
 */
controller.corrigeUuidVersao = async (correcoes, motivo, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const ids = correcoes.map(c => c.versao_id);
    // `SELECT *` no lugar das três colunas: é o `dados_antes` de cada correção,
    // pela mesma ida ao banco. É o único rastro de qual identificador a versão
    // tinha antes de o BDGEx impor o dele.
    const atuais = await t.any(
      'SELECT * FROM acervo.versao WHERE id IN ($1:csv)',
      [ids]
    );

    if (atuais.length !== ids.length) {
      const achados = atuais.map(v => Number(v.id));
      const faltando = ids.filter(id => !achados.includes(id));
      throw new AppError(
        `As seguintes versões não foram encontradas: ${faltando.join(', ')}`,
        httpCode.NotFound
      );
    }

    const porId = new Map(atuais.map(v => [Number(v.id), v]));

    // O uuid novo não pode já pertencer a OUTRA versão. A UNIQUE do banco pegaria
    // isso, mas com mensagem de constraint; aqui o erro diz qual linha do lote
    // está errada, que é o que quem manda o lote precisa saber.
    const novos = correcoes.map(c => c.uuid_versao);
    const ocupados = await t.any(
      'SELECT id, uuid_versao FROM acervo.versao WHERE uuid_versao IN ($1:csv) AND id NOT IN ($2:csv)',
      [novos, ids]
    );
    if (ocupados.length > 0) {
      const lista = ocupados.map(o => `${o.uuid_versao} (versão ${o.id})`).join(', ');
      throw new AppError(
        `Estes identificadores já pertencem a outra versão: ${lista}`,
        httpCode.Conflict
      );
    }

    const resultado = [];
    for (const c of correcoes) {
      const atual = porId.get(c.versao_id);
      if (atual.uuid_versao === c.uuid_versao) {
        // Reenviar o mesmo valor não é erro: a rota é idempotente de propósito,
        // porque um lote de 42 folhas pode ser reexecutado depois de uma falha
        // parcial de rede.
        resultado.push({
          versao_id: c.versao_id,
          uuid_anterior: atual.uuid_versao,
          uuid_versao: c.uuid_versao,
          itens_pedido: 0,
          alterado: false
        });
        continue;
      }

      const itens = await t.one(
        'SELECT COUNT(*)::int AS total FROM mapoteca.produto_pedido WHERE uuid_versao = $1',
        [atual.uuid_versao]
      );

      // O identificador antigo fica registrado no metadado da própria versão: é
      // a trilha de quem procurar pelo número velho num RTM antigo.
      const metadado = Object.assign({}, atual.metadado || {}, {
        uuid_versao_anterior: atual.uuid_versao,
        uuid_versao_correcao_motivo: motivo,
        uuid_versao_corrigido_em: new Date().toISOString()
      });

      const depois = await t.one(
        `UPDATE acervo.versao
         SET uuid_versao = $1, metadado = $2, data_modificacao = $3, usuario_modificacao_uuid = $4
         WHERE id = $5
         RETURNING *`,
        [c.uuid_versao, metadado, new Date(), usuarioUuid, c.versao_id]
      );

      // O `motivo` é obrigatório nesta rota e até aqui só existia dentro do
      // metadado da própria versão. No rastro ele responde a pergunta que a
      // correção produz: de onde saiu o identificador novo.
      await auditoriaCtrl.registrar(t, {
        tabela: 'acervo.versao',
        registroId: c.versao_id,
        operacao: 'U',
        antes: atual,
        depois,
        usuarioUuid,
        contexto,
        motivo
      });

      resultado.push({
        versao_id: c.versao_id,
        uuid_anterior: atual.uuid_versao,
        uuid_versao: c.uuid_versao,
        itens_pedido: itens.total,
        alterado: true
      });
    }

    return resultado;
  });
};

// EXCLUSÃO EM CASCATA, e o rastro é UM EVENTO POR LINHA APAGADA.
//
// Apagar um produto apaga as versões dele, os arquivos dessas versões, os
// downloads e os relacionamentos, e nenhum schema Joi põe teto nisso. Um evento
// agregado com a contagem ("apagou 1 produto") não permitiria conferir nem
// desfazer nada: quem pergunta depois quer saber QUAL folha se perdeu. O
// `loteId` do contexto é o que impede a tela de virar 400 linhas iguais: ela
// mostra uma, que abre.
//
// A ORDEM de registro segue a ordem de exclusão, e ela importa: o agregado do
// arquivo e do relacionamento é resolvido lendo `acervo.versao`, então os dois
// têm de ser registrados enquanto a versão ainda existe.
controller.deleteProdutos = async (produtoIds, motivo_exclusao, usuarioUuid, contexto) => {
  const data_delete = new Date();
  const usuario_delete_uuid = usuarioUuid;

  return db.conn.tx(async t => {
    // Verificar se todos os IDs de produto existem
    const existingProducts = await t.any(
      `SELECT id FROM acervo.produto WHERE id IN ($1:csv)`,
      [produtoIds]
    );

    if (existingProducts.length !== produtoIds.length) {
      // BIGSERIAL retorna como string no driver, normalizar para número
      const existingIds = existingProducts.map(p => Number(p.id));
      const missingIds = produtoIds.filter(id => !existingIds.includes(parseInt(id)));
      throw new AppError(`Os seguintes produtos não foram encontrados: ${missingIds.join(', ')}`, httpCode.NotFound);
    }

    // Versões referenciadas por pedidos da mapoteca bloqueiam a exclusão (FK).
    // Checar antes para devolver mensagem orientativa em vez de erro de FK.
    const pedidosVinculados = await t.any(
      `SELECT DISTINCT COALESCE(ped.localizador_pedido, ped.id::text) AS pedido
       FROM mapoteca.produto_pedido pp
       JOIN acervo.versao v ON v.uuid_versao = pp.uuid_versao
       JOIN mapoteca.pedido ped ON ped.id = pp.pedido_id
       WHERE v.produto_id IN ($1:csv)`,
      [produtoIds]
    );

    if (pedidosVinculados.length > 0) {
      const pedidos = pedidosVinculados.map(p => p.pedido).join(', ');
      throw new AppError(
        `Não é possível excluir: há versões vinculadas a pedidos da mapoteca (${pedidos}). Remova antes os itens desses pedidos.`,
        httpCode.BadRequest
      );
    }

    // A linha inteira de cada produto, com a geometria em EWKT. Uma consulta por
    // produto, e não uma só para todos: `lerAntes` é o único lugar que sabe
    // trocar o WKB pelo EWKT, e reescrever essa regra aqui a colocaria em dois
    // lugares. A conferência de existência acima já garante que nenhuma delas
    // levanta 404, e ela continua sendo quem lista TODOS os ids que faltam.
    const produtosAntes = [];
    for (const id of produtoIds) {
      produtosAntes.push(await auditoriaCtrl.lerAntes(t, 'acervo.produto', id, 'Produto'));
    }

    // `SELECT *` porque estas linhas são o `dados_antes` das versões apagadas.
    const versoes = await t.any(
      'SELECT * FROM acervo.versao WHERE produto_id IN ($<produtoIds:csv>)',
      { produtoIds }
    );
    const versaoIds = versoes.map(v => Number(v.id));

    // Os arquivos saem primeiro, e `arquivarArquivos` registra o evento de cada
    // um a partir da própria lápide.
    const arquivoIds = await idsDosArquivosDasVersoes(t, versaoIds);
    await arquivarArquivos(t, arquivoIds, {
      motivo: motivo_exclusao,
      dataDelete: data_delete,
      usuarioDeleteUuid: usuario_delete_uuid,
      contexto
    });

    if (versaoIds.length > 0) {
      const relacionamentos = await t.any(
        `DELETE FROM acervo.versao_relacionamento
         WHERE versao_id_1 IN ($<versaoIds:csv>) OR versao_id_2 IN ($<versaoIds:csv>)
         RETURNING *`,
        { versaoIds }
      );
      await registraRelacionamentosApagados(t, relacionamentos, { motivo_exclusao, usuarioUuid, contexto });

      await t.none('DELETE FROM acervo.versao WHERE id IN ($<versaoIds:csv>)', { versaoIds });
      for (const versao of versoes) {
        await auditoriaCtrl.registrar(t, {
          tabela: 'acervo.versao',
          registroId: versao.id,
          operacao: 'D',
          antes: versao,
          usuarioUuid,
          contexto,
          motivo: motivo_exclusao
        });
      }
    }

    await t.none('DELETE FROM acervo.produto WHERE id IN ($<produtoIds:csv>)', { produtoIds });

    for (const produto of produtosAntes) {
      await auditoriaCtrl.registrar(t, {
        tabela: 'acervo.produto',
        registroId: produto.id,
        operacao: 'D',
        antes: produto,
        usuarioUuid,
        contexto,
        motivo: motivo_exclusao
      });
    }
  });
};

/**
 * Os eventos dos relacionamentos que caíram junto com as versões.
 *
 * Aqui o agregado NÃO é passado pronto, ao contrário do arquivo: o
 * relacionamento liga duas versões que costumam ser de produtos diferentes (é o
 * caso do insumo), e a `versao_id_1` pode estar fora do conjunto que está sendo
 * apagado. Quem resolve é a função `agregado` do mapa, que lê a versão, e ela
 * ainda existe neste ponto, porque o DELETE da versão vem depois. São poucas
 * linhas por exclusão, então a consulta por linha não pesa como pesaria nos
 * arquivos.
 */
const registraRelacionamentosApagados = async (t, relacionamentos, { motivo_exclusao, usuarioUuid, contexto }) => {
  for (const rel of relacionamentos) {
    await auditoriaCtrl.registrar(t, {
      tabela: 'acervo.versao_relacionamento',
      registroId: rel.id,
      operacao: 'D',
      antes: rel,
      usuarioUuid,
      contexto,
      motivo: motivo_exclusao
    });
  }
};

controller.deleteVersoes = async (versaoIds, motivo_exclusao, usuarioUuid, contexto) => {
  const data_delete = new Date();
  const usuario_delete_uuid = usuarioUuid;

  return db.conn.tx(async t => {
    // Verificar se todos os IDs de versão existem
    const existingVersions = await t.any(
      `SELECT id FROM acervo.versao WHERE id IN ($1:csv)`,
      [versaoIds]
    );

    if (existingVersions.length !== versaoIds.length) {
      const existingIds = existingVersions.map(v => Number(v.id));
      const missingIds = versaoIds.filter(id => !existingIds.includes(parseInt(id)));
      throw new AppError(`As seguintes versões não foram encontradas: ${missingIds.join(', ')}`, httpCode.NotFound);
    }

    // Versões referenciadas por pedidos da mapoteca bloqueiam a exclusão (FK).
    // Checar antes para devolver mensagem orientativa em vez de erro de FK.
    const pedidosVinculados = await t.any(
      `SELECT DISTINCT COALESCE(ped.localizador_pedido, ped.id::text) AS pedido
       FROM mapoteca.produto_pedido pp
       JOIN acervo.versao v ON v.uuid_versao = pp.uuid_versao
       JOIN mapoteca.pedido ped ON ped.id = pp.pedido_id
       WHERE v.id IN ($1:csv)`,
      [versaoIds]
    );

    if (pedidosVinculados.length > 0) {
      const pedidos = pedidosVinculados.map(p => p.pedido).join(', ');
      throw new AppError(
        `Não é possível excluir: as versões estão vinculadas a pedidos da mapoteca (${pedidos}). Remova antes os itens desses pedidos.`,
        httpCode.BadRequest
      );
    }

    // As linhas inteiras, guardadas para o `dados_antes`. Os dois laços abaixo já
    // liam cada versão com `SELECT *`; agora a leitura acontece UMA vez e os dois
    // usam o que ela trouxe, em vez de duas idas ao banco por versão.
    const versoesAntes = new Map();
    for (const id of versaoIds) {
      versoesAntes.set(
        Number(id),
        await t.one('SELECT * FROM acervo.versao WHERE id = $1', [id])
      );
    }

    // Verificar se alguma versão possui versões posteriores que dependem dela (formato X-SIGLA)
    for (let id of versaoIds) {
      const versao = versoesAntes.get(Number(id));

      // Verificar formato novo "X-SIGLA"
      const match = versao.versao.match(/^(\d+)-([A-Z]{1,5})$/);
      if (match) {
        const versionNumber = parseInt(match[1]);
        const acronym = match[2];
        const nextVersion = `${versionNumber + 1}-${acronym}`;

        // Verificar se existe versão posterior que depende desta
        const dependente = await t.oneOrNone(
          `SELECT id FROM acervo.versao
           WHERE produto_id = $1 AND versao = $2 AND id NOT IN ($3:csv)`,
          [versao.produto_id, nextVersion, versaoIds]
        );

        if (dependente) {
          throw new AppError(
            `Não é possível excluir a versão "${versao.versao}" pois a versão "${nextVersion}" depende dela. Exclua as versões posteriores primeiro.`,
            httpCode.BadRequest
          );
        }
      }
    }

    // Produto não pode ficar SEM VERSÃO NENHUMA.
    //
    // A conta é sobre o que SOBRA, e não sobre o que existe hoje. Contando o que
    // existe, apagar as DUAS versões de um produto de duas passava: cada volta
    // via `count = 2`, nenhuma reprovava, e o produto terminava sem versão -- o
    // estado exato que esta guarda existe para impedir. A guarda só pegava o
    // caso de uma versão só, que é o caso fácil.
    const produtosAfetados = [
      ...new Set([...versoesAntes.values()].map(v => String(v.produto_id)))
    ];

    for (const produtoId of produtosAfetados) {
      const restantes = await t.one(
        `SELECT COUNT(*)::int AS n FROM acervo.versao
         WHERE produto_id = $<produtoId> AND id NOT IN ($<versaoIds:csv>)`,
        { produtoId, versaoIds }
      );

      if (restantes.n === 0) {
        const rotulos = [...versoesAntes.values()]
          .filter(v => String(v.produto_id) === produtoId)
          .map(v => v.versao)
          .join(', ');
        throw new AppError(
          `Não é possível excluir a versão ${rotulos} pois é a única versão do produto. Delete o produto inteiro.`,
          httpCode.BadRequest
        );
      }
    }

    const arquivoIds = await idsDosArquivosDasVersoes(t, versaoIds);
    await arquivarArquivos(t, arquivoIds, {
      motivo: motivo_exclusao,
      dataDelete: data_delete,
      usuarioDeleteUuid: usuario_delete_uuid,
      contexto
    });

    const relacionamentos = await t.any(
      `DELETE FROM acervo.versao_relacionamento
       WHERE versao_id_1 IN ($<versaoIds:csv>) OR versao_id_2 IN ($<versaoIds:csv>)
       RETURNING *`,
      { versaoIds }
    );
    await registraRelacionamentosApagados(t, relacionamentos, { motivo_exclusao, usuarioUuid, contexto });

    await t.none('DELETE FROM acervo.versao WHERE id IN ($<versaoIds:csv>)', { versaoIds });

    for (const versao of versoesAntes.values()) {
      await auditoriaCtrl.registrar(t, {
        tabela: 'acervo.versao',
        registroId: versao.id,
        operacao: 'D',
        antes: versao,
        usuarioUuid,
        contexto,
        motivo: motivo_exclusao
      });
    }
  });
};

controller.moverArquivos = async (arquivoIds, versaoIdDestino, usuarioUuid, permitirEntreProdutos = false, permitirEsvaziarOrigem = false, contexto) => {
  return db.conn.tx(async t => {
    // Versao de destino existe?
    const destino = await t.oneOrNone(
      'SELECT id, produto_id FROM acervo.versao WHERE id = $1',
      [versaoIdDestino]
    );
    if (!destino) {
      throw new AppError(`Versão de destino ${versaoIdDestino} não encontrada`, httpCode.NotFound);
    }

    // Todos os arquivos existem? `SELECT *` porque estas linhas são o
    // `dados_antes` do movimento, pela mesma ida ao banco.
    const arquivos = await t.any(
      'SELECT * FROM acervo.arquivo WHERE id IN ($1:csv)',
      [arquivoIds]
    );
    if (arquivos.length !== arquivoIds.length) {
      const achados = arquivos.map(a => Number(a.id));
      const faltando = arquivoIds.filter(id => !achados.includes(parseInt(id)));
      throw new AppError(`Arquivos não encontrados: ${faltando.join(', ')}`, httpCode.NotFound);
    }

    // Algum ja esta no destino?
    const jaNoDestino = arquivos.filter(a => Number(a.versao_id) === Number(versaoIdDestino));
    if (jaNoDestino.length > 0) {
      throw new AppError(
        `Arquivo(s) já pertencem à versão de destino: ${jaNoDestino.map(a => a.id).join(', ')}`,
        httpCode.BadRequest
      );
    }

    // Por padrao, so entre versoes do MESMO produto. Cross-produto exige opt-in explicito
    // (correcao de arquivo carregado no produto/tipo errado, ex.: tematica carregada como topo).
    const origemVersaoIds = [...new Set(arquivos.map(a => Number(a.versao_id)))];
    const produtos = await t.any(
      'SELECT DISTINCT produto_id FROM acervo.versao WHERE id IN ($1:csv)',
      [origemVersaoIds]
    );
    const mesmoProduto = produtos.length === 1 && Number(produtos[0].produto_id) === Number(destino.produto_id);
    if (!mesmoProduto && !permitirEntreProdutos) {
      throw new AppError(
        'Só é possível mover arquivos entre versões do mesmo produto (envie permitir_entre_produtos=true para mover entre produtos diferentes)',
        httpCode.BadRequest
      );
    }

    // Nao deixar a versao de origem sem nenhum arquivo, salvo opt-in explicito
    // (uso: a origem vai ser deletada em seguida, ex.: produto carregado so com
    // conteudo do tipo errado, sem nenhum arquivo genuino a manter).
    if (!permitirEsvaziarOrigem) {
      for (const ov of origemVersaoIds) {
        const total = await t.one(
          'SELECT COUNT(*)::int AS n FROM acervo.arquivo WHERE versao_id = $1',
          [ov]
        );
        const movidosDessa = arquivos.filter(a => Number(a.versao_id) === ov).length;
        if (total.n - movidosDessa < 1) {
          throw new AppError(
            `A operação deixaria a versão ${ov} sem arquivos. Para remover a versão, use o delete de versão, ou envie permitir_esvaziar_origem=true se a versão/produto de origem será deletado a seguir.`,
            httpCode.BadRequest
          );
        }
      }
    }

    // Respeitar unique_file_per_version (checksum, versao_id) no destino
    for (const a of arquivos) {
      const colide = await t.oneOrNone(
        'SELECT id FROM acervo.arquivo WHERE versao_id = $1 AND checksum = $2',
        [versaoIdDestino, a.checksum]
      );
      if (colide) {
        throw new AppError(
          `A versão de destino já possui um arquivo com o mesmo checksum (arquivo ${colide.id})`,
          httpCode.Conflict
        );
      }
    }

    // Mover
    const data_modificacao = new Date();
    const movidos = await t.any(
      `UPDATE acervo.arquivo
       SET versao_id = $1, data_modificacao = $2, usuario_modificacao_uuid = $3
       WHERE id IN ($4:csv)
       RETURNING *`,
      [versaoIdDestino, data_modificacao, usuarioUuid, arquivoIds]
    );

    // O produto de ORIGEM de cada arquivo, resolvido numa consulta só.
    const produtoPorVersao = new Map(
      (await t.any(
        'SELECT id, produto_id FROM acervo.versao WHERE id IN ($1:csv)',
        [[...origemVersaoIds, Number(versaoIdDestino)]]
      )).map(v => [String(v.id), String(v.produto_id)])
    );

    const antesPorId = new Map(arquivos.map(a => [String(a.id), a]));

    for (const depois of movidos) {
      const antes = antesPorId.get(String(depois.id));
      const produtoOrigem = produtoPorVersao.get(String(antes.versao_id));
      const produtoDestino = String(destino.produto_id);

      // O evento nasce na ficha do produto de DESTINO, que é onde o arquivo
      // passou a estar e onde alguém vai encontrá-lo.
      await auditoriaCtrl.registrar(t, {
        tabela: 'acervo.arquivo',
        registroId: depois.id,
        operacao: 'U',
        antes,
        depois,
        usuarioUuid,
        contexto,
        entidadeId: produtoDestino
      });

      // Mover ENTRE PRODUTOS é opt-in explícito e raro, e é o caso em que um
      // evento só não basta: o produto de origem perdeu um arquivo, e a ficha
      // dele não teria como dizer para onde ele foi. O segundo evento tem o
      // mesmo `registro_id` e o mesmo `lote_id`, então a tela os mostra como o
      // movimento único que eles são.
      if (produtoOrigem && produtoOrigem !== produtoDestino) {
        await auditoriaCtrl.registrar(t, {
          tabela: 'acervo.arquivo',
          registroId: depois.id,
          operacao: 'U',
          antes,
          depois,
          usuarioUuid,
          contexto,
          entidadeId: produtoOrigem
        });
      }
    }
  });
};

// Regex e sufixo de rotulo para cada familia de numeracao de versao (espelha
// acervo.validate_version: "Nª Edição" legado, ou "N-SIGLA" produzido por orgao).
function familiaVersao(familia) {
  if (familia === 'EDICAO') {
    return { regex: /^([0-9]+)ª Edição$/, sufixo: 'ª Edição' };
  }
  return { regex: new RegExp(`^([0-9]+)-${familia}$`), sufixo: `-${familia}` };
}

controller.renumeraVersoes = async (produtoId, subtipoProdutoId, familia, novaDataEdicao, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const produto = await t.oneOrNone('SELECT id FROM acervo.produto WHERE id = $1', [produtoId]);
    if (!produto) {
      throw new AppError(`Produto ${produtoId} não encontrado`, httpCode.NotFound);
    }

    // `SELECT *` porque a linha inteira vira o `dados_antes` de cada versão
    // deslocada: o rótulo muda debaixo de quem não pediu nada a ela, e sem o
    // estado anterior não haveria como saber que "2ª Edição" já foi a 1ª.
    const versoes = await t.any(
      `SELECT * FROM acervo.versao
       WHERE produto_id = $1 AND subtipo_produto_id = $2`,
      [produtoId, subtipoProdutoId]
    );

    const { regex, sufixo } = familiaVersao(familia);
    const daFamilia = versoes
      .map(v => {
        const m = regex.exec(v.versao);
        return m ? { id: v.id, numero: parseInt(m[1], 10), data_edicao: v.data_edicao, linha: v } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.numero - b.numero);

    // Posicao de insercao pela DATA (nunca pelo numero atual, que pode ja estar
    // errado): conta quantas versoes da familia sao mais antigas que a nova.
    const novaData = new Date(novaDataEdicao);
    let numeroNovaEdicao = 1;
    for (const v of daFamilia) {
      if (new Date(v.data_edicao) < novaData) {
        numeroNovaEdicao++;
      } else {
        break;
      }
    }

    // Desloca as que ficam na frente (numero >= numeroNovaEdicao), da MAIOR
    // pra MENOR, pra nunca colidir com unique_version_per_product em transito.
    const aDeslocar = daFamilia
      .filter(v => v.numero >= numeroNovaEdicao)
      .sort((a, b) => b.numero - a.numero);

    const data_modificacao = new Date();
    const deslocadas = [];
    for (const v of aDeslocar) {
      const rotuloNovo = `${v.numero + 1}${sufixo}`;
      const depois = await t.one(
        `UPDATE acervo.versao SET versao = $1, data_modificacao = $2, usuario_modificacao_uuid = $3 WHERE id = $4 RETURNING *`,
        [rotuloNovo, data_modificacao, usuarioUuid, v.id]
      );

      await auditoriaCtrl.registrar(t, {
        tabela: 'acervo.versao',
        registroId: v.id,
        operacao: 'U',
        antes: v.linha,
        depois,
        usuarioUuid,
        contexto
      });

      deslocadas.push({ id: v.id, rotulo_antigo: `${v.numero}${sufixo}`, rotulo_novo: rotuloNovo });
    }

    return {
      familia,
      rotulo_livre: `${numeroNovaEdicao}${sufixo}`,
      versoes_deslocadas: deslocadas
    };
  });
};

controller.getVersaoRelacionamento = async () => {
  return db.conn.any(
    `SELECT 
      vr.id, vr.versao_id_1, vr.versao_id_2, vr.tipo_relacionamento_id, 
      vr.data_relacionamento, vr.usuario_relacionamento_uuid,
      tr.nome AS tipo_relacionamento_nome,
      v1.versao AS versao_1_nome, v1.produto_id AS produto_id_1,
      p1.nome AS produto_nome_1, p1.mi AS mi_1, p1.inom AS inom_1,
      v2.versao AS versao_2_nome, v2.produto_id AS produto_id_2,
      p2.nome AS produto_nome_2, p2.mi AS mi_2, p2.inom AS inom_2
     FROM acervo.versao_relacionamento vr
     INNER JOIN dominio.tipo_relacionamento tr ON vr.tipo_relacionamento_id = tr.code
     INNER JOIN acervo.versao v1 ON vr.versao_id_1 = v1.id
     INNER JOIN acervo.versao v2 ON vr.versao_id_2 = v2.id
     INNER JOIN acervo.produto p1 ON v1.produto_id = p1.id
     INNER JOIN acervo.produto p2 ON v2.produto_id = p2.id`
  );
};

// Função auxiliar para verificar ciclos em relacionamentos
async function verificaCicloRelacionamento(t, versaoId1, versaoId2, tipoRelacionamentoId) {
  // Implementação de busca em profundidade (DFS) para detectar ciclos
  const visitados = new Set();
  const pilha = new Set();
  
  async function dfs(versaoAtual) {
    visitados.add(versaoAtual);
    pilha.add(versaoAtual);
    
    // Buscar todos os relacionamentos onde a versão atual é origem
    const relacionamentos = await t.any(
      `SELECT versao_id_2 FROM acervo.versao_relacionamento 
       WHERE versao_id_1 = $1 AND tipo_relacionamento_id = $2`,
      [versaoAtual, tipoRelacionamentoId]
    );
    
    for (const rel of relacionamentos) {
      // BIGINT chega como string do driver, normalizar para comparar
      const vizinho = Number(rel.versao_id_2);

      // Se encontramos a versão que queremos adicionar, há um ciclo
      if (vizinho === Number(versaoId1)) {
        return true;
      }
      
      // Se o vizinho está na pilha, há um ciclo
      if (pilha.has(vizinho)) {
        return true;
      }
      
      // Se ainda não visitamos, continuar DFS
      if (!visitados.has(vizinho)) {
        const temCiclo = await dfs(vizinho);
        if (temCiclo) return true;
      }
    }
    
    pilha.delete(versaoAtual);
    return false;
  }
  
  // Começar DFS da versaoId2 (normalizado: vizinhos do DFS são Number)
  return await dfs(Number(versaoId2));
}

controller.criaVersaoRelacionamento = async (versaoRelacionamentos, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    for (const item of versaoRelacionamentos) {
      item.usuario_relacionamento_uuid = usuarioUuid;

      // Verificar se as versões existem
      const versao1 = await t.oneOrNone(
        'SELECT id, produto_id FROM acervo.versao WHERE id = $1',
        [item.versao_id_1]
      );

      const versao2 = await t.oneOrNone(
        'SELECT id, produto_id FROM acervo.versao WHERE id = $1',
        [item.versao_id_2]
      );

      if (!versao1 || !versao2) {
        throw new AppError('Uma ou ambas as versões não foram encontradas', httpCode.NotFound);
      }

      // Verificar se o relacionamento já existe
      const relacionamentoExistente = await t.oneOrNone(
        `SELECT id FROM acervo.versao_relacionamento
         WHERE ((versao_id_1 = $1 AND versao_id_2 = $2) OR (versao_id_1 = $2 AND versao_id_2 = $1))
         AND tipo_relacionamento_id = $3`,
        [item.versao_id_1, item.versao_id_2, item.tipo_relacionamento_id]
      );

      if (relacionamentoExistente) {
        throw new AppError(`Relacionamento já existe entre as versões ${item.versao_id_1} e ${item.versao_id_2}`, httpCode.Conflict);
      }

      // Verificar auto-relacionamento
      if (item.versao_id_1 === item.versao_id_2) {
        throw new AppError('Uma versão não pode ter relacionamento consigo mesma', httpCode.BadRequest);
      }

      // Verificar ciclos para relacionamentos do tipo "Insumo" (tipo 1)
      if (item.tipo_relacionamento_id === TIPO_RELACIONAMENTO.INSUMO) {
        const temCiclo = await verificaCicloRelacionamento(
          t, item.versao_id_1, item.versao_id_2, item.tipo_relacionamento_id
        );

        if (temCiclo) {
          throw new AppError('Este relacionamento criaria um ciclo de dependências', httpCode.BadRequest);
        }
      }

      const cs = new db.pgp.helpers.ColumnSet([
        'versao_id_1', 'versao_id_2', 'tipo_relacionamento_id', 'usuario_relacionamento_uuid'
      ]);

      const query = db.pgp.helpers.insert(item, cs, {
        table: 'versao_relacionamento',
        schema: 'acervo'
      }) + ' RETURNING *';

      const criado = await t.one(query);

      await auditoriaCtrl.registrar(t, {
        tabela: 'acervo.versao_relacionamento',
        registroId: criado.id,
        operacao: 'I',
        depois: criado,
        usuarioUuid,
        contexto
      });
    }
  });
};

controller.atualizaVersaoRelacionamento = async (versaoRelacionamentos, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    for (const item of versaoRelacionamentos) {
      item.usuario_relacionamento_uuid = usuarioUuid;

      // Verificar se o relacionamento existe
      const relacionamentoAtual = await t.oneOrNone(
        'SELECT * FROM acervo.versao_relacionamento WHERE id = $1',
        [item.id]
      );

      if (!relacionamentoAtual) {
        throw new AppError(`Relacionamento ${item.id} não encontrado`, httpCode.NotFound);
      }

      // Se estiver mudando as versões ou tipo, fazer as mesmas validações
      // (BIGINT retorna como string no driver, comparar como número)
      if (Number(relacionamentoAtual.versao_id_1) !== Number(item.versao_id_1) ||
          Number(relacionamentoAtual.versao_id_2) !== Number(item.versao_id_2) ||
          Number(relacionamentoAtual.tipo_relacionamento_id) !== Number(item.tipo_relacionamento_id)) {

        // Verificar se as versões existem
        const versao1 = await t.oneOrNone(
          'SELECT id FROM acervo.versao WHERE id = $1',
          [item.versao_id_1]
        );

        const versao2 = await t.oneOrNone(
          'SELECT id FROM acervo.versao WHERE id = $1',
          [item.versao_id_2]
        );

        if (!versao1 || !versao2) {
          throw new AppError('Uma ou ambas as versões não foram encontradas', httpCode.NotFound);
        }

        // Verificar se o novo relacionamento já existe
        const relacionamentoExistente = await t.oneOrNone(
          `SELECT id FROM acervo.versao_relacionamento
           WHERE ((versao_id_1 = $1 AND versao_id_2 = $2) OR (versao_id_1 = $2 AND versao_id_2 = $1))
           AND tipo_relacionamento_id = $3
           AND id != $4`,
          [item.versao_id_1, item.versao_id_2, item.tipo_relacionamento_id, item.id]
        );

        if (relacionamentoExistente) {
          throw new AppError(`Relacionamento já existe entre as versões ${item.versao_id_1} e ${item.versao_id_2}`, httpCode.Conflict);
        }

        // Verificar auto-relacionamento
        if (item.versao_id_1 === item.versao_id_2) {
          throw new AppError('Uma versão não pode ter relacionamento consigo mesma', httpCode.BadRequest);
        }

        // Verificar ciclos para relacionamentos do tipo "Insumo" (tipo 1)
        if (item.tipo_relacionamento_id === TIPO_RELACIONAMENTO.INSUMO) {
          // Temporariamente remover o relacionamento atual para verificar ciclos
          await t.none('DELETE FROM acervo.versao_relacionamento WHERE id = $1', [item.id]);

          const temCiclo = await verificaCicloRelacionamento(
            t, item.versao_id_1, item.versao_id_2, item.tipo_relacionamento_id
          );

          // Restaurar o relacionamento
          await t.none(
            `INSERT INTO acervo.versao_relacionamento
             (id, versao_id_1, versao_id_2, tipo_relacionamento_id, usuario_relacionamento_uuid, data_relacionamento)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [relacionamentoAtual.id, relacionamentoAtual.versao_id_1, relacionamentoAtual.versao_id_2,
             relacionamentoAtual.tipo_relacionamento_id, relacionamentoAtual.usuario_relacionamento_uuid,
             relacionamentoAtual.data_relacionamento]
          );

          if (temCiclo) {
            throw new AppError('Este relacionamento criaria um ciclo de dependências', httpCode.BadRequest);
          }
        }
      }

      // UPDATE parametrizado simples: helpers.update com objeto único ignora
      // os aliases e gerava SQL inválido (WHERE Y.id = X.id sem FROM)
      const depois = await t.one(
        `UPDATE acervo.versao_relacionamento
         SET versao_id_1 = $2,
             versao_id_2 = $3,
             tipo_relacionamento_id = $4,
             usuario_relacionamento_uuid = $5
         WHERE id = $1
         RETURNING *`,
        [item.id, item.versao_id_1, item.versao_id_2, item.tipo_relacionamento_id, usuarioUuid]
      );

      await auditoriaCtrl.registrar(t, {
        tabela: 'acervo.versao_relacionamento',
        registroId: item.id,
        operacao: 'U',
        antes: relacionamentoAtual,
        depois,
        usuarioUuid,
        contexto
      });
    }
  });
};

controller.deleteVersaoRelacionamento = async (versaoRelacionamentoIds, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    // `SELECT *` porque estas linhas são o `dados_antes` da exclusão, pela mesma
    // ida ao banco que a conferência de existência já custava.
    const exists = await t.any(
      `SELECT * FROM acervo.versao_relacionamento
      WHERE id in ($<versaoRelacionamentoIds:csv>)`,
      { versaoRelacionamentoIds }
    );

    if (exists && exists.length < versaoRelacionamentoIds.length) {
      throw new AppError(
        'O id informado não corresponde a uma entrada do Versão Relacionamento',
        httpCode.BadRequest
      );
    }

    // `t.none`, e não `t.any`: o DELETE sem RETURNING não devolve linha nenhuma,
    // então o valor devolvido era sempre um array vazio, e devolvê-lo como se
    // fosse a lista dos apagados afirmava o contrário do que acontecia. Quem
    // chama já ignora o retorno; a lista de verdade é `exists`.
    await t.none(
      `DELETE FROM acervo.versao_relacionamento
      WHERE id in ($<versaoRelacionamentoIds:csv>)`,
      { versaoRelacionamentoIds }
    );

    for (const rel of exists) {
      await auditoriaCtrl.registrar(t, {
        tabela: 'acervo.versao_relacionamento',
        registroId: rel.id,
        operacao: 'D',
        antes: rel,
        usuarioUuid,
        contexto
      });
    }
  });
};

// Cria versao SEM arquivo num produto que JA EXISTE, e o tipoVersaoId e o que
// separa os dois casos legitimos, exatamente como em criaProdutoComVersoes:
//   REGISTRO_HISTORICO: a edicao existe no mundo e o acervo a registra sem ter o
//     arquivo (carga do acervo legado).
//   PLANEJADA: a edicao ainda NAO existe, e o acervo a registra para o item do
//     pedido poder apontar para ela.
// O corpo e um so porque a diferenca entre os dois e um inteiro: duplicar aqui
// seria pedir que a proxima coluna de acervo.versao fosse lembrada em dois
// lugares, e esquecer um nao da erro nenhum.
const criaVersoesEmProduto = async (versoes, usuarioUuid, tipoVersaoId, contexto) => {
  const data_cadastramento = new Date();

  const versoesPreparadas = versoes.map(versao => {
    return {
      ...versao,
      uuid_versao: versao.uuid_versao || uuidv4(),
      data_cadastramento: data_cadastramento,
      usuario_cadastramento_uuid: usuarioUuid,
      tipo_versao_id: tipoVersaoId,
    };
  });

  return db.conn.tx(async t => {
    // Espelha a UNIQUE unique_version_per_product com erro amigável
    // (duplicatas dentro do payload e contra o banco).
    //
    // O SUBTIPO faz PARTE da chave: a constraint é
    // (produto_id, versao, subtipo_produto_id). Omitindo-o aqui, esta guarda era
    // mais rígida que a constraint que ela diz espelhar, e recusava com 409 o
    // caso legítimo do produto que tem a Carta Ortoimagem SCN e a Especial, as
    // duas rotuladas "1ª Edição". É o mesmo defeito já corrigido em
    // `atualizaVersao`; ele tinha sobrado neste caminho.
    const chaves = versoesPreparadas.map(v => `${v.produto_id}|${v.versao}|${v.subtipo_produto_id}`);
    const duplicadas = chaves.filter((c, i) => chaves.indexOf(c) !== i);
    if (duplicadas.length > 0) {
      throw new AppError(
        `A requisição contém versões duplicadas para o mesmo produto: ${[...new Set(duplicadas)].join(', ')}`,
        httpCode.BadRequest
      );
    }

    // O produto tem de existir ANTES do INSERT.
    //
    // Sem esta conferência, `produto_id` inexistente estourava a chave
    // estrangeira e virava 500 com a mensagem genérica -- que é a resposta que o
    // servidor dá quando ELE errou, e aqui quem errou foi quem chamou. Quem
    // recebia o 500 não tinha como saber que o problema era o id do produto.
    //
    // Em lote, o SELECT é um só: um por versão custaria uma ida ao banco por
    // linha para provar o que uma consulta prova de uma vez.
    const produtoIds = [...new Set(versoesPreparadas.map(v => Number(v.produto_id)))];
    const existentes = await t.any(
      'SELECT id FROM acervo.produto WHERE id IN ($<produtoIds:csv>)',
      { produtoIds }
    );
    const achados = new Set(existentes.map(p => Number(p.id)));
    const faltando = produtoIds.filter(id => !achados.has(id));
    if (faltando.length > 0) {
      throw new AppError(
        faltando.length === 1
          ? `Produto ${faltando[0]} não encontrado`
          : `Produtos não encontrados: ${faltando.join(', ')}`,
        httpCode.NotFound
      );
    }

    for (const v of versoesPreparadas) {
      const versaoExistente = await t.oneOrNone(
        `SELECT id FROM acervo.versao
         WHERE produto_id = $1 AND versao = $2 AND subtipo_produto_id = $3`,
        [v.produto_id, v.versao, v.subtipo_produto_id]
      );
      if (versaoExistente) {
        throw new AppError(
          `Já existe a versão "${v.versao}" (subtipo ${v.subtipo_produto_id}) para o produto ${v.produto_id}`,
          httpCode.Conflict
        );
      }
    }

    // O VÍNCULO COM O PLANO ANUAL entra já na criação, e não numa edição
    // depois. É o que faz o fluxo guiado da tela de metas ser um passo só: a
    // folha nasce cumprindo a meta e prometendo o mês.
    //
    // As três GRAVAM aqui desde 2026-08-05. Antes o schema nem as aceitava, e o
    // `schemaValidation` tolerante as descartava: a pessoa escolhia a meta,
    // recebia 201, e a versão nascia fora da conta do PIT.
    //
    // `def: null` nas três porque elas são opcionais no schema, e o corpo que as
    // omite não pode estourar o "Property doesn't exist" do pg-promise.
    const cs = new db.pgp.helpers.ColumnSet([
      'uuid_versao', 'versao', 'nome', 'produto_id', 'lote_id', 'metadado', 'descricao',
      'orgao_produtor', 'palavras_chave',
      'data_criacao', 'data_edicao', 'tipo_versao_id', 'subtipo_produto_id',
      { name: 'meta_pit_id', def: null },
      { name: 'demanda_extra_id', def: null },
      { name: 'data_prevista', cast: 'date', def: null },
      'data_cadastramento', 'usuario_cadastramento_uuid'
    ], { table: { table: 'versao', schema: 'acervo' } });

    // O INSERT multi-linha não devolvia NADA: o id das versões criadas não
    // existia no JavaScript, e sem id não há `registro_id`. `RETURNING *` num
    // insert de várias linhas devolve uma linha por versão, na mesma ida ao
    // banco. A resposta da rota não muda: ela nunca devolveu dados.
    const query = db.pgp.helpers.insert(versoesPreparadas, cs) + ' RETURNING *';

    const criadas = await t.any(query);

    for (const criada of criadas) {
      await auditoriaCtrl.registrar(t, {
        tabela: 'acervo.versao',
        registroId: criada.id,
        operacao: 'I',
        depois: criada,
        usuarioUuid,
        contexto
      });
    }
  });
};

controller.criaVersaoHistorica = async (versoes, usuarioUuid, contexto) =>
  criaVersoesEmProduto(versoes, usuarioUuid, TIPO_VERSAO.REGISTRO_HISTORICO, contexto);

controller.criaVersaoPlanejada = async (versoes, usuarioUuid, contexto) =>
  criaVersoesEmProduto(versoes, usuarioUuid, TIPO_VERSAO.PLANEJADA, contexto);

// Cria produto e versoes SEM arquivo, numa transacao. Serve aos dois casos em
// que isso e legitimo, e o tipoVersaoId e o que os separa:
//   REGISTRO_HISTORICO: a folha existe no mundo e o acervo a registra sem ter o
//     arquivo (carga do acervo legado).
//   PLANEJADA: a folha ainda NAO existe, e o acervo a registra para o item do
//     pedido poder apontar para ela. O arquivo entra nesta MESMA versao quando a
//     producao terminar, e ai o item vira imprimivel sozinho.
// Nao ha terceiro caso: versao Regular nasce do fluxo de carregamento, com
// arquivo, e nunca por aqui.
const criaProdutoComVersoes = async (produtos, usuarioUuid, tipoVersaoId, contexto) => {
  const data_cadastramento = new Date();

  return db.conn.tx(async t => {
    for (const produto of produtos) {
      // A identidade é conferida ANTES do INSERT, e não deixada para o índice
      // único estourar: o estouro não diz qual produto já ocupa a identidade,
      // e no lote ele derruba a transação inteira depois de tudo preenchido.
      await conferirIdentidadeLivre(t, produto);

      // Inserir o produto
      const [novoProduto] = await t.any(`
        INSERT INTO acervo.produto(nome, mi, inom, tipo_escala_id, denominador_escala_especial, tipo_produto_id, subtipo_produto_id, descricao, geom, data_cadastramento, usuario_cadastramento_uuid)
        VALUES($1, $2, $3, $4, $5, $6, $7, $8, ST_GeomFromEWKT($9), $10, $11)
        RETURNING id
      `, [produto.nome, produto.mi, produto.inom, produto.tipo_escala_id, produto.denominador_escala_especial, produto.tipo_produto_id, produto.subtipo_produto_id ?? null, produto.descricao, produto.geom, data_cadastramento, usuarioUuid]);

      await auditoriaCtrl.registrar(t, {
        tabela: 'acervo.produto',
        registroId: novoProduto.id,
        operacao: 'I',
        // Relido em vez de `RETURNING *` por causa da geometria: ver o
        // comentário no topo deste arquivo.
        depois: await auditoriaCtrl.lerDepois(t, 'acervo.produto', novoProduto.id),
        usuarioUuid,
        contexto
      })

      // Preparar e inserir as versões
      const versoesPreparadas = produto.versoes.map(versao => ({
        ...versao,
        uuid_versao: versao.uuid_versao || uuidv4(),
        produto_id: novoProduto.id,
        data_cadastramento: data_cadastramento,
        usuario_cadastramento_uuid: usuarioUuid,
        tipo_versao_id: tipoVersaoId
      }));

      // Mesmo trio do outro caminho de criação, e pelo mesmo motivo: a folha
      // nasce já cumprindo a meta e prometendo o mês.
      const cs = new db.pgp.helpers.ColumnSet([
        'uuid_versao', 'versao', 'nome', 'produto_id', 'lote_id', 'metadado', 'descricao',
        'orgao_produtor', 'palavras_chave',
        'data_criacao', 'data_edicao', 'tipo_versao_id', 'subtipo_produto_id',
        { name: 'meta_pit_id', def: null },
        { name: 'data_prevista', cast: 'date', def: null },
        'data_cadastramento', 'usuario_cadastramento_uuid'
      ], { table: { table: 'versao', schema: 'acervo' } });

      const query = db.pgp.helpers.insert(versoesPreparadas, cs) + ' RETURNING *';
      const versoesCriadas = await t.any(query);

      for (const criada of versoesCriadas) {
        await auditoriaCtrl.registrar(t, {
          tabela: 'acervo.versao',
          registroId: criada.id,
          operacao: 'I',
          depois: criada,
          usuarioUuid,
          contexto
        });
      }
    }

  });
};

controller.criaProdutoVersoesHistoricas = async (produtos, usuarioUuid, contexto) =>
  criaProdutoComVersoes(produtos, usuarioUuid, TIPO_VERSAO.REGISTRO_HISTORICO, contexto);

controller.criaProdutoVersoesPlanejadas = async (produtos, usuarioUuid, contexto) =>
  criaProdutoComVersoes(produtos, usuarioUuid, TIPO_VERSAO.PLANEJADA, contexto);

controller.bulkCreateProducts = async (produtos, usuarioUuid, contexto) => {
  const data_cadastramento = new Date();

  return db.conn.tx(async t => {
    for (const produto of produtos) {
      // Mesma conferência do outro caminho de criação: a regra da identidade
      // não pode depender do botão que a pessoa apertou.
      await conferirIdentidadeLivre(t, produto);

      const [novoProduto] = await t.any(`
        INSERT INTO acervo.produto(nome, mi, inom, tipo_escala_id, denominador_escala_especial, tipo_produto_id, subtipo_produto_id, descricao, geom, data_cadastramento, usuario_cadastramento_uuid)
        VALUES($1, $2, $3, $4, $5, $6, $7, $8, ST_GeomFromEWKT($9), $10, $11)
        RETURNING id
      `, [produto.nome, produto.mi, produto.inom, produto.tipo_escala_id, produto.denominador_escala_especial, produto.tipo_produto_id, produto.subtipo_produto_id ?? null, produto.descricao, produto.geom, data_cadastramento, usuarioUuid]);

      await auditoriaCtrl.registrar(t, {
        tabela: 'acervo.produto',
        registroId: novoProduto.id,
        operacao: 'I',
        depois: await auditoriaCtrl.lerDepois(t, 'acervo.produto', novoProduto.id),
        usuarioUuid,
        contexto
      });
    }

  });
};

// Folha do SCN a partir do INOM ou do MI. É o ÚNICO método deste controlador que
// não toca o banco, e é assim de propósito: a folha existe no Sistema
// Cartográfico Nacional esteja ou não catalogada aqui. Quem for cadastrar um
// produto precisa da geometria ANTES de o produto existir, e uma consulta ao
// acervo devolveria "não encontrado" para toda folha ainda não cadastrada, que é
// exatamente o caso de uso.
//
// Toda a regra mora em `utils/scn.js`. Aqui fica só a tradução de "não deu" para
// o status HTTP, porque são três "não deu" bem diferentes e só um é erro.
controller.getFolha = async ({ inom, mi, tipo_escala_id: tipoEscalaId }) => {
  let inomCanonico = inom

  if (mi) {
    inomCanonico = scn.inomDoMi(mi, tipoEscalaId)
    if (!inomCanonico) {
      throw new AppError(
        `Folha de MI "${mi}" não encontrada no Mapa Índice. ` +
        'Nem toda folha do Sistema Cartográfico Nacional tem MI (a numeração ' +
        'cobre só o território brasileiro, e há folhas de fronteira sem número ' +
        'emitido). Informe o INOM pelo parâmetro `inom`, que descreve a folha ' +
        'por construção e sempre resolve.',
        httpCode.NotFound
      )
    }
  }

  const poligono = scn.poligonoDoInom(inomCanonico)
  if (!poligono) {
    throw new AppError(
      `INOM "${inom}" fora do formato do Sistema Cartográfico Nacional. ` +
      'O formato é <hemisfério><faixa>-<fuso> seguido de um token por ' +
      'subdivisão: SF-22 (1:1.000.000), -V/X/Y/Z (1:500.000), -A/B/C/D ' +
      '(1:250.000), -I a -VI (1:100.000), -1 a -4 (1:50.000) e -NO/NE/SO/SE ' +
      '(1:25.000). Exemplo completo: SF-22-Y-D-II-4-NE.',
      httpCode.BadRequest
    )
  }

  const canonico = scn.normalizarInom(inomCanonico)
  const resultadoMi = scn.miDoInom(canonico)

  // `sem_mi` sai SEMPRE, e não só quando é verdadeiro. Um campo que aparece só
  // no caso negativo obriga quem consome a distinguir "não tem MI" de "esqueci
  // de olhar", e as duas coisas se leem como `undefined`.
  return {
    inom: canonico,
    mi: resultadoMi.mi || null,
    sem_mi: resultadoMi.sem_mi === true,
    motivo_sem_mi: resultadoMi.motivo || null,
    tipo_escala_id: poligono.tipo_escala_id,
    geom: poligono.ewkt,
    bbox: poligono.bbox
  }
}

module.exports = controller;