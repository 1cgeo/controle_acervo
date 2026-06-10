# -*- coding: utf-8 -*-
"""Gera INOM e moldura 25k (EPSG:4674) para as MIs do lote SISFRON 2020
usando o DsgTools (core/Utils/FrameTools/map_index.py).

Executar com o Python do QGIS:
  & 'C:\\Program Files\\QGIS 4.0.0\\bin\\python-qgis.bat' gera_molduras_dsgtools.py <saida.json>
"""
import sys
import io
import json
import os

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

FRAMETOOLS = r'D:\desenvolvimento\DsgTools\DsgTools\core\Utils\FrameTools'
sys.path.insert(0, FRAMETOOLS)

from qgis.core import QgsApplication  # noqa: E402

qgs = QgsApplication([], False)
QgsApplication.setPrefixPath(r'C:\Program Files\QGIS 4.0.0\apps\qgis', True)
qgs.initQgis()

import map_index  # noqa: E402

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


def main():
    saida = sys.argv[1]
    grid = map_index.UtmGrid()
    resultados = []
    for mi in MIS:
        inom = grid.getINomenFromMI(mi)
        if not inom:
            resultados.append({'mi': mi, 'inom': None, 'erro': 'MI sem INOM no DsgTools'})
            print(f'{mi}: SEM INOM')
            continue
        poly = grid.getQgsPolygonFrame(inom, 1, 1)
        bb = poly.boundingBox()
        xmin, ymin, xmax, ymax = bb.xMinimum(), bb.yMinimum(), bb.xMaximum(), bb.yMaximum()
        ring = [
            [xmin, ymin], [xmax, ymin], [xmax, ymax], [xmin, ymax], [xmin, ymin]
        ]
        resultados.append({'mi': mi, 'inom': inom, 'bbox': [xmin, ymin, xmax, ymax], 'ring': ring})
        print(f'{mi}: {inom} bbox=({xmin:.6f},{ymin:.6f},{xmax:.6f},{ymax:.6f})')

    with open(saida, 'w', encoding='utf-8') as f:
        json.dump(resultados, f, ensure_ascii=False, indent=2)
    print(f'\n{len(resultados)} molduras -> {saida}')
    qgs.exitQgis()


if __name__ == '__main__':
    main()
