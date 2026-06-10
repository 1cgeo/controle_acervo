# -*- coding: utf-8 -*-
"""Gera molduras (EPSG:4674) pelo INOM de cada JSON de edição, via DsgTools.
Para MIs fora da grade do site (ex.: Mato Grosso do Sul, Roraima).

Executar com o Python do QGIS 4:
  & 'C:\\Program Files\\QGIS 4.0.0\\bin\\python-qgis.bat' gera_frames.py <saida.json> <pasta_JSON>
(<pasta_JSON> é varrida recursivamente; ignora templates/correcao.)
"""
import sys, io, json, glob, os, re

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

FRAMETOOLS = r'D:\desenvolvimento\DsgTools\DsgTools\core\Utils\FrameTools'
sys.path.insert(0, FRAMETOOLS)
from qgis.core import QgsApplication  # noqa: E402
qgs = QgsApplication([], False)
QgsApplication.setPrefixPath(r'C:\Program Files\QGIS 4.0.0\apps\qgis', True)
qgs.initQgis()
import map_index  # noqa: E402


def mi_do_arquivo(path):
    return re.sub(r'_\d+dpi$', '', os.path.splitext(os.path.basename(path))[0])


def main():
    saida, json_dir = sys.argv[1], sys.argv[2]
    grid = map_index.UtmGrid()
    out = {}
    jsons = [p for p in glob.glob(os.path.join(json_dir, '**', '*.json'), recursive=True)
             if not re.search(r'modelo|template|correcao|Gera_XML', p, re.I)]
    for jp in sorted(jsons):
        mi = mi_do_arquivo(jp)
        try:
            inom = json.load(open(jp, encoding='utf-8-sig')).get('inom')
            poly = grid.getQgsPolygonFrame(inom, 1, 1)
            bb = poly.boundingBox()
            xmin, ymin, xmax, ymax = bb.xMinimum(), bb.yMinimum(), bb.xMaximum(), bb.yMaximum()
            out[mi] = {'inom': inom, 'ring': [[xmin, ymin], [xmax, ymin], [xmax, ymax], [xmin, ymax], [xmin, ymin]]}
        except Exception as e:
            print(f'{mi}: ERRO {e}')
    json.dump(out, open(saida, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f'{len(out)} molduras -> {saida}')
    qgs.exitQgis()


if __name__ == '__main__':
    main()
