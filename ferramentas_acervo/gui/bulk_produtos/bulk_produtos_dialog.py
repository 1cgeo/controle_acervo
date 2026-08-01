# Path: gui\bulk_produtos\bulk_produtos_dialog.py
"""Criação de produtos em lote, sem versão e sem arquivo."""
import os

from qgis.PyQt import uic
from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtWidgets import QDialog, QMessageBox

from ..camada_modelo import (CamadaModelo, preencher_combo_de_camadas,
                             relatar_feicoes_invalidas)
from ..campos_acervo import CAMPOS_PRODUTO, montar_produto

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'bulk_produtos_dialog.ui'))

MODELO = CamadaModelo(
    "Modelo - Produtos em lote",
    CAMPOS_PRODUTO,
    com_geometria=True,
    observacao=("Os produtos nascem sem versão e sem arquivo. As versões entram depois, "
                "por 'Adicionar Versões a Produtos em Lote'.")
)


class BulkCreateProductsDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(BulkCreateProductsDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        self.setup_ui()

    def setup_ui(self):
        self.setWindowTitle("Criar produtos em lote")

        if preencher_combo_de_camadas(self.layerComboBox, MODELO.com_geometria) == 0:
            self.layerComboBox.setEnabled(False)
            self.loadButton.setEnabled(False)
            self.statusLabel.setText(
                "Nenhuma camada compatível no projeto. Crie a camada modelo para começar."
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

        produtos = self.montar_corpo(camada)
        if produtos is None:
            return

        self.setCursor(Qt.CursorShape.WaitCursor)
        self.statusLabel.setText(f"Criando {len(produtos)} produto(s)...")
        try:
            resposta = self.api_client.post('produtos/produtos', {'produtos': produtos})
        finally:
            self.setCursor(Qt.CursorShape.ArrowCursor)

        if resposta and resposta.get('success'):
            self.statusLabel.setText(f"{len(produtos)} produto(s) criados.")
            QMessageBox.information(self, "Pronto", f"{len(produtos)} produto(s) criados com sucesso.")
        else:
            # 4xx já foi mostrado pelo api_client, com a mensagem do servidor.
            self.statusLabel.setText("O servidor não criou os produtos.")

    def montar_corpo(self, camada):
        presentes = {f.name() for f in camada.fields()}
        produtos, invalidas = [], []
        total = 0

        for feature in camada.getFeatures():
            total += 1
            nulos = MODELO.campos_nulos(feature, presentes)
            # `geom` é obrigatório mas pode vir da geometria da feição, então
            # quem cobra a geometria é o montar_produto, não a checagem de nulo.
            nulos = [n for n in nulos if n != 'geom']
            if nulos:
                invalidas.append((feature.id(), "campo obrigatório em branco: " + ", ".join(nulos)))
                continue

            produto, erro = montar_produto(feature, presentes, self.api_client.dominios)
            if erro:
                invalidas.append((feature.id(), erro))
                continue
            produtos.append(produto)

        if not relatar_feicoes_invalidas(self, invalidas, total):
            return None
        if not produtos:
            QMessageBox.warning(self, "Nada a enviar", "A camada não tem nenhuma feição válida.")
            return None
        return produtos
