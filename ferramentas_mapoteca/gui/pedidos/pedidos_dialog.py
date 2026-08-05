# Path: gui\pedidos\pedidos_dialog.py
import os
import logging
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import (QDialog, QMessageBox, QFileDialog,
                                 QTableWidgetItem, QHeaderView, QVBoxLayout,
                                 QLabel, QTableWidget, QPushButton, QHBoxLayout,
                                 QApplication)
from qgis.PyQt.QtCore import Qt, QDir
from qgis.PyQt.QtGui import QColor
from .impressao_manager import ImpressaoManager
from .registrar_impressao_dialog import RegistrarImpressaoDialog

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'pedidos_dialog.ui'))

FILA_COLUNAS = ['Localizador', 'Cliente', 'Prazo', 'Situação', 'Impressão']
ITENS_COLUNAS = ['Produto', 'MI', 'Escala', 'Mídia', 'Pedida', 'Impressa',
                 'Restante', 'Arquivo', 'Situação']

COR_CONCLUIDO = QColor(214, 240, 214)
COR_ATRASADO = QColor(250, 205, 205)
COR_URGENTE = QColor(252, 236, 195)

# A partir de quantos dias o prazo deixa de ser urgente na tela
DIAS_URGENTE = 3


def _formatar_data(valor):
    """Converte data ISO (YYYY-MM-DD...) para DD/MM/YYYY."""
    if not valor:
        return '-'
    data = str(valor)[:10]
    partes = data.split('-')
    if len(partes) == 3:
        return f"{partes[2]}/{partes[1]}/{partes[0]}"
    return data


def _formatar_prazo(pedido):
    """Prazo com a distância até ele, que é o que decide o dia de quem imprime.

    `dias_para_prazo` vem calculado no BANCO (`(p.prazo - CURRENT_DATE)::int`).
    Não se recalcula aqui de propósito: conta de data no cliente erra por fuso,
    e a fila é ordenada pelo mesmo valor no servidor.
    """
    if not pedido.get('prazo'):
        return 'sem prazo', None

    data = _formatar_data(pedido.get('prazo'))
    dias = pedido.get('dias_para_prazo')
    if dias is None:
        return data, None

    dias = int(dias)
    if dias < 0:
        return f"{data} (atrasado {abs(dias)} dia(s))", COR_ATRASADO
    if dias == 0:
        return f"{data} (hoje)", COR_ATRASADO
    if dias <= DIAS_URGENTE:
        return f"{data} (em {dias} dia(s))", COR_URGENTE
    return f"{data} (em {dias} dias)", None


def _formatar_mb(valor):
    try:
        return f"{float(valor):.1f} MB".replace('.', ',')
    except (TypeError, ValueError):
        return '-'


class PedidosDialog(QDialog, FORM_CLASS):
    """
    A tela do plugin da mapoteca: a FILA de pedidos a atender, os itens de cada
    um com o quantitativo de impressão (pedida / impressa / restante), o
    download dos PDFs das cartas e o registro do que foi impresso, para que
    operadores diferentes continuem o trabalho de onde o outro parou.

    TODA rota que esta tela chama é do módulo MAPOTECA, e isso é requisito, não
    coincidência: quem atende pedido tem operador na mapoteca e pode não ter
    perfil nenhum no acervo. Rota de acervo aqui devolve 403 para o usuário
    certo, no fim de um trabalho que deu certo.
    """

    def __init__(self, iface, api_client, settings, parent=None):
        # Sem pai, a janela some atrás do QGIS e sobrevive ao fechamento dele.
        super(PedidosDialog, self).__init__(parent or iface.mainWindow())
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        self.settings = settings

        self.impressao_manager = ImpressaoManager(api_client)

        self.pedidos = []          # tudo o que o servidor devolveu
        self.pedidos_visiveis = [] # o que o filtro deixou na tabela
        self.itens = []
        self.pedido_selecionado = None
        self.detalhe = {}
        self.download_in_progress = False

        self.setup_ui()
        self.setup_signals()
        self.load_pedidos()

    # --- Setup -------------------------------------------------------------

    def setup_ui(self):
        for table, colunas in ((self.pedidosTable, FILA_COLUNAS), (self.itensTable, ITENS_COLUNAS)):
            table.setColumnCount(len(colunas))
            table.setHorizontalHeaderLabels(colunas)
            table.verticalHeader().setVisible(False)
            table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
            table.setSelectionMode(QTableWidget.SelectionMode.SingleSelection)
            table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
            table.setAlternatingRowColors(True)
            table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.ResizeToContents)

        # A coluna de nome é a que cresce; as outras se ajustam ao conteúdo
        self.pedidosTable.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.itensTable.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)

        self.browseButton.setToolTip("Selecionar a pasta de destino dos PDFs")
        self.destinationLineEdit.setToolTip(
            "Pasta onde os PDFs e o manifesto de impressão serão salvos")

        # A pasta sobrevive à sessão: quem imprime usa a mesma todo dia, e
        # reescolhê-la a cada abertura era o passo mais repetido da tela.
        salva = self.settings.get('pasta_impressao', '')
        if salva and os.path.isdir(salva):
            self.destinationLineEdit.setText(salva)

        self.splitter.setStretchFactor(0, 1)
        self.splitter.setStretchFactor(1, 2)

        self.progressGroupBox.setVisible(False)
        self.cancelButton.setEnabled(False)
        self._atualizar_botoes()

    def setup_signals(self):
        self.refreshButton.clicked.connect(self.load_pedidos)
        # O lambda descarta o texto que `textChanged` manda. Ligado direto, esse
        # texto caía no parâmetro `recarregar_itens` e a tela pedia os itens do
        # pedido ao servidor A CADA TECLA digitada no filtro.
        self.filtroLineEdit.textChanged.connect(lambda _: self._preencher_fila())
        self.pedidosTable.itemSelectionChanged.connect(self.handle_pedido_selecionado)
        self.itensTable.itemSelectionChanged.connect(self._atualizar_botoes)
        self.itensTable.itemDoubleClicked.connect(lambda _: self.mostrar_historico())
        self.registrarButton.clicked.connect(self.registrar_impressao)
        self.historicoButton.clicked.connect(self.mostrar_historico)
        self.baixarItemButton.clicked.connect(self.baixar_pdf_item)
        self.browseButton.clicked.connect(self.browse_destination)
        self.downloadButton.clicked.connect(self.start_download)
        self.cancelButton.clicked.connect(self.cancel_download)
        self.closeButton.clicked.connect(self.handle_close)

        self.impressao_manager.prepare_complete.connect(self.handle_prepare_complete)
        self.impressao_manager.download_progress.connect(self.update_overall_progress)
        self.impressao_manager.file_progress.connect(self.update_file_progress)
        self.impressao_manager.download_complete.connect(self.handle_download_complete)
        self.impressao_manager.download_error.connect(self.handle_download_error)

    # --- Fila de atendimento -------------------------------------------------

    def _aguardar(self, mensagem):
        """Mostra a mensagem e o cursor de espera ANTES de uma chamada de rede.

        As chamadas são síncronas e travam a interface enquanto duram. O
        `processEvents` obriga a tela a pintar o aviso antes de bloquear; sem
        ele o operador vê a janela congelada, sem nada escrito.
        """
        self.statusLabel.setText(mensagem)
        self.refreshButton.setEnabled(False)
        QApplication.setOverrideCursor(Qt.CursorShape.WaitCursor)
        QApplication.processEvents()

    def _fim_da_espera(self):
        QApplication.restoreOverrideCursor()
        self.refreshButton.setEnabled(True)

    def load_pedidos(self):
        """Carrega a fila de atendimento do servidor.

        `/pedido/em_aberto`, e nunca `/pedido`: a lista de pedidos é do ANO
        consultado (o `ano` da query cai no ano corrente quando não vem), e o
        plugin não tem seletor de ano. Por ela, o pedido de dezembro ainda
        aberto em janeiro some da tela sem aviso.

        A fila já exclui no SERVIDOR o que não é trabalho de quem imprime
        (Concluído, Cancelado, Remetido e Aguardando produção). Não duplique
        essa régua aqui em Python.
        """
        self._aguardar("Carregando a fila de atendimento...")
        try:
            response = self.api_client.get('mapoteca/pedido/em_aberto')
        finally:
            self._fim_da_espera()

        if not response or 'dados' not in response:
            self.statusLabel.setText(
                "Não foi possível carregar a fila de atendimento. "
                "Verifique a conexão e use Atualizar para tentar de novo.")
            return

        self.pedidos = response['dados']
        self._preencher_fila(recarregar_itens=True)

    def _preencher_fila(self, recarregar_itens=False):
        """Redesenha a tabela da fila aplicando o filtro de texto.

        A seleção sobrevive ao redesenho: filtrar ou atualizar a fila com um
        pedido aberto embaixo não pode fechá-lo. Os sinais ficam bloqueados
        durante o preenchimento porque `selectRow` dispara
        `itemSelectionChanged`, e sem o bloqueio o recarregamento pediria os
        itens duas vezes ao servidor.
        """
        termo = self.filtroLineEdit.text().strip().lower()
        if termo:
            self.pedidos_visiveis = [p for p in self.pedidos if self._casa_filtro(p, termo)]
        else:
            self.pedidos_visiveis = list(self.pedidos)

        selecionado_id = self.pedido_selecionado['id'] if self.pedido_selecionado else None

        self.pedidosTable.blockSignals(True)
        self.pedidosTable.setRowCount(len(self.pedidos_visiveis))
        for row, pedido in enumerate(self.pedidos_visiveis):
            total = int(pedido.get('total_itens') or 0)
            impressos = int(pedido.get('itens_impressos') or 0)
            concluida = total > 0 and impressos >= total

            prazo_texto, cor_prazo = _formatar_prazo(pedido)
            valores = [
                pedido.get('localizador_pedido') or '-',
                pedido.get('cliente_nome') or '-',
                prazo_texto,
                pedido.get('situacao_pedido_nome') or '-',
                'Concluída' if concluida else f"{impressos}/{total} itens",
            ]
            for col, valor in enumerate(valores):
                cell = QTableWidgetItem(valor)
                if concluida:
                    cell.setBackground(COR_CONCLUIDO)
                elif cor_prazo is not None:
                    cell.setBackground(cor_prazo)
                self.pedidosTable.setItem(row, col, cell)

        linha = next(
            (r for r, p in enumerate(self.pedidos_visiveis) if p['id'] == selecionado_id),
            None
        )
        if linha is not None:
            self.pedido_selecionado = self.pedidos_visiveis[linha]
            self.pedidosTable.selectRow(linha)
        self.pedidosTable.blockSignals(False)

        if selecionado_id is not None and linha is None:
            # O pedido saiu da fila (outra pessoa concluiu) ou o filtro o escondeu
            self._limpar_itens()
        elif linha is not None and recarregar_itens:
            self.load_itens()

        self._atualizar_status_fila()
        self._atualizar_botoes()

    def _atualizar_status_fila(self):
        """Escreve na barra de status quantos pedidos a fila tem agora."""
        if not self.pedidos:
            self.statusLabel.setText("Nenhum pedido em aberto no momento.")
        elif len(self.pedidos_visiveis) != len(self.pedidos):
            self.statusLabel.setText(
                f"{len(self.pedidos_visiveis)} de {len(self.pedidos)} pedido(s) em aberto.")
        else:
            self.statusLabel.setText(f"{len(self.pedidos)} pedido(s) em aberto.")

    @staticmethod
    def _casa_filtro(pedido, termo):
        campos = (
            pedido.get('localizador_pedido'),
            pedido.get('cliente_nome'),
            pedido.get('documento_solicitacao'),
            pedido.get('documento_solicitacao_nup'),
            pedido.get('operacao'),
        )
        return any(termo in str(c).lower() for c in campos if c)

    def handle_pedido_selecionado(self):
        row = self.pedidosTable.currentRow()
        if row < 0 or row >= len(self.pedidos_visiveis):
            # Seleção desfeita: a tabela de itens tem de esvaziar junto, senão
            # os botões de trabalho seguem agindo sobre o pedido anterior.
            self._limpar_itens()
            self._atualizar_botoes()
            return
        self.pedido_selecionado = self.pedidos_visiveis[row]
        self.load_itens()

    def _limpar_itens(self):
        self.itensTable.setRowCount(0)
        self.itens = []
        self.detalhe = {}
        self.pedido_selecionado = None
        self.itensLabel.setText("Itens do pedido")
        self.pedidoInfoLabel.setText("Selecione um pedido na fila acima.")

    # --- Itens do pedido -----------------------------------------------------

    def load_itens(self):
        """Carrega o que IMPRIMIR do pedido selecionado.

        `/pedido/:id/impressao` é a lista de trabalho: além do quantitativo, ela
        diz item por item se existe PDF no acervo, o tamanho do arquivo e se o
        item é AVULSO (papel quadriculado, carta de outro CGEO). Saber disso
        ANTES de preparar o download é o que evita a surpresa no fim.
        """
        if not self.pedido_selecionado:
            return

        pedido_id = self.pedido_selecionado['id']
        self._aguardar("Carregando os itens do pedido...")
        try:
            response = self.api_client.get(f"mapoteca/pedido/{pedido_id}/impressao")
        finally:
            self._fim_da_espera()

        if not response or 'dados' not in response:
            self.statusLabel.setText(
                "Não foi possível carregar os itens do pedido. "
                "Selecione o pedido de novo ou use Atualizar.")
            return

        self.detalhe = response['dados']
        self.itens = self.detalhe.get('itens', [])

        self.itensTable.blockSignals(True)
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
                self._descricao_arquivo(item),
                'Concluída' if concluida else 'Pendente',
            ]
            for col, valor in enumerate(valores):
                cell = QTableWidgetItem(valor)
                if concluida:
                    cell.setBackground(COR_CONCLUIDO)
                self.itensTable.setItem(row, col, cell)

            dica = self._dica_item(item)
            if dica:
                for col in range(len(valores)):
                    self.itensTable.item(row, col).setToolTip(dica)
        self.itensTable.blockSignals(False)

        self._atualizar_cabecalho_itens()
        self._atualizar_status_fila()
        self._atualizar_botoes()

    @staticmethod
    def _descricao_arquivo(item):
        """O que se pode baixar deste item, dito na linha dele."""
        if item.get('uuid_arquivo'):
            return f"PDF ({_formatar_mb(item.get('tamanho_mb'))})"
        # O avulso não aponta produto do acervo: ele NUNCA terá PDF, e dizer
        # "sem PDF no acervo" mandaria o operador procurar o que não existe.
        if item.get('item_avulso'):
            return 'Avulso, imprimir do original'
        return 'Sem PDF no acervo'

    @staticmethod
    def _dica_item(item):
        partes = []
        if item.get('item_avulso'):
            partes.append('Item avulso: não vem do acervo.')
            if item.get('avulso_descricao'):
                partes.append(item['avulso_descricao'])
        else:
            if item.get('versao'):
                partes.append(f"Versão {item['versao']}")
            if item.get('arquivo_nome'):
                partes.append(item['arquivo_nome'])
        if item.get('observacao'):
            partes.append(f"Observação: {item['observacao']}")
        return '\n'.join(partes)

    def _atualizar_cabecalho_itens(self):
        impressao = self.detalhe.get('impressao') or {}
        localizador = self.detalhe.get('localizador_pedido') or ''
        concluidos = impressao.get('itens_concluidos', 0)
        total = impressao.get('total_itens', 0)
        self.itensLabel.setText(
            f"Itens do pedido {localizador} ({concluidos}/{total} itens impressos)")

        pedido = self.pedido_selecionado or {}
        info = [pedido.get('cliente_nome') or '-']
        if self.detalhe.get('forma_entrega_nome'):
            info.append(f"Entrega: {self.detalhe['forma_entrega_nome']}")
        if pedido.get('documento_solicitacao'):
            info.append(pedido['documento_solicitacao'])
        prazo_texto, _ = _formatar_prazo(pedido)
        info.append(f"Prazo: {prazo_texto}")

        sem_arquivo = impressao.get('itens_sem_arquivo', 0)
        if sem_arquivo:
            info.append(f"{sem_arquivo} item(ns) sem PDF para baixar")
        if total > 0 and concluidos >= total:
            info.append("impressão concluída, marque o pedido como Remetido no SCA")

        self.pedidoInfoLabel.setText('  ·  '.join(info))

    def _item_selecionado(self):
        row = self.itensTable.currentRow()
        if row < 0 or row >= len(self.itens):
            return None
        return self.itens[row]

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
        if not response:
            return

        # Recarrega a fila ANTES da mensagem: os contadores do pedido mudaram
        # junto, e `_preencher_fila` reescreve o statusLabel com a contagem.
        self.load_pedidos()
        total = sum(r['quantidade'] for r in registros)
        self.statusLabel.setText(
            f"Impressão registrada: {total} cópia(s) em {len(registros)} item(ns).")

    def mostrar_historico(self):
        """Mostra o histórico de impressão do item selecionado (quem/quando/quanto)."""
        item = self._item_selecionado()
        if item is None:
            return

        self._aguardar("Carregando o histórico do item...")
        try:
            response = self.api_client.get(
                f"mapoteca/produto_pedido/{item['produto_pedido_id']}/impressao")
        finally:
            self._fim_da_espera()

        if not response or 'dados' not in response:
            self.statusLabel.setText(
                "Não foi possível carregar o histórico deste item. Tente de novo.")
            return
        dados = response['dados']
        self._atualizar_status_fila()

        dialog = QDialog(self)
        dialog.setWindowTitle(
            f"Histórico de impressão: {item.get('produto_nome') or item.get('mi') or ''}")
        dialog.resize(680, 400)
        layout = QVBoxLayout(dialog)

        layout.addWidget(QLabel(
            f"Pedida: {dados['quantidade']}   |   "
            f"Já impresso: {dados['quantidade_impressa']}   |   "
            f"Restante: {dados['quantidade_restante']}"
        ))

        table = QTableWidget(dialog)
        table.setColumnCount(4)
        table.setHorizontalHeaderLabels(['Data', 'Usuário', 'Cópias', 'Observação'])
        table.verticalHeader().setVisible(False)
        table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        table.setAlternatingRowColors(True)
        table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.Stretch)

        registros = dados.get('registros', [])
        table.setRowCount(len(registros))
        for r, reg in enumerate(registros):
            data = _formatar_data(reg.get('data_impressao'))
            hora = str(reg.get('data_impressao') or '')[11:16]
            valores = [
                f"{data} {hora}".strip(),
                reg.get('usuario_nome_guerra') or reg.get('usuario_nome') or '-',
                str(reg.get('quantidade', 0)),
                reg.get('observacao') or ''
            ]
            for c, valor in enumerate(valores):
                table.setItem(r, c, QTableWidgetItem(valor))
        layout.addWidget(table)

        if not registros:
            layout.addWidget(QLabel("Nenhuma impressão registrada para este item."))

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
            self.settings.set('pasta_impressao', directory)
            self.settings.sync()
            self._atualizar_botoes()

    def baixar_pdf_item(self):
        """Baixa o PDF de UM item, pelo servidor.

        Usa `mapoteca/pedido/:id/arquivo/:uuid_arquivo/download`, que faz o
        stream do arquivo. É o caminho para reimprimir uma carta sozinha e para
        a máquina que não enxerga o volume de armazenamento, que é de onde o
        download do pedido inteiro copia.
        """
        item = self._item_selecionado()
        if item is None or not self.pedido_selecionado:
            return

        if not item.get('uuid_arquivo'):
            QMessageBox.information(
                self, "Item sem PDF",
                "Este item não tem PDF no acervo para baixar.\n\n"
                "Item avulso se imprime do original. Item do acervo sem "
                "arquivo depende de alguém carregar o PDF no SCA."
            )
            return

        destino_dir = self.destinationLineEdit.text()
        if not destino_dir or not os.path.isdir(destino_dir):
            QMessageBox.warning(
                self, "Pasta de destino",
                "Escolha uma pasta de destino válida antes de baixar o PDF."
            )
            return

        nome = os.path.basename(
            item.get('arquivo_nome_fisico') or item.get('arquivo_nome') or 'carta.pdf')
        destino = os.path.join(destino_dir, nome)

        if os.path.exists(destino):
            reply = QMessageBox.question(
                self, "Arquivo já existe",
                f"O arquivo \"{nome}\" já está na pasta de destino e será "
                "substituído.\n\nDeseja continuar?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No
            )
            if reply != QMessageBox.StandardButton.Yes:
                return

        # Baixa para um arquivo temporário e só depois renomeia. Escrevendo direto
        # no destino, uma queda no meio deixaria meio PDF com o nome do bom, ou
        # destruiria a cópia que já estava lá.
        parcial = f"{destino}.parcial"

        self.download_in_progress = True
        self.progressGroupBox.setVisible(True)
        self.currentFileLabel.setText(f"Baixando: {nome}")
        self.fileProgressBar.setValue(0)
        self.overallProgressBar.setMaximum(1)
        self.overallProgressBar.setValue(0)
        self.overallProgressLabel.setText("Progresso total: 0/1 arquivos")
        self.closeButton.setEnabled(False)
        self._atualizar_botoes()
        self._aguardar(f"Baixando o PDF de {nome}...")
        try:
            baixou = self.api_client.download_file(
                f"mapoteca/pedido/{self.pedido_selecionado['id']}"
                f"/arquivo/{item['uuid_arquivo']}/download",
                parcial,
                progress_callback=self._progresso_pdf_item
            )
        finally:
            self._fim_da_espera()
            self.download_in_progress = False
            self.progressGroupBox.setVisible(False)
            self.closeButton.setEnabled(True)
            self._atualizar_botoes()

        if baixou:
            try:
                os.replace(parcial, destino)
            except OSError as e:
                self._descartar_parcial(parcial)
                QMessageBox.warning(
                    self, "Falha ao salvar",
                    f"O PDF foi baixado, mas não pôde ser salvo como \"{nome}\": {e}\n\n"
                    "Feche o arquivo se ele estiver aberto, ou escolha outra pasta."
                )
                return
            self.overallProgressBar.setValue(1)
            self.statusLabel.setText(f"PDF salvo em {destino}")
            QMessageBox.information(
                self, "PDF baixado", f"O arquivo foi salvo em:\n{destino}")
            return

        # A causa da falha o api_client já mostrou.
        self._descartar_parcial(parcial)
        self.statusLabel.setText(
            "Não foi possível baixar o PDF deste item. Tente de novo ou baixe "
            "o pedido inteiro.")

    def _progresso_pdf_item(self, baixados, total):
        """Pinta o progresso do download de um item, que é síncrono."""
        if total > 0:
            self.fileProgressBar.setValue(int(baixados * 100 / total))
        QApplication.processEvents()

    @staticmethod
    def _descartar_parcial(caminho):
        try:
            if os.path.exists(caminho):
                os.remove(caminho)
        except OSError as e:
            logging.warning(f"Não foi possível apagar o arquivo parcial {caminho}: {e}")

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
        self.impressao_manager.prepare_download(
            self.pedido_selecionado['id'],
            localizador=self.detalhe.get('localizador_pedido')
            or self.pedido_selecionado.get('localizador_pedido'),
            itens=self.itens
        )

    def handle_prepare_complete(self, dados):
        arquivos = dados.get('arquivos', [])
        sem_pdf = dados.get('itens_sem_pdf', [])

        if sem_pdf:
            # A lista mistura duas coisas diferentes, e confundi-las era o que
            # mandava o operador procurar um PDF que não existe: o item AVULSO
            # nunca terá arquivo no acervo, e o do acervo sem PDF é uma falta de
            # verdade, que alguém tem de carregar.
            avulsos = [i for i in sem_pdf if i.get('item_avulso')]
            faltando = [i for i in sem_pdf if not i.get('item_avulso')]
            partes = []
            if faltando:
                partes.append(
                    "Estes itens do acervo NÃO têm PDF carregado e não serão baixados:\n"
                    + self._listar_itens(faltando))
            if avulsos:
                partes.append(
                    "Estes itens são avulsos (não vêm do acervo) e devem ser "
                    "impressos a partir do original:\n" + self._listar_itens(avulsos))
            QMessageBox.warning(self, "Itens sem PDF para baixar", "\n\n".join(partes))

        if not arquivos:
            self.statusLabel.setText("Nenhum PDF disponível para download neste pedido.")
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
        self._atualizar_botoes()

        self.impressao_manager.start_download(arquivos, self.destinationLineEdit.text())

    @staticmethod
    def _listar_itens(itens):
        return "\n".join(
            f"- {i.get('produto_nome') or '-'}"
            f"{' (MI ' + str(i['mi']) + ')' if i.get('mi') else ''}"
            f": {i.get('quantidade')} cópia(s)"
            for i in itens
        )

    def update_overall_progress(self, current, total):
        self.overallProgressBar.setMaximum(max(total, 1))
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
        self.progressGroupBox.setVisible(False)
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
                f"{sucessos} PDF(s) baixado(s), {falhas} falha(s):\n\n{detalhes}\n\n"
                "Baixe o pedido de novo para tentar os que faltaram, ou use "
                "\"Baixar PDF do item\" em cada um deles."
            )

        if manifesto_path:
            mensagem += (
                f"\n\nOs quantitativos de impressão foram gravados em:\n{manifesto_path}"
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
        self.progressGroupBox.setVisible(False)
        self._atualizar_botoes()

        # Mensagem vazia é o combinado com o ImpressaoManager: o api_client já
        # mostrou a causa, e um segundo diálogo só empilharia em cima dela.
        if not error_message:
            self.statusLabel.setText(
                "O download não pôde ser preparado. Veja a mensagem de erro e "
                "tente de novo.")
            return

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
        """Habilita o que dá para fazer, e diz na dica por que o resto não dá."""
        ocupado = self.download_in_progress
        tem_itens = bool(self.itens)
        tem_destino = bool(self.destinationLineEdit.text())
        tem_baixavel = any(i.get('uuid_arquivo') for i in self.itens)
        item = self._item_selecionado()
        item_com_pdf = item is not None and bool(item.get('uuid_arquivo'))

        self.registrarButton.setEnabled(tem_itens and not ocupado)
        self.registrarButton.setToolTip(
            "Aguarde o download terminar" if ocupado else
            "Selecione um pedido" if not tem_itens else
            "Registrar as cópias impressas nesta sessão")

        self.historicoButton.setEnabled(item is not None)
        self.historicoButton.setToolTip(
            "Selecione um item na tabela" if item is None else
            "Quem imprimiu, quando e quantas cópias")

        self.baixarItemButton.setEnabled(item_com_pdf and tem_destino and not ocupado)
        self.baixarItemButton.setToolTip(
            "Aguarde o download terminar" if ocupado else
            "Selecione um item na tabela" if item is None else
            "Este item não tem PDF no acervo" if not item_com_pdf else
            "Escolha a pasta de destino" if not tem_destino else
            "Baixar só o PDF deste item, direto do servidor")

        self.downloadButton.setEnabled(tem_baixavel and tem_destino and not ocupado)
        self.downloadButton.setToolTip(
            "Aguarde o download terminar" if ocupado else
            "Selecione um pedido" if not tem_itens else
            "Nenhum item deste pedido tem PDF no acervo" if not tem_baixavel else
            "Escolha a pasta de destino" if not tem_destino else
            "Baixar os PDFs das cartas deste pedido")

    def handle_close(self):
        if self.download_in_progress:
            reply = QMessageBox.question(
                self, "Confirmar Fechamento",
                "Há downloads em andamento. Tem certeza que deseja fechar?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No
            )
            if reply != QMessageBox.StandardButton.Yes:
                return
        # shutdown() espera as threads terminarem antes de fechar, evitando
        # QThread viva sem referência (crash nativo)
        self.impressao_manager.shutdown()
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
