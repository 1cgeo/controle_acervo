# Path: gui\bulk_versao_relacionamento\bulk_versao_relacionamento_dialog.py
"""Relacionamentos entre versões, em lote."""
import os

from qgis.PyQt import uic
from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtWidgets import QDialog, QMessageBox

from ..camada_modelo import (Campo, CamadaModelo, preencher_combo_de_camadas,
                             relatar_feicoes_invalidas, sem_null)

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'bulk_versao_relacionamento_dialog.ui'))

MODELO = CamadaModelo(
    "Modelo - Relacionamentos entre versões",
    [Campo('versao_id_1', 'integer', True, 'id da primeira versão'),
     Campo('versao_id_2', 'integer', True, 'id da segunda versão'),
     Campo('tipo_relacionamento_id', 'integer', True,
           'código do tipo de relacionamento (1 insumo, 2 complementar, 3 conjunto)')],
    com_geometria=False,
    observacao="O relacionamento não tem direção: (A, B) e (B, A) são o mesmo vínculo."
)


class BulkCreateVersionRelationshipsDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(BulkCreateVersionRelationshipsDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        self.setup_ui()

    def setup_ui(self):
        self.setWindowTitle("Criar relacionamentos entre versões em lote")

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

        vinculos = self.montar_corpo(camada)
        if not vinculos:
            return

        self.setCursor(Qt.CursorShape.WaitCursor)
        self.statusLabel.setText(f"Criando {len(vinculos)} relacionamento(s)...")
        try:
            resposta = self.api_client.post('produtos/versao_relacionamento',
                                            {'versao_relacionamento': vinculos})
        finally:
            self.setCursor(Qt.CursorShape.ArrowCursor)

        if resposta and resposta.get('success'):
            self.statusLabel.setText(f"{len(vinculos)} relacionamento(s) criados.")
            QMessageBox.information(self, "Pronto",
                                    f"{len(vinculos)} relacionamento(s) criados com sucesso.")
        else:
            self.statusLabel.setText("O servidor não criou os relacionamentos.")

    def montar_corpo(self, camada):
        presentes = {f.name() for f in camada.fields()}
        vinculos, invalidas = [], []
        total = 0

        # Deduplicação no cliente, pela tupla EXATA, que é o que a
        # `unique_versao_relacionamento` cobre: (versao_id_1, versao_id_2,
        # tipo). Uma linha repetida faria a transação INTEIRA falhar no
        # servidor, e o lote de 300 vínculos morreria por causa de uma.
        #
        # O par INVERTIDO não é descartado, e isso é deliberado: para o banco
        # (A, B) e (B, A) são linhas diferentes, e as duas entram. Descartar
        # seria decidir por conta própria jogar fora um dado que o servidor
        # aceitaria. Mas a leitura casa por `versao_id_1 = X OR versao_id_2 = X`,
        # então o vínculo apareceria DUAS vezes na ficha do produto, e por isso
        # existe o aviso.
        vistos = set()
        invertidos = []
        repetidos = 0

        for feature in camada.getFeatures():
            total += 1
            nulos = MODELO.campos_nulos(feature, presentes)
            if nulos:
                invalidas.append((feature.id(), "campo obrigatório em branco: " + ", ".join(nulos)))
                continue

            v1 = sem_null(feature['versao_id_1'])
            v2 = sem_null(feature['versao_id_2'])
            tipo = sem_null(feature['tipo_relacionamento_id'])

            if v1 == v2:
                invalidas.append((feature.id(), "uma versão não se relaciona com ela mesma"))
                continue

            chave = (v1, v2, tipo)
            if chave in vistos:
                repetidos += 1
                continue
            if (v2, v1, tipo) in vistos:
                invertidos.append(f"{v1} e {v2}")
            vistos.add(chave)

            vinculos.append({'versao_id_1': v1, 'versao_id_2': v2,
                             'tipo_relacionamento_id': tipo})

        if not relatar_feicoes_invalidas(self, invalidas, total):
            return None

        if repetidos:
            QMessageBox.information(
                self, "Repetições ignoradas",
                f"{repetidos} linha(s) idêntica(s) foram descartadas antes do envio.\n\n"
                "A UNIQUE do banco recusaria a segunda, e isso derrubaria a transação "
                "inteira: o lote todo falharia por causa de uma linha repetida."
            )

        if invertidos:
            prosseguir = QMessageBox.question(
                self, "Par invertido na camada",
                "A camada traz o MESMO vínculo nos dois sentidos para: "
                + ", ".join(invertidos[:10])
                + (f" e mais {len(invertidos) - 10}." if len(invertidos) > 10 else ".")
                + "\n\nO banco aceita os dois (a UNIQUE é sobre a ordem), mas a ficha do "
                  "produto lê o vínculo pelos dois lados, então ele apareceria repetido.\n\n"
                  "Enviar assim mesmo?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
            )
            if prosseguir != QMessageBox.StandardButton.Yes:
                return None

        if not vinculos:
            QMessageBox.warning(self, "Nada a enviar", "A camada não tem nenhuma feição válida.")
            return None
        return vinculos
