# -*- coding: utf-8 -*-
"""Cross-valida frames DsgTools x grade do site, e calcula ordinais.

- Para cada MI do lote: INOM DsgTools == INOM grade; bbox DsgTools ~ bbox grade (<=1e-6).
- Ordinal: posicao de 2020 entre os anos pre-2022 de edicoes_topo da grade.
- Reporta divergencias e MIs ausentes da grade.
"""
import sys
import io
import json

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

GRADE = r'D:\desenvolvimento\produtos\data\situacao-geral-ct-25k.geojson'
FRAMES = r'D:\desenvolvimento\controle_acervo\carga\sisfron_2020_frames.json'
PLANILHA = r'D:\desenvolvimento\controle_acervo\carga\sisfron_2020_planilha.json'
CORTE = 2022
TOL = 1e-6


def bbox_of_ring(ring):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return [min(xs), min(ys), max(xs), max(ys)]


def main():
    grade = json.load(open(GRADE, encoding='utf-8'))
    frames = json.load(open(FRAMES, encoding='utf-8'))
    planilha = json.load(open(PLANILHA, encoding='utf-8'))

    por_mi = {f['properties']['identificadorMI']: f for f in grade['features']}

    mis = sorted(frames.keys())
    divergencias = []
    ausentes_grade = []
    relatorio = {}

    for mi in mis:
        fr = frames[mi]
        dsg_inom = fr['inom']
        dsg_bbox = fr['bbox']

        cell = por_mi.get(mi)
        if cell is None:
            ausentes_grade.append(mi)
            relatorio[mi] = {'dsg_inom': dsg_inom, 'grade': False}
            continue

        grid_inom = cell['properties']['identificadorINOM']
        grid_bbox = bbox_of_ring(cell['geometry']['coordinates'][0])

        inom_ok = (dsg_inom == grid_inom)
        bbox_diffs = [abs(a - b) for a, b in zip(dsg_bbox, grid_bbox)]
        bbox_ok = all(d <= TOL for d in bbox_diffs)

        if not inom_ok:
            divergencias.append(f'{mi}: INOM dsg={dsg_inom} grade={grid_inom}')
        if not bbox_ok:
            divergencias.append(f'{mi}: bbox diff={[round(d,9) for d in bbox_diffs]} dsg={dsg_bbox} grade={grid_bbox}')

        # ordinal de 2020
        edicoes = cell['properties'].get('edicoes_topo', []) or []
        anos = sorted({int(a) for a in edicoes if str(a).isdigit() and int(a) < CORTE})
        ordinal = None
        if 2020 in anos:
            ordinal = anos.index(2020) + 1

        relatorio[mi] = {
            'dsg_inom': dsg_inom,
            'grade': True,
            'grid_inom': grid_inom,
            'inom_ok': inom_ok,
            'bbox_ok': bbox_ok,
            'bbox_max_diff': max(bbox_diffs),
            'edicoes_topo': edicoes,
            'anos_pre_corte': anos,
            'ordinal_2020': ordinal,
            'cont_edicao_planilha': planilha.get(mi, [{}])[0].get('Cont_Edicao'),
        }

    # ordinais
    print('=== ORDINAIS (grade vs Cont_Edicao planilha) ===')
    flag_ord = []
    for mi in mis:
        r = relatorio[mi]
        if not r['grade']:
            print(f'  {mi}: AUSENTE da grade -> usar Cont_Edicao planilha={r.get("cont_edicao_planilha")}')
            continue
        ordg = r['ordinal_2020']
        contp = r['cont_edicao_planilha']
        marca = ''
        if ordg is None:
            marca = ' [2020 NAO ESTA nas edicoes pre-corte da grade!]'
            flag_ord.append(mi)
        elif str(ordg) != str(contp):
            marca = f' [DIVERGE planilha cont={contp}]'
            flag_ord.append(mi)
        print(f'  {mi}: edicoes={r["edicoes_topo"]} -> ordinal_2020={ordg} cont_planilha={contp}{marca}')

    print('\n=== CROSS-VALIDACAO GEOMETRIA ===')
    print(f'MIs no lote: {len(mis)}')
    print(f'MIs ausentes da grade: {ausentes_grade}')
    print(f'Divergencias INOM/bbox: {len(divergencias)}')
    for d in divergencias:
        print('  ', d)
    max_diff_global = max((r['bbox_max_diff'] for r in relatorio.values() if r.get('grade')), default=None)
    print(f'max bbox diff global: {max_diff_global}')
    print(f'todos no grid? {len(ausentes_grade) == 0}')

    json.dump(relatorio, open(r'D:\desenvolvimento\controle_acervo\carga\sisfron_2020_validacao.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

    # Veredito
    if divergencias:
        print('\n*** ABORTAR: divergencia DsgTools x grade ***')
        sys.exit(2)
    if flag_ord:
        print(f'\n*** ATENCAO: ordinais a revisar: {flag_ord} ***')


if __name__ == '__main__':
    main()
