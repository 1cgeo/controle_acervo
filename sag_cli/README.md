# sag_cli

CLI de **leitura** do SAG (Sistema de Apoio a Gestão), o espelho do SIAFI que a
administração do Exército usa. Irmão do `orcamento_cli`, e com o papel oposto: o
`orcamento_cli` escreve no SCA, este lê a fonte primária contra a qual o SCA se
confere.

## Por que ele existe

O módulo `orcamento` do SCA era alimentado à mão, a partir de PDF. O dado nasce
no SIAFI, e o SAG já o publica com todos os campos que o SCA guarda: número,
data, ND, PTRES, fonte, PI, UG emitente, valor e o histórico inteiro. Digitar de
novo o que a máquina já sabe é onde estava o custo, e é o que este CLI remove.

Ele **não escreve**, em nenhum dos dois lados. O SAG é alimentado pelo SIAFI e
pelos agentes da SALC: escrever daqui criaria uma segunda origem para o mesmo
fato. Quem grava no SCA continua sendo o `orcamento_cli`, com os guardrails dele
(dry-run contra o Joi vivo, confirmação de exclusão, releitura no destino).

## Como usar

```
node sag_cli/sag.js --ajuda

sag schema                    os documentos que este CLI consulta (não gasta rede)
sag schema nc                 colunas, períodos e filtros, lidos da tela viva
sag login                     autentica e guarda o cookie
sag nc listar --ano 2026 --ug-fav 160382
sag conferir nc --ano 2026 --acao 20XE --ug-fav 160382
```

Ambiente: `SAG_URL`, `SAG_USUARIO` (CPF, 11 dígitos) e `SAG_SENHA` (6 dígitos).
O comando `conferir` usa também as chaves do SCA (`SCA_URL` e `SCA_TOKEN`, ou
`SCA_USER` e `SCA_SENHA`). Catálogo em `.env.example`. Nunca passe senha na linha
de comando.

## O contrato sai da tela viva

Este CLI não guarda a lista de colunas do SAG. Ele lê o `<select>` da própria
tela em tempo de execução, como o `orcamento_cli` lê o Joi do `server/`. O único
dado local é o nome do arquivo PHP de cada documento (`lib/documentos.js`).
Contrato copiado apodrece; um nome de arquivo, não.

Por isso `sag schema nc` é o comando que se roda antes de montar uma consulta:
ele mostra as 39 colunas e os 20 seletores que a tela oferece **hoje**.

## O que foi medido, e o que não foi

`lib/documentos.js` marca cada documento com a data em que o contrato de
consulta foi exercido de verdade. Hoje só `nc` e `ne` estão medidos
(2026-08-07). Os demais (`ns`, `ob`, `ro`, `nl`, `ra`, `dr`, `df`) têm a página
mapeada, e o CLI **avisa** antes de entregar o resultado. Ausência de prova, e
não suspeita de defeito: quem medir, atualiza o arquivo.

## Três armadilhas que já custaram, e onde elas moram

**O SAG lista por ITEM; o SCA guarda por documento e ND.** Medido na
2026NC420174: duas linhas, `VALOR_NC` 18.422,14 nas duas, e
`DESTINO_VALOR_ITEM` 18.023,14 e 399,00, que somam o total. Ler o valor de
`VALOR_NC` funciona enquanto a NC tem uma ND só e mente quando ela tem duas,
que é um caso que o SCA modela de propósito. O agrupamento vive em
`comandos/conferir.js`, e a regra de soma por documento em `lib/documentos.js`.

**Duas convenções de número se cruzam aqui.** O SAG manda `"20.710,00"` e o SCA
manda `"20710.00"`. Tratar todo ponto como milhar transforma o segundo em
2071000, e a conferência acusa divergência em toda linha correta. Aconteceu na
primeira execução real; a regra que separa os dois casos está em
`lib/valores.js`, com teste de regressão.

**O charset não é confiável.** O SAG declara UTF-8, e uma leitura da mesma rota
só fez sentido em ISO-8859-1. Enquanto isso não se explicar, `lib/http.js`
decodifica tentando UTF-8 estrito e caindo para latin-1 quando ele reprova.
Byte alto solto não passa no decode estrito, então a regra acerta nos dois casos
sem precisar saber qual é.

## Teste

```
cd sag_cli && npm test
```

Roda offline, sem rede e sem credencial: o contrato é exercitado contra uma
fixture com a anatomia medida da tela.
