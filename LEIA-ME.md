# 🔧 Como Resolver o Erro "Failed to fetch"

## Causa do Problema
O erro acontece porque o Google Apps Script **bloqueia requisições POST** quando
o sistema é aberto diretamente como arquivo (protocolo `file://`).

A solução aplicada foi: **todas as operações agora usam GET** (incluindo cadastros,
edições e exclusões), o que o Google Apps Script permite normalmente.

---

## ✅ Passo a Passo para Corrigir

### 1. Atualize o código no Apps Script

1. Abra a planilha: https://docs.google.com/spreadsheets/d/1W7r46a1XtgoOsO9M_tY5-amKBvuPa3QaCjqnLILpZPQ/
2. Clique em **Extensões > Apps Script**
3. **Selecione todo o código** (Ctrl+A) e **apague**
4. Abra o arquivo `apps-script.js` desta pasta
5. **Copie todo o conteúdo** e cole no editor do Apps Script
6. Clique em 💾 **Salvar**

### 2. Crie uma NOVA implantação

> ⚠️ **IMPORTANTE**: A URL antiga não vai funcionar com o código novo.
> Você precisa criar uma **Nova implantação** (não gerenciar a existente).

1. Clique em **Implantar > Nova implantação**
2. Clique no ícone de engrenagem ⚙️ ao lado de "Tipo" e selecione **App da Web**
3. Preencha:
   - **Descrição**: `CSTI v2 - CORS Fix`
   - **Executar como**: `Eu mesmo`
   - **Quem tem acesso**: `Qualquer pessoa`
4. Clique em **Implantar**
5. **Autorize** as permissões se solicitado
6. Copie a URL gerada (começa com `https://script.google.com/macros/s/...`)

### 3. Configure a URL no sistema

1. Abra o `index.html`
2. Vá em **Configurações** (ícone ⚙️ no menu lateral)
3. Cole a nova URL no campo
4. Clique em **💾 Salvar**
5. Clique em **⚡ Criar Abas na Planilha** (só na primeira vez)

---

## 🔍 Diagnóstico do Erro

| Erro | Causa | Solução |
|------|-------|---------|
| `Failed to fetch` | CORS bloqueando POST ou URL errada | Use o código novo (GET only) e reimplante |
| `Erro HTTP 401` | Permissão negada | Defina acesso como "Qualquer pessoa" |
| `Erro HTTP 404` | URL errada ou script não publicado | Crie nova implantação |
| `sucesso: false` | Erro no script | Verifique o console do Apps Script |

---

## ℹ️ Por que usar GET para tudo?

O Google Apps Script, quando acessado de uma página local (`file://`), bloqueia
requisições `POST` por política de CORS. Requisições `GET`, porém, são sempre
permitidas. Por isso, o sistema foi adaptado para enviar os dados de escrita
(cadastros, edições, exclusões) como parâmetro `payload` em uma URL GET.
