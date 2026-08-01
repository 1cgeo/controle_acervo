# Path: gui\ponto_controle\ponto_controle_dialog.py
"""Busca de pontos de controle e download dos arquivos.

ESPELHA a tela web (`client/src/js/modules/acervo/pages/ponto_controle/`), gesto
por gesto e pelo mesmo motivo que ela espelha a busca do acervo: quem já usa o
sistema não deve aprender nada novo aqui. Os mesmos filtros com quantitativo, o
mesmo "só na área do mapa", a mesma exportação, a mesma leitura de cor por
situação.

TRÊS DIFERENÇAS, e todas vêm de estar dentro do QGIS:

  1. **O mapa não é embutido, é o canvas.** A web precisa desenhar um mapa
     porque o navegador não tem um; aqui ele já existe. "Ver no mapa" entrega
     uma CAMADA categorizada por situação, que a pessoa filtra, estiliza e
     cruza com o resto do projeto -- coisa que o mapa da web não permite.
  2. **O download é em LOTE.** Na web se baixa um arquivo por vez, porque é o
     que um navegador faz bem. Aqui a pergunta real é "me dá o pacote destes
     trinta pontos", e a tela responde isso numa pasta.
  3. **Não há importação de missão.** Ela vive no plugin de ponto de controle,
     com o GeoPackage validado em campo. Um botão de importar aqui prometeria
     um caminho que esta tela não tem.

O que NÃO muda em relação à web, de propósito: só ponto APROVADO entra no
acervo, então não há filtro por situação (a coluna é constante e o filtro não
discriminaria nada); a situação continua na ficha, como registro da decisão de
campo.
"""
import os

from qgis.core import Qgis, QgsFeature, QgsGeometry, QgsPointXY
from qgis.PyQt import uic
from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtWidgets import (QDialog, QFileDialog, QHeaderView, QMessageBox,
                                 QTableWidget, QTableWidgetItem)

from ..mapa_utils import adicionar_ao_projeto, bbox_do_canvas, categorizar, criar_camada
from ..ui_utils import sortable_int_item, sortable_item
from .ponto_ficha_dialog import PontoFichaDialog

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'ponto_controle_dialog.ui'))

# Códigos de ponto_controle.tipo_situacao, com a MESMA leitura de cor da web e
# da ficha: 1 Não medido, 2 Aguardando revisão, 3 Aprovado, 4 Reprovado.
# Trocar o 3 com o 4 pinta a camada mentindo.
SITUACOES = [
    (1, 'Não medido', '#e8a33d'),
    (2, 'Aguardando revisão', '#3d8fe8'),
    (3, 'Aprovado', '#3da35d'),
    (4, 'Reprovado', '#d1495b'),
]

POR_PAGINA = 50
COLUNAS = ['Código', 'Projeto', 'Lote', 'Data do rastreio', 'Situação',
           'Medidor', 'Altitude (m)', 'Arquivos']


class PontoControleDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(PontoControleDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client

        self.pagina = 1
        self.total = 0
        self.pontos = []

        self.setup_ui()
        self.carregar_facetas()
        self.buscar()

    # --- montagem -----------------------------------------------------------

    def setup_ui(self):
        self.setWindowTitle("Pontos de Controle")

        self.resultsTable.setColumnCount(len(COLUNAS))
        self.resultsTable.setHorizontalHeaderLabels(COLUNAS)
        self.resultsTable.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        # Seleção MÚLTIPLA: é o que o download em lote precisa, e o que separa
        # esta tela da web.
        self.resultsTable.setSelectionMode(QTableWidget.SelectionMode.ExtendedSelection)
        self.resultsTable.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.resultsTable.setSortingEnabled(True)
        self.resultsTable.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.ResizeMode.Stretch)

        self.buscarButton.clicked.connect(self.buscar)
        self.buscarButton.setDefault(True)
        self.codigoLineEdit.returnPressed.connect(self.buscar)
        self.verNoMapaButton.clicked.connect(self.carregar_camada)
        self.fichaButton.clicked.connect(self.abrir_ficha)
        self.baixarButton.clicked.connect(self.baixar_selecionados)
        self.csvButton.clicked.connect(self.exportar_csv)
        self.anteriorButton.clicked.connect(lambda: self.ir_para(self.pagina - 1))
        self.proximaButton.clicked.connect(lambda: self.ir_para(self.pagina + 1))
        self.fecharButton.clicked.connect(self.reject)

        self.resultsTable.itemSelectionChanged.connect(self.atualizar_botoes)
        self.resultsTable.itemDoubleClicked.connect(lambda _: self.abrir_ficha())

        # Trocar projeto refaz a lista de lotes, e trocar estado refaz a de
        # municípios: a opção que não pertence ao pai deixou de fazer sentido.
        for combo in (self.projetoComboBox, self.estadoComboBox,
                      self.loteComboBox, self.municipioComboBox):
            combo.currentIndexChanged.connect(self.carregar_facetas)

        self.atualizar_botoes()

    # --- filtros ------------------------------------------------------------

    def montar_filtros(self):
        """Os filtros da tela, no formato da API.

        UM lugar só: a lista, as facetas, as posições do mapa e o CSV respondem
        à MESMA pergunta. Montá-los em quatro lugares é o que faria o número
        entre parênteses da faceta deixar de ser o total que a lista devolve.
        """
        filtros = {}

        codigo = self.codigoLineEdit.text().strip()
        if codigo:
            filtros['cod_ponto'] = codigo

        for chave, combo in (('projeto_id', self.projetoComboBox),
                             ('lote_id', self.loteComboBox),
                             ('estado_id', self.estadoComboBox),
                             ('municipio_id', self.municipioComboBox)):
            valor = combo.currentData()
            if valor is not None:
                filtros[chave] = valor

        if self.areaVisivelCheckBox.isChecked():
            bbox = bbox_do_canvas(self.iface, self)
            if bbox:
                filtros['bbox'] = bbox

        return filtros

    def carregar_facetas(self):
        """Recarrega as opções com o quantitativo cruzado.

        Os sinais ficam bloqueados durante o preenchimento: repovoar um combo
        dispara `currentIndexChanged`, e sem o bloqueio cada faceta chamaria o
        servidor de novo, em cascata.
        """
        if getattr(self, '_carregando_facetas', False):
            return
        self._carregando_facetas = True
        try:
            resposta = self.api_client.get('ponto_controle/facetas',
                                           params=self.montar_filtros())
            if not resposta or 'dados' not in resposta:
                return

            dados = resposta['dados']
            self._preencher(self.projetoComboBox, dados.get('projetos'), "Todos os projetos")
            self._preencher(self.loteComboBox, dados.get('lotes'), "Todos os lotes")
            self._preencher(self.estadoComboBox, dados.get('estados'), "Todos os estados",
                            rotulo=lambda i: i.get('sigla') or i.get('nome'))
            self._preencher(self.municipioComboBox, dados.get('municipios'),
                            "Todos os municípios")
        finally:
            self._carregando_facetas = False

    @staticmethod
    def _preencher(combo, itens, rotulo_vazio, rotulo=None):
        """Popula uma faceta, com a mesma política da web.

        Só entra quem TEM ponto, e o número vai entre parênteses: um combo com
        os 86 lotes do acervo, dos quais dois têm ponto de controle, faz a
        pessoa procurar agulha.

        A opção ESCOLHIDA sobrevive mesmo com zero, marcada com "(0)". Sumir com
        ela enquanto está selecionada tiraria da tela justamente o filtro que
        produziu o resultado vazio, e não haveria o que desfazer.
        """
        itens = itens or []
        atual = combo.currentData()
        nome = rotulo or (lambda i: i.get('nome'))

        combo.blockSignals(True)
        combo.clear()
        total = sum(i.get('pontos') or 0 for i in itens)
        combo.addItem(f"{rotulo_vazio} ({total})" if total else rotulo_vazio, None)

        for item in itens:
            pontos = item.get('pontos') or 0
            if pontos == 0 and item.get('code') != atual:
                continue
            combo.addItem(f"{nome(item)} ({pontos})", item.get('code'))

        indice = combo.findData(atual)
        combo.setCurrentIndex(indice if indice >= 0 else 0)
        combo.setEnabled(combo.count() > 1)
        combo.blockSignals(False)

    # --- lista --------------------------------------------------------------

    def buscar(self):
        self.pagina = 1
        self.carregar_pagina()
        self.carregar_facetas()

    def ir_para(self, pagina):
        if pagina < 1:
            return
        self.pagina = pagina
        self.carregar_pagina()

    def carregar_pagina(self):
        params = dict(self.montar_filtros(), pagina=self.pagina, por_pagina=POR_PAGINA)

        self.setCursor(Qt.CursorShape.WaitCursor)
        try:
            resposta = self.api_client.get('ponto_controle/', params=params)
        finally:
            self.setCursor(Qt.CursorShape.ArrowCursor)

        if not resposta or 'dados' not in resposta:
            self.statusLabel.setText("Não foi possível consultar os pontos.")
            return

        dados = resposta['dados']
        self.total = dados.get('total', 0)
        self.pontos = dados.get('pontos', []) or []
        self.preencher_tabela()
        self.atualizar_paginacao()

    def preencher_tabela(self):
        # Ordenação desligada durante o preenchimento: com ela ativa, cada
        # setItem reordena as linhas e embaralha as células de uma mesma linha.
        self.resultsTable.setSortingEnabled(False)
        self.resultsTable.setRowCount(len(self.pontos))

        for linha, ponto in enumerate(self.pontos):
            codigo = QTableWidgetItem(ponto.get('cod_ponto') or '')
            codigo.setData(Qt.ItemDataRole.UserRole, ponto)
            self.resultsTable.setItem(linha, 0, codigo)

            self.resultsTable.setItem(linha, 1, QTableWidgetItem(ponto.get('projeto') or ''))

            lote = ponto.get('lote') or ''
            if ponto.get('pit'):
                lote = f"{lote} ({ponto['pit']})"
            self.resultsTable.setItem(linha, 2, QTableWidgetItem(lote))

            data = (ponto.get('data_rastreio') or '')[:10]
            self.resultsTable.setItem(
                linha, 3,
                sortable_item(self._data_br(data), data)  # exibe dd/mm, ordena ISO
            )
            self.resultsTable.setItem(
                linha, 4, QTableWidgetItem(ponto.get('tipo_situacao_nome') or ''))
            self.resultsTable.setItem(linha, 5, QTableWidgetItem(ponto.get('medidor') or ''))

            altitude = ponto.get('altitude_ortometrica')
            self.resultsTable.setItem(
                linha, 6,
                sortable_item('' if altitude is None else f"{float(altitude):.3f}".replace('.', ','),
                              float(altitude) if altitude is not None else -99999)
            )
            self.resultsTable.setItem(linha, 7, sortable_int_item(ponto.get('total_arquivos')))

        self.resultsTable.setSortingEnabled(True)
        self.resultsTable.resizeColumnsToContents()
        self.atualizar_botoes()

    @staticmethod
    def _data_br(iso):
        if not iso or len(iso) < 10:
            return ''
        return f"{iso[8:10]}/{iso[5:7]}/{iso[0:4]}"

    def atualizar_paginacao(self):
        if self.total == 0:
            # Estado vazio explícito: separa "não há ponto para estes filtros"
            # de "a consulta falhou".
            self.statusLabel.setText("Nenhum ponto de controle para os filtros informados.")
        else:
            ultimo = min(self.pagina * POR_PAGINA, self.total)
            primeiro = (self.pagina - 1) * POR_PAGINA + 1
            self.statusLabel.setText(f"{primeiro}-{ultimo} de {self.total} ponto(s)")

        self.anteriorButton.setEnabled(self.pagina > 1)
        self.proximaButton.setEnabled(self.pagina * POR_PAGINA < self.total)

    def atualizar_botoes(self):
        selecionados = self.selecionados()
        self.fichaButton.setEnabled(len(selecionados) == 1)
        self.baixarButton.setEnabled(len(selecionados) > 0)
        self.baixarButton.setText(
            f"Baixar arquivos ({len(selecionados)})" if selecionados else "Baixar arquivos"
        )

    def selecionados(self):
        """Os pontos das linhas selecionadas, na ordem da tabela."""
        pontos = []
        for indice in self.resultsTable.selectionModel().selectedRows():
            item = self.resultsTable.item(indice.row(), 0)
            if item is not None:
                ponto = item.data(Qt.ItemDataRole.UserRole)
                if ponto:
                    pontos.append(ponto)
        return pontos

    # --- mapa ---------------------------------------------------------------

    def carregar_camada(self):
        """Traz TODOS os pontos do filtro como camada, e não a página.

        `/posicoes` existe justamente para isso: a lista pagina porque ninguém
        lê 500 cartões, mas o mapa não pode paginar -- cinquenta pontos numa
        consulta de quinhentos afirmam visualmente que a missão tem cinquenta.
        """
        self.setCursor(Qt.CursorShape.WaitCursor)
        try:
            resposta = self.api_client.get('ponto_controle/posicoes',
                                           params=self.montar_filtros(), timeout=180)
        finally:
            self.setCursor(Qt.CursorShape.ArrowCursor)

        if not resposta or 'dados' not in resposta:
            return

        pontos = (resposta['dados'].get('pontos') or [])
        if not pontos:
            QMessageBox.information(self, "Nada a mostrar",
                                    "Nenhum ponto atende aos filtros informados.")
            return

        camada = criar_camada("Pontos de controle", "Point",
                              [('id', 'int'), ('cod_ponto', 'str'),
                               ('situacao', 'int'), ('situacao_nome', 'str')])
        if camada is None:
            QMessageBox.critical(self, "Erro", "Não foi possível criar a camada.")
            return

        rotulos = {code: nome for code, nome, _ in SITUACOES}
        feicoes = []
        sem_posicao = 0
        for ponto in pontos:
            lon, lat = ponto.get('longitude'), ponto.get('latitude')
            if lon is None or lat is None:
                sem_posicao += 1
                continue
            feicao = QgsFeature(camada.fields())
            feicao.setGeometry(QgsGeometry.fromPointXY(QgsPointXY(float(lon), float(lat))))
            situacao = ponto.get('tipo_situacao')
            feicao.setAttributes([ponto.get('id'), ponto.get('cod_ponto') or '',
                                  situacao, rotulos.get(situacao, 'Não classificado')])
            feicoes.append(feicao)

        camada.dataProvider().addFeatures(feicoes)
        camada.updateExtents()
        categorizar(camada, 'situacao', SITUACOES, tipo_simbolo='ponto')
        adicionar_ao_projeto(self.iface, camada)

        self.iface.messageBar().pushMessage(
            "Pontos de controle",
            f"{len(feicoes)} ponto(s) carregados, coloridos por situação.",
            level=Qgis.MessageLevel.Success
        )
        if sem_posicao:
            QMessageBox.warning(
                self, "Pontos sem posição",
                f"{sem_posicao} ponto(s) não têm coordenada e ficaram de fora da camada."
            )

    # --- ficha e arquivos ---------------------------------------------------

    def abrir_ficha(self):
        selecionados = self.selecionados()
        if len(selecionados) != 1:
            return
        dialogo = PontoFichaDialog(self.iface, self.api_client,
                                   selecionados[0]['cod_ponto'], self)
        dialogo.exec()

    def baixar_selecionados(self):
        """Baixa pacote e monografia dos pontos selecionados, numa pasta.

        É o gesto que a web não faz: lá se baixa um arquivo por vez, porque é o
        que um navegador faz bem. A pergunta de quem trabalha com apoio de campo
        é "me dá o pacote destes trinta pontos".
        """
        pontos = self.selecionados()
        if not pontos:
            return

        pasta = QFileDialog.getExistingDirectory(self, "Pasta de destino")
        if not pasta:
            return

        tipos = []
        if self.pacoteCheckBox.isChecked():
            tipos.append(('pacote', 'Pacote'))
        if self.monografiaCheckBox.isChecked():
            tipos.append(('monografia', 'Monografia'))
        if not tipos:
            QMessageBox.warning(self, "Nada a baixar",
                                "Escolha pelo menos um tipo de arquivo.")
            return

        self.baixarButton.setEnabled(False)
        self.setCursor(Qt.CursorShape.WaitCursor)
        baixados, ausentes, falhas = 0, [], []
        try:
            for indice, ponto in enumerate(pontos, start=1):
                codigo = ponto['cod_ponto']
                # Uma subpasta por ponto, espelhando como o servidor os guarda
                # no volume: sem isso, dois pontos com arquivos de mesmo nome se
                # sobrescreveriam em silêncio na pasta de destino.
                destino_ponto = os.path.join(pasta, codigo)
                os.makedirs(destino_ponto, exist_ok=True)

                for tipo, rotulo in tipos:
                    self.statusLabel.setText(
                        f"Baixando {rotulo.lower()} de {codigo} ({indice}/{len(pontos)})..."
                    )
                    self.statusLabel.repaint()

                    # Destino é a PASTA: o nome sai do Content-Disposition da
                    # resposta, que traz o nome real com a extensão certa. Sem
                    # isso, trinta pacotes chegariam sem extensão e ninguém
                    # saberia qual é .zip e qual é .7z.
                    if self.api_client.download_file(
                        f"ponto_controle/{codigo}/download/{tipo}", destino_ponto
                    ):
                        baixados += 1
                    else:
                        # 404 é caso NORMAL aqui: nem todo ponto tem os dois
                        # arquivos, e a rota responde 404 quando falta um. Por
                        # isso o resumo diz "não vieram" em vez de "falharam".
                        ausentes.append(f"{codigo}: {rotulo.lower()}")
        finally:
            self.setCursor(Qt.CursorShape.ArrowCursor)
            self.baixarButton.setEnabled(True)
            self.statusLabel.setText("")

        self.atualizar_paginacao()
        resumo = f"{baixados} arquivo(s) baixados em {pasta}."
        if ausentes:
            resumo += (f"\n\n{len(ausentes)} não vieram (o ponto não tem aquele arquivo, "
                       "ou houve falha):\n" + "\n".join(f"  {a}" for a in ausentes[:15]))
            if len(ausentes) > 15:
                resumo += f"\n  ... e mais {len(ausentes) - 15}."
        QMessageBox.information(self, "Download concluído", resumo)

    def exportar_csv(self):
        """Exporta o conjunto INTEIRO dos filtros, ou só os selecionados."""
        selecionados = self.selecionados()
        filtros = self.montar_filtros()

        if selecionados:
            resposta = QMessageBox.question(
                self, "Exportar CSV",
                f"Exportar apenas os {len(selecionados)} ponto(s) selecionados?\n\n"
                f"'Não' exporta os {self.total} ponto(s) do filtro.",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
                | QMessageBox.StandardButton.Cancel
            )
            if resposta == QMessageBox.StandardButton.Cancel:
                return
            if resposta == QMessageBox.StandardButton.Yes:
                filtros['ids'] = ','.join(str(p['id']) for p in selecionados)

        caminho, _ = QFileDialog.getSaveFileName(
            self, "Salvar CSV", "pontos-de-controle.csv", "CSV (*.csv)")
        if not caminho:
            return

        self.setCursor(Qt.CursorShape.WaitCursor)
        try:
            ok = self.api_client.download_file('ponto_controle/csv', caminho, params=filtros)
        finally:
            self.setCursor(Qt.CursorShape.ArrowCursor)

        if ok:
            QMessageBox.information(self, "CSV salvo", f"Arquivo salvo em:\n{caminho}")
