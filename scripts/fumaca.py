#!/usr/bin/env python3
"""Fumaca da plataforma DGEO: os tres modulos de ponta a ponta, SO LEITURA.

Roda depois de todo deploy. Nenhum POST, PUT, PATCH ou DELETE, exceto o proprio
login. Cada checagem diz o que esperava e o que veio, para o resultado ser prova
e nao impressao.

Uso:
    SCA_URL=http://localhost:3015 SCA_USER=<login> SCA_SENHA=<senha> \
        python scripts/fumaca.py

A URL tambem pode vir como primeiro argumento. Sai com 0 se tudo passa, 1 se
alguma checagem falha, para servir de portao num script de deploy.

Os limites minimos abaixo sao do acervo da DGEO em 2026-07. Instalacao nova ou
outro acervo devolve menos: ajuste os minimos ou rode so as checagens de rota.
"""
import json
import os
import sys
import urllib.error
import urllib.request

# Host interno da DGEO sai por proxy Squid, que responde 503. Sempre direto.
for _chave in ('http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY'):
    os.environ.pop(_chave, None)

BASE = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get('SCA_URL', 'http://localhost:3015')).rstrip('/')
USUARIO = os.environ.get('SCA_USER')
SENHA = os.environ.get('SCA_SENHA')

if not USUARIO or not SENHA:
    sys.exit('Informe SCA_USER e SCA_SENHA no ambiente. A senha nunca vai na linha de comando.')

_op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
resultados = []


def chamar(rota, metodo='GET', corpo=None, token=None, cru=False):
    cabecalhos = {'Content-Type': 'application/json'}
    if token:
        cabecalhos['Authorization'] = 'Bearer ' + token
    dados = json.dumps(corpo).encode() if corpo else None
    req = urllib.request.Request(BASE + rota, data=dados, headers=cabecalhos, method=metodo)
    try:
        r = _op.open(req, timeout=40)
        corpo_resp = r.read()
        return r.status, (corpo_resp if cru else json.loads(corpo_resp.decode('utf-8', 'replace')))
    except urllib.error.HTTPError as ex:
        corpo_resp = ex.read()
        try:
            return ex.code, json.loads(corpo_resp.decode('utf-8', 'replace'))
        except Exception:
            return ex.code, corpo_resp
    except Exception as ex:
        return 0, {'message': f'{type(ex).__name__}: {ex}'}


def checa(descricao, ok, detalhe):
    resultados.append((descricao, ok, detalhe))
    print(f"  [{'OK ' if ok else 'FALHA'}] {descricao}: {detalhe}")


def secao(titulo):
    print()
    print('=' * 74)
    print(titulo)
    print('=' * 74)


def lista(rotas, token):
    for rota, rotulo, minimo in rotas:
        c, b = chamar(rota, token=token)
        d = b.get('dados') if isinstance(b, dict) else None
        n = len(d) if isinstance(d, list) else (1 if d else 0)
        checa(rotulo, c == 200 and n >= minimo, f'HTTP {c}, {n} registro(s)')


print(f'Fumaca da plataforma DGEO contra {BASE}')

secao('PLATAFORMA')
c, b = chamar('/', cru=True)
checa('interface servida na raiz', c == 200 and b'<html' in bytes(b).lower(),
      f'HTTP {c}, {len(b)} bytes')

c, b = chamar('/api')
checa('API operacional', c == 200, f"HTTP {c}, versao {b.get('version')}")

c, b = chamar('/api/login', 'POST', {'usuario': USUARIO, 'senha': SENHA, 'cliente': 'sca_web'})
dados = b.get('dados') or {}
tok = dados.get('token')
modulos = [m['nome_abrev'] for m in (dados.get('modulos') or [])]
checa('login devolve token e o catalogo dos tres modulos',
      c == 201 and bool(tok) and modulos == ['acervo', 'mapoteca', 'orcamento'],
      f'HTTP {c}, modulos={modulos}')
if not tok:
    print('\nSem token, o resto nao roda.')
    sys.exit(1)

c, b = chamar('/api/usuarios', token=tok)
checa('tela unica de usuarios', c == 200 and len(b.get('dados') or []) >= 1,
      f"HTTP {c}, {len(b.get('dados') or [])} usuarios")

c, _ = chamar('/api/login', 'POST', {'usuario': 'x', 'senha': 'y', 'cliente': 'inexistente'})
checa('cliente de login invalido e recusado', c == 400, f'HTTP {c}')

secao('MODULO ACERVO')
lista([
    ('/api/dashboard/produtos_total', 'total de produtos', 1),
    ('/api/dashboard/arquivos_total_gb', 'volume em GB', 1),
    ('/api/dashboard/produtos_tipo', 'produtos por tipo', 1),
    ('/api/dashboard/gb_volume', 'GB por volume de armazenamento', 1),
    ('/api/gerencia/dominio/tipo_produto', 'dominio tipo_produto', 5),
    ('/api/acervo/busca?tipo_escala_id=2&page=1&limit=5', 'busca de produtos', 1),
], tok)

secao('MODULO MAPOTECA')
lista([
    ('/api/mapoteca/cliente', 'clientes', 1),
    ('/api/mapoteca/pedido', 'pedidos', 1),
    ('/api/mapoteca/tipo_material', 'tipos de material', 1),
    ('/api/mapoteca/dominio/tipo_cliente', 'dominio tipo_cliente', 3),
], tok)

# A rota publica so responde 200 para localizador QUE EXISTE. Testar com um
# codigo inventado afere o 404, nao a rota, entao pegamos um real antes.
_, bl = chamar('/api/mapoteca/pedido', token=tok)
reais = [p.get('localizador_pedido') for p in (bl.get('dados') or []) if p.get('localizador_pedido')]
loc = reais[0] if reais else None
c, _ = chamar(f'/api/mapoteca/pedido/localizador/{loc}') if loc else (0, {})
checa('consulta publica por localizador NAO exige sessao', loc is not None and c == 200,
      f'HTTP {c} SEM token, localizador real')
c, _ = chamar('/api/mapoteca/pedido/localizador/AAAA-BBBB-CCCC')
checa('localizador inexistente devolve 404, e nao vaza pedido', c == 404, f'HTTP {c}')

secao('MODULO ORCAMENTO')
lista([
    ('/api/orcamento/notas_credito', 'notas de credito', 1),
    ('/api/orcamento/notas_empenho', 'notas de empenho', 1),
    ('/api/orcamento/dfd', 'DFD', 1),
    ('/api/orcamento/licitacoes', 'licitacoes', 1),
    ('/api/orcamento/rpnp', 'RPNP', 1),
    ('/api/orcamento/dominio/natureza_despesa', 'dominio ND', 8),
    ('/api/orcamento/dominio/plano_interno', 'dominio PI', 1),
], tok)

c, b = chamar('/api/orcamento/configuracao', token=tok)
cfg = b.get('dados') or {}
ano = cfg.get('ano_referencia')
checa('configuracao singleton', c == 200 and bool(cfg), f'HTTP {c}, ano_referencia={ano}')

if ano:
    lista([
        (f'/api/orcamento/pdr?ano={ano}', f'itens do PDR de {ano}', 1),
        (f'/api/orcamento/metas?ano={ano}', 'metas do PIT', 1),
    ], tok)

    c, b = chamar(f'/api/orcamento/dashboard/execucao_nd?ano={ano}&mes=6', token=tok)
    linhas = b.get('dados') or []
    checa('execucao por ND (o painel do orcamento)',
          c == 200 and isinstance(linhas, list) and len(linhas) >= 2,
          f'HTTP {c}, {len(linhas) if isinstance(linhas, list) else 0} linha(s)')

c, b = chamar('/api/orcamento/arquivo?nota_credito_id=1', token=tok)
checa('anexos de NC (conteudo BYTEA)', c == 200, f"HTTP {c}, {len(b.get('dados') or [])} anexo(s)")

secao('RPCMTec (plataforma, fora dos tres modulos)')
# Desde 2026-08-01 o relatorio inteiro sai de um gerador so. Antes eram dois
# (/api/relatorio/rpcmtec e /api/orcamento/relatorio/secao3), com numeracao
# propria cada um, e alguem colava um arquivo no outro. As 16 subsecoes sao as
# que o SCA preenche INTEIRAS; menos que isso e regressao.
c, b = chamar('/api/rpcmtec/gerar?ano=2026&mes=6', token=tok)
secoes = (b.get('dados') or {}).get('secoes') or []
subsecoes = [x for s_ in secoes for x in (s_.get('subsecoes') or [])]
checa('RPCMTec inteiro, na numeracao do documento da Divisao',
      c == 200 and len(subsecoes) == 16,
      f'HTTP {c}, {len(secoes)} secoes / {len(subsecoes)} subsecoes')

c, b = chamar('/api/rpcmtec/anuario?ano=2026&mes=6', token=tok)
d = b.get('dados') or {}
checa('Anuario Estatistico (Tabela 5.4.9, sobe para a DSG)',
      c == 200 and len(d.get('convencional') or []) == 18 and len(d.get('digital') or []) == 16,
      f"HTTP {c}, {len(d.get('convencional') or [])} convencional / {len(d.get('digital') or [])} digital")

secao('COLISOES DE NOME RESOLVIDAS PELO PREFIXO')
# /arquivo existe nos DOIS modulos. Antes da fusao colidia; o prefixo
# /api/orcamento/ e o que os faz conviver. 5xx aqui e regressao.
#
# `/relatorio` saiu desta lista em 2026-08-01: a colisao deixou de existir
# porque as duas rotas foram embora, cada uma para o seu lugar.
for rota_acervo, rota_orc, nome in [
    ('/api/arquivo/deletados?pagina=1&total_pagina=1', '/api/orcamento/arquivo?nota_credito_id=1', 'arquivo'),
]:
    ca, _ = chamar(rota_acervo, token=tok)
    co, _ = chamar(rota_orc, token=tok)
    checa(f'/{nome} do acervo e do orcamento coexistem', ca < 500 and co < 500,
          f'acervo HTTP {ca}, orcamento HTTP {co}')

print()
print('=' * 74)
falhas = [r for r in resultados if not r[1]]
print(f'RESULTADO: {len(resultados) - len(falhas)} de {len(resultados)} checagens passaram')
for desc, _, det in falhas:
    print(f'  FALHA: {desc}: {det}')
sys.exit(1 if falhas else 0)
