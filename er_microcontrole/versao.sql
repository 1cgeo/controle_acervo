BEGIN;

-- O CARIMBO DO BANCO DA TELEMETRIA, e ele é de OUTRO banco: não confundir com
-- `er/versao.sql`, que carimba o banco do SAP e cria também
-- `public.layer_styles`, que o QGIS lê. Aqui não há estilo nenhum a guardar,
-- porque ninguém abre a telemetria como camada de trabalho.
--
-- NENHUM CÓDIGO LÊ ESTA TABELA HOJE, e ela existe assim mesmo. O piso de
-- `MIN_DATABASE_VERSION` (`server/src/config.js`) vale para o banco principal,
-- que é quem responde por toda regra de negócio; a telemetria tem três tabelas,
-- e o serviço tem de subir mesmo com ela fora do ar, então cobrar versão dela
-- no boot seria transformar uma indisponibilidade tolerada em queda de serviço.
-- O carimbo é para QUEM OPERA: sem ele, a única forma de saber a idade de um
-- banco de telemetria seria comparar `information_schema` à mão.
--
-- 3.0.0, E NÃO 1.0.0 COMO NO SAP 2.3.5: este banco nasce na versão 3.0.0, e
-- os dois bancos da instalação passam a responder o mesmo número. Uma série
-- própria, começando em 1.0.0, faria "qual a versão da instalação" ter duas
-- respostas que nunca se encontram.
CREATE TABLE public.versao(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO public.versao (code, nome) VALUES
(1, '3.0.0');

COMMENT ON TABLE public.versao IS
    'Versão do schema DESTE banco (o da telemetria). Uma linha só, e o code existe para garantir isso.';

COMMIT;
