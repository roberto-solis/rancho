// =========================================================================
// RANCHO DINA SOLIS — versão web (mesmas abas e regras do app desktop)
// Usa o mesmo banco do app desktop. A chave abaixo é pública: sozinha não lê
// nada; as tabelas só respondem a sócios logados (regras RLS no Supabase).
// =========================================================================
"use strict";

const SUPABASE_URL = "https://ndvkuozrnabipeezszci.supabase.co";
const SUPABASE_CHAVE = "sb_publishable_24BbODs4FuH0sVSuP_dVGw_TDyE7J2-";
const ALVO_FUNDO = "Manutenção - Fundo de Reserva";   // "sócio" especial dos lançamentos do fundo

const banco = supabase.createClient(SUPABASE_URL, SUPABASE_CHAVE, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "rds-sessao" },
});

const $ = (id) => document.getElementById(id);
const ehCelular = () => window.matchMedia("(max-width: 899px)").matches;

const estado = {
  usuario: null,
  cadastro: null,
  todos: [],                  // todos os lançamentos do banco
  saldos: {},                 // saldo de manutenção de cada sócio
  mes: { a: hoje().a, m: hoje().m },
  pagina: "lanc",
  mapaLogin: {},              // nome -> {email, tem_senha}
  alertaFechado: false,
};

// =========================================================================
// UTILITÁRIOS
// =========================================================================
function el(tag, classe, texto) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

function preencherSelect(select, opcoes, valor) {
  const atual = valor !== undefined ? valor : select.value;
  select.replaceChildren(...opcoes.map((o) => {
    const op = el("option", "", typeof o === "string" ? o : o.texto);
    op.value = typeof o === "string" ? o : o.valor;
    return op;
  }));
  if ([...select.options].some((o) => o.value === atual)) select.value = atual;
}

function garantirOpcao(select, valor) {
  if (valor && ![...select.options].some((o) => o.value === valor)) select.append(new Option(valor, valor));
  select.value = valor;
}

function lembrar(chave, valor) {
  try { localStorage.setItem(chave, valor); } catch (e) { /* navegador sem armazenamento */ }
}
function lembrado(chave) {
  try { return localStorage.getItem(chave); } catch (e) { return null; }
}

// Resposta do Supabase: devolve os dados ou lança o erro
async function dados(promessa) {
  const r = await promessa;
  if (r.error) throw r.error;
  return r.data;
}

// Lê tudo, de 1000 em 1000 (o Supabase entrega no máximo 1000 linhas por vez)
async function buscarTodos(montarConsulta) {
  const todas = [];
  for (let inicio = 0; ; inicio += 1000) {
    const parte = await dados(montarConsulta().order("id", { ascending: false }).range(inicio, inicio + 999));
    todas.push(...parte);
    if (parte.length < 1000) return todas;
  }
}

function mensagemDeErro(e) {
  const texto = String((e && (e.message || e.error_description)) || e || "");
  if (/failed to fetch|networkerror|load failed/i.test(texto)) {
    return "Sem conexão com a internet. Confira a conexão e tente de novo.";
  }
  return texto || "Erro desconhecido.";
}

function sessaoExpirada(e) {
  const texto = String((e && e.message) || "");
  return /jwt expired|invalid jwt|not authenticated/i.test(texto) || (e && (e.status === 401 || e.code === "PGRST301"));
}

// Executa uma ação mostrando "carregando" e tratando erros
let contadorOcupado = 0;
async function acao(fn) {
  contadorOcupado++;
  const timer = setTimeout(() => { if (contadorOcupado) $("carregando").hidden = false; }, 200);
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    if (estado.usuario && sessaoExpirada(e)) {
      await aviso("Sessão encerrada", "Sua sessão expirou. Entre de novo.", "aviso");
      await sair();
    } else {
      await aviso("Erro", mensagemDeErro(e), "erro");
    }
  } finally {
    clearTimeout(timer);
    if (--contadorOcupado === 0) $("carregando").hidden = true;
  }
}

const valorTexto = (centavos) => brl(centavos / 100);
const lerDataCampo = (id) => paraData($(id).value);

function somarDias(dt, dias) {
  const d = new Date(dt.a, dt.m - 1, dt.d + dias);
  return { a: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
}

// =========================================================================
// JANELAS (avisos, perguntas, senha) E TOAST
// =========================================================================
const ICONES = { info: "ℹ️", sucesso: "✅", aviso: "⚠️", erro: "⛔", pergunta: "❓", senha: "🔑", divisao: "⚖️" };

function modal({ titulo, mensagem, tipo = "info", botoes, senha = false, conteudo = null, deBaixo = false, aoAbrir = null }) {
  return new Promise((resolver) => {
    const fundo = el("div", "fundo-modal" + (deBaixo ? " de-baixo" : ""));
    const caixa = el("div", "modal" + (conteudo && deBaixo ? " acoes" : ""));
    caixa.setAttribute("role", "dialog");
    caixa.setAttribute("aria-modal", "true");
    if (titulo) {
      const h = el("h3");
      h.append(el("span", "", ICONES[tipo] || ""), el("span", "", titulo));
      caixa.append(h);
    }
    if (mensagem) caixa.append(el("p", "", mensagem));
    if (conteudo) caixa.append(conteudo);
    let campo = null;
    if (senha) {
      campo = el("input");
      campo.type = "password";
      campo.autocomplete = "off";
      campo.placeholder = "••••••••";
      caixa.append(campo);
    }
    const linha = el("div", "modal-botoes");
    const fechar = (valor) => {
      document.removeEventListener("keydown", teclas, true);
      fundo.remove();
      resolver(valor);
    };
    const cancelar = botoes.find((b) => b.cancelar);
    const principal = botoes.find((b) => b.principal) || botoes[botoes.length - 1];
    for (const b of botoes) {
      const btn = el("button", "btn " + (b.classe || "btn-primario"), b.texto);
      btn.type = "button";
      btn.onclick = async () => {
        if (b.antes && !(await b.antes())) return;       // validação antes de fechar
        fechar(b.cancelar ? (senha ? null : b.valor) : (senha ? campo.value : b.valor));
      };
      linha.append(btn);
      b.el = btn;
    }
    caixa.append(linha);
    function teclas(ev) {
      if (fundo !== $("modais").lastElementChild) return;   // só a janela da frente responde
      if (ev.key === "Escape" && cancelar) { ev.preventDefault(); cancelar.el.click(); }
      else if (ev.key === "Enter" && (!conteudo || senha || principal.enter)) {
        ev.preventDefault();
        if (!principal.el.disabled) principal.el.click();
      }
    }
    document.addEventListener("keydown", teclas, true);
    fundo.addEventListener("click", (ev) => { if (ev.target === fundo && cancelar) cancelar.el.click(); });
    fundo.append(caixa);
    $("modais").append(fundo);
    if (aoAbrir) aoAbrir(botoes);
    setTimeout(() => (campo || (conteudo && conteudo.querySelector("input:not([type=date])")) || principal.el).focus(), 30);
  });
}

const aviso = (titulo, mensagem, tipo = "info") =>
  modal({ titulo, mensagem, tipo, botoes: [{ texto: "OK", valor: true, cancelar: true, principal: true }] });

const perguntar = (titulo, mensagem, textoOk = "Confirmar", perigo = false) =>
  modal({
    titulo, mensagem, tipo: "pergunta",
    botoes: [
      { texto: "Cancelar", classe: "btn-contorno", valor: false, cancelar: true },
      { texto: textoOk, classe: perigo ? "btn-perigo" : "btn-primario", valor: true, principal: true },
    ],
  });

const pedirSenha = (titulo, mensagem) =>
  modal({
    titulo, mensagem, tipo: "senha", senha: true,
    botoes: [
      { texto: "Cancelar", classe: "btn-contorno", cancelar: true },
      { texto: "OK", principal: true },
    ],
  });

function toast(mensagem) {
  const t = el("div", "toast sucesso", mensagem);
  $("toasts").append(t);
  setTimeout(() => t.remove(), 2600);
}

// =========================================================================
// LOGIN (mesmas funções do app desktop — ver migracao_login_supabase.sql)
// =========================================================================
const rpc = (funcao, params = {}) => dados(banco.rpc(funcao, params));

async function carregarSociosLogin() {
  const linhas = await rpc("rds_socios_login");
  estado.mapaLogin = {};
  for (const l of linhas || []) estado.mapaLogin[l.nome] = { email: l.email, tem_senha: l.tem_senha };
  return Object.keys(estado.mapaLogin);
}

async function mostrarLogin() {
  $("tela-app").hidden = true;
  $("tela-login").hidden = false;
  $("login-senha").value = "";
  let nomes = [];
  try {
    nomes = await carregarSociosLogin();
  } catch (e) {
    await aviso("Sem conexão com o banco",
      "Não foi possível carregar a lista de sócios.\nConfira a internet e abra o aplicativo de novo.\n\n" + mensagemDeErro(e), "erro");
  }
  preencherSelect($("login-socio"), nomes.length ? nomes : ["(sem sócios)"], lembrado("rds-ultimo-socio") || undefined);
  if (!ehCelular()) $("login-senha").focus();
}

async function sairDoSupabase() {
  try { await banco.auth.signOut(); } catch (e) { /* já estava fora */ }
}

async function entrar(ev) {
  ev.preventDefault();
  await acao(async () => {
    const usuario = $("login-socio").value;
    const senha = $("login-senha").value.trim();
    const dadosSocio = estado.mapaLogin[usuario];
    if (!senha) return aviso("Atenção", "Por favor, digite sua senha.", "aviso");
    if (!dadosSocio) return aviso("Sócio não encontrado", "Escolha um sócio da lista.", "erro");
    if (!dadosSocio.tem_senha) {
      return aviso("Sem senha cadastrada", "Este sócio ainda não possui senha.\nUse o botão “Criar / redefinir senha”.", "erro");
    }

    const { error } = await banco.auth.signInWithPassword({ email: dadosSocio.email, password: senha });
    if (error) {
      if (error.code === "invalid_credentials" || /invalid login/i.test(error.message)) {
        $("login-senha").value = "";
        return aviso("Senha incorreta", "Confira a senha digitada e tente novamente.", "erro");
      }
      throw error;
    }

    const status = (await rpc("rds_meu_status")) || {};
    if (status.socio !== usuario) {
      await sairDoSupabase();
      return aviso("Acesso negado", "Este usuário não está ligado a um sócio do Rancho.", "erro");
    }

    // Senha provisória: exige cadastrar a definitiva
    if (status.requer_troca) {
      await aviso("Senha provisória",
        `Olá, ${usuario}!\nVocê está usando uma senha provisória.\nCadastre agora sua nova senha definitiva.`);
      const nova = await pedirSenha("Senha definitiva", "Digite sua NOVA senha definitiva:");
      if (!nova || nova.trim().length < 4) {
        if (nova !== null) await aviso("Atenção", "A senha deve ter no mínimo 4 caracteres!", "aviso");
        await aviso("Login cancelado", "A senha não foi alterada. O login foi cancelado.", "aviso");
        return sairDoSupabase();
      }
      if ((await rpc("rds_definir_minha_senha", { p_nova: nova.trim() })) !== "alterada") {
        await sairDoSupabase();
        return aviso("Erro", "Não foi possível gravar a nova senha. Tente novamente.", "erro");
      }
      await aviso("Tudo certo", "Sua senha definitiva foi cadastrada com sucesso!", "sucesso");
    }

    lembrar("rds-ultimo-socio", usuario);
    await abrirAplicativo(usuario);
  });
}

async function redefinirSenha() {
  await acao(async () => {
    const socio = $("login-socio").value;
    await carregarSociosLogin();                        // situação atual de quem tem senha
    const dadosSocio = estado.mapaLogin[socio];
    if (!dadosSocio) return aviso("Sócio não encontrado", "Escolha um sócio da lista.", "erro");
    const primeiroAcesso = !dadosSocio.tem_senha;

    let autorizacao = null;
    if (!primeiroAcesso) {
      const senha = await pedirSenha("Autenticação", `Digite a SENHA ATUAL de “${socio}” ou a SENHA DE ADMIN:`);
      if (!senha) return;
      autorizacao = senha.trim();
      if (!(await rpc("rds_autorizado", { p_socio: socio, p_senha: autorizacao }))) {
        return aviso("Acesso negado", "Senha incorreta!", "erro");
      }
    }

    const nova = await pedirSenha(primeiroAcesso ? "Primeiro acesso" : "Nova senha", `Digite a nova senha para “${socio}”:`);
    if (!nova || nova.trim().length < 4) {
      if (nova !== null) await aviso("Atenção", "A senha deve ter no mínimo 4 caracteres!", "aviso");
      return;
    }

    const resultado = await rpc("rds_redefinir_senha", { p_socio: socio, p_autorizacao: autorizacao, p_nova: nova.trim() });
    if (resultado === "criada") {
      await carregarSociosLogin();
      await aviso("Senha criada", `Senha criada para “${socio}”! Já pode fazer login.`, "sucesso");
    } else if (resultado === "alterada") {
      await aviso("Senha redefinida",
        `Senha redefinida para “${socio}”!\nNo próximo login, o sistema pedirá a senha definitiva.`, "sucesso");
    } else {
      await aviso("Não foi possível", `A senha não foi alterada (${resultado}).`, "erro");
    }
  });
}

async function sair() {
  estado.usuario = null;
  await sairDoSupabase();
  await mostrarLogin();
}

// =========================================================================
// LISTAS (tabela no computador, cartões no celular) — comum a todas as abas
// =========================================================================
class Lista {
  // cfg: {id, form, colunas: [{campo, titulo, classe, texto(l), chave(l)}], grade, campoTitulo, campoValor,
  //       classeLinha(l), info(l), resumo(l) -> [título, detalhe], vazio, aoEditar(id), aoExcluir(ids)}
  constructor(cfg) {
    this.cfg = cfg;
    this.linhas = [];
    this.selecionados = new Set();
    this.ordem = null;                       // null = ordem padrão
    const raiz = $(cfg.id);
    this.cab = el("div", "tabela-cab");
    this.cab.style.gridTemplateColumns = cfg.grade;
    for (const c of cfg.colunas) {
      const b = el("button", c.classe || "", c.titulo);
      b.type = "button";
      b.dataset.campo = c.campo;
      b.onclick = () => {
        this.ordem = this.ordem && this.ordem.campo === c.campo
          ? { campo: c.campo, desc: !this.ordem.desc } : { campo: c.campo, desc: false };
        this.desenhar();
      };
      this.cab.append(b);
    }
    this.corpo = el("div", "tabela-corpo");
    raiz.append(this.cab, this.corpo);
    this.corpo.addEventListener("click", (ev) => this.clicar(ev));
    this.corpo.addEventListener("dblclick", (ev) => {
      const linha = ev.target.closest(".linha");
      if (linha && linha.dataset.id && !ehCelular()) cfg.aoEditar(Number(linha.dataset.id));
    });
  }

  definir(linhas) {
    this.linhas = linhas;
    const ids = new Set(linhas.map((l) => l.id));
    for (const id of [...this.selecionados]) if (!ids.has(id)) this.selecionados.delete(id);
    this.desenhar();
  }

  ordenadas() {
    const fixas = this.linhas.filter((l) => l._fixa);
    const demais = this.linhas.filter((l) => !l._fixa);
    if (this.ordem) {
      const col = this.cfg.colunas.find((c) => c.campo === this.ordem.campo);
      const chave = col.chave || ((l) => String(l[col.campo] ?? "").toLowerCase());
      demais.sort((x, y) => {
        const a = chave(x), b = chave(y);
        const r = a < b ? -1 : a > b ? 1 : 0;
        return this.ordem.desc ? -r : r;
      });
    }
    return [...fixas, ...demais];
  }

  desenhar() {
    this.corpo.replaceChildren();
    for (const l of this.ordenadas()) {
      const linha = el("div", "linha " + (this.cfg.classeLinha ? this.cfg.classeLinha(l) : ""));
      linha.style.gridTemplateColumns = this.cfg.grade;
      if (l._fixa) linha.classList.add("fixa");
      else linha.dataset.id = l.id;
      if (this.selecionados.has(l.id)) linha.classList.add("selecionada");
      for (const c of this.cfg.colunas) {
        let classe = "c " + (c.classe || "");
        if (c.campo === this.cfg.campoTitulo) classe += " m-titulo";
        if (c.campo === this.cfg.campoValor) classe += " m-valor";
        linha.append(el("span", classe, c.texto ? c.texto(l) : String(l[c.campo] ?? "")));
      }
      linha.append(el("span", "c-info", this.cfg.info(l)));
      this.corpo.append(linha);
    }
    if (!this.linhas.some((l) => !l._fixa)) this.corpo.append(el("div", "vazio", this.cfg.vazio));
    this.cab.querySelectorAll("button").forEach((b) => {
      const ativa = !!this.ordem && this.ordem.campo === b.dataset.campo;
      b.classList.toggle("ordem-asc", ativa && !this.ordem.desc);
      b.classList.toggle("ordem-desc", ativa && this.ordem.desc);
    });
    this.atualizarBotoes();
  }

  atualizarBotoes() {
    const n = this.selecionados.size;
    this.cfg.form.querySelector(".btn-alterar").disabled = n !== 1;
    this.cfg.form.querySelector(".btn-excluir").disabled = n === 0;
  }

  clicar(ev) {
    const linha = ev.target.closest(".linha");
    if (!linha || !linha.dataset.id) return;
    const id = Number(linha.dataset.id);
    if (ehCelular()) return this.abrirAcoes(id);
    if (ev.ctrlKey || ev.metaKey) {
      if (this.selecionados.has(id)) this.selecionados.delete(id); else this.selecionados.add(id);
    } else {
      this.selecionados = new Set([id]);
    }
    this.corpo.querySelectorAll(".linha").forEach((l) =>
      l.classList.toggle("selecionada", this.selecionados.has(Number(l.dataset.id))));
    this.atualizarBotoes();
  }

  async abrirAcoes(id) {
    const l = this.linhas.find((x) => x.id === id);
    if (!l) return;
    const [titulo, detalhe] = this.cfg.resumo(l);
    const resumo = el("div", "resumo");
    resumo.append(el("b", "", titulo), el("span", "", detalhe));
    const escolha = await modal({
      conteudo: resumo, deBaixo: true,
      botoes: [
        { texto: "✎  Alterar", classe: "btn-ambar", valor: "alterar" },
        { texto: "🗑  Excluir", classe: "btn-perigo", valor: "excluir" },
        { texto: "Cancelar", classe: "btn-contorno", valor: null, cancelar: true },
      ],
    });
    if (escolha === "alterar") await this.cfg.aoEditar(id);
    else if (escolha === "excluir") await this.cfg.aoExcluir([id]);
  }
}

// ---------------------------------------------------------------- formulários (painel / folha no celular)
const formularios = {};

function prepararFormulario(chave, { novo, editar, salvar, limpar }) {
  const form = $(chave + "-form");
  const painel = $(chave + "-painel");
  const f = {
    form, painel, editando: false, idEdicao: null,
    abrir() { painel.classList.add("aberto"); },
    fechar() { painel.classList.remove("aberto"); },
    modo(editando) {
      f.editando = editando;
      form.querySelector(".titulo-form").textContent = editando ? editar : novo.titulo;
      form.querySelector(".selo").hidden = !editando;
      form.classList.toggle("editando", editando);
      const b = form.querySelector(".btn-salvar");
      b.textContent = editando ? "✓ Confirmar alteração" : novo.botao;
      b.className = "btn btn-salvar " + (editando ? "btn-edicao" : novo.classe);
      form.querySelectorAll(".so-novo").forEach((x) => { x.hidden = editando; });
      form.querySelector(".btn-limpar").textContent = editando ? "✕ Cancelar edição" : "↺ Limpar";
    },
  };
  formularios[chave] = f;
  form.addEventListener("submit", (ev) => { ev.preventDefault(); salvar(); });
  form.querySelector(".btn-limpar").addEventListener("click", () => {
    const editando = f.editando;
    limpar();
    if (editando && ehCelular()) f.fechar();
  });
  form.querySelector(".fechar-folha").addEventListener("click", () => {
    if (f.editando) limpar();
    f.fechar();
  });
  painel.addEventListener("click", (ev) => { if (ev.target === painel) form.querySelector(".fechar-folha").click(); });
  // Enter passa para o próximo campo; no último, grava
  const campos = [...form.querySelectorAll("input, select")];
  campos.forEach((c, i) => c.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    const proximo = campos.slice(i + 1).find((x) => !x.closest("[hidden]") && !x.disabled);
    if (proximo) proximo.focus(); else form.querySelector(".btn-salvar").click();
  }));
  form.querySelectorAll("input[type=text], input[type=number]").forEach((c) =>
    c.addEventListener("focus", () => c.select()));
  return f;
}

// =========================================================================
// APLICATIVO
// =========================================================================
const listas = {};

async function carregarCadastro() {
  const socios = await dados(banco.from("socios").select("id, nome, data_entrada, data_saida").order("id"));
  const percentuais = await dados(banco.from("socios_percentuais").select("socio_id, percentual, vigente_desde"));
  estado.cadastro = new Cadastro(socios, percentuais);
}

async function carregarLancamentos() {
  estado.todos = await buscarTodos(() =>
    banco.from("lancamentos").select("id, data, pagador, destinacao, tipo, descricao, valores"));
}

// Listas de sócios dos formulários e filtros (depois de mudar o cadastro)
function atualizarOpcoesSocios() {
  const c = estado.cadastro;
  const ativos = c.ativosHoje;
  preencherSelect($("lanc-socio"), ativos);
  preencherSelect($("acer-pagador"), ativos);
  preencherSelect($("acer-recebedor"), ativos);
  preencherSelect($("fundo-socio"), [ALVO_FUNDO, ...ativos]);
  preencherSelect($("lanc-fl-socio"), ["Todos", ...c.todos]);
  preencherSelect($("fundo-fl-socio"), ["Todos", ALVO_FUNDO, ...c.todos]);
}

async function abrirAplicativo(usuario) {
  estado.usuario = usuario;
  await carregarCadastro();
  await carregarLancamentos();
  $("tela-login").hidden = true;
  $("tela-app").hidden = false;
  $("avatar-usuario").textContent = iniciais(usuario);
  $("nome-usuario").textContent = usuario;
  atualizarOpcoesSocios();
  $("lanc-socio").value = usuario;
  limparLanc(false);
  limparAcerto(false);
  limparFundo(false);
  limparSocio(false);
  definirMes(hoje().a, hoje().m);      // também desenha as listas
  desenharTudo();
  mostrarPagina(estado.pagina);
}

// Busca os lançamentos de novo no banco e redesenha as abas
async function recarregar() {
  await carregarLancamentos();
  desenharTudo();
}

async function recarregarCadastro() {
  await carregarCadastro();
  atualizarOpcoesSocios();
  await recarregar();
}

function desenharTudo() {
  desenharAcertos();          // calcula os saldos (usados também na aba Sócios)
  filtrarLanc();
  filtrarFundo();
  verificarAlertasFundo();
  desenharSocios();
  if (estado.pagina === "evol") desenharEvolucao();
}

function mostrarPagina(chave) {
  estado.pagina = chave;
  document.querySelectorAll(".pagina").forEach((p) => p.classList.toggle("ativa", p.id === "pagina-" + chave));
  document.querySelectorAll(".aba").forEach((b) => b.classList.toggle("ativa", b.dataset.pagina === chave));
  $("fab").hidden = chave === "evol";
  if (chave === "evol") desenharEvolucao();
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- seletor de mês
const rotuloMes = (a, m) => `${MESES[m - 1].toUpperCase()}/${a}`;
function somarMes(a, m, passo) {
  const t = m - 1 + passo;
  return { a: a + Math.floor(t / 12), m: ((t % 12) + 12) % 12 + 1 };
}

// Aplica o mês escolhido aos filtros de período e redesenha as telas
function definirMes(a, m) {
  estado.mes = { a, m };
  const opcoes = [];
  for (let i = -3; i <= 3; i++) {
    const x = somarMes(a, m, i);
    opcoes.push({ texto: rotuloMes(x.a, x.m), valor: `${x.a}-${x.m}` });
  }
  preencherSelect($("combo-mes"), opcoes, `${a}-${m}`);
  const [ini, fim] = limitesDoMes(a, m);
  for (const p of ["lanc", "fundo"]) {
    $(p + "-fl-ini").value = dataISO(ini);
    $(p + "-fl-fim").value = dataISO(fim);
  }
  filtrarLanc();
  filtrarFundo();
  if (estado.pagina === "evol") desenharEvolucao();
}

// ---------------------------------------------------------------- gravação comum
async function inserirLancamentos(linhas) {
  if (linhas.length) await dados(banco.from("lancamentos").insert(linhas));
}
async function alterarLancamento(id, campos) {
  await dados(banco.from("lancamentos").update(campos).eq("id", id));
}
async function excluirLancamentos(ids) {
  await dados(banco.from("lancamentos").delete().in("id", ids));
}
async function buscarLancamento(id) {
  const lista = await dados(banco.from("lancamentos").select("*").eq("id", id));
  return lista && lista[0];
}

function lerValorEData(prefixo, mensagemValor = "Insira um valor maior que zero.") {
  const centavos = lerCentavos($(prefixo + "-valor").value);
  if (!centavos) {
    aviso("Valor inválido", mensagemValor, "erro");
    return null;
  }
  const dt = lerDataCampo(prefixo + "-data");
  if (!dt) {
    aviso("Data inválida", "Escolha a data.", "erro");
    return null;
  }
  const campoParcelas = $(prefixo + "-parcelas");
  const parcelas = campoParcelas ? Math.max(1, Math.min(120, parseInt(campoParcelas.value, 10) || 1)) : 1;
  return { dt, centavos, parcelas };
}

function textoFiltros(prefixo) {
  const ini = lerDataCampo(prefixo + "-fl-ini"), fim = lerDataCampo(prefixo + "-fl-fim");
  const partes = [];
  if (ini && fim) partes.push(`${dataBR(ini).slice(0, 5)} a ${dataBR(fim).slice(0, 5)}`);
  for (const campo of ["socio", "tipo"]) {
    const v = $(`${prefixo}-fl-${campo}`).value;
    if (v !== "Todos") partes.push(v);
  }
  const d = $(prefixo + "-fl-desc").value.trim();
  if (d) partes.push(`“${d}”`);
  const valor = $(prefixo + "-fl-valor");
  if (valor && valor.value) partes.push(`R$ ${valor.value}`);
  $(prefixo + "-filtros").closest(".filtros").querySelector(".filtros-resumo").textContent = partes.join(" · ");
}

const dentroDoPeriodo = (dt, ini, fim) => !(ini && fim) || (chaveData(ini) <= chaveData(dt) && chaveData(dt) <= chaveData(fim));

// =========================================================================
// ABA 1 — LANÇAMENTOS DIÁRIOS (Manutenção)
// =========================================================================
function filtrarLanc() {
  if (!estado.cadastro) return;
  const socio = $("lanc-fl-socio").value;
  const tipo = $("lanc-fl-tipo").value;
  const desc = $("lanc-fl-desc").value.trim().toLowerCase();
  const valor = lerCentavos($("lanc-fl-valor").value);
  const ini = lerDataCampo("lanc-fl-ini"), fim = lerDataCampo("lanc-fl-fim");

  const linhas = [];
  let despesas = 0, receitas = 0;
  for (const l of estado.todos) {
    if (l.tipo === "Ajuste" || l.destinacao !== "Manutenção") continue;
    if (socio !== "Todos" && l.pagador !== socio) continue;
    if (tipo !== "Todos" && l.tipo !== tipo) continue;
    if (desc && !String(l.descricao || "").toLowerCase().includes(desc)) continue;
    if (valor && l.valores !== valor) continue;
    const dt = dataDoBanco(l.data);
    if (!dt || !dentroDoPeriodo(dt, ini, fim)) continue;
    const t = String(l.tipo).toLowerCase();
    if (t === "despesa") despesas += l.valores;
    else if (t === "receita") receitas += l.valores;
    linhas.push({ ...l, _dt: chaveData(dt) });
  }
  listas.lanc.definir(linhas);

  const total = (despesas - receitas) / 100;
  $("lanc-tot-desp").textContent = `Despesas: ${valorTexto(despesas)}`;
  $("lanc-tot-rec").textContent = `Receitas: ${valorTexto(receitas)}`;
  $("lanc-tot-valor").textContent = total >= 0 ? brl(Math.abs(total)) : `- ${brl(Math.abs(total))}`;
  $("lanc-tot-geral").classList.toggle("negativo", total > 0);
  textoFiltros("lanc");
}

function limparLanc(redesenhar = true) {
  formularios.lanc.modo(false);
  formularios.lanc.idEdicao = null;
  $("lanc-data").value = dataISO(hoje());
  $("lanc-desc").value = "";
  $("lanc-valor").value = "";
  $("lanc-parcelas").value = "1";
  listas.lanc.selecionados.clear();
  if (redesenhar) listas.lanc.desenhar();
}

async function salvarLanc() {
  const f = lerValorEData("lanc");
  if (!f) return;
  await acao(async () => {
    const pagador = $("lanc-socio").value;
    const tipo = $("lanc-tipo").value;
    const desc = $("lanc-desc").value.trim().toUpperCase();
    let msg;
    if (!formularios.lanc.editando) {
      await inserirLancamentos(gerarParcelas(f.dt, desc, f.parcelas).map((p) => ({
        data: p.data, pagador, destinacao: "Manutenção", tipo, descricao: p.descricao, valores: f.centavos,
      })));
      msg = f.parcelas > 1 ? `${f.parcelas} parcelas adicionadas` : "Lançamento adicionado";
      if (ehCelular()) { limparLanc(false); formularios.lanc.fechar(); }
    } else {
      await alterarLancamento(formularios.lanc.idEdicao, {
        data: dataBR(f.dt), pagador, destinacao: "Manutenção", tipo, descricao: desc, valores: f.centavos,
      });
      limparLanc(false);
      formularios.lanc.fechar();
      msg = "Lançamento alterado";
    }
    await recarregar();
    toast(msg);
  });
}

async function lancParaTodos() {
  const f = lerValorEData("lanc");
  if (!f) return;
  await acao(async () => {
    const tipo = $("lanc-tipo").value;
    const desc = $("lanc-desc").value.trim().toUpperCase();
    const linhas = [];
    let qtd = 0;
    for (const p of gerarParcelas(f.dt, desc, f.parcelas)) {
      const socios = estado.cadastro.ativosEm(paraData(p.data));
      for (const pagador of socios) {
        linhas.push({ data: p.data, pagador, destinacao: "Manutenção", tipo, descricao: p.descricao, valores: f.centavos });
      }
      qtd = Math.max(qtd, socios.length);
    }
    await inserirLancamentos(linhas);
    limparLanc(false);
    formularios.lanc.fechar();
    await recarregar();
    toast(`Lançamento adicionado aos ${qtd} sócios`);
  });
}

async function editarLanc(id) {
  await acao(async () => {
    const reg = await buscarLancamento(id);
    if (!reg) return aviso("Não encontrado", "Este lançamento não existe mais.", "aviso");
    formularios.lanc.idEdicao = id;
    listas.lanc.selecionados = new Set([id]);
    const dt = paraData(reg.data);
    $("lanc-data").value = dt ? dataISO(dt) : "";
    garantirOpcao($("lanc-socio"), reg.pagador);
    garantirOpcao($("lanc-tipo"), reg.tipo);
    $("lanc-desc").value = reg.descricao || "";
    $("lanc-valor").value = numBR(reg.valores / 100);
    formularios.lanc.modo(true);
    listas.lanc.desenhar();
    formularios.lanc.abrir();
    if (!ehCelular()) $("lanc-desc").focus();
  });
}

async function excluirLanc(ids) {
  if (!ids.length) return aviso("Nada selecionado", "Selecione pelo menos um lançamento para excluir.", "aviso");
  const l = ids.length === 1 && listas.lanc.linhas.find((x) => x.id === ids[0]);
  const msg = l ? `Deseja remover o lançamento “${l.descricao}” do sócio ${l.pagador} (${valorTexto(l.valores)})?`
    : `Deseja excluir os ${ids.length} lançamentos selecionados de uma vez?`;
  if (!(await perguntar("Confirmar exclusão", msg, "Excluir", true))) return;
  await acao(async () => {
    await excluirLancamentos(ids);
    if (ids.includes(formularios.lanc.idEdicao)) { limparLanc(false); formularios.lanc.fechar(); }
    listas.lanc.selecionados.clear();
    await recarregar();
    toast(`${ids.length} lançamento(s) excluído(s)`);
  });
}

// =========================================================================
// ABA 2 — ACERTOS (saldos, sugestões e ajustes entre sócios)
// =========================================================================
// Descrição gravada: "TEXTO | AJUSTE: RECEBEDOR -> PAGADOR"
function partesDoAjuste(descricao) {
  const d = descricao || "";
  const sep = d.includes(" | AJUSTE:") ? " | AJUSTE:" : d.includes("AJUSTE:") ? "AJUSTE:" : null;
  if (!sep) return { texto: d, fluxo: "", recebedor: null, pagador: null };
  const partes = d.split(sep);
  const resto = partes.length > 1 ? partes[1] : "";
  const lados = resto.split("->").map((x) => x.trim());
  return {
    texto: partes[0].trim(),
    fluxo: resto.replace("->", "RECEBEU DE").trim(),
    recebedor: lados.length === 2 ? lados[0] : null,
    pagador: lados.length === 2 ? lados[1] : null,
  };
}

function desenharAcertos() {
  if (!estado.cadastro) return;
  const c = estado.cadastro;
  const saldos = calcularSaldos(estado.todos, c)["Manutenção"];
  estado.saldos = saldos;

  // Cards: sócios ativos + ex-sócios que ainda têm saldo a acertar
  const ativos = c.ativosHoje;
  const grade = $("acer-saldos");
  grade.replaceChildren();
  for (const socio of c.todos.filter((p) => ativos.includes(p) || Math.abs(saldos[p] || 0) > 0.05)) {
    const valor = saldos[socio] || 0;
    let status = ["dia", "em dia"];
    if (valor > 0.05) status = ["receber", "a receber"];
    else if (valor < -0.05) status = ["pagar", "a pagar"];
    const card = el("div", "card saldo-socio");
    const topo = el("div", "saldo-topo");
    topo.append(el("span", "avatar", iniciais(socio)), el("span", "saldo-nome", socio),
      el("span", "status " + status[0], status[1]));
    card.append(topo, el("div", "saldo-valor " + (valor >= 0 ? "pos" : "neg"), brl(valor)));
    grade.append(card);
  }

  const caixa = $("acer-sugestoes");
  caixa.replaceChildren();
  const sugestoes = sugerirAcertos(saldos);
  if (!sugestoes.length) caixa.append(el("p", "tudo-em-dia", "✓ Todos os sócios estão em dia — nenhum acerto pendente."));
  for (const s of sugestoes) {
    const b = el("button", "sugestao");
    b.type = "button";
    b.append(el("span", "", `${s.pagador}  →  ${s.recebedor}`), el("b", "", brl(s.valor)));
    b.onclick = () => preencherAcerto(s);
    caixa.append(b);
  }

  const linhas = estado.todos
    .filter((l) => l.tipo === "Ajuste" && l.destinacao === "Manutenção")
    .map((l) => {
      const p = partesDoAjuste(l.descricao);
      const dt = paraData(l.data);
      return { ...l, _texto: p.texto, _fluxo: p.fluxo || l.descricao || "", _dt: dt ? chaveData(dt) : 0 };
    });
  listas.acer.definir(linhas);
}

function preencherAcerto(s) {
  if (formularios.acer.editando) limparAcerto(false);
  const h = hoje();
  $("acer-desc").value = `Acerto de Contas - ${MESES[h.m - 1]}/${h.a}`;
  garantirOpcao($("acer-recebedor"), s.recebedor);
  garantirOpcao($("acer-pagador"), s.pagador);
  $("acer-valor").value = numBR(s.valor);
  formularios.acer.abrir();
  if (!ehCelular()) $("acer-valor").focus();
}

function limparAcerto(redesenhar = true) {
  formularios.acer.modo(false);
  formularios.acer.idEdicao = null;
  $("acer-pagador").disabled = false;
  $("acer-recebedor").disabled = false;
  $("acer-data").value = dataISO(hoje());
  $("acer-desc").value = "";
  $("acer-valor").value = "";
  listas.acer.selecionados.clear();
  if (redesenhar) listas.acer.desenhar();
}

async function salvarAcerto() {
  const f = lerValorEData("acer", "Insira um valor válido para o acerto.");
  if (!f) return;
  const recebedor = $("acer-recebedor").value;
  const pagador = $("acer-pagador").value;
  if (recebedor === pagador) {
    return aviso("Sócios iguais", "O sócio pagador não pode ser o mesmo que o sócio recebedor.", "erro");
  }
  await acao(async () => {
    const desc = $("acer-desc").value.trim();
    const campos = {
      data: dataBR(f.dt), pagador: recebedor, destinacao: "Manutenção", tipo: "Ajuste",
      descricao: `${desc} | AJUSTE: ${recebedor} -> ${pagador}`.toUpperCase(), valores: f.centavos,
    };
    let msg;
    if (!formularios.acer.editando) {
      await inserirLancamentos([campos]);
      msg = "Acerto aplicado";
    } else {
      await alterarLancamento(formularios.acer.idEdicao, campos);
      msg = "Acerto alterado";
    }
    limparAcerto(false);
    formularios.acer.fechar();
    await recarregar();
    toast(msg);
  });
}

async function editarAcerto(id) {
  await acao(async () => {
    const reg = await buscarLancamento(id);
    if (!reg) return aviso("Não encontrado", `Acerto com ID ${id} não encontrado no banco.`, "erro");
    limparAcerto(false);
    formularios.acer.idEdicao = id;
    listas.acer.selecionados = new Set([id]);
    const dt = paraData(reg.data);
    $("acer-data").value = dt ? dataISO(dt) : "";
    $("acer-valor").value = numBR(reg.valores / 100);
    const p = partesDoAjuste(reg.descricao);
    const nomeCerto = (n) => estado.cadastro.todos.find((s) => s.toUpperCase() === String(n).toUpperCase()) || n;
    if (p.recebedor) garantirOpcao($("acer-recebedor"), nomeCerto(p.recebedor));
    if (p.pagador) garantirOpcao($("acer-pagador"), nomeCerto(p.pagador));
    $("acer-desc").value = p.texto;
    $("acer-pagador").disabled = true;           // como no desktop: na alteração os sócios não mudam
    $("acer-recebedor").disabled = true;
    formularios.acer.modo(true);
    listas.acer.desenhar();
    formularios.acer.abrir();
  });
}

async function excluirAcerto(ids) {
  if (!ids.length) return aviso("Nada selecionado", "Selecione um acerto para excluir.", "aviso");
  const msg = ids.length === 1 ? "Deseja remover este acerto financeiro definitivamente?"
    : `Deseja remover os ${ids.length} acertos selecionados definitivamente?`;
  if (!(await perguntar("Excluir acerto", msg, "Excluir", true))) return;
  await acao(async () => {
    await excluirLancamentos(ids);
    if (ids.includes(formularios.acer.idEdicao)) { limparAcerto(false); formularios.acer.fechar(); }
    listas.acer.selecionados.clear();
    await recarregar();
    toast("Acerto(s) removido(s)");
  });
}

// =========================================================================
// ABA 3 — FUNDO DE RESERVA
// =========================================================================
function filtrarFundo() {
  if (!estado.cadastro) return;
  const socio = $("fundo-fl-socio").value;
  const tipo = $("fundo-fl-tipo").value;
  const desc = $("fundo-fl-desc").value.trim().toLowerCase();
  const ini = lerDataCampo("fundo-fl-ini"), fim = lerDataCampo("fundo-fl-fim");

  const linhas = [];
  for (const l of estado.todos) {
    if (l.destinacao !== "Fundo de Reserva" || !["Crédito", "Débito"].includes(l.tipo)) continue;
    const dt = dataDoBanco(l.data);
    if (!dt || !dentroDoPeriodo(dt, ini, fim)) continue;
    if (socio !== "Todos" && l.pagador !== socio) continue;
    if (tipo !== "Todos" && l.tipo !== tipo) continue;
    if (desc && !String(l.descricao || "").toLowerCase().includes(desc)) continue;
    linhas.push({ ...l, _dt: chaveData(dt) });
  }
  linhas.sort((x, y) => x._dt - y._dt);       // por data, como no desktop

  // 1ª linha: saldo do fundo no início do período
  if (ini) {
    const saldo = saldoFundoAntesDe(estado.todos, ini);
    linhas.unshift({ _fixa: true, id: "saldo", data: dataBR(ini), pagador: "", tipo: "", descricao: "SALDO INICIAL",
      valores: Math.round(saldo * 100), _saldo: saldo });
  }
  listas.fundo.definir(linhas);
  $("fundo-saldo").textContent = brl(saldoFundoAteHoje(estado.todos));
  textoFiltros("fundo");
}

function verificarAlertasFundo() {
  const amanha = chaveData(somarDias(hoje(), 1)), depois = chaveData(somarDias(hoje(), 2));
  const alertas = [];
  for (const l of estado.todos) {
    if (l.destinacao !== "Fundo de Reserva" || !["Débito", "Despesa"].includes(String(l.tipo).trim())) continue;
    const dt = dataDoBanco(l.data);
    if (dt && [amanha, depois].includes(chaveData(dt))) alertas.push({ k: chaveData(dt), l });
  }
  const caixa = $("fundo-alerta-linhas");
  caixa.replaceChildren();
  if (!alertas.length || estado.alertaFechado) {
    $("fundo-alerta").hidden = true;
    return;
  }
  caixa.append(el("b", "", "Pagamentos do fundo próximos do vencimento"));
  alertas.sort((x, y) => x.k - y.k);
  for (const { k, l } of alertas) {
    const quando = k === amanha ? "AMANHÃ" : "EM 2 DIAS";
    caixa.append(el("div", "", `• Vence ${quando} — ${l.pagador} · ${l.descricao} · ${valorTexto(l.valores)}`));
  }
  $("fundo-alerta").hidden = false;
}

function limparFundo(redesenhar = true) {
  formularios.fundo.modo(false);
  formularios.fundo.idEdicao = null;
  $("fundo-data").value = dataISO(hoje());
  $("fundo-desc").value = "";
  $("fundo-valor").value = "";
  $("fundo-parcelas").value = "1";
  listas.fundo.selecionados.clear();
  if (redesenhar) listas.fundo.desenhar();
}

async function salvarFundo() {
  const f = lerValorEData("fundo");
  if (!f) return;
  await acao(async () => {
    const alvo = $("fundo-socio").value;
    const tipo = $("fundo-tipo").value;
    const desc = $("fundo-desc").value.trim().toUpperCase();
    let msg;
    if (!formularios.fundo.editando) {
      await inserirLancamentos(gerarParcelas(f.dt, desc, f.parcelas).map((p) => ({
        data: p.data, pagador: alvo, destinacao: "Fundo de Reserva", tipo, descricao: p.descricao, valores: f.centavos,
      })));
      msg = f.parcelas > 1 ? `${f.parcelas} parcelas adicionadas ao fundo` : "Lançamento adicionado ao fundo";
      if (ehCelular()) { limparFundo(false); formularios.fundo.fechar(); }
    } else {
      await alterarLancamento(formularios.fundo.idEdicao, {
        data: dataBR(f.dt), pagador: alvo, destinacao: "Fundo de Reserva", tipo, descricao: desc, valores: f.centavos,
      });
      limparFundo(false);
      formularios.fundo.fechar();
      msg = "Lançamento do fundo alterado";
    }
    await recarregar();
    toast(msg);
  });
}

async function fundoParaTodos() {
  const f = lerValorEData("fundo");
  if (!f) return;
  await acao(async () => {
    const tipo = $("fundo-tipo").value;
    const desc = $("fundo-desc").value.trim().toUpperCase();
    const linhas = [];
    let qtd = 0;
    for (const p of gerarParcelas(f.dt, desc, f.parcelas)) {
      const socios = estado.cadastro.ativosEm(paraData(p.data));
      for (const pagador of socios) {
        linhas.push({ data: p.data, pagador, destinacao: "Fundo de Reserva", tipo, descricao: p.descricao, valores: f.centavos });
      }
      qtd = Math.max(qtd, socios.length);
    }
    await inserirLancamentos(linhas);
    if (ehCelular()) { limparFundo(false); formularios.fundo.fechar(); }
    await recarregar();
    toast(`Lançamento adicionado ao fundo para os ${qtd} sócios`);
  });
}

async function editarFundo(id) {
  await acao(async () => {
    const reg = await buscarLancamento(id);
    if (!reg) return aviso("Não encontrado", "Este lançamento não existe mais.", "aviso");
    formularios.fundo.idEdicao = id;
    listas.fundo.selecionados = new Set([id]);
    const dt = paraData(reg.data);
    $("fundo-data").value = dt ? dataISO(dt) : "";
    garantirOpcao($("fundo-socio"), reg.pagador);
    garantirOpcao($("fundo-tipo"), reg.tipo);
    $("fundo-desc").value = reg.descricao || "";
    $("fundo-valor").value = numBR(reg.valores / 100);
    $("fundo-parcelas").value = "1";
    formularios.fundo.modo(true);
    listas.fundo.desenhar();
    formularios.fundo.abrir();
    if (!ehCelular()) $("fundo-desc").focus();
  });
}

async function excluirFundo(ids) {
  if (!ids.length) return aviso("Nada selecionado", "Selecione pelo menos um lançamento do fundo para excluir.", "aviso");
  const l = ids.length === 1 && listas.fundo.linhas.find((x) => x.id === ids[0]);
  const msg = l ? `Deseja remover o lançamento “${l.descricao}” do fundo, no valor de ${valorTexto(l.valores)}?`
    : `Deseja excluir os ${ids.length} lançamentos do fundo selecionados?`;
  if (!(await perguntar("Confirmar exclusão", msg, "Excluir", true))) return;
  await acao(async () => {
    await excluirLancamentos(ids);
    if (ids.includes(formularios.fundo.idEdicao)) { limparFundo(false); formularios.fundo.fechar(); }
    listas.fundo.selecionados.clear();
    await recarregar();
    toast(`${ids.length} lançamento(s) do fundo excluído(s)`);
  });
}

// =========================================================================
// ABA 4 — EVOLUÇÃO DOS GASTOS (gráfico de barras empilhadas, 12 meses)
// =========================================================================
function desenharEvolucao() {
  const meses = gastosPorMes(estado.todos, estado.mes.a, estado.mes.m);
  const totais = meses.map((m) => m.total);
  const total = totais.reduce((s, v) => s + v, 0);
  $("evol-total").textContent = brl(total);
  $("evol-media").textContent = brl(total / 12);
  $("evol-atual").textContent = brl(totais[11]);
  const iMax = totais.indexOf(Math.max(...totais));
  $("evol-maior").textContent = total ? `${brl(totais[iMax])} · ${meses[iMax].rotulo}` : "—";

  const area = $("evol-grafico");
  area.replaceChildren();
  $("evol-legenda").replaceChildren(...CATEGORIAS_GASTO.map((c) => {
    const item = el("span", "legenda-item", c.nome);
    item.style.setProperty("--cor", c.cor);
    return item;
  }));
  if (!total) {
    area.append(el("p", "vazio", "Nenhuma despesa encontrada nos últimos 12 meses."));
    return;
  }

  // Celular: uma linha por mês (o mais recente em cima), com barra horizontal
  if (ehCelular()) {
    const maior = Math.max(...totais);
    const lista = el("div", "barras-h");
    for (const m of [...meses].reverse()) {
      const linha = el("div", "barra-h");
      const trilho = el("div", "trilho");
      for (const c of CATEGORIAS_GASTO) {
        const v = m.valores[c.nome];
        if (v > 0) {
          const pedaco = el("span");
          pedaco.style.width = `${(v / maior) * 100}%`;
          pedaco.style.background = c.cor;
          pedaco.title = `${c.nome}: ${brl(v)}`;
          trilho.append(pedaco);
        }
      }
      linha.append(el("span", "rot", m.rotulo), trilho, el("b", "", m.total ? brl(m.total) : "—"));
      lista.append(linha);
    }
    area.append(lista);
    return;
  }

  const L = 960, A = 400, esq = 78, dir = 10, topo = 30, baixo = 34;
  const larg = (L - esq - dir) / 12;
  const maximo = Math.max(...totais) * 1.15;
  const passo = escalaBonita(maximo / 4);
  const y = (v) => topo + (A - topo - baixo) * (1 - v / maximo);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${L} ${A}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Despesas dos últimos 12 meses por categoria");
  const add = (tag, attrs, texto) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (texto !== undefined) e.textContent = texto;
    svg.append(e);
    return e;
  };
  for (let v = 0; v <= maximo; v += passo) {
    add("line", { x1: esq, x2: L - dir, y1: y(v), y2: y(v), class: "g-grade" });
    add("text", { x: esq - 8, y: y(v) + 4, class: "g-eixo", "text-anchor": "end" }, `R$ ${Math.round(v).toLocaleString("pt-BR")}`);
  }
  meses.forEach((m, i) => {
    const x = esq + i * larg + larg * 0.21;
    const w = larg * 0.58;
    let base = 0;
    for (const c of CATEGORIAS_GASTO) {
      const v = m.valores[c.nome];
      if (v > 0) {
        const r = add("rect", { x, y: y(base + v), width: w, height: y(base) - y(base + v), fill: c.cor, class: "g-barra" });
        const dica = document.createElementNS(ns, "title");
        dica.textContent = `${m.rotulo} · ${c.nome}: ${brl(v)}`;
        r.append(dica);
      }
      base += v;
    }
    if (m.total > 0) add("text", { x: x + w / 2, y: y(m.total) - 6, class: "g-total", "text-anchor": "middle" }, brl(m.total));
    add("text", { x: x + w / 2, y: A - 10, class: "g-eixo", "text-anchor": "middle" }, m.rotulo);
  });
  add("line", { x1: esq, x2: L - dir, y1: y(0), y2: y(0), class: "g-base" });
  area.append(svg);
}

function escalaBonita(bruto) {
  const p = Math.pow(10, Math.floor(Math.log10(bruto || 1)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= bruto) return m * p;
  return 10 * p;
}

// =========================================================================
// ABA 5 — SÓCIOS (cadastro e divisão das despesas)
// =========================================================================
function desenharSocios() {
  if (!estado.cadastro) return;
  const c = estado.cadastro;
  const h = hoje();
  let ativos = 0;
  const linhas = c.socios.map((s) => {
    const situacao = c.situacao(s, h);
    if (situacao === "Ativo") ativos++;
    const perc = situacao === "Ativo" ? c.percentualEm(s.nome, h) : null;
    return {
      ...s, _situacao: situacao,
      _entrada: dataBR(s.entrada), _saida: s.saida ? dataBR(s.saida) : "—",
      _divisao: perc !== null ? `${textoPercentual(perc)}%` : situacao === "Ativo" ? "falta definir" : "—",
      _saldo: estado.saldos[s.nome] || 0,
    };
  });
  listas.soc.definir(linhas);
  $("soc-resumo").textContent = `${ativos} ativo(s) de ${c.socios.length} cadastrado(s)`;

  // Quadro da divisão em vigor hoje
  const { ok, divisao } = c.divisaoOk(h);
  const partes = Object.entries(divisao)
    .map(([n, v]) => `${n}: ${v !== null ? textoPercentual(v) + "%" : "falta definir"}`).join("   ·   ");
  const quadro = $("soc-divisao");
  if (ok) {
    const datas = Object.keys(divisao).flatMap((n) => (c.percentuais[n] || [])
      .filter((p) => chaveData(p.desde) <= chaveData(h)).map((p) => p.desde));
    datas.sort((x, y) => chaveData(x) - chaveData(y));
    const desde = datas.length ? `Em vigor desde ${dataBR(datas[datas.length - 1])}:   ` : "";
    $("soc-divisao-texto").textContent = desde + partes;
    quadro.classList.remove("alerta-divisao");
  } else {
    const soma = Object.values(divisao).reduce((s, v) => s + (v || 0), 0);
    $("soc-divisao-texto").textContent = `⚠ A divisão de hoje não fecha 100% (soma ${textoPercentual(soma)}%). `
      + `Enquanto isso, as despesas são divididas igualmente.   ${partes}`;
    quadro.classList.add("alerta-divisao");
  }
}

function limparSocio(redesenhar = true) {
  formularios.soc.modo(false);
  formularios.soc.idEdicao = null;
  $("soc-nome").disabled = false;
  $("soc-nome").value = "";
  $("soc-entrada").value = dataISO(hoje());
  $("soc-saida").value = "";
  listas.soc.selecionados.clear();
  if (redesenhar) listas.soc.desenhar();
}

function validarNomeSocio(nome) {
  if (nome.length < 3) return "Digite o nome do sócio (pelo menos 3 letras).";
  if (nome.length > 40) return "Use no máximo 40 caracteres.";
  if (["->", "|", ":"].some((t) => nome.includes(t))) {
    return 'O nome não pode conter "->", "|" nem ":" (esses símbolos são usados nos acertos).';
  }
  if (["todos", ALVO_FUNDO.toLowerCase()].includes(nome.toLowerCase())) return "Esse nome é reservado pelo sistema.";
  if (estado.cadastro.socios.some((s) => s.nome.toLowerCase() === nome.toLowerCase())) return `Já existe um sócio chamado ${nome}.`;
  return null;
}

async function salvarSocio() {
  const entrada = lerDataCampo("soc-entrada");
  if (!entrada) return aviso("Data inválida", "Informe a data de entrada.", "erro");
  const saidaTexto = $("soc-saida").value;
  const saida = saidaTexto ? paraData(saidaTexto) : null;
  if (saidaTexto && !saida) return aviso("Data inválida", "A data de saída deve ser válida ou ficar vazia.", "erro");
  if (saida && chaveData(saida) < chaveData(entrada)) {
    return aviso("Datas inválidas", "A data de saída não pode ser anterior à data de entrada.", "erro");
  }
  const c = estado.cadastro;
  const h = hoje();
  const mesmaData = (a, b) => (!a && !b) || (!!a && !!b && chaveData(a) === chaveData(b));
  let redistribuir = null;
  let msg;

  if (!formularios.soc.editando) {
    const nome = $("soc-nome").value.split(/\s+/).filter(Boolean).join(" ");
    const erro = validarNomeSocio(nome);
    if (erro) return aviso("Nome inválido", erro, "erro");
    if (chaveData(entrada) < chaveData(h) && !(await perguntar("Entrada no passado",
      `${nome} vai entrar no rateio das despesas lançadas desde ${dataBR(entrada)}.\n`
      + "Os saldos de todos os sócios serão recalculados. Confirma?"))) return;
    const ok = await acao(async () => {
      await dados(banco.from("socios").insert({ nome, data_entrada: dataISO(entrada), data_saida: saida ? dataISO(saida) : null }));
      return true;
    });
    if (!ok) return;
    msg = `Sócio ${nome} cadastrado`;
    redistribuir = { dia: entrada, motivo: `${nome} entra no grupo em ${dataBR(entrada)}. Defina a divisão das despesas a partir dessa data.` };
  } else {
    const atual = c.socios.find((s) => s.id === formularios.soc.idEdicao);
    const nome = atual.nome;
    const continuaAtivo = !saida || chaveData(saida) >= chaveData(h);
    const outrosAtivos = c.socios.filter((s) => s.id !== atual.id && c.situacao(s, h) === "Ativo");
    if (!continuaAtivo && !outrosAtivos.length) return aviso("Não permitido", "Precisa haver pelo menos um sócio ativo.", "erro");
    const saldo = estado.saldos[nome] || 0;
    if (saida && !mesmaData(atual.saida, saida) && Math.abs(saldo) > 0.05 && !(await perguntar("Saldo pendente",
      `${nome} tem saldo de ${brl(saldo)} na manutenção.\nO ideal é fazer o acerto antes da saída. Gravar a saída assim mesmo?`, "Gravar"))) return;
    if ((!mesmaData(atual.entrada, entrada) || !mesmaData(atual.saida, saida)) && !(await perguntar("Alterar datas",
      "Mudar as datas de entrada ou saída muda quem divide as despesas daquele período, "
      + "e os saldos de todos os sócios serão recalculados. Confirma?"))) return;
    const ok = await acao(async () => {
      await dados(banco.from("socios").update({ data_entrada: dataISO(entrada), data_saida: saida ? dataISO(saida) : null }).eq("id", atual.id));
      return true;
    });
    if (!ok) return;
    msg = `Sócio ${nome} alterado`;
    if (saida && !mesmaData(atual.saida, saida)) {
      const dia = somarDias(saida, 1);
      redistribuir = { dia, motivo: `${nome} sai do grupo em ${dataBR(saida)}. Redistribua a parte dele entre os demais a partir de ${dataBR(dia)}.` };
    }
  }

  limparSocio(false);
  formularios.soc.fechar();
  await acao(recarregarCadastro);
  toast(msg);
  if (redistribuir && estado.cadastro.ativosEm(redistribuir.dia).length && !estado.cadastro.divisaoOk(redistribuir.dia).ok) {
    await abrirDivisao(redistribuir.dia, redistribuir.motivo);
  }
}

function editarSocio(id) {
  const s = estado.cadastro.socios.find((x) => x.id === id);
  if (!s) return;
  formularios.soc.idEdicao = id;
  listas.soc.selecionados = new Set([id]);
  $("soc-nome").value = s.nome;
  $("soc-nome").disabled = true;
  $("soc-entrada").value = dataISO(s.entrada);
  $("soc-saida").value = s.saida ? dataISO(s.saida) : "";
  formularios.soc.modo(true);
  listas.soc.desenhar();
  formularios.soc.abrir();
  if (!ehCelular()) $("soc-saida").focus();
}

async function excluirSocio(ids) {
  if (!ids.length) return aviso("Nada selecionado", "Selecione um sócio para excluir.", "aviso");
  const c = estado.cadastro;
  const escolhidos = ids.map((id) => c.socios.find((s) => s.id === id)).filter(Boolean);
  const comLancamentos = await acao(async () => {
    for (const s of escolhidos) {
      const r = await dados(banco.from("lancamentos").select("id").eq("pagador", s.nome).limit(1));
      if (r && r.length) return s;
    }
    return false;
  });
  if (comLancamentos === undefined) return;      // erro já mostrado
  if (comLancamentos) {
    return aviso("Exclusão não permitida", `${comLancamentos.nome} já tem lançamentos e não pode ser excluído.\n`
      + "Para tirar o sócio do grupo, use Alterar e informe a data de saída.", "erro");
  }
  const nomes = escolhidos.map((s) => s.nome);
  if (!c.ativosHoje.some((n) => !nomes.includes(n))) return aviso("Não permitido", "Precisa haver pelo menos um sócio ativo.", "erro");
  if (!(await perguntar("Excluir sócio", `Excluir do cadastro: ${nomes.join(", ")}?`, "Excluir", true))) return;
  await acao(async () => {
    await dados(banco.from("socios").delete().in("id", ids));
    limparSocio(false);
    formularios.soc.fechar();
    await recarregarCadastro();
    toast("Sócio(s) excluído(s)");
  });
}

// Janela da divisão: percentual de cada sócio ativo, valendo a partir de uma data
async function abrirDivisao(diaInicial = hoje(), motivo = null) {
  const c = estado.cadastro;
  const conteudo = el("div", "divisao-janela");
  conteudo.append(el("p", "", motivo || "Informe o percentual de cada sócio. A soma precisa dar 100%."));
  const linhaData = el("label", "linha-data", "Vale a partir de");
  const campoData = el("input");
  campoData.type = "date";
  campoData.value = dataISO(diaInicial);
  linhaData.append(campoData);
  const area = el("div", "divisao-socios");
  const soma = el("div", "divisao-soma");
  const igual = el("button", "btn btn-link", "Dividir igualmente");
  igual.type = "button";
  conteudo.append(linhaData, area, soma, igual);
  let campos = {};
  let gravar = null;

  const lerValores = () => Object.fromEntries(Object.entries(campos).map(([n, e]) => [n, lerPercentual(e.value)]));
  function atualizarSoma() {
    const v = lerValores();
    const total = Object.values(v).reduce((s, x) => s + (x || 0), 0);
    const semValor = Object.entries(v).filter(([, x]) => !x || x <= 0).map(([n]) => n);
    const ok = Object.keys(v).length > 0 && !semValor.length && Math.abs(total - 100000) <= 10;
    let dica = "";
    if (!ok) {
      if (semValor.length) dica = ` (falta o percentual de ${semValor.join(", ")})`;
      else if (100000 - total > 10) dica = ` (faltam ${textoPercentual(100000 - total)}%)`;
      else dica = ` (sobram ${textoPercentual(total - 100000)}%)`;
    }
    soma.textContent = `Soma: ${textoPercentual(total)}%${ok ? "  ✓" : dica}`;
    soma.className = "divisao-soma " + (ok ? "ok" : "erro");
    if (gravar) gravar.disabled = !(ok && paraData(campoData.value));
    return ok;
  }
  function montar() {
    const anteriores = Object.fromEntries(Object.entries(campos).map(([n, e]) => [n, e.value]));
    area.replaceChildren();
    campos = {};
    const dia = paraData(campoData.value);
    if (!dia) { area.append(el("p", "erro", "Data inválida.")); return atualizarSoma(); }
    const socios = c.ativosEm(dia);
    if (!socios.length) area.append(el("p", "erro", "Nenhum sócio ativo nessa data."));
    for (const nome of socios) {
      const linha = el("label", "divisao-linha");
      const e = el("input");
      e.type = "text";
      e.inputMode = "decimal";
      e.className = "centro";
      e.placeholder = "0";
      const atual = c.percentualEm(nome, dia);
      e.value = anteriores[nome] || (atual !== null ? textoPercentual(atual) : "");
      e.addEventListener("input", atualizarSoma);
      e.addEventListener("focus", () => e.select());
      linha.append(el("span", "", nome), e, el("span", "", "%"));
      area.append(linha);
      campos[nome] = e;
    }
    return atualizarSoma();
  }
  campoData.addEventListener("change", montar);
  igual.onclick = () => {
    const nomes = Object.keys(campos);
    if (!nomes.length) return;
    const base = Math.round(100000 / nomes.length);
    nomes.forEach((n, i) => { campos[n].value = textoPercentual(i < nomes.length - 1 ? base : 100000 - base * (nomes.length - 1)); });
    atualizarSoma();
  };
  montar();

  const gravou = await modal({
    titulo: "Divisão das despesas", tipo: "divisao", conteudo,
    aoAbrir: (botoes) => { gravar = botoes[1].el; atualizarSoma(); },
    botoes: [
      { texto: "Cancelar", classe: "btn-contorno", valor: false, cancelar: true },
      {
        texto: "Gravar divisão", valor: true, principal: true, enter: true,
        antes: async () => {
          const dia = paraData(campoData.value);
          if (!dia || !atualizarSoma()) return false;
          if (chaveData(dia) < chaveData(hoje()) && !(await perguntar("Divisão no passado",
            `As despesas lançadas desde ${dataBR(dia)} serão divididas pelos novos percentuais `
            + "e os saldos de todos serão recalculados. Confirma?"))) return false;
          const idPorNome = Object.fromEntries(c.socios.map((s) => [s.nome, s.id]));
          const linhas = Object.entries(lerValores()).map(([n, v]) => ({
            socio_id: idPorNome[n], percentual: v / 1000, vigente_desde: dataISO(dia),
          }));
          const ok = await acao(async () => {
            await dados(banco.from("socios_percentuais").upsert(linhas, { onConflict: "socio_id,vigente_desde" }));
            return true;
          });
          if (ok) toast(`Divisão gravada a partir de ${dataBR(dia)}`);
          return !!ok;
        },
      },
    ],
  });
  if (gravou) await acao(recarregarCadastro);
}

// =========================================================================
// LIGAÇÕES
// =========================================================================
function criarListas() {
  const corTipo = (l) => {
    const t = String(l.tipo || "").toLowerCase();
    return t === "despesa" || t === "débito" ? "neg" : t === "receita" || t === "crédito" ? "pos" : "";
  };
  const porData = (l) => l._dt;
  listas.lanc = new Lista({
    id: "lanc-tabela", form: $("lanc-form"),
    colunas: [
      { campo: "data", titulo: "Data", classe: "centro", chave: porData },
      { campo: "pagador", titulo: "Sócio" },
      { campo: "tipo", titulo: "Tipo", classe: "centro cor" },
      { campo: "descricao", titulo: "Descrição" },
      { campo: "valores", titulo: "Valor", classe: "dir cor forte", texto: (l) => valorTexto(l.valores), chave: (l) => l.valores },
    ],
    grade: "100px 160px 90px minmax(0, 1fr) 130px", campoTitulo: "descricao", campoValor: "valores",
    classeLinha: corTipo, info: (l) => `${l.data.slice(0, 5)} · ${l.pagador} · ${l.tipo}`,
    resumo: (l) => [l.descricao || "(sem descrição)", `${l.data} · ${l.pagador} · ${l.tipo} · ${valorTexto(l.valores)}`],
    vazio: "Nenhum lançamento neste período.", aoEditar: editarLanc, aoExcluir: excluirLanc,
  });
  listas.acer = new Lista({
    id: "acer-tabela", form: $("acer-form"),
    colunas: [
      { campo: "data", titulo: "Data", classe: "centro", chave: porData },
      { campo: "_texto", titulo: "Descrição" },
      { campo: "_fluxo", titulo: "Fluxo do acerto (recebedor ⇄ pagador)" },
      { campo: "valores", titulo: "Valor", classe: "dir forte", texto: (l) => valorTexto(l.valores), chave: (l) => l.valores },
    ],
    grade: "100px minmax(0, 1fr) minmax(0, 1.4fr) 130px", campoTitulo: "_fluxo", campoValor: "valores",
    info: (l) => `${l.data} · ${l._texto}`,
    resumo: (l) => [l._fluxo, `${l.data} · ${l._texto} · ${valorTexto(l.valores)}`],
    vazio: "Nenhum acerto registrado.", aoEditar: editarAcerto, aoExcluir: excluirAcerto,
  });
  listas.fundo = new Lista({
    id: "fundo-tabela", form: $("fundo-form"),
    colunas: [
      { campo: "data", titulo: "Data", classe: "centro", chave: porData },
      { campo: "pagador", titulo: "Sócio / Alvo" },
      { campo: "tipo", titulo: "Tipo", classe: "centro cor" },
      { campo: "descricao", titulo: "Descrição" },
      { campo: "valores", titulo: "Valor", classe: "dir cor forte",
        texto: (l) => (l._fixa ? brl(l._saldo) : valorTexto(l.valores)), chave: (l) => l.valores },
    ],
    grade: "106px 210px 80px minmax(0, 1fr) 130px", campoTitulo: "descricao", campoValor: "valores",
    classeLinha: (l) => (l._fixa ? "saldo-inicial " + (l._saldo >= 0 ? "pos" : "neg") : corTipo(l)),
    info: (l) => (l._fixa ? `Saldo no início do período · ${l.data}` : `${l.data.slice(0, 5)} · ${l.pagador} · ${l.tipo}`),
    resumo: (l) => [l.descricao || "(sem descrição)", `${l.data} · ${l.pagador} · ${l.tipo} · ${valorTexto(l.valores)}`],
    vazio: "Nenhuma movimentação neste período.", aoEditar: editarFundo, aoExcluir: excluirFundo,
  });
  listas.soc = new Lista({
    id: "soc-tabela", form: $("soc-form"),
    colunas: [
      { campo: "nome", titulo: "Sócio" },
      { campo: "_entrada", titulo: "Entrada", classe: "centro", chave: (l) => chaveData(l.entrada) },
      { campo: "_saida", titulo: "Saída", classe: "centro", chave: (l) => (l.saida ? chaveData(l.saida) : 99999999) },
      { campo: "_situacao", titulo: "Situação", classe: "centro" },
      { campo: "_divisao", titulo: "Divisão hoje", classe: "centro" },
      { campo: "_saldo", titulo: "Saldo na manutenção", classe: "dir cor forte", texto: (l) => brl(l._saldo), chave: (l) => l._saldo },
    ],
    grade: "minmax(0, 1fr) 110px 110px 100px 110px 170px", campoTitulo: "nome", campoValor: "_saldo",
    classeLinha: (l) => (Math.abs(l._saldo) > 0.05 ? (l._saldo > 0 ? "pos" : "neg") : "")
      + (l._situacao !== "Ativo" ? " inativo" : ""),
    info: (l) => `${l._situacao} · desde ${l._entrada}${l.saida ? " até " + l._saida : ""} · divisão ${l._divisao}`,
    resumo: (l) => [l.nome, `${l._situacao} · entrada ${l._entrada} · saída ${l._saida} · saldo ${brl(l._saldo)}`],
    vazio: "Nenhum sócio cadastrado.", aoEditar: editarSocio, aoExcluir: excluirSocio,
  });
}

function ligarBotoesLista(chave) {
  const form = $(chave + "-form");
  const lista = listas[chave];
  form.querySelector(".btn-alterar").addEventListener("click", () => lista.cfg.aoEditar([...lista.selecionados][0]));
  form.querySelector(".btn-excluir").addEventListener("click", () => lista.cfg.aoExcluir([...lista.selecionados]));
}

function ligarFiltros(chave, filtrar) {
  const form = $(chave + "-filtros");
  const caixa = form.closest(".filtros");
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (ehCelular()) caixa.classList.remove("aberto");
    filtrar();
  });
  caixa.querySelector(".filtros-cabeca").addEventListener("click", () => caixa.classList.toggle("aberto"));
  form.querySelector(".btn-limpar-filtros").addEventListener("click", () => {
    const [ini, fim] = limitesDoMes(estado.mes.a, estado.mes.m);
    $(chave + "-fl-ini").value = dataISO(ini);
    $(chave + "-fl-fim").value = dataISO(fim);
    form.querySelectorAll("select").forEach((s) => { s.value = "Todos"; });
    form.querySelectorAll("input[type=search], input.moeda").forEach((i) => { i.value = ""; });
    filtrar();
  });
}

function ligarEventos() {
  $("form-login").addEventListener("submit", entrar);
  $("btn-redefinir").addEventListener("click", redefinirSenha);
  $("btn-olho").addEventListener("click", () => {
    const campo = $("login-senha");
    campo.type = campo.type === "password" ? "text" : "password";
  });
  $("chip-usuario").addEventListener("click", async () => {
    if (await perguntar("Sair", `Sair da conta de ${estado.usuario}?`, "Sair")) await sair();
  });

  document.querySelectorAll(".aba").forEach((b) => b.addEventListener("click", () => mostrarPagina(b.dataset.pagina)));
  $("mes-anterior").addEventListener("click", () => { const x = somarMes(estado.mes.a, estado.mes.m, -1); definirMes(x.a, x.m); });
  $("mes-seguinte").addEventListener("click", () => { const x = somarMes(estado.mes.a, estado.mes.m, 1); definirMes(x.a, x.m); });
  $("combo-mes").addEventListener("change", () => {
    const [a, m] = $("combo-mes").value.split("-").map(Number);
    definirMes(a, m);
  });
  document.querySelectorAll("input.moeda").forEach((c) =>
    c.addEventListener("input", () => { c.value = mascararMoeda(c.value); }));

  prepararFormulario("lanc", {
    novo: { titulo: "Novo lançamento", botao: "＋ Adicionar lançamento", classe: "btn-primario" },
    editar: "Editar lançamento", salvar: salvarLanc, limpar: limparLanc,
  });
  prepararFormulario("acer", {
    novo: { titulo: "Novo acerto", botao: "✓ Aplicar acerto", classe: "btn-primario" },
    editar: "Editar acerto", salvar: salvarAcerto, limpar: limparAcerto,
  });
  prepararFormulario("fundo", {
    novo: { titulo: "Novo lançamento", botao: "＋ Adicionar lançamento", classe: "btn-ambar" },
    editar: "Editar lançamento", salvar: salvarFundo, limpar: limparFundo,
  });
  prepararFormulario("soc", {
    novo: { titulo: "Novo sócio", botao: "＋ Adicionar sócio", classe: "btn-primario" },
    editar: "Editar sócio", salvar: salvarSocio, limpar: limparSocio,
  });
  criarListas();
  ["lanc", "acer", "fundo", "soc"].forEach(ligarBotoesLista);
  $("lanc-todos").addEventListener("click", lancParaTodos);
  $("fundo-todos").addEventListener("click", fundoParaTodos);
  ligarFiltros("lanc", filtrarLanc);
  ligarFiltros("fundo", filtrarFundo);
  $("fundo-alerta-fechar").addEventListener("click", () => { estado.alertaFechado = true; $("fundo-alerta").hidden = true; });
  $("evol-atualizar").addEventListener("click", () => acao(async () => { await recarregar(); toast("Gráfico atualizado"); }));
  $("soc-divisao-btn").addEventListener("click", () => abrirDivisao());
  $("fab").addEventListener("click", () => {
    const chave = estado.pagina;
    const limpar = { lanc: limparLanc, acer: limparAcerto, fundo: limparFundo, soc: limparSocio }[chave];
    if (!limpar) return;
    limpar();
    formularios[chave].abrir();
  });

  document.addEventListener("keydown", (ev) => {
    const lista = listas[estado.pagina];
    if (ev.key === "Delete" && lista && estado.usuario && !ehCelular() && lista.selecionados.size
        && !document.querySelector(".fundo-modal") && !/INPUT|SELECT/.test(document.activeElement.tagName)) {
      lista.cfg.aoExcluir([...lista.selecionados]);
    }
  });

  // Girou o celular / mudou o tamanho da janela: o gráfico muda de formato
  window.matchMedia("(max-width: 899px)").addEventListener("change", () => {
    if (estado.usuario && estado.pagina === "evol") desenharEvolucao();
  });

  // Ao voltar para o app (ex.: celular desbloqueado), busca os números de novo
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && estado.usuario && !document.querySelector(".fundo-modal")) {
      acao(recarregar);
    }
  });
}

async function iniciar() {
  ligarEventos();
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  // Já entrou antes neste aparelho? Continua logado.
  try {
    const { data } = await banco.auth.getSession();
    if (data && data.session) {
      const status = await rpc("rds_meu_status");
      if (status && status.socio && !status.requer_troca) {
        await acao(() => abrirAplicativo(status.socio));
        if (estado.usuario) return;
      }
      await sairDoSupabase();
    }
  } catch (e) {
    console.error(e);
  }
  await mostrarLogin();
}

iniciar();
