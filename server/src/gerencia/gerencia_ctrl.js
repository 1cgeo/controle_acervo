"use strict";
const fs = require('fs').promises;
const { caminhoNoVolume } = require('../utils/caminho_volume');
const crypto = require('crypto');
const { db } = require("../database");
const { domainConstants: { STATUS_ARQUIVO, TIPO_ARQUIVO } } = require("../utils");
const { auditoriaCtrl } = require("../auditoria");

const controller = {};

controller.getTipoPostoGrad = async () => {
  return db.conn.any(`
    SELECT code, nome, nome_abrev
    FROM dominio.tipo_posto_grad
    `);
};

controller.getTipoProduto = async () => {
  return db.conn.any(`
    SELECT code, nome
    FROM dominio.tipo_produto
    `);
};

controller.getSituacaoCarregamento = async () => {
  return db.conn.any(`
    SELECT code, nome
    FROM dominio.situacao_carregamento
    `);
};

controller.getTipoArquivo = async () => {
  return db.conn.any(`
    SELECT code, nome
    FROM dominio.tipo_arquivo
    `);
};

controller.getTipoRelacionamento = async () => {
  return db.conn.any(`
    SELECT code, nome
    FROM dominio.tipo_relacionamento
    `);
};

controller.getTipoStatusArquivo = async () => {
  return db.conn.any(`
    SELECT code, nome
    FROM dominio.tipo_status_arquivo
    `);
};

controller.getTipoVersao = async () => {
  return db.conn.any(`
    SELECT code, nome
    FROM dominio.tipo_versao
    `);
};

controller.getTipoStatusExecucao = async () => {
  return db.conn.any(`
    SELECT code, nome
    FROM dominio.tipo_status_execucao
    `);
};

controller.getTipoEscala = async () => {
  return db.conn.any(`
    SELECT code, nome
    FROM dominio.tipo_escala
    `);
};

// `define_produto` viaja junto, e não é detalhe de banco vazando para a API.
//
// Ele é a única forma de o cliente saber, ANTES de montar o corpo, que aquele
// subtipo (hoje o 24, Carta Topográfica Militar) exige produto próprio: o
// gatilho acervo.validate_version recusa a versão quando o produto não tem o
// MESMO subtipo. Sem o campo aqui, o plugin oferecia o 24 como qualquer outro e
// a recusa só aparecia no confirm-upload, isto é, DEPOIS de o operador ter
// copiado os bytes para o volume, e como exceção do PostgreSQL, que vira 500
// genérico. Quem escolhe precisa saber a regra na hora de escolher.
controller.getSubtipoProduto = async () => {
  return db.conn.any(`
    SELECT sp.code, sp.nome, sp.tipo_id, sp.define_produto, tp.nome AS tipo_produto
    FROM dominio.subtipo_produto AS sp
    INNER JOIN dominio.tipo_produto AS tp ON tp.code = sp.tipo_id
    ORDER BY tp.nome, sp.nome
    `);
};

controller.getArquivosDeletados = async (page = 1, limit = 20) => {
  return db.conn.task(async t => {
    const offset = (page - 1) * limit;
    
    const totalCount = await t.one(
      `SELECT COUNT(*) AS total FROM acervo.arquivo_deletado`
    );
    
    const arquivosDeletados = await t.any(
      `
      SELECT 
        ad.id, 
        ad.uuid_arquivo, 
        ad.nome, 
        ad.nome_arquivo, 
        ad.motivo_exclusao, 
        ad.versao_id, 
        v.versao AS versao, 
        v.nome AS versao_nome,
        p.nome AS produto,
        p.mi,
        p.inom,
        te.nome AS escala,
        p.denominador_escala_especial,
        l.nome AS lote,
        l.pit,
        proj.nome AS projeto,
        ad.tipo_arquivo_id, 
        ta.nome AS tipo_arquivo_nome, 
        ad.volume_armazenamento_id, 
        va.nome AS volume_armazenamento_nome, 
        va.volume AS volume_armazenamento, 
        ad.extensao, 
        ad.tamanho_mb, 
        ad.checksum, 
        ad.metadado, 
        ad.tipo_status_id, 
        ts.nome AS tipo_status_nome, 
        ad.situacao_carregamento_id, 
        sb.nome AS situacao_carregamento_nome, 
        ad.crs_original,
        ad.descricao, 
        ad.data_cadastramento, 
        ad.usuario_cadastramento_uuid, 
        u.nome AS usuario_cadastramento_nome, 
        ad.data_modificacao, 
        ad.usuario_modificacao_uuid, 
        um.nome AS usuario_modificacao_nome, 
        ad.data_delete, 
        ad.usuario_delete_uuid, 
        ud.nome AS usuario_delete_nome 
      FROM 
        acervo.arquivo_deletado ad
      LEFT JOIN 
        acervo.versao v ON ad.versao_id = v.id
      LEFT JOIN 
        acervo.produto p ON v.produto_id = p.id
      LEFT JOIN
        dominio.tipo_escala AS te ON te.code = p.tipo_escala_id
      LEFT JOIN 
        acervo.lote l ON v.lote_id = l.id
      LEFT JOIN 
        acervo.projeto proj ON l.projeto_id = proj.id
      LEFT JOIN 
        dominio.tipo_arquivo ta ON ad.tipo_arquivo_id = ta.code
      LEFT JOIN 
        acervo.volume_armazenamento va ON ad.volume_armazenamento_id = va.id
      LEFT JOIN 
        dominio.tipo_status_arquivo ts ON ad.tipo_status_id = ts.code
      LEFT JOIN 
        dominio.situacao_carregamento sb ON ad.situacao_carregamento_id = sb.code
      LEFT JOIN 
        dgeo.usuario u ON ad.usuario_cadastramento_uuid = u.uuid
      LEFT JOIN 
        dgeo.usuario um ON ad.usuario_modificacao_uuid = um.uuid
      LEFT JOIN 
        dgeo.usuario ud ON ad.usuario_delete_uuid = ud.uuid
      ORDER BY 
        ad.data_delete DESC
      LIMIT $1 OFFSET $2;
      `,
      [limit, offset]
    );

    const totalPages = Math.ceil(totalCount.total / limit);

    return {
      data: arquivosDeletados,
      pagination: {
        totalItems: parseInt(totalCount.total),
        totalPages,
        currentPage: page,
        pageSize: limit
      }
    };
  });
};

/**
 * Relê o byte de todo o acervo, confere o SHA-256 e escreve o status.
 *
 * O RASTRO DELA É UM EVENTO DE OPERAÇÃO, e não uma linha por arquivo. Dois dos
 * quatro UPDATEs abaixo (`:339` e `:349`) são `WHERE tipo_status_id = ERRO AND
 * id NOT IN (...)`, ou seja SEM lista de ids: eles podem reescrever a
 * `acervo.arquivo` e a `acervo.arquivo_deletado` INTEIRAS. Um evento por arquivo
 * ali seria a auditoria crescendo mais rápido que o acervo, para registrar algo
 * que ninguém decidiu arquivo a arquivo -- e a lista dos arquivos com problema
 * já existe, é a tela de diagnóstico, que duplicá-la aqui só faria envelhecer.
 *
 * O que se guarda é o que se procura depois: quem mandou rodar, quando, e o que
 * saiu. A `origem` do evento é 'sistema', que é o que `registrarOperacao` põe.
 *
 * Ela não recebia o usuário: agora recebe, porque "quem mandou rodar" era
 * exatamente a pergunta sem resposta.
 */
controller.verificarConsistencia = async (usuarioUuid, contexto) => {
    const inicio = Date.now();
    // Leitura e checksums fora de transação: o cálculo pode levar horas em
    // acervos grandes e seguraria uma conexão/transação aberta o tempo todo.
    // 1. Obter todos os arquivos e suas informações em uma consulta
    const arquivos = await db.conn.any(`
      SELECT a.id, a.nome_arquivo, a.checksum, a.extensao, v.volume, a.tipo_arquivo_id
      FROM acervo.arquivo a
      JOIN acervo.volume_armazenamento v ON a.volume_armazenamento_id = v.id
      WHERE a.tipo_arquivo_id != ${TIPO_ARQUIVO.TILESERVER}
    `);

    const arquivosDeletados = await db.conn.any(`
      SELECT ad.id, ad.nome_arquivo, ad.extensao, v.volume
      FROM acervo.arquivo_deletado ad
      JOIN acervo.volume_armazenamento v ON ad.volume_armazenamento_id = v.id
      WHERE ad.tipo_arquivo_id != ${TIPO_ARQUIVO.TILESERVER}
    `);

    // 2. Processar em lotes menores para evitar sobrecarga de memória
    const BATCH_SIZE = 50;
    const arquivosParaAtualizar = [];
    const arquivosDeletadosParaAtualizar = [];
    
    // Função auxiliar para cálculo de checksum com streams
    async function calculaChecksumStream(filePath) {
      return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = require('fs').createReadStream(filePath);
        
        stream.on('error', (error) => reject(error));
        
        stream.on('data', (data) => hash.update(data));
        
        stream.on('end', () => resolve(hash.digest('hex')));
      });
    }
    
    // Processar arquivos existentes
    for (let i = 0; i < arquivos.length; i += BATCH_SIZE) {
      const batch = arquivos.slice(i, i + BATCH_SIZE);
      
      // Usar Promise.all para processamento paralelo dentro do lote
      const resultados = await Promise.all(batch.map(async arquivo => {
        const filePath = caminhoNoVolume(arquivo.volume, `${arquivo.nome_arquivo}.${arquivo.extensao}`);
        
        try {
          // Verificar existência do arquivo antes de ler
          await fs.access(filePath);
          // Usar stream para grandes arquivos
          const calculatedChecksum = await calculaChecksumStream(filePath);
          
          return {
            id: arquivo.id,
            status: calculatedChecksum !== arquivo.checksum ? 'checksum_invalido' : 'ok'
          };
        } catch (error) {
          return {
            id: arquivo.id,
            status: 'nao_encontrado'
          };
        }
      }));
      
      // Adicionar apenas os arquivos com problema
      resultados
        .filter(r => r.status !== 'ok')
        .forEach(r => arquivosParaAtualizar.push(r.id));
    }
    
    // Processar arquivos deletados
    for (let i = 0; i < arquivosDeletados.length; i += BATCH_SIZE) {
      const batch = arquivosDeletados.slice(i, i + BATCH_SIZE);
      
      const resultados = await Promise.all(batch.map(async arquivoDeletado => {
        const deletedFilePath = caminhoNoVolume(arquivoDeletado.volume, `${arquivoDeletado.nome_arquivo}.${arquivoDeletado.extensao}`);
        
        try {
          // Verificar se o arquivo existe
          await fs.access(deletedFilePath);
          
          // Verificar se está associado a um arquivo existente
          // (comparação por componentes, concatenar caminhos divergiria do
          // path.join do Node, que usa backslash no Windows)
          const existingArquivo = await db.conn.oneOrNone(`
            SELECT a.id
            FROM acervo.arquivo a
            JOIN acervo.volume_armazenamento v ON a.volume_armazenamento_id = v.id
            WHERE v.volume = $1 AND a.nome_arquivo = $2 AND a.extensao = $3
          `, [arquivoDeletado.volume, arquivoDeletado.nome_arquivo, arquivoDeletado.extensao]);
          
          return {
            id: arquivoDeletado.id,
            status: !existingArquivo ? 'unexpected' : 'ok'
          };
        } catch (error) {
          // Arquivo não existe, o que é esperado para arquivos deletados
          return {
            id: arquivoDeletado.id,
            status: 'ok'
          };
        }
      }));
      
      // Adicionar apenas os arquivos com problema
      resultados
        .filter(r => r.status !== 'ok')
        .forEach(r => arquivosDeletadosParaAtualizar.push(r.id));
    }

    // Apenas os UPDATEs finais em transação curta
    return db.conn.tx(async t => {
    // Atualizar status de arquivos com problemas
    // O cast ::bigint[] e obrigatorio: o driver devolve bigint como STRING, e
    // sem ele o array vai como text[], entao o Postgres recusa com
    // "operator does not exist: bigint = text" e a transacao inteira reverte.
    // Os dois UPDATEs de baixo ja nasceram com o cast; estes dois nao tinham.
    if (arquivosParaAtualizar.length > 0) {
      await t.none(`
        UPDATE acervo.arquivo
        SET tipo_status_id = ${STATUS_ARQUIVO.ERRO_CARREGAMENTO}
        WHERE id = ANY($1::bigint[])
        AND tipo_status_id = ${STATUS_ARQUIVO.CARREGADO}
      `, [arquivosParaAtualizar]);
    }

    // Atualizar status de arquivos deletados com problemas
    if (arquivosDeletadosParaAtualizar.length > 0) {
      await t.none(`
        UPDATE acervo.arquivo_deletado
        SET tipo_status_id = ${STATUS_ARQUIVO.ERRO_EXCLUSAO}
        WHERE id = ANY($1::bigint[])
        AND tipo_status_id = ${STATUS_ARQUIVO.EXCLUIDO}
      `, [arquivosDeletadosParaAtualizar]);
    }

    // Verificar e atualizar arquivos classificados incorretamente como incorretos
    // (restrito ao universo verificado acima, tileserver não é verificado,
    // então seu status não pode ser resetado aqui)
    await t.none(`
      UPDATE acervo.arquivo
      SET tipo_status_id = ${STATUS_ARQUIVO.CARREGADO}
      WHERE tipo_status_id = ${STATUS_ARQUIVO.ERRO_CARREGAMENTO}
      AND tipo_arquivo_id != ${TIPO_ARQUIVO.TILESERVER}
      AND id NOT IN (SELECT unnest($1::bigint[]))
    `, [arquivosParaAtualizar.length > 0 ? arquivosParaAtualizar : [-1]]);

    // Verificar e atualizar arquivos deletados classificados incorretamente como incorretos
    // (idem: tileserver e registros sem volume ficam fora da verificação)
    await t.none(`
      UPDATE acervo.arquivo_deletado
      SET tipo_status_id = ${STATUS_ARQUIVO.EXCLUIDO}
      WHERE tipo_status_id = ${STATUS_ARQUIVO.ERRO_EXCLUSAO}
      AND tipo_arquivo_id != ${TIPO_ARQUIVO.TILESERVER}
      AND volume_armazenamento_id IS NOT NULL
      AND id NOT IN (SELECT unnest($1::bigint[]))
    `, [arquivosDeletadosParaAtualizar.length > 0 ? arquivosDeletadosParaAtualizar : [-1]]);

    const resultado = {
      arquivos_atualizados: arquivosParaAtualizar.length,
      arquivos_deletados_atualizados: arquivosDeletadosParaAtualizar.length
    };

    await auditoriaCtrl.registrarOperacao(t, {
      tabela: 'acervo.arquivo',
      resultado: {
        ...resultado,
        // A duração é a informação que só existe aqui: esta rota leva horas em
        // acervo grande, e saber quanto levou é o que separa "rodou" de "rodou
        // sobre o acervo inteiro".
        arquivos_verificados: arquivos.length,
        arquivos_deletados_verificados: arquivosDeletados.length,
        segundos: Number(((Date.now() - inicio) / 1000).toFixed(1))
      },
      usuarioUuid,
      contexto
    });

    return resultado;
    });
};

controller.getArquivosIncorretos = async (page = 1, limit = 20) => {
  return db.conn.task(async t => {
    const offset = (page - 1) * limit;
    
    const arquivosIncorretos = await t.any(`
      WITH arquivos_combined AS (
        SELECT 
          'arquivo' as origem,
          a.id, a.nome, a.nome_arquivo, a.extensao, a.tipo_status_id, 
          a.data_cadastramento, a.data_modificacao, v.volume, v.nome AS volume_nome, va.nome AS versao_nome,
          'Arquivo com erro' as tipo,
          COALESCE(a.data_modificacao, a.data_cadastramento) as ordem_data
        FROM acervo.arquivo AS a
        LEFT JOIN acervo.volume_armazenamento AS v ON a.volume_armazenamento_id = v.id
        INNER JOIN acervo.versao AS va ON a.versao_id = va.id
        WHERE a.tipo_status_id = ${STATUS_ARQUIVO.ERRO_CARREGAMENTO}

        UNION ALL
        
        SELECT 
          'arquivo_deletado' as origem,
          ad.id, ad.nome, ad.nome_arquivo, ad.extensao, ad.tipo_status_id,
          ad.data_cadastramento, ad.data_delete as data_modificacao, v.volume,
          v.nome AS volume_nome, COALESCE(va.nome, 'Versão removida') AS versao_nome,
          'Arquivo deletado com erro' as tipo,
          ad.data_delete as ordem_data
        FROM acervo.arquivo_deletado AS ad
        LEFT JOIN acervo.volume_armazenamento AS v ON ad.volume_armazenamento_id = v.id
        LEFT JOIN acervo.versao AS va ON ad.versao_id = va.id
        WHERE ad.tipo_status_id = ${STATUS_ARQUIVO.ERRO_EXCLUSAO}
      ),
      arquivos_numerados AS (
        SELECT *, ROW_NUMBER() OVER (ORDER BY ordem_data DESC NULLS LAST) as row_num
        FROM arquivos_combined
      )
      -- A coluna origem SAI na resposta, e não pode voltar a ficar de fora. Os
      -- dois lados da união têm sequências de id DISTINTAS (acervo.arquivo e
      -- acervo.arquivo_deletado), então o id sozinho é ambíguo: o mesmo
      -- número existe nas duas tabelas apontando arquivos diferentes. Sem este
      -- campo a tela mostrava um número cru, e um id de excluído colado no
      -- cartão de checksum manda o servidor reler OUTRO arquivo, vivo, sem que
      -- nada perceba (ele existe, então a rota não recusa).
      SELECT
        origem, id, nome, nome_arquivo, extensao, tipo_status_id,
        data_cadastramento, data_modificacao, volume, volume_nome, versao_nome, tipo
      FROM arquivos_numerados
      WHERE row_num > $1 AND row_num <= $2
      ORDER BY row_num
    `, [offset, offset + limit]);
    
    const totalCount = await t.one(`
      SELECT 
        (SELECT COUNT(*) FROM acervo.arquivo WHERE tipo_status_id = ${STATUS_ARQUIVO.ERRO_CARREGAMENTO}) +
        (SELECT COUNT(*) FROM acervo.arquivo_deletado WHERE tipo_status_id = ${STATUS_ARQUIVO.ERRO_EXCLUSAO}) AS total
    `);
    
    const totalPages = Math.ceil(totalCount.total / limit);
    
    return {
      data: arquivosIncorretos,
      pagination: {
        totalItems: parseInt(totalCount.total),
        totalPages,
        currentPage: page,
        pageSize: limit
      }
    };
  });
};

controller.getDownloadsDeletados = async (page = 1, limit = 20) => {
  return db.conn.task(async t => {
    const offset = (page - 1) * limit;

    const countResult = await t.one(
      `SELECT COUNT(*) FROM acervo.download_deletado`
    );

    const downloads = await t.any(
      `SELECT
        dd.id, dd.arquivo_deletado_id, dd.usuario_uuid,
        dd.data_download,
        u.nome AS usuario_nome,
        ad.nome AS arquivo_nome, ad.nome_arquivo,
        ad.motivo_exclusao, ad.data_delete
      FROM acervo.download_deletado dd
      LEFT JOIN dgeo.usuario u ON u.uuid = dd.usuario_uuid
      LEFT JOIN acervo.arquivo_deletado ad ON ad.id = dd.arquivo_deletado_id
      ORDER BY dd.data_download DESC
      LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const totalItems = parseInt(countResult.count);
    return {
      data: downloads,
      pagination: {
        totalItems,
        totalPages: Math.ceil(totalItems / limit),
        currentPage: page,
        pageSize: limit
      }
    };
  });
};

module.exports = controller;