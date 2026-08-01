# Path: gui\informacao_produto\add_files_to_version_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import (
    QDialog, QMessageBox, QVBoxLayout, QHBoxLayout, 
    QTableWidgetItem, QHeaderView, QFileDialog
)
from qgis.PyQt.QtCore import Qt
from ...core.upload_flow import UploadFlowMixin, calcular_checksum

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'add_files_to_version_dialog.ui'))

class AddFilesToVersionDialog(UploadFlowMixin, QDialog, FORM_CLASS):
    def __init__(self, api_client, versao_data, parent=None):
        """
        Inicializa o diálogo para adicionar arquivos a uma versão existente.
        
        Args:
            api_client: Cliente da API
            versao_data (dict): Dados da versão
            parent: Widget pai
        """
        super(AddFilesToVersionDialog, self).__init__(parent)
        self.setupUi(self)
        self.api_client = api_client
        self.versao_data = versao_data
        self.arquivos = []
        # nome FÍSICO -> caminho local, preenchido em add_file
        self.origens = {}
        self._upload_zerar()
        self.current_session_uuid = None

        self.setup_ui()
        self.load_tipo_arquivo()
        
    def setup_ui(self):
        """Configura a interface de usuário."""
        self.setWindowTitle(f"Adicionar Arquivos à Versão: {self.versao_data['versao']} - {self.versao_data['nome_versao']}")
        self.resize(800, 600)
        
        # Esconder progresso inicialmente
        self.progressGroupBox.setVisible(False)
        
        # Configurar tabela de arquivos
        self.filesTable.setColumnCount(5)
        self.filesTable.setHorizontalHeaderLabels(['Nome', 'Arquivo', 'Tipo', 'Tamanho (MB)', 'Caminho'])
        self.filesTable.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        self.filesTable.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.filesTable.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeMode.Stretch)
        
        # Conectar botões
        self.addFileButton.clicked.connect(self.add_file)
        self.removeFileButton.clicked.connect(self.remove_file)
        self.uploadButton.clicked.connect(self.start_upload_process)
        self.cancelButton.clicked.connect(self.reject)
        
    def load_tipo_arquivo(self):
        """Carrega os tipos de arquivo do servidor."""
        try:
            response = self.api_client.get('gerencia/dominio/tipo_arquivo')
            if response and 'dados' in response:
                self.tipoArquivoComboBox.clear()
                for tipo in response['dados']:
                    self.tipoArquivoComboBox.addItem(tipo['nome'], tipo['code'])
            else:
                QMessageBox.warning(self, "Erro", "Não foi possível carregar os tipos de arquivo.")
        except Exception as e:
            QMessageBox.critical(self, "Erro", f"Erro ao carregar tipos de arquivo: {str(e)}")
        
    def add_file(self):
        """Adiciona um novo arquivo à lista."""
        file_path, _ = QFileDialog.getOpenFileName(
            self, "Selecionar Arquivo", "", "Todos os Arquivos (*.*)"
        )
        
        if not file_path:
            return
        
        # Calcular o checksum do arquivo
        checksum = self.calculate_checksum(file_path)
        
        # Obter informações do arquivo
        filename = os.path.basename(file_path)
        nome_arquivo, extensao = os.path.splitext(filename)
        extensao = extensao[1:] if extensao.startswith('.') else extensao
        
        tipo_arquivo_id = self.tipoArquivoComboBox.currentData()
        tipo_arquivo_nome = self.tipoArquivoComboBox.currentText()
        
        file_info = {
            "nome": nome_arquivo,
            "nome_arquivo": nome_arquivo,
            "extensao": extensao,
            "tipo_arquivo_id": tipo_arquivo_id,
            "tipo_arquivo_nome": tipo_arquivo_nome,
            "tamanho_mb": os.path.getsize(file_path) / (1024 * 1024),
            "path": file_path,
            "checksum": checksum,
            "metadado": {},
            "situacao_carregamento_id": 1,  # Não carregado por padrão
            "descricao": self.descriptionTextEdit.toPlainText(),
            "crs_original": self.crsLineEdit.text()
        }
        
        # O nome FÍSICO é único por volume (índice unique_nome_fisico_por_volume,
        # inclusive na variante que ignora maiúsculas). Dois arquivos com o mesmo
        # nome no mesmo envio seriam recusados pelo servidor no meio da carga;
        # avisar aqui é mais barato.
        if any(a['nome_arquivo'].lower() == nome_arquivo.lower() for a in self.arquivos):
            QMessageBox.warning(
                self, "Nome repetido",
                f"Já há um arquivo chamado '{nome_arquivo}' nesta lista.\n\n"
                "O nome físico é único por volume, então os dois não podem entrar juntos."
            )
            return

        self.arquivos.append(file_info)
        self.origens[(self.versao_data['versao_id'], nome_arquivo)] = file_path

        self.update_files_table()
        
    def remove_file(self):
        """Remove o arquivo selecionado da lista."""
        selected_rows = self.filesTable.selectionModel().selectedRows()
        if not selected_rows:
            QMessageBox.warning(self, "Aviso", "Selecione um arquivo para remover.")
            return
        
        # Remover arquivo da lista (em ordem reversa para evitar problemas com índices)
        indices_to_remove = sorted([index.row() for index in selected_rows], reverse=True)
        for index in indices_to_remove:
            if index < len(self.arquivos):
                removido = self.arquivos.pop(index)
                self.origens.pop(
                    (self.versao_data['versao_id'], removido['nome_arquivo']), None
                )

        # Atualizar a tabela
        self.update_files_table()
        
    def update_files_table(self):
        """Atualiza a tabela de arquivos."""
        self.filesTable.setRowCount(len(self.arquivos))
        
        for row, file_info in enumerate(self.arquivos):
            # Nome
            self.filesTable.setItem(row, 0, QTableWidgetItem(file_info['nome']))
            
            # Nome do arquivo com extensão
            file_name_ext = f"{file_info['nome_arquivo']}.{file_info['extensao']}"
            self.filesTable.setItem(row, 1, QTableWidgetItem(file_name_ext))
            
            # Tipo de arquivo
            self.filesTable.setItem(row, 2, QTableWidgetItem(file_info['tipo_arquivo_nome']))
            
            # Tamanho
            tamanho = f"{file_info['tamanho_mb']:.2f}"
            self.filesTable.setItem(row, 3, QTableWidgetItem(tamanho))
            
            # Caminho
            self.filesTable.setItem(row, 4, QTableWidgetItem(file_info['path']))
        
        # Habilitar/desabilitar botão de upload baseado em ter arquivos
        self.uploadButton.setEnabled(len(self.arquivos) > 0)
        
    def calculate_checksum(self, file_path):
        """Checksum do arquivo, ou '' quando não deu para ler."""
        try:
            return calcular_checksum(file_path)
        except OSError as e:
            QMessageBox.warning(self, "Erro", f"Não foi possível calcular o checksum: {e}")
            return ""

    def start_upload_process(self):
        """Fase 1 do upload. A máquina inteira vive em core/upload_flow.py."""
        if not self.arquivos:
            QMessageBox.warning(self, "Aviso", "Adicione pelo menos um arquivo.")
            return

        self.progressGroupBox.setVisible(True)
        for botao in (self.addFileButton, self.removeFileButton):
            botao.setEnabled(False)

        versao_id = self.versao_data['versao_id']
        corpo = {'arquivos': [{
            'versao_id': versao_id,
            'nome': a['nome'],
            'nome_arquivo': a['nome_arquivo'],
            'tipo_arquivo_id': a['tipo_arquivo_id'],
            'extensao': a['extensao'],
            'tamanho_mb': a['tamanho_mb'],
            'checksum': a['checksum'],
            'metadado': a['metadado'],
            'situacao_carregamento_id': a['situacao_carregamento_id'],
            'descricao': a['descricao'],
            'crs_original': a['crs_original'],
        } for a in self.arquivos]}

        if not self.executar_upload('arquivo/prepare-upload/files', corpo):
            for botao in (self.addFileButton, self.removeFileButton):
                botao.setEnabled(True)

    # --- ganchos do UploadFlowMixin -----------------------------------------

    def upload_origem_de(self, arquivo_info):
        """Casa por (versao_id, nome_arquivo), e não pelo `nome`.

        `nome` é rótulo descritivo e pode se repetir entre arquivos da mesma
        versão ("Arquivo principal"); o par com o nome FÍSICO é único por volume,
        garantido por índice no banco. Casando pelo rótulo, dois arquivos com o
        mesmo nome mandavam o mesmo byte duas vezes e deixavam o outro de fora.
        """
        return self.origens.get((arquivo_info.get('versao_id'),
                                 arquivo_info.get('nome_arquivo')))

    def upload_concluido(self, mensagem):
        QMessageBox.information(self, "Sucesso", "Arquivos carregados com sucesso.")
        self.accept()
