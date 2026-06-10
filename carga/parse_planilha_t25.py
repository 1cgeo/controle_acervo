# -*- coding: utf-8 -*-
"""Extrai da planilha ASC (aba T25) as linhas das MIs do lote SISFRON 2020.

Uso: python parse_planilha_t25.py <planilha.ods> <saida.json>

Para cada MI do lote, seleciona a linha com Ano_Edicao == 2020 e exporta
Cont_Edicao, Nome, Orgao_Produtor, EPSG (e demais colunas para conferência).
"""
import sys
import io
import json
import zipfile
import xml.etree.ElementTree as ET

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

NS_TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0'
NS_TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0'

# MIs do lote 2020_SISFRON_PR_25k (derivadas dos nomes dos PDFs)
MIS = [
    '2753-1-NE', '2753-1-NO', '2753-1-SE', '2753-1-SO',
    '2753-2-NE', '2753-2-NO', '2753-2-SE', '2753-2-SO',
    '2753-3-NE', '2753-3-NO', '2753-3-SE', '2753-3-SO',
    '2753-4-NE', '2753-4-NO', '2753-4-SE', '2753-4-SO',
    '2779-1-NE', '2779-1-NO', '2779-1-SE', '2779-1-SO',
    '2779-2-NE', '2779-2-NO', '2779-2-SE', '2779-2-SO',
    '2779-3-NE', '2779-3-NO', '2779-3-SE', '2779-3-SO',
    '2779-4-NE', '2779-4-NO', '2779-4-SE', '2779-4-SO',
    '2799-1-NE', '2799-1-SE',
    '2799-2-NE', '2799-2-NO', '2799-2-SE', '2799-2-SO',
    '2799-3-NE', '2799-3-SE',
    '2799-4-NE', '2799-4-NO', '2799-4-SE', '2799-4-SO',
]


def cell_text(cell):
    parts = []
    for p in cell.iter('{%s}p' % NS_TEXT):
        parts.append(''.join(p.itertext()))
    return '\n'.join(parts).strip()


def expand_row(row):
    cells = []
    for cell in row:
        if cell.tag not in ('{%s}table-cell' % NS_TABLE, '{%s}covered-table-cell' % NS_TABLE):
            continue
        rep = int(cell.get('{%s}number-columns-repeated' % NS_TABLE, '1'))
        text = cell_text(cell)
        if rep > 500:  # cauda de células vazias repetidas
            rep = 1 if text else 0
        cells.extend([text] * rep)
    return cells


def main():
    ods, saida = sys.argv[1], sys.argv[2]
    with zipfile.ZipFile(ods) as z:
        root = ET.fromstring(z.read('content.xml'))

    tabela = None
    for t in root.iter('{%s}table' % NS_TABLE):
        if t.get('{%s}name' % NS_TABLE) == 'T25':
            tabela = t
            break
    if tabela is None:
        raise SystemExit('Aba T25 não encontrada')

    rows = tabela.findall('{%s}table-row' % NS_TABLE)
    header = expand_row(rows[0])
    print('Colunas T25:', header)

    idx = {name: i for i, name in enumerate(header) if name}
    quer = set(MIS)
    achados = {}

    for row in rows[1:]:
        cells = expand_row(row)
        if not cells:
            continue

        def get(col):
            i = idx.get(col)
            return cells[i] if i is not None and i < len(cells) else ''

        mi = get('MI')
        if mi not in quer:
            continue
        registro = {col: get(col) for col in header if col}
        achados.setdefault(mi, []).append(registro)

    # imprime todas as edições de cada MI para conferência
    for mi in MIS:
        linhas = achados.get(mi, [])
        print(f'\n{mi}: {len(linhas)} edição(ões)')
        for r in linhas:
            print('  ', {k: r.get(k) for k in ('Cont_Edicao', 'Nome', 'Orgao_Produtor', 'EPSG', 'Ano_Dados', 'Ano_Edicao', 'INOM', 'Tipo_Produto', 'PDF', 'Geotiff')})

    with open(saida, 'w', encoding='utf-8') as f:
        json.dump(achados, f, ensure_ascii=False, indent=2)
    faltam = [mi for mi in MIS if mi not in achados]
    print(f'\n{len(achados)}/{len(MIS)} MIs encontradas -> {saida}')
    if faltam:
        print('FALTAM:', faltam)


if __name__ == '__main__':
    main()
