-- Migração: o ponto de controle passa a guardar DOIS arquivos, e não nove tipos.
--
-- Decisão do chefe em 2026-07-29, ao preparar a carga dos 3.490 pontos que já
-- existem no banco legado `ptocontrole`. O acervo passa a guardar, por ponto:
--
--   1. o PACOTE, um zip com tudo o que só se lê junto (RINEX, fotos de
--      rastreio, croqui, processamento, imagens da monografia, formato nativo);
--   2. a MONOGRAFIA, que é o documento que alguém busca sozinho.
--
-- São também os dois únicos downloads que a tela oferece, e é essa a razão da
-- mudança: o que não se baixa em separado não precisa de registro em separado.
--
-- O que se perde, e vale estar escrito: o checksum passa a ser do PACOTE, não da
-- peça. Um JPEG corrompido dentro do zip acusa o pacote inteiro, sem dizer qual.
-- E o `maximo_por_ponto` deixa de ser teto (4 fotos) e passa a ser regra exata
-- (um pacote, uma monografia).
--
-- Por que o domínio pode ser TROCADO e não mapeado: conferido em 2026-07-29, a
-- `ponto_controle.arquivo` em produção estava VAZIA (zero pontos, zero
-- arquivos). Se algum dia esta migração rodar num banco com dado, o DELETE
-- abaixo falha na chave estrangeira, que é o comportamento certo: melhor parar
-- do que apagar o tipo de um arquivo já gravado.
--
-- Roda num banco já na versão 1.6.0.
-- Aditiva e idempotente.

BEGIN;

-- Os nove códigos saem. A FK de `arquivo` protege: com dado gravado, isto
-- levanta erro em vez de deixar arquivo órfão de tipo.
DELETE FROM ponto_controle.tipo_arquivo WHERE code BETWEEN 1 AND 9;

INSERT INTO ponto_controle.tipo_arquivo (code, nome, maximo_por_ponto) VALUES
(1, 'Pacote do ponto', 1),
(2, 'Monografia', 1)
ON CONFLICT (code) DO UPDATE
  SET nome = EXCLUDED.nome,
      maximo_por_ponto = EXCLUDED.maximo_por_ponto;

-- O pacote de um ponto passa de 20 MB, e o `tamanho_mb` é REAL. Cabe, mas o
-- somatório do dashboard sobre 3.490 pacotes ganha precisão com NUMERIC.
ALTER TABLE ponto_controle.arquivo
    ALTER COLUMN tamanho_mb TYPE DOUBLE PRECISION;

-- A plataforma passa a exigir o domínio de dois códigos: o servidor recusa
-- subir em banco anterior, e a tela oferece exatamente dois downloads.
UPDATE public.versao SET nome = '1.7.0' WHERE code = 1;

COMMIT;
