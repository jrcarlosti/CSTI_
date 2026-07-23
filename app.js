/* ================================================================
   CSTI — app.js — Lógica principal do sistema de estoque
   Integração via Google Apps Script (100% GET — sem CORS issues)
================================================================ */

// ── CONFIG ────────────────────────────────────────────────────
// URL padrão do Apps Script. Preencha aqui para que QUALQUER dispositivo
// (celular, tablet, outros PCs via GitHub Pages) já entre conectado automaticamente!
const DEFAULT_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw77r-ISLdV5O2U-f60bU86341iw1kUppgk-983IuB4W24uS9Ssg-h_xEXYt81DY1fSmg/exec';

const SCRIPT_URL_KEY = 'csti_script_url';
let   SCRIPT_URL     = localStorage.getItem(SCRIPT_URL_KEY) || DEFAULT_SCRIPT_URL;

// Usuário logado na sessão
let usuarioLogado = null;

// Cache local para performance
let cacheProdutos = [];
let filtroTipoProduto = 'TODOS';

// ── HELPER DE DATA P/ INPUTS ──────────────────────────────────
function getTodayIsoDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function inicializarFiltrosData() {
  // Deixa filtros de data livres por padrão para exibir histórico completo
}

function limparFiltroDataRange(idInicio, idFim, callback) {
  const elIni = document.getElementById(idInicio);
  const elFim = document.getElementById(idFim);
  if (elIni) elIni.value = '';
  if (elFim) elFim.value = '';
  if (typeof callback === 'function') callback();
}

function limparFiltroData(inputId, callback) {
  const el = document.getElementById(inputId);
  if (el) el.value = '';
  if (typeof callback === 'function') callback();
}

function normalizarDataISO(val) {
  if (!val && val !== 0) return '';
  if (val instanceof Date) {
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(val).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.substring(0, 10);
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) {
    const partes = s.split(' ')[0].split('/');
    const d = partes[0].padStart(2, '0');
    const m = partes[1].padStart(2, '0');
    const y = partes[2];
    return `${y}-${m}-${d}`;
  }
  return s;
}

function filtrarPorIntervaloData(lista, dataInicio, dataFim) {
  if (!dataInicio && !dataFim) return lista;
  const isoIni = dataInicio ? normalizarDataISO(dataInicio) : '';
  const isoFim = dataFim ? normalizarDataISO(dataFim) : '';
  return lista.filter(item => {
    const dt = normalizarDataISO(item.Data);
    if (!dt) return true;
    if (isoIni && dt < isoIni) return false;
    if (isoFim && dt > isoFim) return false;
    return true;
  });
}

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  iniciarRelogio();
  setupNav();
  setupPaymentCards();
  carregarConfigUrl();
  inicializarFiltrosData(); // Inicializa os inputs de data com a data do dia por padrão
  verificarSessao();
});

// ── RELÓGIO ───────────────────────────────────────────────────
function iniciarRelogio() {
  const el = document.getElementById('datetimeDisplay');
  const atualizar = () => {
    const now = new Date();
    el.textContent = now.toLocaleDateString('pt-BR', { weekday:'short', day:'2-digit', month:'2-digit', year:'numeric' })
      + ' ' + now.toLocaleTimeString('pt-BR');
  };
  atualizar();
  setInterval(atualizar, 1000);
}

// ── NAVEGAÇÃO ─────────────────────────────────────────────────
function setupNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => navegarPara(btn.dataset.page));
  });

  // Sidebar toggle
  document.getElementById('sidebarToggle').addEventListener('click', toggleSidebar);
  document.getElementById('menuBtn').addEventListener('click', toggleSidebar);
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('collapsed');
  document.body.classList.toggle('sidebar-collapsed');
}

function navegarPara(page) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('nav-' + page)?.classList.add('active');
  document.getElementById('page-' + page)?.classList.add('active');

  const titles = {
    dashboard:      'Dashboard',
    produtos:       'Produtos / Serviços',
    entrada:        'Entrada de Estoque',
    saida:          'Venda / Saída',
    caixa:          'Fluxo de Caixa',
    movimentacoes:  'Movimentações',
    config:         'Configurações'
  };
  document.getElementById('pageTitle').textContent = titles[page] || page;

  // Carrega dados ao navegar
  if (page === 'config') carregarListaUsuarios();

  if (SCRIPT_URL) {
    if (page === 'dashboard')     carregarDashboard();
    if (page === 'produtos')      carregarProdutos();
    if (page === 'entrada')       { carregarSelectProdutos('entProduto'); carregarEntradas(); }
    if (page === 'saida')         { carregarSelectProdutos('saidaProduto'); carregarSaidas(); }
    if (page === 'caixa')         carregarCaixa();
    if (page === 'movimentacoes') carregarMovimentacoes();
  }
}

function irParaConfig() { navegarPara('config'); }

function refreshCurrentPage() {
  const active = document.querySelector('.nav-item.active');
  if (active) navegarPara(active.dataset.page);
}

// ── API HELPERS (JSONP) ───────────────────────────────────────
// Usamos JSONP via <script> tag — única forma de contornar o bloqueio
// CORS do Chrome quando o arquivo é aberto via file://
// O Apps Script recebe ?callback=nome e retorna nome({...})

const JSONP_TIMEOUT = 20000; // 20 segundos

function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cbName = 'csti_cb_' + Date.now() + '_' + Math.floor(Math.random() * 9999);
    const script = document.createElement('script');

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout: o Apps Script demorou mais de 20 segundos para responder.'));
    }, JSONP_TIMEOUT);

    window[cbName] = (data) => {
      cleanup();
      resolve(data);
    };

    const cleanup = () => {
      clearTimeout(timer);
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error('Falha ao carregar o script. Verifique a URL do Apps Script.'));
    };

    // Adiciona o nome do callback na URL
    const urlObj = new URL(url);
    urlObj.searchParams.set('callback', cbName);
    script.src = urlObj.toString();
    document.head.appendChild(script);
  });
}

// Leitura: GET com JSONP
async function apiGet(acao, params = {}) {
  if (!SCRIPT_URL) throw new Error('URL do Apps Script não configurada. Vá em Configurações ⚙️');
  const url = new URL(SCRIPT_URL);
  url.searchParams.set('acao', acao);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  });
  return jsonp(url.toString());
}

// Escrita: GET com payload JSON + JSONP
async function apiPostSeguro(body) {
  if (!SCRIPT_URL) throw new Error('URL do Apps Script não configurada.');
  const url = new URL(SCRIPT_URL);
  url.searchParams.set('acao', 'escrever');
  url.searchParams.set('payload', JSON.stringify(body));
  return jsonp(url.toString());
}

// ── LOGIN / SESSÃO ────────────────────────────────────────────
function verificarSessao() {
  const sessao = localStorage.getItem('csti_usuario');
  if (sessao) {
    usuarioLogado = JSON.parse(sessao);
    document.getElementById('app').style.display = 'flex';
    if (SCRIPT_URL) {
      testarConexao();
      carregarDashboard();
    }
  } else {
    document.getElementById('app').style.display = 'none';
    abrirModal('modalLogin');
  }
}

async function fazerLogin() {
  const user = document.getElementById('loginUser').value;
  const pass = document.getElementById('loginPass').value;
  try {
    const r = await apiGet('validar_login', { user, pass });
    if (r.sucesso) {
      usuarioLogado = { nome: r.nome, cargo: r.cargo };
      localStorage.setItem('csti_usuario', JSON.stringify(usuarioLogado));
      fecharModal('modalLogin');
      document.getElementById('app').style.display = 'flex';
      carregarDashboard();
    } else {
      showToast('Credenciais inválidas', 'error');
    }
  } catch (e) {
    showToast('Erro ao logar: ' + e.message, 'error');
  }
}

// ── CONEXÃO ───────────────────────────────────────────────────
async function testarConexao() {
  setConnectionStatus(false, 'Conectando…');
  try {
    const r = await apiGet('dashboard');
    if (r.sucesso) {
      setConnectionStatus(true, 'Google Sheets ✔');
      return true;
    } else {
      setConnectionStatus(false, 'Erro: ' + (r.mensagem || r.erro || 'Resposta inválida'));
      return false;
    }
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('CORS')) {
      setConnectionStatus(false, 'Erro de rede/CORS');
      showToast('⚠️ "Failed to fetch": reimplante o Apps Script com o código atualizado. Veja o arquivo LEIA-ME.md', 'error', 8000);
    } else if (msg.includes('não configurada')) {
      setConnectionStatus(false, 'URL não configurada');
    } else {
      setConnectionStatus(false, 'Erro: ' + msg.substring(0, 40));
    }
    return false;
  }
}

function setConnectionStatus(ok, label) {
  const badge = document.getElementById('connectionBadge');
  const lbl   = document.getElementById('connectionLabel');
  badge.className = 'connection-badge ' + (ok ? 'ok' : 'error');
  lbl.textContent = label;
}

// ── DASHBOARD ─────────────────────────────────────────────────
async function carregarDashboard() {
  try {
    const r = await apiGet('dashboard');
    if (!r.sucesso) return;
    const d = r.dados;

    const cards = [
      { icon:'💰', label:'Saldo do Caixa',   val: fmtMoney(d.saldoCaixa),     cls: d.saldoCaixa >= 0 ? 'blue' : 'red', sub: 'Total acumulado', glow:'blue' },
      { icon:'📈', label:'Vendas Hoje',       val: fmtMoney(d.vendasHoje),      cls:'green', sub: d.qtdVendasHoje + ' transação(ões)', glow:'green' },
      { icon:'📦', label:'Produtos Cadastr.', val: d.totalProdutos,             cls:'blue', sub: d.totalServicos + ' serviço(s)',   glow:'blue' },
      { icon:'⚠️', label:'Estoque Baixo',     val: d.estoqueBaixo,              cls: d.estoqueBaixo > 0 ? 'red':'green', sub:'Itens com qtd < 5', glow: d.estoqueBaixo > 0 ? 'red':'green' },
    ];

    const grid = document.getElementById('dashboardCards');
    grid.innerHTML = cards.map(c => `
      <div class="card metric-card">
        <div class="metric-glow ${c.glow}"></div>
        <div class="metric-icon">${c.icon}</div>
        <div class="metric-label">${c.label}</div>
        <div class="metric-value ${c.cls}">${c.val}</div>
        <div class="metric-sub">${c.sub}</div>
      </div>
    `).join('');

    // Barras de formas de pagamento
    const pfp = d.porFormaPagamento || {};
    const total = Object.values(pfp).reduce((a, b) => a + b, 0);
    const formasLabels = { DINHEIRO:'💵 Dinheiro', PIX:'⚡ Pix', DEBITO:'💳 Débito', CREDITO:'💳 Crédito' };

    document.getElementById('formasPagChart').innerHTML = Object.entries(pfp).map(([k, v]) => {
      const pct = total > 0 ? Math.round((v / total) * 100) : 0;
      return `
        <div class="forma-bar-wrap">
          <div class="forma-bar-info">
            <span class="forma-bar-label">${formasLabels[k] || k}</span>
            <span class="forma-bar-val">${fmtMoney(v)} (${pct}%)</span>
          </div>
          <div class="forma-bar-track">
            <div class="forma-bar-fill ${k}" style="width:${pct}%"></div>
          </div>
        </div>`;
    }).join('');

    // Últimas movimentações
    const movs = d.ultimasMovimentacoes || [];
    const movEl = document.getElementById('ultimasMovList');
    if (movs.length === 0) {
      movEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>Nenhuma movimentação registrada</p></div>';
    } else {
      movEl.innerHTML = movs.map(m => `
        <div class="mov-item">
          <span class="mov-badge ${m.Tipo}">${m.Tipo}</span>
          <div class="mov-item-info">
            <div class="mov-item-nome">${m.Nome_Produto}</div>
            <div class="mov-item-sub">${m.Data} ${m.Hora} · ${fmtForma(m.Forma_Pagamento)}</div>
          </div>
          <div class="mov-item-val ${m.Tipo === 'SAIDA' ? 'success' : 'primary'}">${fmtMoney(m.Valor_Total)}</div>
        </div>`).join('');
    }

    setConnectionStatus(true, 'Google Sheets');
  } catch (e) {
    console.error('Erro dashboard:', e);
    setConnectionStatus(false, 'Erro: ' + e.message);
  }
}

// ── PRODUTOS ──────────────────────────────────────────────────
async function carregarProdutos() {
  try {
    const r = await apiGet('listar_produtos');
    cacheProdutos = r.sucesso ? r.dados : [];
    renderProdutos();
  } catch (e) {
    document.getElementById('tbodyProdutos').innerHTML = `<tr><td colspan="9" class="loading-cell">Erro: ${e.message}</td></tr>`;
  }
}

function renderProdutos() {
  const busca = (document.getElementById('searchProduto')?.value || '').toLowerCase();
  
  // Atualiza cartões de resumo de estoque
  const prodsFisicos = cacheProdutos.filter(p => p.Tipo === 'PRODUTO');
  const servicosFisicos = cacheProdutos.filter(p => p.Tipo === 'SERVICO');
  
  const totalQtdEstoque = prodsFisicos.reduce((s, p) => s + parseNum(p.Quantidade), 0);
  const baixoCount = prodsFisicos.filter(p => parseNum(p.Quantidade) < 5).length;
  
  if (document.getElementById('pTotalEstoqueQtd')) {
    document.getElementById('pTotalEstoqueQtd').textContent = `${totalQtdEstoque} un`;
    document.getElementById('pEstoqueBaixoCount').textContent = `${baixoCount} ${baixoCount === 1 ? 'item' : 'itens'}`;
    document.getElementById('pProdutosCount').textContent = prodsFisicos.length;
    document.getElementById('pServicosCount').textContent = servicosFisicos.length;
  }

  let lista = cacheProdutos.filter(p => {
    if (filtroTipoProduto !== 'TODOS' && p.Tipo !== filtroTipoProduto) return false;
    if (busca && !`${p.Nome} ${p.Categoria} ${p.Descricao}`.toLowerCase().includes(busca)) return false;
    return true;
  });

  const tbody = document.getElementById('tbodyProdutos');
  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">📦</div><p>Nenhum item encontrado</p></div></td></tr>';
    return;
  }

  tbody.innerHTML = lista.map(p => {
    const qtd = parseNum(p.Quantidade);
    let qtdBadge = '';
    
    if (p.Tipo === 'SERVICO') {
      qtdBadge = `<span class="chip" style="background:rgba(139,92,246,0.12);color:var(--purple)">🔧 N/A (Serviço)</span>`;
    } else if (qtd === 0) {
      qtdBadge = `<span class="chip danger" style="font-weight:700">🔴 0 un (Zerado)</span>`;
    } else if (qtd < 5) {
      qtdBadge = `<span class="chip warning" style="font-weight:700">⚠️ ${qtd} ${esc(p.Unidade || 'UN')} (Baixo)</span>`;
    } else {
      qtdBadge = `<span class="chip success" style="font-weight:700;font-size:0.88rem">📦 ${qtd} ${esc(p.Unidade || 'UN')}</span>`;
    }

    return `<tr>
      <td><span class="chip ${p.Tipo}">${p.Tipo === 'PRODUTO' ? '📦 Produto' : '🔧 Serviço'}</span></td>
      <td style="font-weight:600;color:var(--text-primary)">${esc(p.Nome)}</td>
      <td>${esc(p.Categoria)}</td>
      <td>${esc(p.Unidade)}</td>
      <td>${qtdBadge}</td>
      <td>${fmtMoney(p.Preco_Custo)}</td>
      <td><strong>${fmtMoney(p.Preco_Venda)}</strong></td>
      <td>${esc(p.Data_Cadastro)}</td>
      <td>
        <button class="btn-action edit" onclick="abrirModalProduto('${esc(p.ID)}')" title="Editar">✏️</button>
        <button class="btn-action del"  onclick="confirmarExclusao('${esc(p.ID)}','${esc(p.Nome)}')" title="Excluir">🗑️</button>
      </td>
    </tr>`;
  }).join('');
}

function filtrarProdutos() { renderProdutos(); }

function setFiltroTipo(btn) {
  document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  filtroTipoProduto = btn.dataset.filter;
  renderProdutos();
}

// Modal Produto
function abrirModalProduto(id) {
  document.getElementById('mpId').value = '';
  document.getElementById('mpNome').value = '';
  document.getElementById('mpDescricao').value = '';
  document.getElementById('mpCategoria').value = '';
  document.getElementById('mpTipo').value = 'PRODUTO';
  document.getElementById('mpUnidade').value = 'UN';
  document.getElementById('mpQtd').value = '';
  document.getElementById('mpCusto').value = '';
  document.getElementById('mpVenda').value = '';

  if (id) {
    const p = cacheProdutos.find(x => x.ID === id);
    if (!p) return;
    document.getElementById('modalProdutoTitulo').textContent = 'Editar Produto / Serviço';
    document.getElementById('mpId').value         = p.ID;
    document.getElementById('mpTipo').value       = p.Tipo;
    document.getElementById('mpNome').value       = p.Nome;
    document.getElementById('mpDescricao').value  = p.Descricao;
    document.getElementById('mpCategoria').value  = p.Categoria;
    document.getElementById('mpUnidade').value    = p.Unidade;
    document.getElementById('mpQtd').value        = p.Quantidade;
    document.getElementById('mpCusto').value      = p.Preco_Custo;
    document.getElementById('mpVenda').value      = p.Preco_Venda;
  } else {
    document.getElementById('modalProdutoTitulo').textContent = 'Novo Produto / Serviço';
  }
  abrirModal('modalProduto');
}

async function salvarProduto() {
  const id   = document.getElementById('mpId').value;
  const nome = document.getElementById('mpNome').value.trim();
  if (!nome) { showToast('Informe o nome do produto/serviço', 'error'); return; }

  const dados = {
    Tipo:        document.getElementById('mpTipo').value,
    Nome:        nome,
    Descricao:   document.getElementById('mpDescricao').value.trim(),
    Categoria:   document.getElementById('mpCategoria').value.trim(),
    Unidade:     document.getElementById('mpUnidade').value,
    Quantidade:  document.getElementById('mpQtd').value || 0,
    Preco_Custo: document.getElementById('mpCusto').value || 0,
    Preco_Venda: document.getElementById('mpVenda').value || 0,
  };

  setLoading('btnSalvarProduto', true);
  try {
    const body = id
      ? { acao: 'atualizar_produto', id, dados }
      : { acao: 'criar_produto', dados };
    await apiPostSeguro(body);
    fecharModal('modalProduto');
    showToast(id ? 'Produto atualizado!' : 'Produto cadastrado!', 'success');
    await carregarProdutos();
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  } finally {
    setLoading('btnSalvarProduto', false);
  }
}

function confirmarExclusao(id, nome) {
  document.getElementById('confirmMsg').textContent = `Deseja excluir "${nome}"?`;
  document.getElementById('btnConfirmOk').onclick = async () => {
    fecharModal('modalConfirm');
    await apiPostSeguro({ acao: 'excluir_produto', id });
    showToast('Item excluído!', 'success');
    carregarProdutos();
  };
  abrirModal('modalConfirm');
}

// ── SELECT DE PRODUTOS ───────────────────────────────────────────────
async function carregarSelectProdutos(selectId) {
  try {
    if (cacheProdutos.length === 0) {
      const r = await apiGet('listar_produtos');
      cacheProdutos = r.sucesso ? r.dados : [];
    }
    const sel = document.getElementById(selectId);
    sel.innerHTML = '<option value="">— Selecione —</option>' +
      cacheProdutos.map(p => `<option value="${esc(p.ID)}"
        data-tipo="${p.Tipo}"
        data-nome="${esc(p.Nome)}"
        data-qtd="${p.Quantidade}"
        data-custo="${p.Preco_Custo}"
        data-venda="${p.Preco_Venda}">${p.Tipo === 'PRODUTO' ? '📦' : '🔧'} ${esc(p.Nome)} ${p.Tipo==='PRODUTO' ? '(Estoque: '+p.Quantidade+')' : ''}</option>`).join('');
  } catch (e) {
    console.error(e);
  }
}

// ── ENTRADA ───────────────────────────────────────────────
function onProdutoEntradaChange() {
  const sel = document.getElementById('entProduto');
  const opt = sel.selectedOptions[0];
  if (!opt || !opt.value) {
    document.getElementById('entTipoItem').value = '';
    document.getElementById('entValor').value    = '';
    document.getElementById('entTotal').textContent = 'R$ 0,00';
    return;
  }
  document.getElementById('entTipoItem').value = opt.dataset.tipo || '';
  // Pré-preenche com o preço de CUSTO (compra) — não o de venda
  document.getElementById('entValor').value    = opt.dataset.custo || '';
  calcEntradaTotal();
}

function calcEntradaTotal() {
  const qtd = parseFloat(document.getElementById('entQtd').value) || 0;
  const val = parseFloat(document.getElementById('entValor').value) || 0;
  document.getElementById('entTotal').textContent = fmtMoney(qtd * val);
}

async function salvarEntrada() {
  const sel  = document.getElementById('entProduto');
  const opt  = sel.selectedOptions[0];
  const idP  = sel.value;
  if (!idP) { showToast('Selecione um produto', 'error'); return; }
  const qtd  = parseFloat(document.getElementById('entQtd').value) || 0;
  if (qtd <= 0) { showToast('Informe a quantidade', 'error'); return; }

  const dados = {
    Tipo:           'ENTRADA',
    ID_Produto:     idP,
    Nome_Produto:   opt.dataset.nome,
    Tipo_Item:      opt.dataset.tipo,
    Quantidade:     qtd,
    Valor_Unitario: document.getElementById('entValor').value || 0,
    Forma_Pagamento:document.getElementById('entFormaPag').value,
    Observacao:     document.getElementById('entObs').value.trim(),
    Operador:       usuarioLogado ? usuarioLogado.nome : 'Sistema',
  };

  setLoading('btnSalvarEntrada', true);
  try {
    await apiPostSeguro({ acao: 'registrar_movimentacao', dados });
    showToast('Entrada registrada com sucesso!', 'success');
    limparEntrada();
    cacheProdutos = []; // Força reload
    await carregarEntradas();
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  } finally {
    setLoading('btnSalvarEntrada', false);
  }
}

function limparEntrada() {
  document.getElementById('entProduto').value = '';
  document.getElementById('entTipoItem').value = '';
  document.getElementById('entQtd').value = '';
  document.getElementById('entValor').value = '';
  document.getElementById('entObs').value = '';
  document.getElementById('entTotal').textContent = 'R$ 0,00';
}

async function carregarEntradas() {
  try {
    const dataInicio = document.getElementById('filtroEntradaDataInicio')?.value || '';
    const dataFim    = document.getElementById('filtroEntradaDataFim')?.value || '';
    const r = await apiGet('listar_movimentacoes', { tipo: 'ENTRADA', dataInicio, dataFim });
    let lista = r.sucesso ? r.dados : [];
    lista = filtrarPorIntervaloData(lista, dataInicio, dataFim);
    lista = lista.slice(-20).reverse();
    const el = document.getElementById('listaEntradas');
    if (lista.length === 0) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">📥</div><p>Nenhuma entrada encontrada para este período</p></div>';
    } else {
      el.innerHTML = lista.map(m => `
        <div class="recent-item">
          <div class="recent-item-info">
            <div class="recent-item-nome">${esc(m.Nome_Produto)}</div>
            <div class="recent-item-sub">${m.Data} ${m.Hora} · ${m.Quantidade} ${esc(m.Tipo_Item)} · ${fmtForma(m.Forma_Pagamento)}</div>
          </div>
          <div class="recent-item-val danger">−${fmtMoney(m.Valor_Total)}</div>
        </div>`).join('');
    }
  } catch (e) { console.error(e); }
}

// ── SAÍDA / VENDA ─────────────────────────────────────────────
function setupPaymentCards() {
  document.querySelectorAll('.payment-card input').forEach(radio => {
    radio.addEventListener('change', () => {
      document.querySelectorAll('.payment-card').forEach(c => c.style.boxShadow = '');
    });
  });
}

function onProdutoSaidaChange() {
  const sel = document.getElementById('saidaProduto');
  const opt = sel.selectedOptions[0];
  if (!opt || !opt.value) {
    document.getElementById('saidaTipoItem').value = '';
    document.getElementById('saidaEstoqueAtual').value = '';
    document.getElementById('saidaValor').value = '';
    return;
  }
  document.getElementById('saidaTipoItem').value     = opt.dataset.tipo;
  document.getElementById('saidaEstoqueAtual').value = opt.dataset.qtd || 'N/A (serviço)';
  document.getElementById('saidaValor').value        = opt.dataset.venda || '';
  calcSaidaTotal();
}

function calcSaidaTotal() {
  const qtd = parseFloat(document.getElementById('saidaQtd').value) || 0;
  const val = parseFloat(document.getElementById('saidaValor').value) || 0;
  document.getElementById('saidaTotal').textContent = fmtMoney(qtd * val);
}

async function salvarSaida() {
  const sel = document.getElementById('saidaProduto');
  const opt = sel.selectedOptions[0];
  const idP = sel.value;
  if (!idP) { showToast('Selecione um produto ou serviço', 'error'); return; }
  const qtd = parseFloat(document.getElementById('saidaQtd').value) || 0;
  if (qtd <= 0) { showToast('Informe a quantidade', 'error'); return; }
  const val = parseFloat(document.getElementById('saidaValor').value) || 0;
  if (val <= 0) { showToast('Informe o valor unitário', 'error'); return; }

  const formaPag = document.querySelector('input[name="saidaFormaPag"]:checked')?.value || 'DINHEIRO';

  const dados = {
    Tipo:           'SAIDA',
    ID_Produto:     idP,
    Nome_Produto:   opt.dataset.nome,
    Tipo_Item:      opt.dataset.tipo,
    Quantidade:     qtd,
    Valor_Unitario: val,
    Forma_Pagamento:formaPag,
    Observacao:     document.getElementById('saidaObs').value.trim(),
    Operador:       usuarioLogado ? usuarioLogado.nome : 'Sistema',
  };

  setLoading('btnSalvarSaida', true);
  try {
    await apiPostSeguro({ acao: 'registrar_movimentacao', dados });
    showToast(`Venda de ${fmtMoney(qtd * val)} registrada! 🎉`, 'success');
    limparSaida();
    cacheProdutos = [];
    await carregarSaidas();
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  } finally {
    setLoading('btnSalvarSaida', false);
  }
}

function limparSaida() {
  document.getElementById('saidaProduto').value = '';
  document.getElementById('saidaTipoItem').value = '';
  document.getElementById('saidaEstoqueAtual').value = '';
  document.getElementById('saidaQtd').value = '';
  document.getElementById('saidaValor').value = '';
  document.getElementById('saidaObs').value = '';
  document.getElementById('saidaTotal').textContent = 'R$ 0,00';
  document.querySelector('input[name="saidaFormaPag"][value="DINHEIRO"]').checked = true;
}

async function carregarSaidas() {
  try {
    const dataInicio = document.getElementById('filtroSaidaDataInicio')?.value || '';
    const dataFim    = document.getElementById('filtroSaidaDataFim')?.value || '';
    const r = await apiGet('listar_movimentacoes', { tipo: 'SAIDA', dataInicio, dataFim });
    let lista = r.sucesso ? r.dados : [];
    lista = filtrarPorIntervaloData(lista, dataInicio, dataFim);
    lista = lista.slice(-20).reverse();
    const el = document.getElementById('listaSaidas');
    if (lista.length === 0) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">📤</div><p>Nenhuma venda encontrada para este período</p></div>';
    } else {
      el.innerHTML = lista.map(m => `
        <div class="recent-item">
          <div class="recent-item-info">
            <div class="recent-item-nome">${esc(m.Nome_Produto)}</div>
            <div class="recent-item-sub">${m.Data} ${m.Hora} · ${m.Quantidade} un · ${fmtForma(m.Forma_Pagamento)}</div>
          </div>
          <div class="recent-item-val success">+${fmtMoney(m.Valor_Total)}</div>
        </div>`).join('');
    }
  } catch (e) { console.error(e); }
}

// ── CAIXA ─────────────────────────────────────────────────────
async function carregarCaixa() {
  try {
    const dataInicio = document.getElementById('filtroCaixaDataInicio')?.value || '';
    const dataFim    = document.getElementById('filtroCaixaDataFim')?.value || '';
    const [rResumo, rLista] = await Promise.all([
      apiGet('resumo_caixa'),
      apiGet('listar_caixa', {
        tipo:           document.getElementById('filtroCaixaTipo')?.value || '',
        formaPagamento: document.getElementById('filtroCaixaForma')?.value || '',
        dataInicio,
        dataFim
      })
    ]);

    if (rResumo.sucesso) {
      const d = rResumo.dados;
      document.getElementById('cTotalReceitas').textContent = fmtMoney(d.totalReceitas);
      document.getElementById('cTotalDespesas').textContent = fmtMoney(d.totalDespesas);
      const saldoEl = document.getElementById('cSaldoAtual');
      saldoEl.textContent = fmtMoney(d.saldoAtual);
      saldoEl.style.color = d.saldoAtual >= 0 ? 'var(--success)' : 'var(--danger)';

      // Breakdown por forma de pagamento
      const pfp = d.porFormaPagamento || {};
      const formasInfo = {
        DINHEIRO: { icon:'💵', label:'Dinheiro' },
        PIX:      { icon:'⚡', label:'Pix'     },
        DEBITO:   { icon:'💳', label:'Débito'  },
        CREDITO:  { icon:'💳', label:'Crédito' },
      };
      document.getElementById('caixaFormasBreakdown').innerHTML = `
        <div class="card-header"><h3>💳 Receitas por Forma de Pagamento</h3></div>
        <div class="formas-breakdown-grid">
          ${Object.entries(pfp).map(([k, v]) => `
            <div class="forma-card">
              <div class="forma-card-icon">${formasInfo[k]?.icon || k}</div>
              <div class="forma-card-label">${formasInfo[k]?.label || k}</div>
              <div class="forma-card-val" style="color:var(--primary)">${fmtMoney(v)}</div>
            </div>`).join('')}
        </div>`;
    }

    // Tabela do caixa
    let lista = rLista.sucesso ? rLista.dados : [];
    lista = filtrarPorIntervaloData(lista, dataInicio, dataFim);
    lista = lista.slice().reverse();
    const tbody = document.getElementById('tbodyCaixa');
    if (lista.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">💰</div><p>Nenhum registro encontrado para este período/filtro</p></div></td></tr>';
    } else {
      tbody.innerHTML = lista.map(r => `
        <tr>
          <td>${esc(r.Data)}</td>
          <td>${esc(r.Hora)}</td>
          <td><span class="chip ${r.Tipo}">${r.Tipo}</span></td>
          <td>${esc(r.Descricao)}</td>
          <td><span class="chip ${r.Forma_Pagamento}">${fmtForma(r.Forma_Pagamento)}</span></td>
          <td style="font-weight:700;color:${r.Tipo==='RECEITA'?'var(--success)':'var(--danger)'}">${r.Tipo==='RECEITA'?'+':'-'}${fmtMoney(r.Valor)}</td>
          <td style="font-weight:700">${fmtMoney(r.Saldo_Acumulado)}</td>
        </tr>`).join('');
    }
  } catch (e) {
    document.getElementById('tbodyCaixa').innerHTML = `<tr><td colspan="7" class="loading-cell">Erro: ${e.message}</td></tr>`;
  }
}

function abrirModalCaixa() { abrirModal('modalCaixa'); }

async function salvarCaixaManual() {
  const tipo  = document.getElementById('mcTipo').value;
  const valor = parseFloat(document.getElementById('mcValor').value);
  const desc  = document.getElementById('mcDescricao').value.trim();
  if (!valor || valor <= 0) { showToast('Informe um valor válido', 'error'); return; }
  if (!desc)                { showToast('Informe a descrição', 'error'); return; }

  const dados = {
    Tipo:           tipo,
    Valor:          valor,
    Descricao:      desc,
    Forma_Pagamento:document.getElementById('mcFormaPag').value,
  };

  try {
    await apiPostSeguro({ acao: 'registrar_caixa', dados });
    fecharModal('modalCaixa');
    showToast('Lançamento registrado!', 'success');
    carregarCaixa();
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  }
}

// ── MOVIMENTAÇÕES ─────────────────────────────────────────────
async function carregarMovimentacoes() {
  try {
    const dataInicio = document.getElementById('filtroMovDataInicio')?.value || '';
    const dataFim    = document.getElementById('filtroMovDataFim')?.value || '';
    const r = await apiGet('listar_movimentacoes', {
      tipo:           document.getElementById('filtroMovTipo')?.value || '',
      formaPagamento: document.getElementById('filtroMovForma')?.value || '',
      dataInicio,
      dataFim
    });
    let lista = r.sucesso ? r.dados : [];
    lista = filtrarPorIntervaloData(lista, dataInicio, dataFim);
    lista = lista.slice().reverse();
    const tbody = document.getElementById('tbodyMovimentacoes');

    if (lista.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">🔄</div><p>Nenhuma movimentação encontrada para este período/filtro</p></div></td></tr>';
    } else {
      tbody.innerHTML = lista.map(m => `
        <tr>
          <td>${esc(m.Data)}</td>
          <td>${esc(m.Hora)}</td>
          <td><span class="chip ${m.Tipo}">${m.Tipo}</span></td>
          <td style="font-weight:600">${esc(m.Nome_Produto)} <small style="color:var(--text-muted)">${esc(m.Tipo_Item)}</small></td>
          <td><span class="chip ${m.Tipo_Item === 'PRODUTO' ? 'PRODUTO' : ''}" style="font-weight:700">${parseNum(m.Quantidade) % 1 === 0 ? parseNum(m.Quantidade) : parseNum(m.Quantidade).toFixed(2)} ${esc(m.Tipo_Item === 'PRODUTO' ? 'un' : '')}</span></td>
          <td>${fmtMoney(m.Valor_Unitario)}</td>
          <td style="font-weight:700;color:${m.Tipo==='SAIDA'?'var(--success)':'var(--danger)'}">${fmtMoney(m.Valor_Total)}</td>
          <td><span class="chip ${m.Forma_Pagamento}">${fmtForma(m.Forma_Pagamento)}</span></td>
          <td style="color:var(--text-muted);font-size:0.78rem">${esc(m.Observacao)} ${m.Operador ? '· 👤 ' + esc(m.Operador) : ''}</td>
        </tr>`).join('');
    }
  } catch (e) {
    document.getElementById('tbodyMovimentacoes').innerHTML = `<tr><td colspan="9" class="loading-cell">Erro: ${e.message}</td></tr>`;
  }
}

// ── CONFIGURAÇÕES ─────────────────────────────────────────────
function carregarConfigUrl() {
  const url = localStorage.getItem(SCRIPT_URL_KEY) || DEFAULT_SCRIPT_URL || '';
  document.getElementById('configScriptUrl').value = url;
}

function salvarConfig() {
  const url = document.getElementById('configScriptUrl').value.trim();
  const el   = document.getElementById('configStatus');

  if (!url) {
    el.textContent = '⚠️ Cole a URL do Apps Script acima.';
    el.className = 'config-status err';
    return;
  }
  if (!url.startsWith('https://script.google.com')) {
    el.textContent = '⚠️ URL inválida. Deve começar com https://script.google.com…';
    el.className = 'config-status err';
    return;
  }

  SCRIPT_URL = url;
  localStorage.setItem(SCRIPT_URL_KEY, url);
  el.textContent = '🕒 URL salva! Testando conexão com a planilha…';
  el.className = 'config-status ok';

  testarConexao().then(ok => {
    if (ok) {
      el.textContent = '✅ Conexão estabelecida com sucesso! O sistema está pronto.';
      showToast('🎉 Conectado ao Google Sheets!', 'success');
      // Navega ao dashboard automaticamente após conexão
      setTimeout(() => navegarPara('dashboard'), 1500);
    } else {
      el.textContent = '❌ Falha na conexão. Verifique se a URL está correta e se o script foi reimplantado com o código atualizado (apps-script.js).';
      el.className = 'config-status err';
    }
  });
}

async function inicializarPlanilha() {
  if (!SCRIPT_URL) { showToast('Configure a URL primeiro', 'error'); return; }
  try {
    const r = await apiGet('inicializar');
    showToast(r.mensagem || 'Abas criadas!', 'success');
  } catch (e) {
    showToast('Erro: ' + e.message, 'error');
  }
}

// ── LOGIN / USUÁRIOS ───────────────────────────────────────────────
// ── LOGIN / USUÁRIOS ───────────────────────────────────────────────
const USUARIOS_KEY = 'csti_usuarios';
let cacheUsuarios = [];

async function getUsuarios() {
  if (SCRIPT_URL) {
    try {
      const r = await apiGet('listar_usuarios');
      if (r.sucesso && Array.isArray(r.dados)) {
        cacheUsuarios = r.dados.map(u => ({
          id: u.ID,
          nome: u.Nome,
          login: u.Login,
          senha: u.Senha,
          cargo: u.Cargo
        }));
        return cacheUsuarios;
      }
    } catch (e) { console.error('Erro ao listar usuários:', e); }
  }
  const raw = localStorage.getItem(USUARIOS_KEY);
  if (raw) return JSON.parse(raw);
  const padrao = [{ id: 'USR_1', nome: 'Administrador', login: 'admin', senha: 'admin123', cargo: 'Administrador' }];
  return padrao;
}

function verificarSessao() {
  const sessao = localStorage.getItem('csti_usuario');
  if (sessao) {
    usuarioLogado = JSON.parse(sessao);
    document.getElementById('usuarioNomeDisplay').textContent = usuarioLogado.nome;
    document.getElementById('usuarioCargoDisplay').textContent = usuarioLogado.cargo || '';
    fecharModal('modalLogin');
    if (SCRIPT_URL) {
      testarConexao();
      carregarDashboard();
    } else {
      setConnectionStatus(false, 'URL não configurada');
      irParaConfig();
      showToast('Configure a URL do Apps Script nas Configurações ⚙️', 'info');
    }
  } else {
    abrirModal('modalLogin');
  }
}

async function fazerLogin() {
  const loginInput = document.getElementById('loginUser').value.trim();
  const senhaInput = document.getElementById('loginPass').value;
  const erroEl     = document.getElementById('loginErro');

  if (!loginInput || !senhaInput) {
    erroEl.textContent = 'Preencha usuário e senha.';
    erroEl.style.display = 'block';
    return;
  }

  const usuarios = await getUsuarios();
  const user = usuarios.find(u => String(u.login).toLowerCase() === loginInput.toLowerCase() && String(u.senha) === senhaInput);

  if (user) {
    erroEl.style.display = 'none';
    usuarioLogado = { id: user.id, nome: user.nome, cargo: user.cargo };
    localStorage.setItem('csti_usuario', JSON.stringify(usuarioLogado));
    document.getElementById('usuarioNomeDisplay').textContent = usuarioLogado.nome;
    document.getElementById('usuarioCargoDisplay').textContent = usuarioLogado.cargo || '';
    fecharModal('modalLogin');
    document.getElementById('loginUser').value = '';
    document.getElementById('loginPass').value = '';
    showToast(`Bem-vindo, ${usuarioLogado.nome}! 👋`, 'success');
    if (SCRIPT_URL) { testarConexao(); carregarDashboard(); }
    else { irParaConfig(); showToast('Configure a URL do Apps Script ⚙️', 'info'); }
  } else {
    erroEl.textContent = '❌ Usuário ou senha incorretos.';
    erroEl.style.display = 'block';
    document.getElementById('loginPass').value = '';
  }
}

function fazerLogout() {
  localStorage.removeItem('csti_usuario');
  usuarioLogado = null;
  document.getElementById('usuarioNomeDisplay').textContent = '—';
  document.getElementById('usuarioCargoDisplay').textContent = '';
  abrirModal('modalLogin');
  showToast('Sessão encerrada.', 'info');
}

// Gerenciamento de usuários
async function carregarListaUsuarios() {
  const usuarios = await getUsuarios();
  const tbody = document.getElementById('tbodyUsuarios');
  if (!tbody) return;
  tbody.innerHTML = usuarios.map(u => `
    <tr>
      <td style="font-weight:600">${esc(u.nome)}</td>
      <td>${esc(u.login)}</td>
      <td><span class="chip PRODUTO">${esc(u.cargo)}</span></td>
      <td>
        <button class="btn-action edit" onclick="editarUsuario('${esc(u.id)}')" title="Editar">✏️</button>
        ${u.login !== 'admin' ? `<button class="btn-action del" onclick="excluirUsuario('${esc(u.id)}')" title="Excluir">🗑️</button>` : ''}
      </td>
    </tr>`).join('');
}

function abrirModalUsuario(id) {
  const form = {
    id:    document.getElementById('muId'),
    nome:  document.getElementById('muNome'),
    login: document.getElementById('muLogin'),
    senha: document.getElementById('muSenha'),
    cargo: document.getElementById('muCargo'),
  };
  if (id) {
    const u = cacheUsuarios.find(x => String(x.id) === String(id));
    if (!u) return;
    document.getElementById('modalUsuarioTitulo').textContent = 'Editar Usuário';
    form.id.value    = u.id;
    form.nome.value  = u.nome;
    form.login.value = u.login;
    form.senha.value = '';
    form.cargo.value = u.cargo;
  } else {
    document.getElementById('modalUsuarioTitulo').textContent = 'Novo Usuário';
    form.id.value = ''; form.nome.value = ''; form.login.value = ''; form.senha.value = ''; form.cargo.value = 'Operador';
  }
  abrirModal('modalUsuario');
}

async function salvarUsuario() {
  const id    = document.getElementById('muId').value;
  const nome  = document.getElementById('muNome').value.trim();
  const login = document.getElementById('muLogin').value.trim();
  const senha = document.getElementById('muSenha').value;
  const cargo = document.getElementById('muCargo').value;

  if (!nome || !login) { showToast('Nome e login são obrigatórios', 'error'); return; }

  const dados = { Nome: nome, Login: login, Senha: senha, Cargo: cargo };

  try {
    if (SCRIPT_URL) {
      const body = id
        ? { acao: 'atualizar_usuario', id, dados }
        : { acao: 'criar_usuario', dados };
      const r = await apiPostSeguro(body);
      if (r.sucesso) {
        showToast(id ? 'Usuário atualizado!' : 'Usuário criado!', 'success');
      } else {
        showToast('Erro: ' + (r.mensagem || 'Falha ao salvar'), 'error');
        return;
      }
    } else {
      let usuarios = await getUsuarios();
      if (id) {
        usuarios = usuarios.map(u => String(u.id) === String(id) ? { ...u, nome, login, cargo, senha: senha || u.senha } : u);
      } else {
        if (!senha) { showToast('Informe a senha para o novo usuário', 'error'); return; }
        const novoId = 'USR_' + Date.now();
        usuarios.push({ id: novoId, nome, login, senha, cargo });
      }
      localStorage.setItem(USUARIOS_KEY, JSON.stringify(usuarios));
      showToast('Usuário salvo localmente!', 'success');
    }
    fecharModal('modalUsuario');
    await carregarListaUsuarios();
  } catch (e) {
    showToast('Erro ao salvar usuário: ' + e.message, 'error');
  }
}

function editarUsuario(id) { abrirModalUsuario(id); }

async function excluirUsuario(id) {
  try {
    if (SCRIPT_URL) {
      await apiPostSeguro({ acao: 'excluir_usuario', id });
      showToast('Usuário excluído!', 'success');
    } else {
      let usuarios = (await getUsuarios()).filter(u => String(u.id) !== String(id));
      localStorage.setItem(USUARIOS_KEY, JSON.stringify(usuarios));
      showToast('Usuário excluído!', 'success');
    }
    await carregarListaUsuarios();
  } catch (e) {
    showToast('Erro ao excluir usuário: ' + e.message, 'error');
  }
}

// ── MODAIS ────────────────────────────────────────────────────
function abrirModal(id) { document.getElementById(id).classList.add('open'); }
function fecharModal(id) { document.getElementById(id).classList.remove('open'); }

// ── TOAST ─────────────────────────────────────────────────────
function showToast(msg, tipo = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${tipo}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  toast.innerHTML = `<span>${icons[tipo] || 'ℹ️'}</span><span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = '0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── HELPERS ───────────────────────────────────────────────────
function parseNum(val) {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (!val && val !== 0) return 0;
  var s = String(val).trim();
  if (s.indexOf(',') >= 0) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function fmtMoney(val) {
  const n = parseNum(val);
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const formaLabels = { DINHEIRO:'💵 Dinheiro', PIX:'⚡ Pix', DEBITO:'💳 Débito', CREDITO:'💳 Crédito' };
function fmtForma(f) { return formaLabels[f] || f || '—'; }

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  if (loading) btn.dataset.origText = btn.innerHTML, btn.innerHTML = '⏳ Salvando…';
  else         btn.innerHTML = btn.dataset.origText || btn.innerHTML;
}
