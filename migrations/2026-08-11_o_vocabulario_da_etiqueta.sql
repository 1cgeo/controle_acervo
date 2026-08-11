-- A ETIQUETA DO PEDIDO VIRA VOCABULARIO DE UMA PALAVRA, E NAO CAMPO LIVRE COM 34.
--
-- POR QUE. `mapoteca.pedido.palavras_chave` ganhou tela e busca em 2026-08-08,
-- e o cadastro e um campo livre sem sugestao nenhuma. A busca casa a etiqueta
-- INTEIRA e diferencia maiuscula (indice GIN, `@>`), entao so acha quem acerta a
-- grafia inteira.
--
-- A MEDIDA, em 2026-08-11, no banco de producao, antes desta migracao:
--
--   166 pedidos, 18 com etiqueta, 34 etiquetas distintas em 50 usos.
--   27 das 34 aparecem UMA vez so, e uma etiqueta usada uma vez nao agrupa nada:
--   ela e a observacao do pedido escrita no lugar errado.
--   O mesmo assunto tinha TRES grafias: 'excedente' (3), 'excedentes' (2) e
--   'exemplares excedentes' (2), em sete pedidos que a busca separava em tres
--   listas que nao se encontram.
--
-- A REGRA QUE O CHEFE FIXOU EM 2026-08-11, e que vale para etiqueta nova: o que
-- JA TEM COLUNA NAO VIRA ETIQUETA. Foi ela que decidiu cada corte abaixo, e e
-- ela que responde "esta etiqueta deve existir?" da proxima vez.
--
-- SOBRA UMA: 'excedente'.
--
-- O QUE SAI, e por que sair e o conserto. As 34 grafias eram de quatro tipos, e
-- so o primeiro sobrevive a regra:
--
--   1. O ASSUNTO 'excedente', em tres grafias. Fica, normalizado. E o fio da
--      redistribuicao de exemplares cartograficos excedentes da mapoteca, aberto
--      pelo DIEx 1724-DGEO/1º CGEO, de 02 JUL 26. Ele NAO tem coluna: atravessa
--      OM, documento e data, e em tres dos oito pedidos a `operacao` esta vazia.
--   2. NOME DE OM ('6º RCB', '13º BIB', '5ª Bda C Bld', '1º BPM'). Ja e o
--      CLIENTE do pedido, e a coluna Cliente da lista mostra e ordena por ele.
--   3. LUGAR E CONTEXTO ('Porto Alegre', 'Campos Gerais', 'area de atuacao',
--      'instrucao 2027'). Ja esta na observacao, que e onde a busca da tabela
--      procura.
--   4. NUMERO DE DOCUMENTO disfarcado ('Extra-PIT', nos pedidos 124 a 128).
--      O `documento_solicitacao` dos cinco ja diz 'Extra-PIT 04', '05', '08',
--      '09' e '12', e `previsto_pit` responde a pergunta de verdade. Prova de
--      que a etiqueta nao servia: OITO outros pedidos com 'Extra-PIT NN' no
--      documento (142 a 149) NUNCA receberam a etiqueta, e ninguem notou.
--
-- 'ARANDU' TAMBEM SAI, e este e o caso que mostra a regra funcionando. Ele era o
-- exercicio, e parecia a segunda etiqueta boa. Mas o exercicio JA TEM COLUNA: a
-- varredura de 2026-08-11 achou onze pedidos do Arandu (57, 58, 59, 64, 77, 79,
-- 80, 117, 130, 132 e 157), e a `operacao` de oito deles ja o nomeia. Etiquetar
-- o que a coluna ja diz e a mesma duplicacao dos itens 2 a 4 acima. Decisao do
-- chefe em 2026-08-11.
--
-- A CLASSIFICACAO E POR LEITURA DE TODOS OS 166 PEDIDOS, e nao por texto casado
-- as cegas. Os oito que ficam com 'excedente' sao o fio inteiro:
--
--   118  DIEx 2679-E2/ChEM/EMG, 3ª Bda C Mec, resposta a oferta
--   158  DIEx 1687-3ª Seção/3º RCG, resposta a oferta
--   159  DIEx 1882-S/3/9º RCB, resposta a oferta
--   161  DIEx 7234-E4/Cmdo CMS, transferencia para a 5ª Bda C Bld
--   162  DIEx 7234-E4/Cmdo CMS, transferencia para a 15ª Bda Inf Mec
--   163  DIEx 7234-E4/Cmdo CMS, transferencia para a 5ª DE
--   164  DIEx 4650-3ª Seção/Cmdo 3ª DE, resposta a oferta
--   167  DIEx 3139-E4/6DE, resposta a oferta, demanda da 3ª Bda C Mec
--
-- O 118 GANHA A ETIQUETA QUE NUNCA TEVE, e ele e a razao de esta migracao ser
-- uma classificacao, e nao so uma normalizacao de texto. Ele e do mesmo fio (a
-- propria observacao do 158 o cita: "como no pedido 118, mesmo fio de
-- excedentes"), e ficou de fora porque a etiqueta era digitada a mao, pedido a
-- pedido. Uma busca por 'excedente' que nao o trouxesse continuaria mentindo
-- depois da limpeza.
--
-- NENHUM DADO SE PERDE. Cada uma das 33 grafias apagadas repete o que o proprio
-- pedido ja guarda em cliente, documento, observacao, operacao ou `previsto_pit`.
-- O que sai e a COPIA, nunca o original.
--
-- ISTO SOZINHO NAO SEGURA. A migracao limpa o que existe, e o campo continua
-- livre. Quem impede a volta da bagunca e o autocomplete que entra junto
-- (`GET /api/mapoteca/pedido/palavras_chave`, mais o `datalist` do cadastro e da
-- busca): ele oferece a etiqueta ja usada antes de a pessoa digitar uma variante
-- nova, e adota a grafia da lista quando so a caixa difere. O chefe escolheu
-- campo livre com sugestao, e nao `select` fechado, para que etiqueta nova nasca
-- sem migracao.

BEGIN;

-- Primeiro ZERA todo mundo, e so depois marca os oito. Nesta ordem porque a
-- limpeza e a regra e a marcacao e a excecao: um UPDATE que so mexesse nas
-- linhas conhecidas deixaria passar qualquer etiqueta cadastrada entre a medida
-- e o momento de rodar isto.
UPDATE mapoteca.pedido
   SET palavras_chave = '{}'::varchar[]
 WHERE cardinality(palavras_chave) > 0;

-- Os oito pedidos do fio dos exemplares excedentes, por id: a classificacao saiu
-- da LEITURA de cada um, e nao de um ILIKE sobre a observacao, que traria
-- tambem quem apenas cita o assunto de passagem.
UPDATE mapoteca.pedido
   SET palavras_chave = ARRAY['excedente']::varchar[]
 WHERE id IN (118, 158, 159, 161, 162, 163, 164, 167);

COMMENT ON COLUMN mapoteca.pedido.palavras_chave IS
  'Etiquetas do pedido, para agrupar pedidos do mesmo assunto quando NENHUMA '
  'outra coluna ja o faz. VARCHAR[] com indice GIN: a busca casa a etiqueta '
  'INTEIRA e diferencia maiuscula de minuscula. Podada em 2026-08-11 de 34 '
  'grafias para uma (excedente). NAO etiquete o que ja tem coluna: cliente, '
  'documento, operacao, previsto_pit e o lugar, que mora na observacao.';

UPDATE public.versao SET nome = '3.3.0' WHERE code = 1;

COMMIT;

-- Para conferir depois de rodar. A primeira tem de devolver UMA linha,
-- 'excedente' com 8:
--
--   SELECT etiqueta, COUNT(*) AS pedidos
--     FROM mapoteca.pedido p, unnest(p.palavras_chave) AS etiqueta
--    GROUP BY etiqueta ORDER BY etiqueta;
--
-- E a segunda tem de devolver ZERO linhas (nenhum pedido de fora da lista ficou
-- com etiqueta, e nenhum da lista ficou sem):
--
--   SELECT id, palavras_chave FROM mapoteca.pedido
--    WHERE (id IN (118,158,159,161,162,163,164,167)) <> (palavras_chave = ARRAY['excedente']::varchar[])
--    ORDER BY id;
--
-- PARA DESFAZER NAO HA COMANDO, e e preciso dizer isso em vez de fingir que ha.
-- A migracao APAGA texto que nao esta em nenhuma outra coluna com aquela grafia,
-- e um `UPDATE` de volta teria de reescrever as 33 etiquetas pedido a pedido. O
-- estado anterior esta neste arquivo, na saida de `getPalavrasChave` medida em
-- 2026-08-11 e no backup do dia. Quem precisar voltar usa o backup, e nao um
-- bloco de desfazer que daria a impressao errada de reversibilidade.
--
-- O PISO DO BANCO NAO SOBE, e a assimetria e deliberada: esta migracao nao cria
-- schema, tabela nem coluna, so reescreve dado e o COMMENT. Um banco carimbado
-- 3.2.0 roda este codigo inteiro sem faltar nada, inclusive a rota nova, que le
-- a coluna que ja existe desde a instalacao. Por isso `VERSION` vai a 3.3.0 e
-- `MIN_DATABASE_VERSION` fica em 3.2.0, pela regra do paragrafo da 1.26.0 em
-- server/src/config.js.
