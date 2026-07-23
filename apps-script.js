/**
 * ============================================================
 * CSTI — SISTEMA DE CONTROLE DE ESTOQUE — GRÁFICA
 * Google Apps Script — Backend da Planilha Google Sheets
 *
 * COMO CONFIGURAR (faça isso UMA VEZ):
 * 1. Abra sua planilha Google Sheets
 * 2. Clique em Extensões > Apps Script
 * 3. Apague todo o código existente e cole ESTE arquivo inteiro
 * 4. Clique em Salvar (ícone de disquete)
 * 5. Clique em Implantar > Nova implantação
 *    - Tipo: "App da Web"
 *    - Executar como: "Eu mesmo"
 *    - Quem tem acesso: "Qualquer pessoa"
 * 6. Clique em "Implantar" e autorize as permissões
 * 7. Copie a URL gerada (começa com https://script.google.com/macros/s/...)
 * 8. Abra o arquivo index.html e substitua na linha:
 *       const SCRIPT_URL = 'COLE_A_URL_AQUI';
 * ============================================================
 */

const HEADERS = {
  PRODUTOS:      ['ID','Tipo','Nome','Descricao','Unidade','Quantidade','Preco_Custo','Preco_Venda','Categoria','Data_Cadastro','Ativo'],
  MOVIMENTACOES: ['ID','Data','Hora','Tipo','ID_Produto','Nome_Produto','Tipo_Item','Quantidade','Valor_Unitario','Valor_Total','Forma_Pagamento','Observacao','Operador'],
  CAIXA:         ['ID','Data','Hora','Tipo','Descricao','Valor','Forma_Pagamento','ID_Movimentacao','Saldo_Acumulado'],
  USUARIOS:      ['ID','Nome','Login','Senha','Cargo']
};

function gerarId(p) { return p+'_'+new Date().getTime()+'_'+Math.floor(Math.random()*9999); }
function agora(f)   { return Utilities.formatDate(new Date(),'America/Sao_Paulo',f); }

function getAba(nome) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  let aba   = ss.getSheetByName(nome);
  if (!aba) {
    aba = ss.insertSheet(nome);
    const hds = HEADERS[nome] || [];
    if (hds.length) {
      aba.getRange(1,1,1,hds.length).setValues([hds])
         .setBackground('#0f172a').setFontColor('#f8fafc').setFontWeight('bold');
      aba.setFrozenRows(1);
    }
  }
  return aba;
}

function formatarDataVal(val) {
  if (!val && val !== 0) return '';
  if (val instanceof Date) {
    if (val.getUTCFullYear() < 1900) {
      return Utilities.formatDate(val, 'America/Sao_Paulo', 'HH:mm:ss');
    }
    // Usa UTC para preservar a data exata gravada pelo Sheets (evita recuo de 1 dia por fuso horário)
    return Utilities.formatDate(val, 'UTC', 'dd/MM/yyyy');
  }
  const s = String(val).trim();
  if (s.indexOf('-') >= 0) {
    const partes = s.split('T')[0].split('-');
    if (partes.length === 3 && partes[0].length === 4) {
      return partes[2] + '/' + partes[1] + '/' + partes[0];
    }
  }
  return s;
}

function normalizarDataISO(val) {
  if (!val && val !== 0) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'UTC', 'yyyy-MM-dd');
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


function abaParaJSON(nomeAba) {
  const aba  = getAba(nomeAba);
  const rows = aba.getDataRange().getValues();
  if (rows.length <= 1) return [];
  const h = rows[0];
  return rows.slice(1).map(r => {
    const o = {};
    h.forEach((k, i) => {
      let val = (r[i] !== undefined && r[i] !== null) ? r[i] : '';
      if (val instanceof Date) {
        val = formatarDataVal(val);
      }
      o[k] = val;
    });
    return o;
  });
}

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

function calcularSaldo() {
  return abaParaJSON('CAIXA').reduce((s,r) => {
    const v = parseNum(r.Valor); return r.Tipo==='RECEITA' ? s+v : s-v;
  }, 0);
}

/* ── PRODUTOS ─────────────────────────────────────────────── */
function listarProdutos() { return abaParaJSON('PRODUTOS').filter(p=>String(p.Ativo)!=='false'); }

function criarProduto(d) {
  const aba = getAba('PRODUTOS'), id = gerarId('PRD');
  aba.appendRow([id, d.Tipo||'PRODUTO', d.Nome||'', d.Descricao||'', d.Unidade||'UN',
    parseNum(d.Quantidade), parseNum(d.Preco_Custo), parseNum(d.Preco_Venda),
    d.Categoria||'', agora('dd/MM/yyyy'), 'true']);
  return { sucesso:true, id, mensagem:'Cadastrado com sucesso!' };
}

function atualizarProduto(id, d) {
  const aba = getAba('PRODUTOS'), rows = aba.getDataRange().getValues(), h = rows[0];
  const iI  = h.indexOf('ID');
  for (let i=1;i<rows.length;i++) {
    if (String(rows[i][iI])===String(id)) {
      ['Nome','Descricao','Unidade','Quantidade','Preco_Custo','Preco_Venda','Categoria','Ativo'].forEach(c=>{
        if (d[c]===undefined) return;
        const col = h.indexOf(c)+1;
        const val = ['Quantidade','Preco_Custo','Preco_Venda'].includes(c) ? parseNum(d[c]) : d[c];
        aba.getRange(i+1,col).setValue(val);
      });
      return { sucesso:true, mensagem:'Atualizado!' };
    }
  }
  return { sucesso:false, mensagem:'Não encontrado.' };
}

function excluirProduto(id) { return atualizarProduto(id,{Ativo:'false'}); }

function ajustarEstoque(idP, delta) {
  const aba = getAba('PRODUTOS'), rows = aba.getDataRange().getValues(), h = rows[0];
  const iI=h.indexOf('ID'), qI=h.indexOf('Quantidade');
  for (let i=1;i<rows.length;i++) {
    if (String(rows[i][iI])===String(idP)) {
      const nova = Math.max(0, parseNum(rows[i][qI]) + delta);
      aba.getRange(i+1,qI+1).setValue(nova); return nova;
    }
  }
}

/* ── MOVIMENTAÇÕES ───────────────────────────────────────── */
function listarMovimentacoes(f) {
  let m = abaParaJSON('MOVIMENTACOES');
  if (f && f.tipo) m = m.filter(x => String(x.Tipo).toUpperCase() === String(f.tipo).toUpperCase());
  if (f && f.formaPagamento) m = m.filter(x => String(x.Forma_Pagamento).toUpperCase() === String(f.formaPagamento).toUpperCase());
  
  const dInicio = f && (f.dataInicio || f.data);
  const dFim    = f && (f.dataFim || f.data_fim);
  if (dInicio || dFim) {
    const isoIni = dInicio ? normalizarDataISO(dInicio) : '';
    const isoFim = dFim ? normalizarDataISO(dFim) : '';
    m = m.filter(x => {
      const dt = normalizarDataISO(x.Data);
      if (!dt) return true;
      if (isoIni && dt < isoIni) return false;
      if (isoFim && dt > isoFim) return false;
      return true;
    });
  }
  return m;
}

function registrarMovimentacao(d) {
  const id=gerarId('MOV'), qtd=parseNum(d.Quantidade)||1, vu=parseNum(d.Valor_Unitario), vt=qtd*vu;
  const dt=agora('dd/MM/yyyy'), hr=agora('HH:mm:ss');
  getAba('MOVIMENTACOES').appendRow([id,dt,hr,d.Tipo,d.ID_Produto||'',d.Nome_Produto||'',
    d.Tipo_Item||'PRODUTO',qtd,vu,vt,d.Forma_Pagamento||'DINHEIRO',d.Observacao||'',d.Operador||'Sistema']);
  if (d.ID_Produto && d.Tipo_Item!=='SERVICO')
    ajustarEstoque(d.ID_Produto, d.Tipo==='ENTRADA'? qtd: -qtd);
  const saldo=calcularSaldo(), tpC=d.Tipo==='SAIDA'?'RECEITA':'DESPESA', ns=tpC==='RECEITA'?saldo+vt:saldo-vt;
  getAba('CAIXA').appendRow([gerarId('CXA'),dt,hr,tpC,
    (d.Tipo==='SAIDA'?'Venda: ':'Entrada: ')+d.Nome_Produto,vt,d.Forma_Pagamento||'DINHEIRO',id,ns]);
  return { sucesso:true, id, valorTotal:vt, saldoCaixa:ns, mensagem:'Registrado!' };
}

/* ── CAIXA ────────────────────────────────────────────────── */
function listarCaixa(f) {
  let r=abaParaJSON('CAIXA');
  if (f && f.tipo) r = r.filter(x => String(x.Tipo).toUpperCase() === String(f.tipo).toUpperCase());
  if (f && f.formaPagamento) r = r.filter(x => String(x.Forma_Pagamento).toUpperCase() === String(f.formaPagamento).toUpperCase());
  
  const dInicio = f && (f.dataInicio || f.data);
  const dFim    = f && (f.dataFim || f.data_fim);
  if (dInicio || dFim) {
    const isoIni = dInicio ? normalizarDataISO(dInicio) : '';
    const isoFim = dFim ? normalizarDataISO(dFim) : '';
    r = r.filter(x => {
      const dt = normalizarDataISO(x.Data);
      if (!dt) return true;
      if (isoIni && dt < isoIni) return false;
      if (isoFim && dt > isoFim) return false;
      return true;
    });
  }
  return r;
}

function resumoCaixa() {
  const r=abaParaJSON('CAIXA'), res={saldoAtual:0,totalReceitas:0,totalDespesas:0,
    porFormaPagamento:{DINHEIRO:0,PIX:0,DEBITO:0,CREDITO:0}};
  r.forEach(x=>{
    const v=parseNum(x.Valor);
    if (x.Tipo==='RECEITA'){res.totalReceitas+=v; if(res.porFormaPagamento[x.Forma_Pagamento]!==undefined) res.porFormaPagamento[x.Forma_Pagamento]+=v;}
    else res.totalDespesas+=v;
  });
  res.saldoAtual=res.totalReceitas-res.totalDespesas; return res;
}

function registrarCaixaManual(d) {
  const v=parseNum(d.Valor), s=calcularSaldo(), ns=d.Tipo==='RECEITA'?s+v:s-v, id=gerarId('CXA');
  getAba('CAIXA').appendRow([id,agora('dd/MM/yyyy'),agora('HH:mm:ss'),d.Tipo,d.Descricao||'',v,d.Forma_Pagamento||'DINHEIRO','',ns]);
  return { sucesso:true, id, saldoAtual:ns, mensagem:'Lançado!' };
}

/* ── USUÁRIOS ─────────────────────────────────────────────── */
function listarUsuarios() {
  const aba = getAba('USUARIOS');
  const rows = aba.getDataRange().getValues();
  if (rows.length <= 1) {
    aba.appendRow(['USR_1', 'Administrador', 'admin', 'admin123', 'Administrador']);
    return [{ ID: 'USR_1', Nome: 'Administrador', Login: 'admin', Senha: 'admin123', Cargo: 'Administrador' }];
  }
  const h = rows[0];
  return rows.slice(1).map(r => {
    const o = {};
    h.forEach((k, i) => { o[k] = (r[i] !== undefined && r[i] !== null) ? String(r[i]) : ''; });
    return o;
  });
}

function criarUsuario(d) {
  const aba = getAba('USUARIOS');
  const usrs = listarUsuarios();
  if (usrs.some(u => String(u.Login).toLowerCase() === String(d.Login).toLowerCase())) {
    return { sucesso: false, mensagem: 'Login "' + d.Login + '" já cadastrado.' };
  }
  const id = gerarId('USR');
  aba.appendRow([id, d.Nome||'', d.Login||'', d.Senha||'', d.Cargo||'Operador']);
  return { sucesso: true, id, mensagem: 'Usuário cadastrado com sucesso!' };
}

function atualizarUsuario(id, d) {
  const aba = getAba('USUARIOS'), rows = aba.getDataRange().getValues(), h = rows[0];
  const iI = h.indexOf('ID');
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][iI]) === String(id)) {
      ['Nome','Login','Senha','Cargo'].forEach(c => {
        if (d[c] !== undefined && d[c] !== '') {
          const col = h.indexOf(c) + 1;
          aba.getRange(i + 1, col).setValue(d[c]);
        }
      });
      return { sucesso: true, mensagem: 'Usuário atualizado com sucesso!' };
    }
  }
  return { sucesso: false, mensagem: 'Usuário não encontrado.' };
}

function excluirUsuario(id) {
  const aba = getAba('USUARIOS'), rows = aba.getDataRange().getValues(), h = rows[0];
  const iI = h.indexOf('ID');
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][iI]) === String(id)) {
      aba.deleteRow(i + 1);
      return { sucesso: true, mensagem: 'Usuário excluído com sucesso!' };
    }
  }
  return { sucesso: false, mensagem: 'Usuário não encontrado.' };
}

/* ── DASHBOARD ───────────────────────────────────────────── */
function getDashboard() {
  const prods = listarProdutos();
  const movs  = abaParaJSON('MOVIMENTACOES');
  const caixa = resumoCaixa();
  const hj    = agora('dd/MM/yyyy');

  const vhj   = movs.filter(m => String(m.Tipo).toUpperCase() === 'SAIDA' && formatarDataVal(m.Data) === hj);

  return {
    totalProdutos: prods.filter(p=>p.Tipo==='PRODUTO').length,
    totalServicos: prods.filter(p=>p.Tipo==='SERVICO').length,
    saldoCaixa:    caixa.saldoAtual, totalReceitas: caixa.totalReceitas, totalDespesas: caixa.totalDespesas,
    vendasHoje:    vhj.reduce((s,m)=>s+parseNum(m.Valor_Total),0), qtdVendasHoje: vhj.length,
    estoqueBaixo:  prods.filter(p=>p.Tipo==='PRODUTO'&&parseNum(p.Quantidade)<5).length,
    porFormaPagamento: caixa.porFormaPagamento,
    ultimasMovimentacoes: movs.slice(-10).reverse()
  };
}

/* ── ROTEADOR ─────────────────────────────────────────────── */

// Rota de escrita via GET (evita erros de CORS com file://)
// O frontend envia: ?acao=escrever&payload={"acao":"criar_produto","dados":{...}}
function rotearEscrita(b) {
  switch(b.acao) {
    case 'criar_produto':          return criarProduto(b.dados);
    case 'atualizar_produto':      return atualizarProduto(b.id, b.dados);
    case 'excluir_produto':        return excluirProduto(b.id);
    case 'registrar_movimentacao': return registrarMovimentacao(b.dados);
    case 'registrar_caixa':        return registrarCaixaManual(b.dados);
    case 'criar_usuario':          return criarUsuario(b.dados);
    case 'atualizar_usuario':      return atualizarUsuario(b.id, b.dados);
    case 'excluir_usuario':        return excluirUsuario(b.id);
    default: return {sucesso:false, mensagem:'Ação de escrita não reconhecida: '+b.acao};
  }
}

function doGet(e) {
  try {
    const p=e.parameter; let r;

    // Operação de escrita via GET (payload JSON)
    if (p.acao === 'escrever') {
      if (!p.payload) return out({sucesso:false,mensagem:'Payload ausente'}, p.callback);
      const body = JSON.parse(p.payload);
      r = rotearEscrita(body);
      return out(r, p.callback);
    }

    switch(p.acao) {
      case 'listar_produtos':      r={sucesso:true,dados:listarProdutos()};       break;
      case 'listar_movimentacoes': r={sucesso:true,dados:listarMovimentacoes(p)}; break;
      case 'listar_caixa':         r={sucesso:true,dados:listarCaixa(p)};         break;
      case 'resumo_caixa':         r={sucesso:true,dados:resumoCaixa()};          break;
      case 'dashboard':            r={sucesso:true,dados:getDashboard()};         break;
      case 'listar_usuarios':      r={sucesso:true,dados:listarUsuarios()};       break;
      case 'inicializar':
        ['PRODUTOS','MOVIMENTACOES','CAIXA','USUARIOS'].forEach(n=>getAba(n));
        r={sucesso:true,mensagem:'Abas criadas com sucesso!'};                    break;
      default: r={sucesso:false,mensagem:'Ação não reconhecida: '+p.acao};
    }
    return out(r, p.callback);
  } catch(err) { return out({sucesso:false,erro:err.message}, e.parameter.callback); }
}

function doPost(e) {
  try {
    const b=JSON.parse(e.postData.contents);
    return out(rotearEscrita(b));
  } catch(err) { return out({sucesso:false,erro:err.message}); }
}

// JSONP: envolve a resposta em callback(dados) quando informado
// Contorna 100% o bloqueio CORS do Chrome em file://
function out(obj, callback) {
  const json = JSON.stringify(obj);
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
