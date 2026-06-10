# -*- coding: utf-8 -*-
"""Extrai informações marginais dos PDFs de carta (camada de texto vetorial).

Uso: python extrai_marginais.py <pasta_pdfs> <saida.json>

Para cada PDF extrai: MI impresso (normalizado), data exata da última edição
e etapas de produção com anos. Ver regras_carga_produtos.md, seção 1.3.
"""
import sys
import io
import re
import json
import glob
import os
from pypdf import PdfReader

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

MESES = {
    'janeiro': 1, 'fevereiro': 2, 'março': 3, 'abril': 4, 'maio': 5, 'junho': 6,
    'julho': 7, 'agosto': 8, 'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12
}

ETAPAS = [
    'Imageamento', 'Aquisição Vetorial', 'Apoio de Campo', 'Aerotriangulação',
    'Restituição', 'Reambulação', 'Validação', 'Edição'
]


def normaliza(texto):
    """Normaliza o sinal U+2212 usado nos PDFs no lugar do hífen."""
    return texto.replace('−', '-')


def extrai(path):
    reader = PdfReader(path)
    text = normaliza(reader.pages[0].extract_text() or '')
    flat = ' '.join(text.split())

    dados = {'arquivo': os.path.basename(path)}

    m = re.search(r'MI[:\s]+(\d{1,4}(?:-\d)?(?:-[NS][EO])?)', flat)
    dados['mi'] = m.group(1) if m else None

    # leiaute 2017: "em 29 de junho de 2017"; leiaute 2020: "em 16 abril de 2020"
    m = re.search(r'Última edição em (\d{1,2}) (?:de )?(\w+) de (\d{4})', flat)
    if m:
        dia, mes, ano = int(m.group(1)), MESES.get(m.group(2).lower()), int(m.group(3))
        dados['data_edicao'] = f'{ano:04d}-{mes:02d}-{dia:02d}' if mes else str(ano)
    else:
        dados['data_edicao'] = None

    etapas = {}
    for etapa in ETAPAS:
        # (?=\D|$): o pypdf às vezes cola o ano à palavra seguinte ("2017Aquisição")
        m = re.search(re.escape(etapa) + r'\s+(.*?)\s+((?:19|20)\d{2})(?=\D|$)', flat)
        if m:
            etapas[etapa.lower().replace(' ', '_')] = {
                'executor': m.group(1).strip(' -'),
                'ano': int(m.group(2))
            }
    dados['etapas_producao'] = etapas

    m = re.search(r'Datum Horizontal\s+([A-Za-z0-9 ]+?)\s+(?:ETAPAS|Datum|Modelo|$)', flat)
    dados['datum_horizontal'] = m.group(1).strip() if m else None
    m = re.search(r'Datum Vertical\s+(.+?)(?:\s+(?:Datum|[A-Z]{2,})|$)', flat)
    dados['datum_vertical'] = m.group(1).strip() if m else None

    # data_criacao = último insumo: reambulação > outro campo > imagem
    ano_criacao = None
    for chave in ('reambulacao', 'reambulação', 'apoio_de_campo', 'imageamento'):
        if chave in etapas:
            ano_criacao = etapas[chave]['ano']
            break
    dados['ano_ultimo_insumo'] = ano_criacao

    return dados


def main():
    pasta, saida = sys.argv[1], sys.argv[2]
    resultados = []
    for path in sorted(glob.glob(os.path.join(pasta, '*.pdf'))):
        d = extrai(path)
        resultados.append(d)
        print(f"{d['arquivo']}: MI={d['mi']} edicao={d['data_edicao']} insumo={d['ano_ultimo_insumo']} etapas={len(d['etapas_producao'])}")

    with open(saida, 'w', encoding='utf-8') as f:
        json.dump(resultados, f, ensure_ascii=False, indent=2)
    print(f'\n{len(resultados)} PDFs processados -> {saida}')


if __name__ == '__main__':
    main()
