# Path: gui\bulk_carrega_arquivos\bulk_carrega_arquivos_dialog.py
"""Arquivos novos em versões que JÁ existem, em lote."""
import os

from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox, QProgressBar

from ...core.dominios import eh_tileserver
from ...core.upload_flow import UploadFlowMixin, calcular_checksum, tamanho_mb
from ..camada_modelo import (Campo, CamadaModelo, preencher_combo_de_camadas,
                             relatar_feicoes_invalidas, sem_null)
from ..campos_acervo import CAMPOS_ARQUIVO, montar_arquivo

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'bulk_carrega_arquivos_dialog.ui'))

MODELO = CamadaModelo(
    "Modelo - Arquivos para versões existentes",
    [Campo('versao_id', 'integer', True, 'id da versão que já existe no acervo')] + CAMPOS_ARQUIVO,
    com_geometria=False,
    observacao=("O nome_arquivo é o nome FÍSICO no volume, sem extensão, e ele é único por "
                "volume (inclusive ignorando maiúsculas). Para tileserver (tipo 9) o "
                "nome_arquivo é a URL http(s) e não há arquivo local: deixe 'path' e "
                "'extensao' em branco.")
)


class LoadSystematicFilesDialog(UploadFlowMixin, QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(LoadSystematicFilesDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        self.origens = {}
        self._upload_zerar()
        self.current_session_uuid = None
        self.setup_ui()

    def setup_ui(self):
        self.setWindowTitle("Adicionar arquivos a versões existentes")

        if preencher_combo_de_camadas(self.layerComboBox, MODELO.com_geometria) == 0:
            self.layerComboBox.setEnabled(False)
            self.loadButton.setEnabled(False)
            self.statusLabel.setText(
                "Nenhuma camada tabular no projeto. Crie a camada modelo para começar."
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

        arquivos = self.montar_corpo(camada)
        if not arquivos:
            return

        self.executar_upload('arquivo/prepare-upload/files', {'arquivos': arquivos})

    def montar_corpo(self, camada):
        """Monta o corpo e, de quebra, o mapa de origens que a cópia vai usar.

        O checksum é medido AQUI, e é a parte lenta: a barra de progresso da
        cópia não cobre a leitura do arquivo inteiro para o hash, então a tela
        avisa a cada arquivo em vez de parecer travada.
        """
        presentes = {f.name() for f in camada.fields()}
        self.origens = {}
        arquivos, invalidas = [], []
        total = 0

        for feature in camada.getFeatures():
            total += 1
            nulos = MODELO.campos_nulos(feature, presentes)
            arquivo, erro = (None, None)

            tipo = sem_null(feature['tipo_arquivo_id'])
            if eh_tileserver(tipo):
                # Tileserver não tem arquivo local: 'path' e 'extensao' em
                # branco são o esperado, e não erro.
                nulos = [n for n in nulos if n not in ('path', 'extensao')]

            if nulos:
                invalidas.append((feature.id(), "campo obrigatório em branco: " + ", ".join(nulos)))
                continue

            arquivo, erro = montar_arquivo(feature, presentes)
            if erro:
                invalidas.append((feature.id(), erro))
                continue

            versao_id = sem_null(feature['versao_id'])
            arquivo['versao_id'] = versao_id

            if not eh_tileserver(tipo):
                caminho = sem_null(feature['path'])
                if not os.path.isfile(caminho or ''):
                    invalidas.append((feature.id(), f"arquivo não encontrado: {caminho}"))
                    continue
                self.statusLabel.setText(f"Calculando checksum de {os.path.basename(caminho)}...")
                self.statusLabel.repaint()
                try:
                    arquivo['checksum'] = calcular_checksum(caminho)
                    arquivo['tamanho_mb'] = tamanho_mb(caminho)
                except OSError as e:
                    invalidas.append((feature.id(), f"não consegui ler o arquivo: {e}"))
                    continue
                self.origens[(versao_id, arquivo['nome_arquivo'])] = caminho
            else:
                arquivo['checksum'] = None
                arquivo['tamanho_mb'] = None

            arquivos.append(arquivo)

        self.statusLabel.setText("")
        if not relatar_feicoes_invalidas(self, invalidas, total):
            return None
        if not arquivos:
            QMessageBox.warning(self, "Nada a enviar", "A camada não tem nenhuma feição válida.")
            return None
        return arquivos

    # --- gancho do UploadFlowMixin ------------------------------------------

    def upload_origem_de(self, arquivo_info):
        """Casa a entrada do servidor com o arquivo local por (versao_id, nome).

        A chave é o PAR, e não o nome sozinho: o mesmo `nome_arquivo` pode
        existir em versões diferentes, e casar só pelo nome mandaria o byte de
        uma versão para o destino da outra, sem erro nenhum, porque os dois
        caminhos existem.
        """
        return self.origens.get((arquivo_info.get('versao_id'), arquivo_info.get('nome_arquivo')))

    def upload_concluido(self, mensagem):
        QMessageBox.information(self, "Pronto", mensagem)
