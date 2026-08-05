# Path: gui\bulk_carrega_produtos_versoes_arquivos\bulk_carrega_produtos_versoes_arquivos_dialog.py
"""Produtos completos em lote: produto, versão e arquivos de uma vez.

A camada é PLANA: uma linha por arquivo. `produto_grupo_id` diz quais linhas são
o mesmo produto, e `versao_grupo_id`, a mesma versão dentro dele.
"""
import os

from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox, QProgressBar

from ...core.dominios import eh_tileserver
from ...core.upload_flow import UploadFlowMixin, marcar_e_medir
from ..camada_modelo import (Campo, CamadaModelo, preencher_combo_de_camadas,
                             relatar_feicoes_invalidas, sem_null)
from ..campos_acervo import (CAMPOS_ARQUIVO, CAMPOS_PRODUTO, CAMPOS_VERSAO,
                             agrupar_produtos_versoes, conferir_identidade)

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'bulk_carrega_produtos_versoes_arquivos_dialog.ui'))


def _renomear(campos, de_para):
    return [Campo(de_para.get(c.nome, c.nome), c.tipo, c.obrigatorio, c.ajuda) for c in campos]


MODELO = CamadaModelo(
    "Modelo - Produtos completos",
    [Campo('produto_grupo_id', 'integer', True,
           'mesmo número nas linhas que são o MESMO produto'),
     Campo('versao_grupo_id', 'integer', True,
           'mesmo número nas linhas que são a MESMA versão daquele produto')]
    + _renomear(CAMPOS_PRODUTO, {'nome': 'produto_nome', 'descricao': 'descricao_produto'})
    + [Campo('uuid_versao', 'string', False, 'uuid da versão, se o BDGEx já publicou um')]
    + CAMPOS_VERSAO
    + _renomear(CAMPOS_ARQUIVO, {'descricao': 'descricao_arquivo'}),
    com_geometria=True,
    observacao=("Uma linha por ARQUIVO. Os campos do produto e da versão se repetem nas linhas "
                "do mesmo grupo, e a divergência entre linhas do mesmo produto é recusada em vez "
                "de ignorada. Quando o subtipo da versão exige produto próprio (Carta Topográfica "
                "Militar), preencha o subtipo do PRODUTO com o mesmo valor.")
)


class LoadProductsDialog(UploadFlowMixin, QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(LoadProductsDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        self.origens = {}
        self._upload_zerar()
        self.current_session_uuid = None
        self.setup_ui()

    def setup_ui(self):
        self.setWindowTitle("Adicionar produtos completos em lote")

        if preencher_combo_de_camadas(self.layerComboBox, MODELO.com_geometria) == 0:
            self.layerComboBox.setEnabled(False)
            self.loadButton.setEnabled(False)
            self.statusLabel.setText(
                "Nenhuma camada compatível no projeto. Crie a camada modelo para começar."
            )

        self.progressBar = QProgressBar(self)
        self.progressBar.setVisible(False)
        self.verticalLayout.addWidget(self.progressBar)

        self.loadButton.clicked.connect(self.enviar)
        self.createModelLayerButton.clicked.connect(self.criar_camada_modelo)

    def criar_camada_modelo(self):
        if MODELO.criar(self, self.layerComboBox, self.iface):
            self.loadButton.setEnabled(True)
            self.statusLabel.setText("Camada modelo criada. Preencha as feições e clique em Carregar.")

    # --- envio --------------------------------------------------------------

    def enviar(self):
        camada = self.layerComboBox.currentData()
        ok, motivo = MODELO.validar_camada(camada)
        if not ok:
            QMessageBox.critical(self, "Camada incompatível", motivo)
            return

        produtos, invalidas, total = agrupar_produtos_versoes(
            camada, self.api_client.dominios, com_arquivos=True
        )
        if not relatar_feicoes_invalidas(self, invalidas, total):
            return
        if not produtos:
            QMessageBox.warning(self, "Nada a enviar", "A camada não tem nenhum produto válido.")
            return

        # A regra do gatilho, ANTES de copiar os bytes. É o caso que motivou
        # tudo isto: sem a conferência, uma Carta Topográfica Militar só era
        # recusada no confirm-upload, depois da cópia inteira, e como 500.
        for produto in produtos:
            recado = conferir_identidade(
                produto['subtipo_produto_id'],
                [v['subtipo_produto_id'] for v in produto['versoes']],
                self.api_client.dominios
            )
            if recado:
                QMessageBox.critical(self, "Subtipo incompatível",
                                     f"Produto '{produto['nome']}':\n\n{recado}")
                return

        corpo = self.medir_arquivos(produtos)
        if corpo is None:
            return

        self.executar_upload('arquivo/prepare-upload/product', {'produtos': corpo})

    def medir_arquivos(self, produtos):
        """Confere a existência, mede o hash e monta o mapa de origens.

        Só acontece DEPOIS de toda a validação estrutural: ler o hash de um lote
        grande leva minutos, e não faz sentido pagá-los para depois descobrir
        que o subtipo estava errado.
        """
        self.origens = {}
        faltando = []

        for produto in produtos:
            for versao in produto['versoes']:
                arquivos = []
                for arquivo, feature in versao['arquivos']:
                    if eh_tileserver(arquivo['tipo_arquivo_id']):
                        arquivo['checksum'] = None
                        arquivo['tamanho_mb'] = None
                        arquivos.append(arquivo)
                        continue

                    caminho = sem_null(feature['path'])
                    if not os.path.isfile(caminho or ''):
                        faltando.append(f"feição {feature.id()}: {caminho}")
                        continue

                    self.statusLabel.setText(
                        f"Calculando checksum de {os.path.basename(caminho)}..."
                    )
                    self.statusLabel.repaint()
                    try:
                        self.origens[marcar_e_medir(arquivo, caminho)] = caminho
                    except OSError as e:
                        faltando.append(f"feição {feature.id()}: {caminho} ({e})")
                        continue
                    arquivos.append(arquivo)
                versao['arquivos'] = arquivos

        self.statusLabel.setText("")

        if faltando:
            QMessageBox.critical(
                self, "Arquivos não encontrados",
                "Estes arquivos não foram lidos, e por isso NADA foi enviado:\n\n"
                + "\n".join(faltando[:20])
                + (f"\n... e mais {len(faltando) - 20}." if len(faltando) > 20 else "")
            )
            return None

        # O corpo do prepare-upload/product é ANINHADO ({produto, versoes}),
        # ao contrário do produto_versao_historica, que traz os campos do
        # produto na raiz. O agrupador devolve a forma plana, e é aqui que ela
        # vira a forma que esta rota pede.
        return [
            {
                'produto': {k: v for k, v in p.items() if k != 'versoes'},
                'versoes': p['versoes'],
            }
            for p in produtos
        ]

    # --- gancho do UploadFlowMixin ------------------------------------------

    def upload_origem_de(self, arquivo_info):
        return self.origens.get(arquivo_info.get('uuid_arquivo'))

    def upload_concluido(self, mensagem):
        QMessageBox.information(self, "Pronto", mensagem)
