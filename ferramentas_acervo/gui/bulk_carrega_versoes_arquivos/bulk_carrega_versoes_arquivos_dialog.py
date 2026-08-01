# Path: gui\bulk_carrega_versoes_arquivos\bulk_carrega_versoes_arquivos_dialog.py
"""Versões novas, com arquivos, para produtos que JÁ existem.

A camada é PLANA: uma linha por arquivo. `versao_grupo_id` diz quais linhas
pertencem à mesma versão.
"""
import os

from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox, QProgressBar

from ...core.dominios import eh_tileserver
from ...core.upload_flow import UploadFlowMixin, marcar_e_medir
from ..camada_modelo import (Campo, CamadaModelo, preencher_combo_de_camadas,
                             relatar_feicoes_invalidas, sem_null)
from ..campos_acervo import (CAMPOS_ARQUIVO, CAMPOS_VERSAO, conferir_identidade,
                             montar_arquivo, montar_versao)

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'bulk_carrega_versoes_arquivos_dialog.ui'))

# Na camada combinada a descrição do arquivo leva nome próprio, senão colidiria
# com a da versão.
CAMPOS_ARQUIVO_COMBINADO = [
    Campo('descricao_arquivo' if c.nome == 'descricao' else c.nome, c.tipo, c.obrigatorio, c.ajuda)
    for c in CAMPOS_ARQUIVO
]

MODELO = CamadaModelo(
    "Modelo - Versões com arquivos",
    [Campo('produto_id', 'integer', True, 'id do produto que já existe no acervo'),
     Campo('versao_grupo_id', 'integer', True,
           'mesmo número nas linhas que são a MESMA versão'),
     Campo('uuid_versao', 'string', False, 'uuid da versão, se o BDGEx já publicou um')]
    + CAMPOS_VERSAO + CAMPOS_ARQUIVO_COMBINADO,
    com_geometria=False,
    observacao=("Uma linha por ARQUIVO. Os campos da versão se repetem em todas as linhas do "
                "mesmo versao_grupo_id. O subtipo da versão precisa ser compatível com o do "
                "produto: subtipo que exige produto próprio só entra em produto do mesmo subtipo.")
)


class LoadVersionToProductsDialog(UploadFlowMixin, QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(LoadVersionToProductsDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        self.origens = {}
        self._upload_zerar()
        self.current_session_uuid = None
        self.setup_ui()

    def setup_ui(self):
        self.setWindowTitle("Adicionar versões com arquivos a produtos existentes")

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

        versoes = self.montar_corpo(camada)
        if not versoes:
            return

        # A regra do gatilho, ANTES de copiar byte nenhum. Aqui o produto já
        # existe, então o subtipo dele vem do servidor.
        recado = self.conferir_contra_produtos(versoes)
        if recado:
            QMessageBox.critical(self, "Subtipo incompatível", recado)
            return

        self.executar_upload('arquivo/prepare-upload/version', {'versoes': versoes})

    def montar_corpo(self, camada):
        presentes = {f.name() for f in camada.fields()}
        self.origens = {}
        grupos, invalidas = {}, []
        total = 0

        for feature in camada.getFeatures():
            total += 1
            tipo = sem_null(feature['tipo_arquivo_id'])
            nulos = MODELO.campos_nulos(feature, presentes)
            if eh_tileserver(tipo):
                nulos = [n for n in nulos if n not in ('path', 'extensao')]
            if nulos:
                invalidas.append((feature.id(), "campo obrigatório em branco: " + ", ".join(nulos)))
                continue

            produto_id = sem_null(feature['produto_id'])
            grupo = sem_null(feature['versao_grupo_id'])
            if produto_id is None or grupo is None:
                invalidas.append((feature.id(), "produto_id e versao_grupo_id são obrigatórios"))
                continue

            versao, erro = montar_versao(feature, presentes)
            if erro:
                invalidas.append((feature.id(), erro))
                continue

            arquivo, erro = montar_arquivo(feature, presentes, descricao_campo='descricao_arquivo')
            if erro:
                invalidas.append((feature.id(), erro))
                continue

            if eh_tileserver(tipo):
                arquivo['checksum'] = None
                arquivo['tamanho_mb'] = None
            else:
                caminho = sem_null(feature['path'])
                if not os.path.isfile(caminho or ''):
                    invalidas.append((feature.id(), f"arquivo não encontrado: {caminho}"))
                    continue
                self.statusLabel.setText(f"Calculando checksum de {os.path.basename(caminho)}...")
                self.statusLabel.repaint()
                try:
                    self.origens[marcar_e_medir(arquivo, caminho)] = caminho
                except OSError as e:
                    invalidas.append((feature.id(), f"não consegui ler o arquivo: {e}"))
                    continue

            chave = (produto_id, grupo)
            if chave not in grupos:
                grupos[chave] = {'produto_id': produto_id, 'versao': versao, 'arquivos': []}
            grupos[chave]['arquivos'].append(arquivo)

        self.statusLabel.setText("")
        if not relatar_feicoes_invalidas(self, invalidas, total):
            return None
        if not grupos:
            QMessageBox.warning(self, "Nada a enviar", "A camada não tem nenhuma feição válida.")
            return None
        return list(grupos.values())

    def conferir_contra_produtos(self, versoes):
        """Lê o subtipo dos produtos alvo e aplica a regra do gatilho.

        Uma leitura por produto DISTINTO, e não por versão: um lote costuma
        empilhar várias versões do mesmo produto, e repetir a consulta seria
        cobrar do servidor a mesma resposta dezenas de vezes.
        """
        subtipos = {}
        for item in versoes:
            produto_id = item['produto_id']
            if produto_id not in subtipos:
                resposta = self.api_client.get(f"acervo/produto/{produto_id}")
                if not resposta or 'dados' not in resposta:
                    return (f"Não consegui ler o produto {produto_id} para conferir o subtipo. "
                            "Verifique se o id existe no acervo.")
                subtipos[produto_id] = resposta['dados'].get('subtipo_produto_id')

            recado = conferir_identidade(
                subtipos[produto_id],
                [item['versao']['subtipo_produto_id']],
                self.api_client.dominios
            )
            if recado:
                return f"Produto {produto_id}:\n\n{recado}"
        return None

    # --- gancho do UploadFlowMixin ------------------------------------------

    def upload_origem_de(self, arquivo_info):
        return self.origens.get(arquivo_info.get('uuid_arquivo'))

    def upload_concluido(self, mensagem):
        QMessageBox.information(self, "Pronto", mensagem)
