# Code Intelligence Engine - Manual do Usuário e Guia de Instalação

O **Code Intelligence Engine** é um serviço independente de indexação, navegação e busca estrutural de código projetado para desenvolvedores (via Web UI) e agentes de Inteligência Artificial (via Model Context Protocol - MCP).

Ele integra o poder de três ferramentas fundamentais:
1. **Universal Ctags:** Para um cache ultrarrápido de símbolos e navegação de outline de arquivos.
2. **scip-typescript (SCIP/LSIF):** Para resolução precisa (nível de compilador) de referências cruzadas e grafos de chamadas interarquivos.
3. **ast-grep:** Para buscas estruturais baseadas na árvore sintática abstrata (AST) do código.

---

## 🛠️ Requisitos e Pré-requisitos

O projeto está configurado para rodar de forma **100% portátil e nativa no Windows**, sem necessidade de privilégios de administrador ou WSL.

* **Node.js:** Versão 20 ou superior.
* **npm:** Versão 10 ou superior.
* **Universal Ctags:** Já incluso de forma portátil na pasta `backend/bin/ctags.exe`.

---

## 📁 Estrutura do Projeto

* [backend/](file:///e:/fzcodeinteligence/backend) - Servidor de API Express, Servidor MCP e Pipeline de Indexação.
  * [src/db.ts](file:///e:/fzcodeinteligence/backend/src/db.ts) - Schema SQLite e funções de banco de dados.
  * [src/indexer.ts](file:///e:/fzcodeinteligence/backend/src/indexer.ts) - Script do pipeline de indexação.
  * [src/index.ts](file:///e:/fzcodeinteligence/backend/src/index.ts) - Servidor Express + endpoints REST e SSE MCP.
  * [bin/ctags.exe](file:///e:/fzcodeinteligence/backend/bin/ctags.exe) - Executável portátil do Universal Ctags.
* [frontend/](file:///e:/fzcodeinteligence/frontend) - Aplicação Web UI SPA React + Vite + TypeScript.
  * [src/App.tsx](file:///e:/fzcodeinteligence/frontend/src/App.tsx) - Painel principal unificado.
  * [src/components/](file:///e:/fzcodeinteligence/frontend/src/components) - Componentes reusáveis (Sidebar, CodeViewer, CallGraph, SearchHeader).

---

## 🚀 Como Executar o Projeto

Siga estes três passos simples para rodar a aplicação completa localmente:

### Passo 1: Indexar o Codebase
Antes de iniciar os servidores, você deve gerar a base de dados SQLite indexando o projeto. No diretório `backend/`, instale as dependências e execute o indexador:
```bash
cd backend
npm install
npm run index
```
*Isso executará o `ctags` e o `scip-typescript` para popular o arquivo `database.db` na raiz.*

### Passo 2: Iniciar o Backend & MCP Server
No mesmo diretório `backend/`, inicie o servidor de desenvolvimento:
```bash
npm run dev
```
*O servidor de API REST e o endpoint do servidor MCP (SSE) rodarão na porta `3000` (`http://localhost:3000`).*

### Passo 3: Iniciar a Interface Web (Vite)
Abra outro terminal, acesse o diretório `frontend/`, instale as dependências e inicie o servidor de desenvolvimento Vite:
```bash
cd ../frontend
npm install --legacy-peer-deps
npm run dev
```
*A interface web será aberta automaticamente ou estará disponível no endereço `http://localhost:5173/`.*

---

## 💻 Documentação de Integração (API & MCP)

### Endpoints da API REST (Backend)

* **`GET /api/files`**
  Retorna todos os arquivos indexados no projeto.
  * *Response:* `{ "files": [{ "id": "...", "language": "...", "size": 0 }] }`

* **`GET /api/file/symbols?file=<caminho>`**
  Retorna o outline de símbolos (funções, classes) gerados para um arquivo.

* **`GET /api/search?q=<busca>&type=<text|symbol|structural>`**
  Realiza buscas de texto livre (`text`), buscas FTS5 de símbolos (`symbol`), ou busca estrutural baseada em padrões do `ast-grep` (`structural`).

* **`GET /api/navigate/definition?file=<arquivo>&line=<linha>&character=<caractere>`**
  Resolve a definição exata de um símbolo em uma coordenada baseando-se no grafo de ocorrências do SCIP.

* **`GET /api/navigate/flow?symbol=<simbolo>`**
  Retorna um grafo de fluxo de chamadas estruturado no formato Mermaid.js para o método ou função especificado.

* **`POST /api/index`**
  Executa novamente o pipeline do indexador sob demanda.

### Model Context Protocol (MCP) Tools

O servidor MCP expõe as seguintes ferramentas para agentes de IA (como Claude ou Gemini) se integrarem ao seu índice de código:

1. **`search_symbols`**
   * *Descrição:* Busca símbolos (funções, classes, variáveis) usando o índice rápido do ctags.
   * *Argumentos:* `query` (string)
2. **`get_structural_matches`**
   * *Descrição:* Busca padrões sintáticos estruturais utilizando o `ast-grep`.
   * *Argumentos:* `pattern` (string) - Ex: `function $A($$$)`
3. **`get_symbol_flow`**
   * *Descrição:* Retorna o grafo de chamadas (quem chama e quem é chamado) por uma determinada função.
   * *Argumentos:* `symbol` (string)

---

## 💡 Como Usar a Web UI

1. **Explorar Árvore de Arquivos:** Use a aba **Files** no painel esquerdo para selecionar um arquivo.
2. **Navegar por Símbolos (Outline):** Mude para a aba **Outline** no painel esquerdo e clique em qualquer função ou classe para ir direto à linha correspondente no editor.
3. **Grafo de Chamadas Dinâmico:** No painel direito, você verá a árvore de dependência de chamadas do método selecionado. Clique em qualquer nó para navegar direto para o código daquele método no editor central.
4. **Ctrl + Click (Go to Definition):** Mantenha pressionada a tecla `Ctrl` e clique sobre a chamada de uma função/método no Monaco Editor para pular direto para o arquivo e a linha onde ela foi declarada.
5. **Hover Cards:** Passe o mouse sobre qualquer símbolo em arquivos suportados para ver uma janela flutuante com a declaração e o bloco de código de definição.
