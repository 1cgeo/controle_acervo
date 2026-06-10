# -*- coding: utf-8 -*-
"""Cross-validação grade do site × molduras DsgTools para o lote SISFRON 2020.

Uso: python valida_grade_sisfron_2020.py <grade.geojson> <molduras_dsgtools.json> <saida.json>

Para cada MI do lote:
  - se presente na grade: INOM DsgTools deve == INOM da grade e o bbox da
    moldura DsgTools deve coincidir com o bbox da grade (tolerância 1e-6 graus);
  - calcula o ordinal da edição 2020 entre os anos pré-ET-RDG (< 2022) de
    edicoes_topo (mesma lógica do carga_saica_2017.cjs).
Saída: JSON por MI com fonte da geometria (grade|dsgtools), ring, inom, ordinal.
"""
import sys
import io
import json
import re

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

TOL = 1e-6
CORTE_ET_RDG = 2022


def bbox_of_ring(ring):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return [min(xs), min(ys), max(xs), max(ys)]


def main():
    grade_path, dsg_path, saida = sys.argv[1], sys.argv[2], sys.argv[3]
    with open(grade_path, encoding='utf-8') as f:
        grade = json.load(f)
    with open(dsg_path, encoding='utf-8') as f:
        dsg = json.load(f)

    por_mi = {f['properties']['identificadorMI']: f for f in grade['features']}

    resultado = {}
    divergencias = []
    for item in dsg:
        mi = item['mi']
        if not item.get('inom'):
            divergencias.append(f'{mi}: DsgTools não retornou INOM')
            continue
        cel = por_mi.get(mi)
        if cel is None:
            resultado[mi] = {
                'fonte': 'dsgtools',
                'inom': item['inom'],
                'ring': item['ring'],
                'edicoes_topo': None,
                'ordinal_2020': None,
            }
            print(f'{mi}: AUSENTE da grade -> moldura DsgTools ({item["inom"]})')
            continue

        inom_grade = cel['properties']['identificadorINOM']
        if inom_grade != item['inom']:
            divergencias.append(f'{mi}: INOM grade={inom_grade} != DsgTools={item["inom"]}')
            continue

        ring_grade = cel['geometry']['coordinates'][0]
        bb_g = bbox_of_ring(ring_grade)
        bb_d = item['bbox']
        if any(abs(a - b) > TOL for a, b in zip(bb_g, bb_d)):
            divergencias.append(f'{mi}: bbox grade={bb_g} != DsgTools={bb_d}')
            continue

        edicoes = cel['properties'].get('edicoes_topo') or []
        anos = sorted({int(a) for a in edicoes if re.match(r'^\d{4}$', str(a))
                       if int(a) < CORTE_ET_RDG})
        ordinal = anos.index(2020) + 1 if 2020 in anos else None
        if ordinal is None:
            divergencias.append(f'{mi}: 2020 não consta em edicoes_topo={edicoes}')
            continue

        resultado[mi] = {
            'fonte': 'grade',
            'inom': inom_grade,
            'ring': ring_grade,
            'edicoes_topo': edicoes,
            'anos_pre_etrdg': anos,
            'ordinal_2020': ordinal,
        }
        print(f'{mi}: OK grade inom={inom_grade} edicoes={edicoes} -> ordinal 2020 = {ordinal}')

    print(f'\n{len(resultado)} MIs validadas; {len(divergencias)} divergência(s)')
    for d in divergencias:
        print('  DIVERGÊNCIA:', d)

    with open(saida, 'w', encoding='utf-8') as f:
        json.dump(resultado, f, ensure_ascii=False, indent=2)
    print(f'-> {saida}')
    if divergencias:
        sys.exit(1)


if __name__ == '__main__':
    main()
