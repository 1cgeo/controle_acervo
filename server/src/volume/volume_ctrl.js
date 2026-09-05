"use strict";

const { db } = require("../database");

const { AppError, httpCode, preserveOmitted } = require("../utils");
const { auditoriaCtrl } = require("../auditoria");

const controller = {};

/** Violação de chave estrangeira, no vocabulário do Postgres. */
const FK_VIOLATION = '23503';

// As SEIS funcoes deste controlador trabalham em LOTE (o corpo das rotas e um
// array), recebem `usuarioUuid` e `contexto`, e gravam UM evento por LINHA, com
// o `loteId` da requisicao amarrando os N.
//
// Um evento por linha, e nao um com a contagem, porque a pergunta que este
// cadastro produz e "quem mudou o caminho do volume X" -- e o caminho e o que
// faz o acervo inteiro daquele volume apontar para outro lugar.

controller.getVolumeArmazenamento = async () => {
  return db.conn.any(
    `SELECT id, volume, nome, capacidade_gb, layout_origem FROM acervo.volume_armazenamento`
  )
}

controller.criaVolumeArmazenamento = async (volumeArmazenamento, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    // Espelha a UNIQUE de acervo.volume_armazenamento(volume) com erro amigável
    const volumes = volumeArmazenamento.map(v => v.volume)
    const duplicados = volumes.filter((v, i) => volumes.indexOf(v) !== i)
    if (duplicados.length > 0) {
      throw new AppError(
        `Volumes duplicados na requisição: ${[...new Set(duplicados)].join(', ')}`,
        httpCode.BadRequest
      )
    }

    const existentes = await t.any(
      `SELECT volume FROM acervo.volume_armazenamento
      WHERE volume in ($<volumes:csv>)`,
      { volumes }
    )
    if (existentes.length > 0) {
      throw new AppError(
        `Já existe volume de armazenamento com o caminho: ${existentes.map(e => e.volume).join(', ')}`,
        httpCode.Conflict
      )
    }

    // layout_origem e opcional na criacao: `def` cobre a ausencia com o mesmo
    // FALSE do DEFAULT da coluna. Volume novo guarda o padrao do acervo, e so
    // vira layout de fornecedor por escolha explicita.
    const cs = new db.pgp.helpers.ColumnSet([
      'nome', 'volume', 'capacidade_gb',
      { name: 'layout_origem', def: false }
    ])

    // `RETURNING *` porque sem ele o id da linha criada nao existe no
    // JavaScript, e sem id nao ha `registro_id`. A rota continua respondendo o
    // que respondia (ela nao devolve dados).
    const query = db.pgp.helpers.insert(volumeArmazenamento, cs, {
      table: 'volume_armazenamento',
      schema: 'acervo'
    }) + ' RETURNING *'

    const criados = await t.any(query)

    for (const criado of criados) {
      await auditoriaCtrl.registrar(t, {
        tabela: 'acervo.volume_armazenamento',
        registroId: criado.id,
        operacao: 'I',
        depois: criado,
        usuarioUuid,
        contexto
      })
    }
  })
}

controller.atualizaVolumeArmazenamento = async (volumeArmazenamento, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    // Espelha a UNIQUE de acervo.volume_armazenamento(volume) com erro amigável
    const volumes = volumeArmazenamento.map(v => v.volume)
    const ids = volumeArmazenamento.map(v => v.id)
    const duplicados = volumes.filter((v, i) => volumes.indexOf(v) !== i)
    if (duplicados.length > 0) {
      throw new AppError(
        `Volumes duplicados na requisição: ${[...new Set(duplicados)].join(', ')}`,
        httpCode.BadRequest
      )
    }

    const existentes = await t.any(
      `SELECT volume FROM acervo.volume_armazenamento
      WHERE volume in ($<volumes:csv>) AND id not in ($<ids:csv>)`,
      { volumes, ids }
    )
    if (existentes.length > 0) {
      throw new AppError(
        `Já existe outro volume de armazenamento com o caminho: ${existentes.map(e => e.volume).join(', ')}`,
        httpCode.Conflict
      )
    }

    // O estado anterior de TODOS os volumes do lote, numa consulta so, e ANTES
    // do `preserveOmitted`: ele copia para o corpo o valor gravado de quem
    // omitiu a chave, entao ler depois dele descreveria um estado intermediario
    // que ninguem viu.
    const antesPorId = new Map(
      (await t.any(
        'SELECT * FROM acervo.volume_armazenamento WHERE id in ($<ids:csv>)',
        { ids }
      )).map(v => [String(v.id), v])
    )

    // `layout_origem` e o unico campo opcional deste PUT. Sem isto, o cliente
    // que nao manda a chave (a tela do dashboard, que nem conhece o campo)
    // apagaria a marca ao editar o nome do volume, com 200 e sem aviso. Ausente
    // preserva, null explicito ainda limpa.
    for (const volume of volumeArmazenamento) {
      await preserveOmitted(t, {
        table: 'volume_armazenamento',
        id: volume.id,
        fields: ['layout_origem'],
        body: volume
      })
    }

    const cs = new db.pgp.helpers.ColumnSet([
      'id', 'nome', 'volume', 'capacidade_gb',
      { name: 'layout_origem', def: false }
    ])

    const query =
      db.pgp.helpers.update(
        volumeArmazenamento,
        cs,
        { table: 'volume_armazenamento', schema: 'acervo' },
        {
          tableAlias: 'X',
          valueAlias: 'Y'
        }
      ) + ' WHERE Y.id = X.id RETURNING X.*'

    const atualizados = await t.any(query)

    if (atualizados.length !== volumeArmazenamento.length) {
      throw new AppError(
        'Um ou mais volumes não foram encontrados',
        httpCode.NotFound
      )
    }

    for (const depois of atualizados) {
      await auditoriaCtrl.registrar(t, {
        tabela: 'acervo.volume_armazenamento',
        registroId: depois.id,
        operacao: 'U',
        antes: antesPorId.get(String(depois.id)),
        depois,
        usuarioUuid,
        contexto
      })
    }
  })
}

controller.deleteVolumeArmazenamento = async (volumeArmazenamentoIds, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    // Verificar se há arquivos usando este volume
    const arquivosAssociados = await t.any(
      `SELECT COUNT(*) as count FROM acervo.arquivo
      WHERE volume_armazenamento_id in ($<volumeArmazenamentoIds:csv>)`,
      { volumeArmazenamentoIds }
    );
    
    if (parseInt(arquivosAssociados[0].count) > 0) {
      throw new AppError(
        'Não é possível deletar pois há Arquivos associados ao volume',
        httpCode.BadRequest
      );
    }
    
    const arquivosDeletadosAssociados = await t.any(
      `SELECT COUNT(*) as count FROM acervo.arquivo_deletado
      WHERE volume_armazenamento_id in ($<volumeArmazenamentoIds:csv>)`,
      { volumeArmazenamentoIds }
    );
    
    if (parseInt(arquivosDeletadosAssociados[0].count) > 0) {
      throw new AppError(
        'Não é possível deletar pois há Arquivos Deletados associados ao volume',
        httpCode.BadRequest
      );
    }
    
    // Verificar volume_tipo_produto associados
    const associated = await t.any(
      `SELECT volume_armazenamento_id FROM acervo.volume_tipo_produto
      WHERE volume_armazenamento_id in ($<volumeArmazenamentoIds:csv>)`,
      { volumeArmazenamentoIds }
    );

    if (associated.length > 0) {
      throw new AppError(
        'Não é possível deletar pois há Volume Tipo Produto associados',
        httpCode.BadRequest
      );
    }

    // O PONTO DE CONTROLE grava no MESMO volume, e as duas tabelas dele apontam
    // `acervo.volume_armazenamento` com NOT NULL e sem ON DELETE
    // (`er/ponto_controle.sql:322` e `:368`). Sem estas duas conferências a
    // violação de FK subia crua e o `error_handler` devolvia 500 com a mensagem
    // do Postgres, em inglês e citando o nome interno da constraint.
    const arquivosPontoControle = await t.one(
      `SELECT COUNT(*)::int as count FROM ponto_controle.arquivo
      WHERE volume_armazenamento_id in ($<volumeArmazenamentoIds:csv>)`,
      { volumeArmazenamentoIds }
    );

    if (arquivosPontoControle.count > 0) {
      throw new AppError(
        'Não é possível deletar pois há Arquivos de Ponto de Controle associados ao volume',
        httpCode.BadRequest
      );
    }

    const temporariosPontoControle = await t.one(
      `SELECT COUNT(*)::int as count FROM ponto_controle.upload_arquivo_temp
      WHERE volume_armazenamento_id in ($<volumeArmazenamentoIds:csv>)`,
      { volumeArmazenamentoIds }
    );

    if (temporariosPontoControle.count > 0) {
      throw new AppError(
        'Não é possível deletar pois há sessões de envio de Ponto de Controle '
        + 'reservando espaço neste volume. Conclua ou cancele essas sessões antes.',
        httpCode.BadRequest
      );
    }

    // `SELECT *` no lugar de `SELECT id`: e o `dados_antes` da exclusao, pela
    // mesma ida ao banco que a conferencia de existencia ja custava. Sem ele o
    // evento nao diria qual caminho de volume deixou de existir.
    const exists = await t.any(
      `SELECT * FROM acervo.volume_armazenamento
      WHERE id in ($<volumeArmazenamentoIds:csv>)`,
      { volumeArmazenamentoIds }
    );

    if (exists && exists.length < volumeArmazenamentoIds.length) {
      throw new AppError(
        'O id informado não corresponde a uma entrada do volume de armazenamento',
        httpCode.BadRequest
      );
    }

    // As conferências acima dão a mensagem ESPECÍFICA, e continuam sendo o
    // caminho normal. Este `.catch` é a rede para o vínculo que ninguém previu:
    // sem ele a violação vira 500 em inglês com o nome da constraint, e quem
    // apertou o botão não sabe o que desfazer.
    const apagados = await t.any(
      `DELETE FROM acervo.volume_armazenamento
      WHERE id in ($<volumeArmazenamentoIds:csv>)`,
      { volumeArmazenamentoIds }
    ).catch(erro => {
      if (erro && erro.code === FK_VIOLATION) {
        throw new AppError(
          'Não é possível deletar: o volume ainda é referenciado por outros '
          + 'registros do sistema. Desfaça esses vínculos antes de apagá-lo.',
          httpCode.BadRequest,
          erro
        );
      }
      throw erro;
    });

    for (const volume of exists) {
      await auditoriaCtrl.registrar(t, {
        tabela: 'acervo.volume_armazenamento',
        registroId: volume.id,
        operacao: 'D',
        antes: volume,
        usuarioUuid,
        contexto
      });
    }

    return apagados;
  });
};

controller.getVolumeTipoProduto = async () => {
  return db.conn.any(
    `SELECT vtp.id, vtp.tipo_produto_id, vtp.volume_armazenamento_id, vtp.primario,
    tp.nome AS tipo_produto, va.volume AS volume, va.nome AS nome_volume, va.capacidade_gb AS volume_capacidade_gb
    FROM acervo.volume_tipo_produto AS vtp
    INNER JOIN acervo.volume_armazenamento AS va ON va.id = vtp.volume_armazenamento_id
    INNER JOIN dominio.tipo_produto AS tp ON tp.code = vtp.tipo_produto_id
    `
  )
}

// Espelha o índice único parcial idx_unique_primario (um volume primário por
// tipo de produto) com erro amigável. excludeIds: ids da própria atualização.
async function verificaPrimarioUnico (t, volumeTipoProduto, excludeIds = null) {
  const tiposPrimarios = volumeTipoProduto
    .filter(v => v.primario)
    .map(v => v.tipo_produto_id)

  const duplicados = tiposPrimarios.filter((v, i) => tiposPrimarios.indexOf(v) !== i)
  if (duplicados.length > 0) {
    throw new AppError(
      `A requisição contém mais de um volume primário para o(s) tipo(s) de produto: ${[...new Set(duplicados)].join(', ')}`,
      httpCode.BadRequest
    )
  }

  if (tiposPrimarios.length === 0) {
    return
  }

  const existentes = await t.any(
    `SELECT tipo_produto_id FROM acervo.volume_tipo_produto
    WHERE primario = TRUE AND tipo_produto_id in ($<tiposPrimarios:csv>)
    ${excludeIds ? 'AND id not in ($<excludeIds:csv>)' : ''}`,
    { tiposPrimarios, excludeIds }
  )
  if (existentes.length > 0) {
    throw new AppError(
      `Já existe volume primário para o(s) tipo(s) de produto: ${existentes.map(e => e.tipo_produto_id).join(', ')}`,
      httpCode.Conflict
    )
  }
}

controller.criaVolumeTipoProduto = async (volumeTipoProduto, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    await verificaPrimarioUnico(t, volumeTipoProduto)

    const cs = new db.pgp.helpers.ColumnSet([
      'tipo_produto_id', 'volume_armazenamento_id', 'primario'
    ])

    const query = db.pgp.helpers.insert(volumeTipoProduto, cs, {
      table: 'volume_tipo_produto',
      schema: 'acervo'
    }) + ' RETURNING *'

    const criados = await t.any(query)

    for (const criado of criados) {
      await auditoriaCtrl.registrar(t, {
        tabela: 'acervo.volume_tipo_produto',
        registroId: criado.id,
        operacao: 'I',
        depois: criado,
        usuarioUuid,
        contexto
      })
    }
  })
}

controller.atualizaVolumeTipoProduto = async (volumeTipoProduto, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    await verificaPrimarioUnico(t, volumeTipoProduto, volumeTipoProduto.map(v => v.id))

    const antesPorId = new Map(
      (await t.any(
        'SELECT * FROM acervo.volume_tipo_produto WHERE id in ($<ids:csv>)',
        { ids: volumeTipoProduto.map(v => v.id) }
      )).map(v => [String(v.id), v])
    )

    const cs = new db.pgp.helpers.ColumnSet([
      'id', 'tipo_produto_id', 'volume_armazenamento_id', 'primario'
    ])

    const query = 
      db.pgp.helpers.update(
        volumeTipoProduto,
        cs,
        { table: 'volume_tipo_produto', schema: 'acervo' },
        {
          tableAlias: 'X',
          valueAlias: 'Y'
        }
      ) + ' WHERE Y.id = X.id RETURNING X.*'

    const atualizados = await t.any(query)

    if (atualizados.length !== volumeTipoProduto.length) {
      throw new AppError(
        'Uma ou mais associações Volume Tipo Produto não foram encontradas',
        httpCode.NotFound
      )
    }

    for (const depois of atualizados) {
      await auditoriaCtrl.registrar(t, {
        tabela: 'acervo.volume_tipo_produto',
        registroId: depois.id,
        operacao: 'U',
        antes: antesPorId.get(String(depois.id)),
        depois,
        usuarioUuid,
        contexto
      })
    }
  })
}

controller.deleteVolumeTipoProduto = async (volumeTipoProdutoIds, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    // Primeiro, buscar os registros para verificar dependências. `SELECT *`
    // porque estas mesmas linhas sao o `dados_antes` da exclusao.
    const volumeTipos = await t.any(
      `SELECT * FROM acervo.volume_tipo_produto
       WHERE id in ($<volumeTipoProdutoIds:csv>)`,
      { volumeTipoProdutoIds }
    );

    if (volumeTipos.length < volumeTipoProdutoIds.length) {
      throw new AppError(
        'Um ou mais IDs informados não correspondem a entradas do Volume Tipo Produto',
        httpCode.BadRequest
      );
    }
    
    // Verificar volumes primários que possuem produtos dependentes
    const volumesPrimarios = volumeTipos
      .filter(v => v.primario)
      .map(v => ({ id: v.id, tipo_produto_id: v.tipo_produto_id }));
      
    if (volumesPrimarios.length > 0) {
      // Para cada volume primário, verificar se há produtos associados
      for (const vp of volumesPrimarios) {
        // Verificar se existe outro volume primário para este tipo de produto
        const outrosPrimarios = await t.any(
          `SELECT COUNT(*) as count FROM acervo.volume_tipo_produto
           WHERE tipo_produto_id = $1 AND primario = TRUE AND id != $2`,
          [vp.tipo_produto_id, vp.id]
        );
        
        // Se não existir outro primário, verificar se existem produtos deste tipo
        if (parseInt(outrosPrimarios[0].count) === 0) {
          const produtosAssociados = await t.any(
            `SELECT COUNT(*) as count FROM acervo.produto
             WHERE tipo_produto_id = $1`,
            [vp.tipo_produto_id]
          );
          
          if (parseInt(produtosAssociados[0].count) > 0) {
            throw new AppError(
              `Não é possível deletar o volume primário para o tipo de produto ${vp.tipo_produto_id} pois há produtos associados`,
              httpCode.BadRequest
            );
          }
        }
      }
    }

    // Se chegou aqui, podemos excluir com segurança
    const apagados = await t.any(
      `DELETE FROM acervo.volume_tipo_produto
      WHERE id in ($<volumeTipoProdutoIds:csv>)`,
      { volumeTipoProdutoIds }
    );

    // Apagar o PRIMARIO deixa o tipo de produto sem destino para o upload web, e
    // o servidor so recusa esse caso quando ja EXISTE produto do tipo. Por isso
    // o evento importa aqui: com o catalogo vazio a exclusao passa, e meses
    // depois ninguem saberia quem tirou o destino.
    for (const vtp of volumeTipos) {
      await auditoriaCtrl.registrar(t, {
        tabela: 'acervo.volume_tipo_produto',
        registroId: vtp.id,
        operacao: 'D',
        antes: vtp,
        usuarioUuid,
        contexto
      });
    }

    return apagados;
  });
};


module.exports = controller;
