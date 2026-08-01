# Path: gui\bulk_produtos_versoes_historicas\bulk_produtos_versoes_historicas_dialog.py
"""Produtos com versões históricas, em lote e sem arquivo.

A camada é PLANA: uma linha por versão. `produto_grupo_id` diz quais linhas são
o mesmo produto, e `versao_grupo_id`, a mesma versão dentro dele.
"""
import os

from qgis.PyQt import uic
from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtWidgets import QDialog, QMessageBox

from ..camada_modelo import (Campo, CamadaModelo, preencher_combo_de_camadas,
                             relatar_feicoes_invalidas)
from ..campos_acervo import (CAMPOS_PRODUTO, CAMPOS_VERSAO, agrupar_produtos_versoes,
                             conferir_identidade)

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'bulk_produtos_versoes_historicas_dialog.ui'))

# Na camada combinada, nome e descrição do produto levam nome próprio: `nome` e
# `descricao` secos seriam ambíguos ao lado dos da versão.
CAMPOS_PRODUTO_COMBINADO = [
    Campo('produto_nome' if c.nome == 'nome' else
          'descricao_produto' if c.nome == 'descricao' else c.nome,
          c.tipo, c.obrigatorio, c.ajuda)
    for c in CAMPOS_PRODUTO
]

MODELO = CamadaModelo(
    "Modelo - Produtos com versões históricas",
    [Campo('produto_grupo_id', 'integer', True,
           'mesmo número nas linhas que são o MESMO produto'),
     Campo('versao_grupo_id', 'integer', True,
           'mesmo número nas linhas que são a MESMA versão daquele produto')]
    + CAMPOS_PRODUTO_COMBINADO
    + [Campo('uuid_versao', 'string', False, 'uuid da versão, se o BDGEx já publicou um')]
    + [c for c in CAMPOS_VERSAO if c.nome != 'tipo_versao_id'],
    com_geometria=True,
    observacao=("As versões nascem SEM arquivo. Quando um subtipo exige produto próprio "
                "(Carta Topográfica Militar), preencha o subtipo do PRODUTO com o mesmo "
                "valor do subtipo da versão.")
)


class LoadHistoricalProductsDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(LoadHistoricalProductsDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        self.setup_ui()

    def setup_ui(self):
        self.setWindowTitle("Adicionar produtos com versões históricas em lote")

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

        produtos, invalidas, total = agrupar_produtos_versoes(camada, self.api_client.dominios)
        if not relatar_feicoes_invalidas(self, invalidas, total):
            return
        if not produtos:
            QMessageBox.warning(self, "Nada a enviar", "A camada não tem nenhum produto válido.")
            return

        # A regra do gatilho, conferida ANTES do envio: aqui não há arquivo para
        # copiar, mas o 400/500 depois de montar um lote de 300 produtos custa a
        # mesma paciência.
        for produto in produtos:
            recado = conferir_identidade(
                produto['subtipo_produto_id'],
                [v['subtipo_produto_id'] for v in produto['versoes']],
                self.api_client.dominios
            )
            if recado:
                QMessageBox.critical(
                    self, "Subtipo incompatível",
                    f"Produto '{produto['nome']}':\n\n{recado}"
                )
                return

        self.setCursor(Qt.CursorShape.WaitCursor)
        self.statusLabel.setText(f"Enviando {len(produtos)} produto(s)...")
        try:
            # Corpo é o ARRAY na raiz (produtoSchema.produtosVersoesHistoricas).
            resposta = self.api_client.post('produtos/produto_versao_historica', produtos)
        finally:
            self.setCursor(Qt.CursorShape.ArrowCursor)

        if resposta and resposta.get('success'):
            versoes = sum(len(p['versoes']) for p in produtos)
            self.statusLabel.setText(f"{len(produtos)} produto(s) e {versoes} versão(ões) criados.")
            QMessageBox.information(
                self, "Pronto",
                f"{len(produtos)} produto(s) e {versoes} versão(ões) histórica(s) criados."
            )
        else:
            self.statusLabel.setText("O servidor não criou os produtos.")
