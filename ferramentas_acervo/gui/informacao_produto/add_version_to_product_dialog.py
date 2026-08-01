# Path: gui\informacao_produto\add_version_to_product_dialog.py
import os
import json
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import (
    QDialog, QMessageBox, QVBoxLayout, QHBoxLayout, QLabel, 
    QTableWidgetItem, QHeaderView, QFileDialog
)
from qgis.PyQt.QtCore import Qt, QDate
from ...core.upload_flow import UploadFlowMixin, marcar_e_medir
from ..campos_acervo import conferir_identidade
from ...core.dominios import SITUACAO_CARREGAMENTO_NAO_CARREGADO

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'add_version_to_product_dialog.ui'))

class AddVersionToProductDialog(UploadFlowMixin, QDialog, FORM_CLASS):
    def __init__(self, api_client, produto_data, parent=None):
        """
        Inicializa o diálogo para adicionar uma nova versão com arquivos a um produto existente.
        
        Args:
            api_client: Cliente da API
            produto_data (dict): Dados do produto
            parent: Widget pai
        """
        super(AddVersionToProductDialog, self).__init__(parent)
        self.setupUi(self)
        self.api_client = api_client
        self.produto_data = produto_data
        self.arquivos = []
        # uuid_arquivo -> caminho local, preenchido em add_file
        self.origens = {}
        self._upload_zerar()
        self.current_session_uuid = None

        self.setup_ui()
        self.load_domain_data()
        
    def setup_ui(self):
        """Configura a interface de usuário."""
        self.setWindowTitle(f"Adicionar Nova Versão ao Produto: {self.produto_data['nome']}")
        self.resize(800, 700)
        
        # Esconder progresso inicialmente
        self.progressGroupBox.setVisible(False)
        
        # Configurar datas
        self.dataCriacaoDateEdit.setDate(QDate.currentDate())
        self.dataEdicaoDateEdit.setDate(QDate.currentDate())
        self.dataCriacaoDateEdit.setCalendarPopup(True)
        self.dataEdicaoDateEdit.setCalendarPopup(True)
        
        # Configurar tabela de arquivos
        self.filesTable.setColumnCount(5)
        self.filesTable.setHorizontalHeaderLabels(['Nome', 'Arquivo', 'Tipo', 'Tamanho (MB)', 'Caminho'])
        self.filesTable.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        self.filesTable.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.filesTable.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeMode.Stretch)
        
        # Configurar órgão produtor padrão
        self.orgaoProdutorLineEdit.setText("DSG")
        
        # Conectar botões
        self.addFileButton.clicked.connect(self.add_file)
        self.removeFileButton.clicked.connect(self.remove_file)
        self.uploadButton.clicked.connect(self.start_upload_process)
        self.cancelButton.clicked.connect(self.reject)
        
    def load_domain_data(self):
        """Carrega dados de domínio dos combos da interface."""
        try:
            dominios = self.api_client.dominios

            self.tipoArquivoComboBox.clear()
            for tipo in dominios.get('tipo_arquivo'):
                self.tipoArquivoComboBox.addItem(tipo['nome'], tipo['code'])

            self.tipoVersaoComboBox.clear()
            for tipo in dominios.get('tipo_versao'):
                self.tipoVersaoComboBox.addItem(tipo['nome'], tipo['code'])

            # Subtipos do tipo do produto. Os que EXIGEM produto próprio saem
            # marcados: escolher um deles num produto de outro subtipo é
            # exatamente o que o gatilho recusa.
            self.subtipoProdutoComboBox.clear()
            for subtipo in dominios.subtipos_do_tipo(self.produto_data['tipo_produto_id']):
                rotulo = subtipo['nome']
                if subtipo.get('define_produto'):
                    rotulo += "  [exige produto próprio]"
                self.subtipoProdutoComboBox.addItem(rotulo, subtipo['code'])

            self.loteComboBox.clear()
            self.loteComboBox.addItem("Nenhum", None)
            for lote in dominios.get('lote'):
                self.loteComboBox.addItem(f"{lote['nome']} ({lote['pit']})", lote['id'])
                    
        except Exception as e:
            QMessageBox.critical(self, "Erro", f"Erro ao carregar dados de domínio: {str(e)}")
        
    def add_file(self):
        """Adiciona um novo arquivo à lista."""
        file_path, _ = QFileDialog.getOpenFileName(
            self, "Selecionar Arquivo", "", "Todos os Arquivos (*.*)"
        )
        
        if not file_path:
            return

        filename = os.path.basename(file_path)
        nome_arquivo, extensao = os.path.splitext(filename)
        extensao = extensao[1:] if extensao.startswith('.') else extensao

        # O nome físico é único por volume (índice unique_nome_fisico_por_volume,
        # inclusive ignorando maiúsculas): dois iguais no mesmo envio seriam
        # recusados no meio da carga.
        if any(a['nome_arquivo'].lower() == nome_arquivo.lower() for a in self.arquivos):
            QMessageBox.warning(
                self, "Nome repetido",
                f"Já há um arquivo chamado '{nome_arquivo}' nesta lista.\n\n"
                "O nome físico é único por volume, então os dois não podem entrar juntos."
            )
            return

        file_info = {
            "nome": nome_arquivo,
            "nome_arquivo": nome_arquivo,
            "extensao": extensao,
            "tipo_arquivo_id": self.tipoArquivoComboBox.currentData(),
            "tipo_arquivo_nome": self.tipoArquivoComboBox.currentText(),
            "path": file_path,
            "metadado": {},
            "situacao_carregamento_id": SITUACAO_CARREGAMENTO_NAO_CARREGADO,
            "descricao": self.descricaoArquivoTextEdit.toPlainText(),
            "crs_original": self.crsLineEdit.text()
        }

        # Gera o uuid e mede hash e tamanho de uma vez. O uuid é o que casa esta
        # entrada com a que o servidor devolve no prepare.
        try:
            self.origens[marcar_e_medir(file_info, file_path)] = file_path
        except OSError as e:
            QMessageBox.warning(self, "Erro", f"Não foi possível ler o arquivo: {e}")
            return

        self.arquivos.append(file_info)
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
                self.origens.pop(removido.get('uuid_arquivo'), None)

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
        
        # Atualizar estado do botão de upload
        self.update_upload_button_state()
        
    def update_upload_button_state(self):
        """Atualiza o estado do botão de upload baseado na validade do formulário."""
        enable_upload = (
            len(self.arquivos) > 0 and 
            self.nomeVersaoLineEdit.text().strip() and 
            self.versaoLineEdit.text().strip() and 
            self.tipoVersaoComboBox.currentIndex() >= 0 and
            self.subtipoProdutoComboBox.currentIndex() >= 0 and
            self.orgaoProdutorLineEdit.text().strip()
        )
        
        self.uploadButton.setEnabled(enable_upload)
        
    def validate_form(self):
        """Valida o formulário antes de iniciar o upload."""
        if not self.nomeVersaoLineEdit.text().strip():
            QMessageBox.warning(self, "Validação", "O nome da versão é obrigatório.")
            return False
            
        if not self.versaoLineEdit.text().strip():
            QMessageBox.warning(self, "Validação", "O número da versão é obrigatório.")
            return False
            
        if self.tipoVersaoComboBox.currentIndex() < 0:
            QMessageBox.warning(self, "Validação", "Selecione um tipo de versão.")
            return False
            
        if self.subtipoProdutoComboBox.currentIndex() < 0:
            QMessageBox.warning(self, "Validação", "Selecione um subtipo de produto.")
            return False
            
        if not self.orgaoProdutorLineEdit.text().strip():
            QMessageBox.warning(self, "Validação", "O órgão produtor é obrigatório.")
            return False
            
        if not self.arquivos:
            QMessageBox.warning(self, "Validação", "Adicione pelo menos um arquivo.")
            return False
            
        # Validar metadados JSON
        metadado_text = self.metadadoTextEdit.toPlainText().strip()
        if metadado_text:
            try:
                json.loads(metadado_text)
            except json.JSONDecodeError:
                QMessageBox.warning(self, "Validação", "O campo de metadados deve conter um JSON válido.")
                return False
        
        return True
    
    def start_upload_process(self):
        """Fase 1 do upload. A máquina inteira vive em core/upload_flow.py."""
        if not self.validate_form():
            return

        # A regra do gatilho acervo.validate_version, ANTES de copiar bytes: o
        # subtipo da versão tem que casar com o do produto, e o subtipo que exige
        # produto próprio (Carta Topográfica Militar) só entra em produto do
        # mesmo subtipo. Sem esta conferência a recusa vinha do banco, no
        # confirm-upload, como 500 sem explicação.
        recado = conferir_identidade(
            self.produto_data.get('subtipo_produto_id'),
            [self.subtipoProdutoComboBox.currentData()],
            self.api_client.dominios
        )
        if recado:
            QMessageBox.warning(self, "Subtipo incompatível", recado)
            return

        self.progressGroupBox.setVisible(True)
        for botao in (self.addFileButton, self.removeFileButton):
            botao.setEnabled(False)

        palavras = [p.strip() for p in self.palavrasChaveLineEdit.text().split(',') if p.strip()]
        metadado = {}
        if self.metadadoTextEdit.toPlainText().strip():
            metadado = json.loads(self.metadadoTextEdit.toPlainText())

        corpo = {'versoes': [{
            'produto_id': self.produto_data['id'],
            'versao': {
                'versao': self.versaoLineEdit.text(),
                # Server aceita null, mas não string vazia
                'nome': self.nomeVersaoLineEdit.text() or None,
                'tipo_versao_id': self.tipoVersaoComboBox.currentData(),
                'subtipo_produto_id': self.subtipoProdutoComboBox.currentData(),
                'lote_id': self.loteComboBox.currentData(),
                'metadado': metadado,
                'descricao': self.descricaoVersaoTextEdit.toPlainText(),
                'orgao_produtor': self.orgaoProdutorLineEdit.text(),
                'palavras_chave': palavras,
                'data_criacao': self.dataCriacaoDateEdit.date().toString(Qt.DateFormat.ISODate),
                'data_edicao': self.dataEdicaoDateEdit.date().toString(Qt.DateFormat.ISODate),
            },
            'arquivos': [{
                'uuid_arquivo': a['uuid_arquivo'],
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
            } for a in self.arquivos],
        }]}

        if not self.executar_upload('arquivo/prepare-upload/version', corpo):
            for botao in (self.addFileButton, self.removeFileButton):
                botao.setEnabled(True)

    # --- ganchos do UploadFlowMixin -----------------------------------------

    def upload_origem_de(self, arquivo_info):
        """Casa pelo uuid_arquivo gerado aqui: a resposta do prepare de versão
        não traz versao_id nas entradas de arquivo."""
        return self.origens.get(arquivo_info.get('uuid_arquivo'))

    def upload_concluido(self, mensagem):
        QMessageBox.information(self, "Sucesso", "Versão e arquivos carregados com sucesso.")
        self.accept()
