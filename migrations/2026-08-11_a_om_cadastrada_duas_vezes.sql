-- A MESMA OM DEIXA DE TER DUAS FICHAS DE CLIENTE.
--
-- O QUE HAVIA, medido na producao em 2026-08-11. `mapoteca.cliente` tem 180
-- linhas e UM grupo repetido: os ids 33 e 59 sao os dois o "3o Grupo de
-- Artilharia de Campanha Autopropulsado", sigla '3o GAC Ap', tipo 1 (OM EB), e o
-- endereco de entrega das duas e o mesmo, caractere por caractere. A diferenca
-- entre as duas linhas e uma so: a 33 tem o ponto de contato preenchido e a 59
-- esta vazia. Cada uma carrega um pedido concluido -- MG3P-GGFP-8XLJ, de
-- 2026-02-24, na 33, e 4ZBH-PCXV-KG4K, de 2026-05-19, na 59.
--
-- O ENDERECO E O CONTATO NAO SE TRANSCREVEM AQUI, e a omissao e deliberada: o
-- repositorio e PUBLICO, o contato e o nome e o telefone de uma pessoa, e o que
-- o leitor precisa saber e que os dois enderecos BATEM -- nao qual e.
--
-- POR QUE ISSO E DEFEITO, E NAO DETALHE DE CADASTRO. Tres coisas quebram, e
-- nenhuma delas da erro:
--
--   * a CONTAGEM mente. "Quantas OM foram atendidas no ano" responde 68 quando
--     a resposta e 67, porque a pergunta se faz por `cliente_id` distinto e o
--     banco tem dois para a mesma unidade. O numero sai errado em toda tela e em
--     todo relatorio que conte cliente, sem que nada acuse;
--   * o HISTORICO da OM aparece partido. Quem abre a ficha ve um pedido e nao o
--     outro, e conclui que o 3o GAC Ap pediu uma vez no ano;
--   * o ENDERECO e o CONTATO da proxima entrega passam a depender de qual das
--     duas fichas o operador escolher na lista, e as duas se chamam igual.
--
-- POR QUE A FUSAO SE ESCREVE POR CONTEUDO, E NUNCA PELO ID. Um
-- `DELETE FROM mapoteca.cliente WHERE id = 59` conserta ESTA instalacao e apaga
-- o cliente errado em qualquer outra, porque la o id 59 e outra pessoa juridica
-- qualquer -- sem erro de sintaxe, sem chave estrangeira reclamando e sem linha
-- vermelha em teste nenhum. `mapoteca.cliente` e povoada pela TELA, nao pelo
-- `er/` (que so semeia o 'Cidadao (LAI)') nem por carga versionada, entao o id
-- aqui nao identifica nada fora deste banco. Por isso o que segue casa o grupo
-- por (nome, sigla, tipo_cliente_id) e nao menciona id nenhum: numa instalacao
-- sem duplicata ele nao encontra grupo, nao toca linha e termina em silencio.
--
-- QUEM SOBREVIVE E O MENOR id: e a ficha mais antiga, e aqui e tambem a que tem
-- o contato preenchido. A escolha nao depende dessa coincidencia -- o bloco
-- abaixo copia para o sobrevivente o ponto de contato e o endereco do descartado
-- QUANDO o sobrevivente estiver vazio. Nesta producao o COALESCE nao muda nada
-- (a 33 ja tem contato e as duas tem o mesmo endereco); ele existe para que a
-- fusao nao perca informacao numa instalacao onde a ficha mais nova seja a mais
-- completa.
--
-- IDEMPOTENTE por construcao, e nao por `IF NOT EXISTS`: depois da primeira
-- passada nao ha mais grupo com duas linhas, e a segunda nao acha o que fundir.
--
-- NAO NASCE UNIQUE em (nome, sigla) para impedir a repeticao, e a ausencia e
-- deliberada. Restricao nova e decisao de desenho, e decisao se registra em
-- `docs/decisoes.md` depois de conversar com o chefe -- ainda mais uma que
-- passaria a RECUSAR cadastro na tela. Fica anotado que a porta continua aberta:
-- quem digitar o nome de novo cria a segunda ficha de novo.
--
-- O PISO DO BANCO NAO SOBE, pela regra do paragrafo da 1.26.0 em
-- `server/src/config.js`: esta migracao nao cria schema, tabela nem coluna. Um
-- banco carimbado 3.2.0 roda este codigo inteiro. `VERSION` vai a 3.4.0 e
-- `MIN_DATABASE_VERSION` fica em 3.2.0.

BEGIN;

DO $$
DECLARE
  v_pedidos INTEGER := 0;
  v_clientes INTEGER := 0;
BEGIN
  -- O grupo repetido e quem sobrevive nele. `sigla` entra na chave com
  -- IS NOT DISTINCT FROM porque ela e NULA para quem nao e OM, e `=` sobre nulo
  -- nao casa nem consigo mesmo -- dois cadastros identicos de orgao civil
  -- escapariam calados da deduplicacao.
  CREATE TEMP TABLE fusao_cliente ON COMMIT DROP AS
  SELECT c.id AS descartado,
         (SELECT MIN(m.id) FROM mapoteca.cliente AS m
           WHERE m.nome = c.nome
             AND m.sigla IS NOT DISTINCT FROM c.sigla
             AND m.tipo_cliente_id = c.tipo_cliente_id) AS sobrevivente
    FROM mapoteca.cliente AS c;

  DELETE FROM fusao_cliente WHERE descartado = sobrevivente;

  IF NOT EXISTS (SELECT 1 FROM fusao_cliente) THEN
    RAISE NOTICE 'Nenhum cliente repetido em mapoteca.cliente. Nada a fazer.';
    RETURN;
  END IF;

  -- O que o descartado sabia e o sobrevivente nao. Antes de mover o pedido,
  -- porque depois o descartado ja nao tem como ser encontrado pela ficha.
  UPDATE mapoteca.cliente AS s
     SET ponto_contato_principal =
           COALESCE(s.ponto_contato_principal, d.ponto_contato_principal),
         endereco_entrega_principal =
           COALESCE(s.endereco_entrega_principal, d.endereco_entrega_principal)
    FROM fusao_cliente AS f
    INNER JOIN mapoteca.cliente AS d ON d.id = f.descartado
   WHERE s.id = f.sobrevivente
     AND (s.ponto_contato_principal IS NULL
          OR s.endereco_entrega_principal IS NULL);

  -- O RASTRO DO PEDIDO QUE TROCA DE DONO, antes do UPDATE. `mapoteca.pedido` e
  -- entidade auditada ('pedido', pelo mapa de `auditoria/mapa/mapoteca.js`), e a
  -- troca de `cliente_id` e exatamente o tipo de mudanca que a ficha mostra no
  -- historico. Sem isto o pedido apareceria amanha sob outra OM sem uma linha
  -- dizendo quando passou para la.
  INSERT INTO auditoria.evento
    (modulo, entidade, entidade_id, tabela, registro_id, operacao,
     dados_antes, dados_depois, campos_alterados, usuario_uuid, origem, motivo)
  SELECT 'mapoteca', 'pedido', p.id::text, 'mapoteca.pedido', p.id::text, 'U',
         to_jsonb(p),
         to_jsonb(p) || jsonb_build_object('cliente_id', f.sobrevivente),
         ARRAY['cliente_id'], NULL, 'migracao',
         'Virada 3.4.0: a OM estava cadastrada duas vezes em mapoteca.cliente, ' ||
         'e o pedido passa da ficha ' || f.descartado || ' para a ficha ' ||
         f.sobrevivente || ', que e a que fica.'
    FROM mapoteca.pedido AS p
    INNER JOIN fusao_cliente AS f ON f.descartado = p.cliente_id;

  UPDATE mapoteca.pedido AS p
     SET cliente_id = f.sobrevivente
    FROM fusao_cliente AS f
   WHERE p.cliente_id = f.descartado;

  GET DIAGNOSTICS v_pedidos = ROW_COUNT;

  -- O RASTRO DA FICHA QUE SAI, tambem antes do DELETE, e pelo mesmo motivo: a
  -- exclusao e justamente o evento que a trilha existe para guardar. Sai como
  -- evento da ficha SOBREVIVENTE (`entidade_id`), e nao da que morre: e na ficha
  -- que fica que alguem vai procurar por que existiam duas.
  INSERT INTO auditoria.evento
    (modulo, entidade, entidade_id, tabela, registro_id, operacao,
     dados_antes, usuario_uuid, origem, motivo)
  SELECT 'mapoteca', 'cliente', f.sobrevivente::text, 'mapoteca.cliente',
         d.id::text, 'D', to_jsonb(d), NULL, 'migracao',
         'Virada 3.4.0: ficha repetida de ' || d.nome || '. A mesma OM estava ' ||
         'cadastrada duas vezes, e a contagem de clientes atendidos somava as ' ||
         'duas. Os pedidos foram para a ficha ' || f.sobrevivente || '.'
    FROM fusao_cliente AS f
    INNER JOIN mapoteca.cliente AS d ON d.id = f.descartado;

  DELETE FROM mapoteca.cliente AS c
   USING fusao_cliente AS f
   WHERE c.id = f.descartado;

  GET DIAGNOSTICS v_clientes = ROW_COUNT;

  RAISE NOTICE
    'Fundidas % ficha(s) repetida(s) de cliente; % pedido(s) mudaram de cliente_id. Todas com evento em auditoria.evento.',
    v_clientes, v_pedidos;
END $$;

UPDATE public.versao SET nome = '3.4.0' WHERE code = 1;

COMMIT;

-- PARA CONFERIR. A primeira tem de devolver ZERO linhas (nenhum nome+sigla+tipo
-- repetido sobrou):
--
--   SELECT nome, sigla, tipo_cliente_id, COUNT(*)
--     FROM mapoteca.cliente
--    GROUP BY nome, sigla, tipo_cliente_id
--   HAVING COUNT(*) > 1;
--
-- E a segunda tem de trazer o 3o GAC Ap com UMA linha e DOIS pedidos:
--
--   SELECT c.id, c.nome, c.sigla, c.ponto_contato_principal,
--          COUNT(p.id) AS pedidos
--     FROM mapoteca.cliente AS c
--     LEFT JOIN mapoteca.pedido AS p ON p.cliente_id = c.id
--    WHERE c.sigla = '3º GAC Ap'
--    GROUP BY c.id, c.nome, c.sigla, c.ponto_contato_principal;
--
-- PARA DESFAZER, e o desfazer e real porque a trilha e append-only e guarda as
-- duas metades. A ficha volta do proprio evento 'D', com o id original, e o
-- pedido volta para ela pelo `dados_antes` do evento 'U'. A sequencia se
-- reposiciona no fim porque o id volta com valor explicito:
--
--   BEGIN;
--
--   INSERT INTO mapoteca.cliente
--     (id, nome, sigla, ponto_contato_principal, endereco_entrega_principal,
--      tipo_cliente_id)
--   SELECT (dados_antes->>'id')::bigint,
--          dados_antes->>'nome',
--          dados_antes->>'sigla',
--          dados_antes->>'ponto_contato_principal',
--          dados_antes->>'endereco_entrega_principal',
--          (dados_antes->>'tipo_cliente_id')::smallint
--     FROM auditoria.evento
--    WHERE tabela = 'mapoteca.cliente' AND operacao = 'D' AND origem = 'migracao'
--      AND motivo LIKE 'Virada 3.4.0:%';
--
--   UPDATE mapoteca.pedido AS p
--      SET cliente_id = (e.dados_antes->>'cliente_id')::bigint
--     FROM auditoria.evento AS e
--    WHERE e.tabela = 'mapoteca.pedido' AND e.operacao = 'U'
--      AND e.origem = 'migracao' AND e.motivo LIKE 'Virada 3.4.0:%'
--      AND p.id = e.registro_id::bigint;
--
--   SELECT setval('mapoteca.cliente_id_seq', (SELECT MAX(id) FROM mapoteca.cliente));
--   UPDATE public.versao SET nome = '3.3.0' WHERE code = 1;
--
--   COMMIT;
--
-- O que o desfazer NAO devolve e o COALESCE do contato e do endereco: se ele
-- tiver preenchido campo vazio do sobrevivente, o campo fica preenchido. Nesta
-- producao ele nao preencheu nada, e o `dados_antes` do evento 'D' guarda os
-- valores do descartado de qualquer forma.
