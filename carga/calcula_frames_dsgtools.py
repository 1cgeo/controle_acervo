# -*- coding: utf-8 -*-
"""Calcula INOM + moldura 25k (EPSG:4674, lon/lat) de cada MI via DsgTools.

Roda com o python do QGIS:
  & 'C:\\Program Files\\QGIS 4.0.0\\bin\\python-qgis.bat' calcula_frames_dsgtools.py <saida.json>

Para cada MI do lote: getINomenFromMI -> INOM; getLLCorner + spacing -> bbox;
exporta o anel exterior do retangulo (5 vertices, fechado) em lon/lat (EPSG:4674)
e a bbox para cross-validacao com a grade do site.
"""
import sys
import io
import json
import os
import importlib.util

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from qgis.core import QgsApplication

# Init headless
qgs = QgsApplication([], False)
qgs.initQgis()

# Importa o map_index.py diretamente pelo caminho do arquivo, sem disparar
# o __init__.py do plugin DsgTools (que exige 'processing' do QGIS).
MAP_INDEX_PATH = r'D:\desenvolvimento\DsgTools\DsgTools\core\Utils\FrameTools\map_index.py'
_spec = importlib.util.spec_from_file_location('dsg_map_index', MAP_INDEX_PATH)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
UtmGrid = _mod.UtmGrid

MARGINAIS = r'D:\desenvolvimento\controle_acervo\carga\sisfron_2020_marginais.json'

ESCALA_25K = 25


def main():
    saida = sys.argv[1]
    margs = json.load(open(MARGINAIS, encoding='utf-8'))
    mis = sorted({m['mi'] for m in margs})

    grid = UtmGrid()
    out = {}
    for mi in mis:
        inom = grid.getINomenFromMI(mi)
        if inom is None:
            out[mi] = {'erro': 'getINomenFromMI retornou None'}
            continue
        (x, y) = grid.getLLCorner(inom)  # lower-left lon, lat
        dx = grid.getSpacingX(ESCALA_25K)
        dy = grid.getSpacingY(ESCALA_25K)
        xmin, ymin = x, y
        xmax, ymax = x + dx, y + dy
        # anel exterior horario? a grade usa lon/lat; manter ordem (xmin,ymin)->(xmax,ymin)->(xmax,ymax)->(xmin,ymax)->fecha
        ring = [
            [xmin, ymin],
            [xmax, ymin],
            [xmax, ymax],
            [xmin, ymax],
            [xmin, ymin],
        ]
        out[mi] = {
            'inom': inom,
            'bbox': [xmin, ymin, xmax, ymax],
            'ring': ring,
            'dx': dx,
            'dy': dy,
        }

    with open(saida, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    erros = {k: v for k, v in out.items() if 'erro' in v}
    print(f'{len(out)} MIs processadas; {len(erros)} com erro')
    for mi in mis:
        v = out[mi]
        if 'erro' in v:
            print(f'  ERRO {mi}: {v["erro"]}')
        else:
            print(f"  {mi} -> {v['inom']} bbox={[round(c,6) for c in v['bbox']]}")
    print(f'-> {saida}')

    qgs.exitQgis()


if __name__ == '__main__':
    main()
