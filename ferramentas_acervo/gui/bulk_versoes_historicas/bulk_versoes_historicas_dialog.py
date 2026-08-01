# Path: gui\bulk_versoes_historicas\bulk_versoes_historicas_dialog.py
"""Versões históricas em lote, para produtos que JÁ existem.

Versão histórica é registro do acervo legado: nasce sem arquivo e aceita tanto o
rótulo moderno ("1-DSG") quanto o antigo ("1ª Edição").
"""
import os

from qgis.PyQt import uic
from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtWidgets import QDialog, QMessageBox

from ..camada_modelo import (Campo, CamadaModelo, preencher_combo_de_camadas,
                             relatar_feicoes_invalidas)
from ..campos_acervo import CAMPOS_VERSAO, montar_versao

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'bulk_versoes_historicas_dialog.ui'))

MODELO = CamadaModelo(
    "Modelo - Versões históricas em lote",
    [Campo('produto_id', 'integer', True, 'id do produto que já existe no acervo'),
     Campo('uuid_versao', 'string', False, 'uuid da versão, se o BDGEx já publicou um')]
    + CAMPOS_VERSAO,
    com_geometria=False,
    observacao=("O produto tem que existir. O subtipo da versão precisa ser compatível com o "
                "do produto: subtipo que exige produto próprio (Carta Topográfica Militar) só "
                "entra em produto do mesmo subtipo.")
)

# `tipo_versao_id` não entra: a rota é a de versão histórica, então o tipo é
# decidido por ela. Ter a coluna convidava a preenchê-la e a acreditar que ela
# muda alguma coisa.
MODELO.campos = [c for c in MODELO.campos if c.nome != 'tipo_versao_id']


class LoadHistoricalVersionsDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(LoadHistoricalVersionsDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        self.setup_ui()

    def setup_ui(self):
        self.setWindowTitle("Adicionar versões históricas em lote")

        if preencher_combo_de_camadas(self.layerComboBox, MODELO.com_geometria) == 0:
            self.layerComboBox.setEnabled(False)
            self.loadButton.setEnabled(False)
            self.statusLabel.setText(
                "Nenhuma camada tabular no projeto. Crie a camada modelo para começar."
            )

        self.loadButton.clicked.connect(self.enviar)
        self.createModelLayerButton.clicked.connect(self.criar_camada_modelo)

    def criar_camada_modelo(self):
        if MODELO.criar(self, self.layerComboBox, self.iface):
            self.loadButton.setEnabled(True)
            self.statusLabel.setText("Camada modelo criada. Preencha as feições e clique em Carregar.")

    def enviar(self):
        camada = self.layerComboBox.currentData()
        ok, motivo = MODELO.validar_camada(camada)
        if not ok:
            QMessageBox.critical(self, "Camada incompatível", motivo)
            return

        versoes = self.montar_corpo(camada)
        if not versoes:
            return

        self.setCursor(Qt.CursorShape.WaitCursor)
        self.statusLabel.setText(f"Enviando {len(versoes)} versão(ões)...")
        try:
            # O corpo desta rota é o ARRAY na raiz, e não um objeto que o
            # embrulha (produtoSchema.versoesHistoricas).
            resposta = self.api_client.post('produtos/versao_historica', versoes)
        finally:
            self.setCursor(Qt.CursorShape.ArrowCursor)

        if resposta and resposta.get('success'):
            self.statusLabel.setText(f"{len(versoes)} versão(ões) criadas.")
            QMessageBox.information(self, "Pronto",
                                    f"{len(versoes)} versão(ões) histórica(s) criadas com sucesso.")
        else:
            self.statusLabel.setText("O servidor não criou as versões.")

    def montar_corpo(self, camada):
        presentes = {f.name() for f in camada.fields()}
        versoes, invalidas = [], []
        total = 0

        for feature in camada.getFeatures():
            total += 1
            nulos = MODELO.campos_nulos(feature, presentes)
            if nulos:
                invalidas.append((feature.id(), "campo obrigatório em branco: " + ", ".join(nulos)))
                continue

            versao, erro = montar_versao(feature, presentes, versao_sozinha=True)
            if erro:
                invalidas.append((feature.id(), erro))
                continue

            versao['produto_id'] = feature['produto_id']
            versoes.append(versao)

        if not relatar_feicoes_invalidas(self, invalidas, total):
            return None
        if not versoes:
            QMessageBox.warning(self, "Nada a enviar", "A camada não tem nenhuma feição válida.")
            return None
        return versoes
