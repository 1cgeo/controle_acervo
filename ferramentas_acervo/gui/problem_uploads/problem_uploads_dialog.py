# Path: gui\problem_uploads\problem_uploads_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox, QTableWidgetItem, QHeaderView, QTreeWidgetItem
from qgis.PyQt.QtCore import Qt, QDateTime

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'problem_uploads_dialog.ui'))

class ProblemUploadsDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(ProblemUploadsDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        self.current_data = []
        
        self.setup_ui()
        self.load_problem_uploads()
        
    def setup_ui(self):
        self.setWindowTitle("Uploads com Problemas")
        
        # Configure the sessions table
        self.sessionsTable.setColumnCount(5)
        self.sessionsTable.setHorizontalHeaderLabels([
            'UUID', 'Tipo de Operação', 'Erro', 'Data de Criação', 'Usuário'
        ])
        self.sessionsTable.setSelectionBehavior(self.sessionsTable.SelectRows)
        self.sessionsTable.setEditTriggers(self.sessionsTable.NoEditTriggers)
        
        # Set column widths
        header = self.sessionsTable.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.ResizeToContents)  # UUID
        header.setSectionResizeMode(1, QHeaderView.ResizeToContents)  # Operação
        header.setSectionResizeMode(2, QHeaderView.Stretch)           # Erro
        header.setSectionResizeMode(3, QHeaderView.ResizeToContents)  # Data
        header.setSectionResizeMode(4, QHeaderView.ResizeToContents)  # Usuário
        
        # Connect signals
        self.sessionsTable.itemSelectionChanged.connect(self.on_session_selected)
        self.refreshButton.clicked.connect(self.refresh_data)
        self.closeButton.clicked.connect(self.reject)
        
        # Initialize problem files tree
        self.problemFilesTree.setHeaderLabels(['Item', 'Detalhes'])
        self.problemFilesTree.setColumnWidth(0, 300)
        
    def load_problem_uploads(self):
        """Load problem uploads from the API."""
        try:
            self.setCursor(Qt.WaitCursor)
            
            response = self.api_client.get('arquivo/problem-uploads')
            
            if response and 'dados' in response:
                self.current_data = response['dados']
                self.populate_sessions_table(self.current_data)
            else:
                QMessageBox.warning(
                    self,
                    "Aviso",
                    "Não foi possível carregar os uploads com problemas."
                )
                
        except Exception as e:
            QMessageBox.critical(
                self,
                "Erro",
                f"Erro ao carregar uploads com problemas: {str(e)}"
            )
        finally:
            self.setCursor(Qt.ArrowCursor)
    
    def populate_sessions_table(self, sessions):
        """Populate the table with problem upload sessions."""
        self.sessionsTable.setRowCount(len(sessions))
        
        for row, session in enumerate(sessions):
            # Add session information
            self.sessionsTable.setItem(row, 0, QTableWidgetItem(session.get('session_uuid', '')))
            
            operation_type = session.get('operation_type', '')
            operation_type_display = {
                'add_files': 'Adicionar Arquivos',
                'add_version': 'Adicionar Versão',
                'add_product': 'Adicionar Produto'
            }.get(operation_type, operation_type)
            
            self.sessionsTable.setItem(row, 1, QTableWidgetItem(operation_type_display))
            self.sessionsTable.setItem(row, 2, QTableWidgetItem(session.get('error_message', '')))
            
            # Format the date
            date = session.get('created_at', '')
            if date:
                date_dt = QDateTime.fromString(date, Qt.ISODate)
                date_formatted = date_dt.toString('dd/MM/yyyy HH:mm:ss')
            else:
                date_formatted = "Sem data"
            self.sessionsTable.setItem(row, 3, QTableWidgetItem(date_formatted))
            
            self.sessionsTable.setItem(row, 4, QTableWidgetItem(session.get('usuario_nome', '')))
            
        # Clear the detail views
        self.sessionInfoText.clear()
        self.problemFilesTree.clear()
    
    def on_session_selected(self):
        """Handle session selection."""
        selected_rows = self.sessionsTable.selectionModel().selectedRows()
        if not selected_rows:
            return
            
        row = selected_rows[0].row()
        session_uuid = self.sessionsTable.item(row, 0).text()
        
        # Find the selected session data
        session_data = next((s for s in self.current_data if s.get('session_uuid') == session_uuid), None)
        if not session_data:
            return
            
        # Update session info tab
        self.update_session_info(session_data)
        
        # Update problem files tab
        self.update_problem_files_tree(session_data)
    
    def update_session_info(self, session):
        """Update the session info text view."""
        info_text = f"""
        <h3>Informações da Sessão</h3>
        <p><b>UUID:</b> {session.get('session_uuid', '')}</p>
        <p><b>Tipo de Operação:</b> {session.get('operation_type', '')}</p>
        <p><b>Status:</b> {session.get('status', '')}</p>
        <p><b>Mensagem de Erro:</b> {session.get('error_message', '')}</p>
        <p><b>Data de Criação:</b> {session.get('created_at', '')}</p>
        <p><b>Data de Conclusão:</b> {session.get('completed_at', '')}</p>
        <p><b>Usuário:</b> {session.get('usuario_nome', '')}</p>
        """
        
        self.sessionInfoText.setHtml(info_text)
    
    def update_problem_files_tree(self, session):
        """Update the problem files tree view."""
        self.problemFilesTree.clear()
        
        operation_type = session.get('operation_type', '')
        
        if operation_type == 'add_files':
            # Handle add_files operation type
            versoes = session.get('versoes_com_problema', [])
            for versao in versoes:
                versao_item = QTreeWidgetItem(self.problemFilesTree)
                versao_item.setText(0, f"Versão ID: {versao.get('versao_id', '')}")
                versao_item.setExpanded(True)
                
                for arquivo in versao.get('arquivos_com_problema', []):
                    arquivo_item = QTreeWidgetItem(versao_item)
                    arquivo_item.setText(0, arquivo.get('nome', ''))
                    arquivo_item.setText(1, arquivo.get('error_message', ''))
        
        elif operation_type == 'add_version':
            # Handle add_version operation type
            versoes = session.get('versoes_com_problema', [])
            for versao in versoes:
                produto_item = QTreeWidgetItem(self.problemFilesTree)
                produto_item.setText(0, f"Produto: {versao.get('produto_nome', '')}")
                produto_item.setExpanded(True)
                
                versao_info = versao.get('versao_info', {})
                versao_item = QTreeWidgetItem(produto_item)
                versao_item.setText(0, f"Versão: {versao_info.get('nome', '')} ({versao_info.get('versao', '')})")
                versao_item.setExpanded(True)
                
                for arquivo in versao.get('arquivos_com_problema', []):
                    arquivo_item = QTreeWidgetItem(versao_item)
                    arquivo_item.setText(0, arquivo.get('nome', ''))
                    arquivo_item.setText(1, arquivo.get('error_message', ''))
        
        elif operation_type == 'add_product':
            # Handle add_product operation type
            produtos = session.get('produtos_com_problema', [])
            for produto in produtos:
                produto_info = produto.get('produto_info', {})
                produto_item = QTreeWidgetItem(self.problemFilesTree)
                produto_item.setText(0, f"Produto: {produto_info.get('nome', '')} (MI: {produto_info.get('mi', '')}, INOM: {produto_info.get('inom', '')})")
                produto_item.setExpanded(True)
                
                for versao in produto.get('versoes_com_problema', []):
                    versao_info = versao.get('versao_info', {})
                    versao_item = QTreeWidgetItem(produto_item)
                    versao_item.setText(0, f"Versão: {versao_info.get('nome', '')} ({versao_info.get('versao', '')})")
                    versao_item.setExpanded(True)
                    
                    for arquivo in versao.get('arquivos_com_problema', []):
                        arquivo_item = QTreeWidgetItem(versao_item)
                        arquivo_item.setText(0, arquivo.get('nome', ''))
                        arquivo_item.setText(1, arquivo.get('error_message', ''))
    
    def refresh_data(self):
        """Refresh the data."""
        self.load_problem_uploads()