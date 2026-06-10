# -*- coding: utf-8 -*-
import json, re, io, sys
from pypdf import PdfReader
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

SITE = r'D:\desenvolvimento\produtos\data\situacao-geral-ct-100k.geojson'
SRC = r'Y:\Produtos_2021\2021_SISFRON_Generalizacao_100k\CT'
ALVO = ['2753', '2779', '2799']


def info_carta(mi):
    r = PdfReader(rf'{SRC}\{mi}.pdf')
    t = ' '.join((r.pages[0].extract_text() or '').replace('−', '-').split())
    m = re.search(r'CARTA TOPOGR[ÁA]FICA (.+?) [ÍI]NDICE', t)
    nome = m.group(1).strip() if m else None
    z = re.search(r'UTM Zona (\d{1,2})', t)
    zona = int(z.group(1)) if z else None
    # SIRGAS 2000 / UTM zona N Sul: EPSG = 31960 + N (21S->31981, 22S->31982)
    epsg_pdf = str(31960 + zona) if zona else None
    return nome, zona, epsg_pdf


gj = json.load(open(SITE, encoding='utf-8'))
feat = {str(f['properties']['identificadorMI']): f for f in gj['features']}

dados = {}
for mi in ALVO:
    f = feat[mi]
    p = f['properties']
    eds = [int(x) for x in p['edicoes_topo']]
    pre = sorted(e for e in eds if e < 2022)
    ordinal = pre.index(2021) + 1
    nome, zona, epsg_pdf = info_carta(mi)
    dados[mi] = {
        'inom': p['identificadorINOM'],
        'nome': nome,
        'ring': f['geometry']['coordinates'][0],
        'edicoes': eds,
        'ordinal': ordinal,
        'utm_zona': zona,
        'epsg_pdf': epsg_pdf
    }
    print(f"{mi} | {nome} | INOM {dados[mi]['inom']} | edicoes {eds} | ordinal(2021)={ordinal} | UTM {zona} -> PDF EPSG {epsg_pdf}")

json.dump(dados, open(r'D:\desenvolvimento\controle_acervo\carga\sisfron_2021_100k_dados.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('ok -> sisfron_2021_100k_dados.json')
