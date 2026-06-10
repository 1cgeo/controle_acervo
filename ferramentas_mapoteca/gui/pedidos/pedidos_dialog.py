# Path: gui\pedidos\pedidos_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import (QDialog, QMessageBox, QFileDialog,
                                 QTableWidgetItem, QHeaderView, QVBoxLayout,
                                 QLabel, QTableWidget, QPushButton, QHBoxLayout)
from qgis.PyQt.QtCore import Qt, QDir
from qgis.PyQt.QtGui import QColor
from .impressao_manager import ImpressaoManager
from .registrar_impressao_dialog import RegistrarImpressaoDialog

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'pedidos_dialog.ui'))

# mapoteca.situacao_pedido: 5 = Concluído, 6 = Cancelado (pedidos inativos)
SITUACOES_INATIVAS = {5, 6}

PEDIDOS_COLUNAS = ['Localizador', 'Cliente', 'Data do Pedido', 'Situação', 'Prazo', 'Itens', 'Impressão']
ITENS_COLUNAS = ['Produto', 'MI', 'Escala', 'Mídia', 'Pedida', 'Já impresso', 'Restante', 'Situação']

COR_CONCLUIDO = QColor(200, 235, 200)


def _formatar_data(valor):
    """Converte data ISO (YYYY-MM-DD...) para DD/MM/YYYY."""
    if not valor:
        return '-'
    data = str(valor)[:10]
    partes = data.split('-')
    if len(partes) == 3:
        return f"{partes[2]}/{partes[1]}/{partes[0]}"
    return data


class PedidosDialog(QDialog, FORM_CLASS):
    """
    Diálogo principal do plugin da mapoteca: lista os pedidos ativos, exibe os
    itens com os quantitativos de impressão (pedido / já impresso / restante),
    baixa os PDFs das cartas para impressão e registra o que foi impresso —
    permitindo que operadores diferentes continuem o trabalho de onde parou.
    """

    def __init__(self, iface, api_client, parent=None):
        super(PedidosDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client

        self.impressao_manager = ImpressaoManager(api_client)

        self.pedidos = []
        self.itens = []
        self.pedido_selecionado = None
        self.download_in_progress = False

        self.setup_ui()
        self.setup_signals()
        self.load_pedidos()

    # --- Setup -------------------------------------------------------------

    def setup_ui(self):
        for table, colunas in ((self.pedidosTable, PEDIDOS_COLUNAS), (self.itensTable, ITENS_COLUNAS)):
            table.setColumnCount(len(colunas))
            table.setHorizontalHeaderLabels(colunas)
            table.verticalHeader().setVisible(False)
            table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
            table.setSelectionMode(QTableWidget.SelectionMode.SingleSelection)
            table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
            table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)

        self.progressGroupBox.setVisible(False)
        self.cancelButton.setEnabled(False)
        self._atualizar_botoes()

    def setup_signals(self):
        self.refreshButton.clicked.connect(self.load_pedidos)
        self.pedidosTable.itemSelectionChanged.connect(self.handle_pedido_selecionado)
        self.itensTable.itemSelectionChanged.connect(self._atualizar_botoes)
        self.registrarButton.clicked.connect(self.registrar_impressao)
        self.historicoButton.clicked.connect(self.mostrar_historico)
        self.browseButton.clicked.connect(self.browse_destination)
        self.downloadButton.clicked.connect(self.start_download)
        self.cancelButton.clicked.connect(self.cancel_download)
        self.closeButton.clicked.connect(self.handle_close)

        self.impressao_manager.prepare_complete.connect(self.handle_prepare_complete)
        self.impressao_manager.download_progress.connect(self.update_overall_progress)
        self.impressao_manager.file_progress.connect(self.update_file_progress)
        self.impressao_manager.download_complete.connect(self.handle_download_complete)
        self.impressao_manager.download_error.connect(self.handle_download_error)

    # --- Pedidos -----------------------------------------------------------

    def load_pedidos(self):
        """Carrega os pedidos ativos (não concluídos/cancelados) do servidor."""
        response = self.api_client.get('mapoteca/pedido')
        if not response or 'dados' not in response:
            return

        self.pedidos = [
            p for p in response['dados']
            if p.get('situacao_pedido_id') not in SITUACOES_INATIVAS
        ]

        self.pedidosTable.setRowCount(len(self.pedidos))
        for row, pedido in enumerate(self.pedidos):
            total_itens = int(pedido.get('quantidade_produtos') or 0)
            impressos = int(pedido.get('itens_impressos') or 0)
            if total_itens > 0 and impressos >= total_itens:
                status_impressao = 'Concluída'
            else:
                status_impressao = f"{impressos}/{total_itens} itens"

            valores = [
                pedido.get('localizador_pedido') or '-',
                pedido.get('cliente_nome') or '-',
                _formatar_data(pedido.get('data_pedido')),
                pedido.get('situacao_pedido_nome') or '-',
                _formatar_data(pedido.get('prazo')),
                str(total_itens),
                status_impressao
            ]
            concluida = total_itens > 0 and impressos >= total_itens
            for col, valor in enumerate(valores):
                cell = QTableWidgetItem(valor)
                if concluida:
                    cell.setBackground(COR_CONCLUIDO)
                self.pedidosTable.setItem(row, col, cell)

        self.itensTable.setRowCount(0)
        self.itens = []
        self.pedido_selecionado = None
        self.statusLabel.setText(f"{len(self.pedidos)} pedido(s) ativo(s).")
        self._atualizar_botoes()

    def handle_pedido_selecionado(self):
        row = self.pedidosTable.currentRow()
        if row < 0 or row >= len(self.pedidos):
            return
        self.pedido_selecionado = self.pedidos[row]
        self.load_itens()

    def load_itens(self):
        """Carrega os itens do pedido selecionado com os quantitativos."""
        if not self.pedido_selecionado:
            return

        response = self.api_client.get(f"mapoteca/pedido/{self.pedido_selecionado['id']}")
        if not response or 'dados' not in response:
            return

        self.itens = response['dados'].get('produtos', [])

        self.itensTable.setRowCount(len(self.itens))
        for row, item in enumerate(self.itens):
            concluida = bool(item.get('impressao_concluida'))
            valores = [
                item.get('produto_nome') or '-',
                item.get('mi') or '-',
                item.get('escala') or '-',
                item.get('tipo_midia_nome') or '-',
                str(item.get('quantidade', 0)),
                str(item.get('quantidade_impressa', 0)),
                str(item.get('quantidade_restante', 0)),
                'Concluída' if concluida else 'Pendente'
            ]
            for col, valor in enumerate(valores):
                cell = QTableWidgetItem(valor)
                if concluida:
                    cell.setBackground(COR_CONCLUIDO)
                self.itensTable.setItem(row, col, cell)

        impressao = response['dados'].get('impressao') or {}
        localizador = self.pedido_selecionado.get('localizador_pedido', '')
        self.itensLabel.setText(
            f"Itens do pedido {localizador} — "
            f"{impressao.get('itens_concluidos', 0)}/{impressao.get('total_itens', 0)} itens impressos"
        )
        self._atualizar_botoes()

    # --- Registro de impressão ----------------------------------------------

    def registrar_impressao(self):
        """Abre o diálogo para registrar as cópias impressas nesta sessão."""
        if not self.itens:
            return

        pendentes = [i for i in self.itens if not i.get('impressao_concluida')]
        if not pendentes:
            QMessageBox.information(
                self, "Impressão concluída",
                "Todos os itens deste pedido já tiveram a impressão concluída."
            )
            return

        dialog = RegistrarImpressaoDialog(pendentes, self)
        if not dialog.exec():
            return

        registros = dialog.get_registros()
        if not registros:
            QMessageBox.information(self, "Aviso", "Nenhuma quantidade informada.")
            return

        response = self.api_client.post('mapoteca/impressao', {'registros': registros})
        if response:
            total = sum(r['quantidade'] for r in registros)
            self.statusLabel.setText(f"Impressão registrada: {total} cópia(s) em {len(registros)} item(ns).")
            self._atualizar_pedido_na_lista()

    def _atualizar_pedido_na_lista(self):
        """Recarrega a lista de pedidos preservando a seleção atual."""
        pedido_id = self.pedido_selecionado['id'] if self.pedido_selecionado else None
        self.load_pedidos()
        if pedido_id is None:
            return
        for row, pedido in enumerate(self.pedidos):
            if pedido['id'] == pedido_id:
                self.pedidosTable.selectRow(row)
                # selectRow na mesma linha não re-emite itemSelectionChanged;
                # nesse caso recarregar os itens explicitamente
                if self.pedido_selecionado is None:
                    self.pedido_selecionado = pedido
                    self.load_itens()
                break

    def mostrar_historico(self):
        """Mostra o histórico de impressão do item selecionado (quem/quando/quanto)."""
        row = self.itensTable.currentRow()
        if row < 0 or row >= len(self.itens):
            return
        item = self.itens[row]

        response = self.api_client.get(f"mapoteca/produto_pedido/{item['id']}/impressao")
        if not response or 'dados' not in response:
            return
        dados = response['dados']

        dialog = QDialog(self)
        dialog.setWindowTitle(f"Histórico de impressão — {item.get('produto_nome') or item.get('mi') or ''}")
        dialog.resize(640, 380)
        layout = QVBoxLayout(dialog)

        resumo = QLabel(
            f"Pedida: {dados['quantidade']}   |   "
            f"Já impresso: {dados['quantidade_impressa']}   |   "
            f"Restante: {dados['quantidade_restante']}"
        )
        layout.addWidget(resumo)

        table = QTableWidget(dialog)
        table.setColumnCount(4)
        table.setHorizontalHeaderLabels(['Data', 'Usuário', 'Cópias', 'Observação'])
        table.verticalHeader().setVisible(False)
        table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.Stretch)

        registros = dados.get('registros', [])
        table.setRowCount(len(registros))
        for r, reg in enumerate(registros):
            data = _formatar_data(reg.get('data_impressao'))
            hora = str(reg.get('data_impressao') or '')[11:16]
            valores = [
                f"{data} {hora}".strip(),
                reg.get('usuario_nome') or '-',
                str(reg.get('quantidade', 0)),
                reg.get('observacao') or ''
            ]
            for c, valor in enumerate(valores):
                table.setItem(r, c, QTableWidgetItem(valor))
        layout.addWidget(table)

        botoes = QHBoxLayout()
        botoes.addStretch()
        fechar = QPushButton("Fechar", dialog)
        fechar.clicked.connect(dialog.accept)
        botoes.addWidget(fechar)
        layout.addLayout(botoes)

        dialog.exec()

    # --- Download dos PDFs ---------------------------------------------------

    def browse_destination(self):
        start_dir = self.destinationLineEdit.text() or QDir.homePath()
        directory = QFileDialog.getExistingDirectory(
            self, "Selecione a Pasta de Destino", start_dir,
            QFileDialog.Option.ShowDirsOnly
        )
        if directory:
            self.destinationLineEdit.setText(directory)
            self._atualizar_botoes()

    def start_download(self):
        """Prepara e inicia o download dos PDFs do pedido selecionado."""
        if not self.pedido_selecionado:
            return

        destination = self.destinationLineEdit.text()
        if not destination or not os.path.isdir(destination):
            QMessageBox.warning(self, "Aviso", "Selecione uma pasta de destino válida.")
            return

        self.statusLabel.setText("Preparando download dos PDFs...")
        self.downloadButton.setEnabled(False)
        self.impressao_manager.prepare_download(self.pedido_selecionado['id'])

    def handle_prepare_complete(self, dados):
        arquivos = dados.get('arquivos', [])
        sem_pdf = dados.get('itens_sem_pdf', [])

        if sem_pdf:
            detalhes = "\n".join(
                f"- {i.get('produto_nome') or '-'} (MI {i.get('mi') or '-'}): {i.get('quantidade')} cópia(s)"
                for i in sem_pdf
            )
            QMessageBox.warning(
                self, "Itens sem PDF",
                "Os seguintes itens não possuem PDF carregado no acervo e não serão baixados:\n\n" + detalhes
            )

        if not arquivos:
            self.statusLabel.setText("Nenhum PDF disponível para este pedido.")
            self._atualizar_botoes()
            return

        total_mb = self.impressao_manager.get_total_size_mb(arquivos)
        self.statusLabel.setText(f"Baixando {len(arquivos)} PDF(s) ({total_mb:.1f} MB)...")

        self.download_in_progress = True
        self.progressGroupBox.setVisible(True)
        self.cancelButton.setEnabled(True)
        self.closeButton.setEnabled(False)
        self.fileProgressBar.setValue(0)
        self.overallProgressBar.setValue(0)

        self.impressao_manager.start_download(arquivos, self.destinationLineEdit.text())

    def update_overall_progress(self, current, total):
        self.overallProgressBar.setMaximum(total)
        self.overallProgressBar.setValue(current)
        self.overallProgressLabel.setText(f"Progresso total: {current}/{total} arquivos")

    def update_file_progress(self, current_bytes, total_bytes, filename):
        if total_bytes > 0:
            self.fileProgressBar.setValue(int((current_bytes / total_bytes) * 100))
        self.currentFileLabel.setText(f"Baixando: {filename}")

    def handle_download_complete(self, results, manifesto_path):
        self.download_in_progress = False
        self.cancelButton.setEnabled(False)
        self.closeButton.setEnabled(True)
        self._atualizar_botoes()

        sucessos = sum(1 for r in results if r['success'])
        falhas = len(results) - sucessos

        if falhas == 0:
            mensagem = f"Todos os {sucessos} PDF(s) foram baixados com sucesso."
        else:
            detalhes = "\n".join(
                f"- {r['nome']}: {r['error_message']}" for r in results if not r['success']
            )
            mensagem = (
                f"{sucessos} PDF(s) baixado(s) com sucesso, {falhas} falha(s):\n\n{detalhes}"
            )

        if manifesto_path:
            mensagem += (
                f"\n\nOs quantitativos de impressão de cada arquivo foram gravados em:\n{manifesto_path}"
                "\n\nApós imprimir, use \"Registrar impressão\" para atualizar o controle."
            )

        self.statusLabel.setText(f"Download concluído: {sucessos} sucesso(s), {falhas} falha(s).")
        if falhas == 0:
            QMessageBox.information(self, "Download Concluído", mensagem)
        else:
            QMessageBox.warning(self, "Download Parcial", mensagem)

    def handle_download_error(self, error_message):
        self.download_in_progress = False
        self.cancelButton.setEnabled(False)
        self.closeButton.setEnabled(True)
        self._atualizar_botoes()
        self.statusLabel.setText(f"Erro: {error_message}")
        QMessageBox.critical(self, "Erro de Download", error_message)

    def cancel_download(self):
        reply = QMessageBox.question(
            self, "Confirmar Cancelamento",
            "Tem certeza que deseja cancelar os downloads em andamento?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No
        )
        if reply == QMessageBox.StandardButton.Yes:
            self.statusLabel.setText("Cancelando downloads...")
            self.impressao_manager.cancel_downloads()

    # --- Diversos ------------------------------------------------------------

    def _atualizar_botoes(self):
        tem_pedido = self.pedido_selecionado is not None
        tem_itens = bool(self.itens)
        tem_destino = bool(self.destinationLineEdit.text())
        item_selecionado = self.itensTable.currentRow() >= 0

        self.registrarButton.setEnabled(tem_itens and not self.download_in_progress)
        self.historicoButton.setEnabled(item_selecionado)
        self.downloadButton.setEnabled(tem_pedido and tem_destino and not self.download_in_progress)

    def handle_close(self):
        if self.download_in_progress:
            reply = QMessageBox.question(
                self, "Confirmar Fechamento",
                "Há downloads em andamento. Tem certeza que deseja fechar?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No
            )
            if reply == QMessageBox.StandardButton.Yes:
                # shutdown() espera as threads terminarem antes de fechar,
                # evitando QThread viva sem referência (crash nativo)
                self.impressao_manager.shutdown()
                self.reject()
        else:
            self.accept()

    def closeEvent(self, event):
        """Fechar pelo X da barra de título também precisa parar as threads."""
        if self.download_in_progress:
            reply = QMessageBox.question(
                self, "Confirmar Fechamento",
                "Há downloads em andamento. Tem certeza que deseja fechar?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No
            )
            if reply != QMessageBox.StandardButton.Yes:
                event.ignore()
                return
        self.impressao_manager.shutdown()
        event.accept()
