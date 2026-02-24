# Path: gui\informacao_produto\relationships_tab.py
"""
Componente da aba de Relacionamentos para o diálogo de informações do produto.
"""

from qgis.PyQt.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, 
    QTreeWidget, QTreeWidgetItem, QHeaderView
)
from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtGui import QFont

class RelationshipsTab(QWidget):
    def __init__(self, parent, is_admin=False):
        super(RelationshipsTab, self).__init__(parent)
        self.parent = parent
        self.is_admin = is_admin
        self.relationships = []
        self.setup_ui()
        
    def setup_ui(self):
        """Configura a interface da aba de relacionamentos."""
        layout = QVBoxLayout(self)
        
        # Árvore de relacionamentos
        self.relationships_tree = QTreeWidget()
        self.relationships_tree.setHeaderLabels(["Versão", "Tipo de Relacionamento", "Produto"])
        self.relationships_tree.setColumnWidth(0, 200)
        self.relationships_tree.setColumnWidth(1, 150)
        layout.addWidget(self.relationships_tree)
        
        # Botões de administração (se aplicável)
        if self.is_admin:
            self.admin_widget = QWidget()
            admin_layout = QHBoxLayout(self.admin_widget)
            
            # Não implementamos o botão de adicionar relação, conforme solicitado
            
            self.edit_relationship_btn = QPushButton("Editar Relacionamento")
            admin_layout.addWidget(self.edit_relationship_btn)
            
            self.delete_relationship_btn = QPushButton("Excluir Relacionamento")
            self.delete_relationship_btn.setStyleSheet("background-color: #CF222E; color: white;")
            admin_layout.addWidget(self.delete_relationship_btn)
            
            layout.addWidget(self.admin_widget)
        
        # Botão para navegar para o produto relacionado
        self.navigate_btn = QPushButton("Visualizar Produto Selecionado")
        layout.addWidget(self.navigate_btn)
    
    def populate_relationships(self, relationships, version_product_info_callback=None):
        """Preenche a árvore de relacionamentos."""
        self.relationships = relationships if relationships else []
        self.relationships_tree.clear()
        
        if not relationships:
            item = QTreeWidgetItem(["Nenhum relacionamento encontrado", "", ""])
            self.relationships_tree.addTopLevelItem(item)
            self.navigate_btn.setEnabled(False)
            return
            
        # Adicionar relacionamentos à árvore
        for relationship in relationships:
            item = QTreeWidgetItem([
                relationship['source_version_name'],
                relationship['relationship_type'],
                relationship['target_product_name'] or "Carregando..."
            ])
            item.setData(0, Qt.UserRole, relationship)
            self.relationships_tree.addTopLevelItem(item)
            
            # Se houver callback para obter info do produto, executar
            if version_product_info_callback and relationship['target_version_id']:
                version_product_info_callback(relationship['target_version_id'], item)
        
        self.navigate_btn.setEnabled(True)
        self.relationships_tree.expandAll()
    
    def get_selected_relationship(self):
        """Retorna o relacionamento selecionado na árvore."""
        selected_items = self.relationships_tree.selectedItems()
        if not selected_items:
            return None
            
        return selected_items[0].data(0, Qt.UserRole)