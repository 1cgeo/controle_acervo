# Path: gui\pedidos\registrar_impressao_dialog.py
from qgis.PyQt.QtWidgets import (QDialog, QVBoxLayout, QHBoxLayout, QLabel,
                                 QTableWidget, QTableWidgetItem, QSpinBox,
                                 QPushButton, QHeaderView, QLineEdit)
from qgis.PyQt.QtCore import Qt

COLUNAS = ["Produto", "MI", "Escala", "Mídia", "Pedida", "Restante", "Impressas agora"]
COLUNA_QUANTIDADE = 6


class RegistrarImpressaoDialog(QDialog):
    """
    Diálogo para registrar quantas cópias de cada item foram impressas.

    Cada linha é um item PENDENTE do pedido, com um campo de quantidade já
    preenchido com o restante a imprimir -- o caso comum é imprimir tudo o que
    falta, e quem imprimiu menos ajusta. Linhas em zero são ignoradas.

    A observação é uma só, da SESSÃO de impressão, e vai em todos os registros.
    É como ela é usada de verdade ("Plotter 2", "papel Tyvek"): o servidor a
    aceita por item, mas anotar plotter diferente em cada linha da mesma sessão
    nunca aconteceu, e um campo por linha só tornaria a tela mais cara de usar.
    """

    def __init__(self, itens, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Registrar impressão")
        self.resize(820, 460)
        self._itens = itens
        self._spinboxes = {}

        layout = QVBoxLayout(self)

        layout.addWidget(QLabel(
            "Informe quantas cópias de cada item foram impressas nesta sessão.\n"
            "O campo já vem preenchido com o restante a imprimir — ajuste se necessário."
        ))

        self.table = QTableWidget(self)
        self.table.setColumnCount(len(COLUNAS))
        self.table.setHorizontalHeaderLabels(COLUNAS)
        self.table.verticalHeader().setVisible(False)
        self.table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.table.setAlternatingRowColors(True)
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)

        self.table.setRowCount(len(itens))
        for row, item in enumerate(itens):
            restante = int(item.get('quantidade_restante', 0) or 0)
            valores = [
                item.get('produto_nome') or '-',
                item.get('mi') or '-',
                item.get('escala') or '-',
                item.get('tipo_midia_nome') or '-',
                str(item.get('quantidade', 0)),
                str(restante),
            ]
            for col, valor in enumerate(valores):
                cell = QTableWidgetItem(valor)
                cell.setFlags(cell.flags() & ~Qt.ItemFlag.ItemIsEditable)
                if item.get('item_avulso'):
                    cell.setToolTip(
                        'Item avulso: não vem do acervo.\n'
                        + (item.get('avulso_descricao') or ''))
                self.table.setItem(row, col, cell)

            spin = QSpinBox(self.table)
            spin.setRange(0, 99999)
            spin.setValue(restante)
            spin.valueChanged.connect(self._update_total)
            self.table.setCellWidget(row, COLUNA_QUANTIDADE, spin)
            self._spinboxes[item['produto_pedido_id']] = spin

        layout.addWidget(self.table)

        atalhos = QHBoxLayout()
        preencher = QPushButton("Preencher com o restante", self)
        preencher.clicked.connect(self._preencher_restante)
        zerar = QPushButton("Zerar tudo", self)
        zerar.clicked.connect(self._zerar)
        atalhos.addWidget(preencher)
        atalhos.addWidget(zerar)
        atalhos.addStretch()
        layout.addLayout(atalhos)

        observacao = QHBoxLayout()
        observacao.addWidget(QLabel("Observação (opcional):", self))
        self.observacaoLineEdit = QLineEdit(self)
        self.observacaoLineEdit.setPlaceholderText("Ex.: Plotter 2")
        self.observacaoLineEdit.setMaxLength(255)
        observacao.addWidget(self.observacaoLineEdit)
        layout.addLayout(observacao)

        self.totalLabel = QLabel(self)
        self.totalLabel.setStyleSheet("font-weight: bold;")
        layout.addWidget(self.totalLabel)

        buttons = QHBoxLayout()
        buttons.addStretch()
        self.okButton = QPushButton("Registrar", self)
        self.okButton.setDefault(True)  # Enter confirma o registro
        self.cancelButton = QPushButton("Cancelar", self)
        buttons.addWidget(self.okButton)
        buttons.addWidget(self.cancelButton)
        layout.addLayout(buttons)

        self.okButton.clicked.connect(self.accept)
        self.cancelButton.clicked.connect(self.reject)

        self._update_total()

    def _preencher_restante(self):
        for item in self._itens:
            self._spinboxes[item['produto_pedido_id']].setValue(
                int(item.get('quantidade_restante', 0) or 0))

    def _zerar(self):
        for spin in self._spinboxes.values():
            spin.setValue(0)

    def _update_total(self):
        """Atualiza o resumo do total a registrar conforme os campos mudam."""
        total = 0
        itens = 0
        for spin in self._spinboxes.values():
            if spin.value() > 0:
                total += spin.value()
                itens += 1
        self.totalLabel.setText(f"Total a registrar: {total} cópia(s) em {itens} item(ns).")
        self.okButton.setEnabled(itens > 0)

    def get_registros(self):
        """Retorna os registros de impressão (apenas itens com quantidade > 0)."""
        observacao = self.observacaoLineEdit.text().strip()
        registros = []
        for produto_pedido_id, spin in self._spinboxes.items():
            if spin.value() > 0:
                registro = {
                    'produto_pedido_id': produto_pedido_id,
                    'quantidade': spin.value()
                }
                if observacao:
                    registro['observacao'] = observacao
                registros.append(registro)
        return registros
