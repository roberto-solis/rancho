// =========================================================================
// RANCHO DINA SOLIS — contas (mesmas regras do app desktop, database.py)
// Sem tela e sem banco: só datas, dinheiro e saldos.
// =========================================================================
"use strict";

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const CATEGORIAS = ["Manutenção", "Fundo de Reserva"];

// ---------------------------------------------------------------- datas
// Data = {a, m, d}. No banco as datas são texto "DD/MM/AAAA".
function dataValida(a, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1)) return false;
  return d <= diasNoMes(a, m);
}

function diasNoMes(a, m) {
  return new Date(a, m, 0).getDate();
}

function paraData(texto) {
  if (!texto) return null;
  const t = String(texto).trim();
  let r = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (r) {
    const [d, m, a] = [+r[1], +r[2], +r[3]];
    return dataValida(a, m, d) ? { a, m, d } : null;
  }
  r = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (r) {
    const [a, m, d] = [+r[1], +r[2], +r[3]];
    return dataValida(a, m, d) ? { a, m, d } : null;
  }
  return null;
}

const chaveData = (dt) => dt.a * 10000 + dt.m * 100 + dt.d;
const doisDig = (n) => String(n).padStart(2, "0");
const dataBR = (dt) => `${doisDig(dt.d)}/${doisDig(dt.m)}/${dt.a}`;
const dataISO = (dt) => `${dt.a}-${doisDig(dt.m)}-${doisDig(dt.d)}`;

function hoje() {
  const h = new Date();
  return { a: h.getFullYear(), m: h.getMonth() + 1, d: h.getDate() };
}

function somarMeses(dt, meses) {
  const total = dt.m - 1 + meses;
  const a = dt.a + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12 + 1;
  return { a, m, d: Math.min(dt.d, diasNoMes(a, m)) };
}

function limitesDoMes(a, m) {
  return [{ a, m, d: 1 }, { a, m, d: diasNoMes(a, m) }];
}

// Parcelas mensais: [{data: "DD/MM/AAAA", descricao: "X 1/3"}, ...]
function gerarParcelas(dt, descricao, total) {
  const lista = [];
  for (let i = 0; i < total; i++) {
    lista.push({
      data: dataBR(somarMeses(dt, i)),
      descricao: total > 1 ? `${descricao} ${i + 1}/${total}` : descricao,
    });
  }
  return lista;
}

// ---------------------------------------------------------------- dinheiro
// No banco os valores são inteiros em centavos.
function numBR(reais) {
  return reais.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const brl = (reais) => `R$ ${numBR(reais)}`;

// "1.234,56" -> 123456 (centavos); vazio/inválido -> null
function lerCentavos(texto) {
  const digitos = String(texto || "").replace(/\D/g, "");
  return digitos ? parseInt(digitos, 10) : null;
}

// Máscara de valor: digitar 12345 vira "123,45"
function mascararMoeda(texto) {
  const c = lerCentavos(texto);
  return c === null ? "" : numBR(c / 100);
}

// ---------------------------------------------------------------- frações exatas
// Como o Fraction do Python: conta sem erro de arredondamento.
function mdc(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

class Fracao {
  constructor(n, d = 1n) {
    n = BigInt(n); d = BigInt(d);
    if (d < 0n) { n = -n; d = -d; }
    const g = mdc(n, d) || 1n;
    this.n = n / g; this.d = d / g;
  }
  mais(o) { return new Fracao(this.n * o.d + o.n * this.d, this.d * o.d); }
  vezes(o) { return new Fracao(this.n * o.n, this.d * o.d); }
}
const ZERO = new Fracao(0);

// Arredonda (em centavos) no padrão comercial: meio centavo vai para longe do zero.
function arredondarCentavos(f) {
  const abs = f.n < 0n ? -f.n : f.n;
  const inteiro = (2n * abs + f.d) / (2n * f.d);
  return Number(f.n < 0n ? -inteiro : inteiro);
}

// ---------------------------------------------------------------- cadastro de sócios
// socios: [{id, nome, entrada: Data, saida: Data|null}]
// percentuais: {nome: [{desde: Data, milesimos: inteiro (25% = 25000)}...] em ordem}
class Cadastro {
  constructor(linhasSocios, linhasPercentuais) {
    this.socios = linhasSocios.map((s) => ({
      id: s.id,
      nome: s.nome,
      entrada: paraData(s.data_entrada) || { a: 2000, m: 1, d: 1 },
      saida: paraData(s.data_saida),
    }));
    this.todos = this.socios.map((s) => s.nome);
    this.percentuais = {};
    for (const s of this.socios) this.percentuais[s.nome] = [];
    const nomePorId = new Map(this.socios.map((s) => [s.id, s.nome]));
    for (const p of linhasPercentuais || []) {
      const nome = nomePorId.get(p.socio_id);
      const desde = paraData(p.vigente_desde);
      if (nome && desde) {
        this.percentuais[nome].push({ desde, milesimos: Math.round(Number(p.percentual) * 1000) });
      }
    }
    for (const lista of Object.values(this.percentuais)) {
      lista.sort((x, y) => chaveData(x.desde) - chaveData(y.desde));
    }
  }

  ativosEm(dt) {
    const k = chaveData(dt);
    return this.socios
      .filter((s) => chaveData(s.entrada) <= k && (!s.saida || k <= chaveData(s.saida)))
      .map((s) => s.nome);
  }

  get ativosHoje() { return this.ativosEm(hoje()); }

  percentualEm(nome, dt) {
    let atual = null;
    for (const p of this.percentuais[nome] || []) {
      if (chaveData(p.desde) <= chaveData(dt)) atual = p.milesimos;
      else break;
    }
    return atual;
  }

  // Parte de cada participante (frações que somam 1). Sem percentual de alguém: divide igual.
  fracoesEm(participantes, dt) {
    const perc = participantes.map((p) => (dt ? this.percentualEm(p, dt) : null));
    const r = new Map();
    if (perc.every((v) => v !== null && v > 0)) {
      const total = perc.reduce((s, v) => s + v, 0);
      participantes.forEach((p, i) => r.set(p, new Fracao(perc[i], total)));
    } else {
      participantes.forEach((p) => r.set(p, new Fracao(1, participantes.length)));
    }
    return r;
  }
}

// ---------------------------------------------------------------- saldos
// Igual a Database.calcular_saldos: cada despesa/receita é dividida entre quem era sócio na
// data dela, pelos percentuais em vigor naquela data. Lançamentos depois do fim do mês
// corrente ficam de fora. Devolve {categoria: {sócio: reais}}.
function calcularSaldos(linhas, cadastro, referencia = hoje()) {
  const nomes = cadastro.todos;
  const limite = chaveData({ a: referencia.a, m: referencia.m, d: diasNoMes(referencia.a, referencia.m) });
  const conta = {};
  for (const c of CATEGORIAS) {
    conta[c] = {};
    for (const p of nomes) conta[c][p] = ZERO;   // em centavos
  }
  const somar = (c, p, f) => { conta[c][p] = conta[c][p].mais(f); };
  const ativosHoje = cadastro.ativosEm(referencia);

  for (const item of linhas) {
    const dt = paraData(item.data);
    if (dt && chaveData(dt) > limite) continue;
    const destinacao = item.destinacao;
    if (!CATEGORIAS.includes(destinacao)) continue;
    const pagador = (item.pagador || "").trim();
    const tipo = (item.tipo || "").trim().toLowerCase();
    const descricao = item.descricao || "";
    const valor = new Fracao(item.valores);

    // Ajustes manuais "... | AJUSTE: DE -> PARA": não entram no rateio
    if (descricao.includes("AJUSTE:")) {
      if (descricao.includes(" -> ")) {
        const partes = descricao.split(":");
        if (partes.length >= 2) {
          const lados = partes[1].split(" -> ");
          if (lados.length >= 2) {
            const de = lados[0].trim().toUpperCase();
            const para = lados[1].trim().toUpperCase();
            const quemDe = nomes.find((p) => p.toUpperCase() === de);
            const quemPara = nomes.find((p) => p.toUpperCase() === para);
            if (quemDe) somar(destinacao, quemDe, new Fracao(-valor.n, valor.d));
            if (quemPara) somar(destinacao, quemPara, valor);
          }
        }
      }
      continue;
    }

    const ehDespesa = (tipo === "despesa" || tipo === "débito") && !descricao.endsWith("​");
    const ehReceita = tipo === "receita" || tipo === "crédito";
    if (!ehDespesa && !ehReceita) continue;

    const socio = nomes.find((p) => p.toLowerCase() === pagador.toLowerCase());
    if (!socio) continue;   // ex.: "Manutenção - Fundo de Reserva"

    let participantes = dt ? cadastro.ativosEm(dt) : ativosHoje;
    if (!participantes.length) participantes = ativosHoje.length ? ativosHoje : [socio];

    const sinal = new Fracao(ehDespesa ? 1 : -1);
    somar(destinacao, socio, sinal.vezes(valor));                         // o que pagou
    for (const [p, fracao] of cadastro.fracoesEm(participantes, dt)) {   // menos a sua parte
      if (p in conta[destinacao]) somar(destinacao, p, sinal.vezes(valor).vezes(fracao).vezes(new Fracao(-1)));
    }
  }

  const r = {};
  for (const c of CATEGORIAS) {
    r[c] = {};
    for (const p of nomes) r[c][p] = arredondarCentavos(conta[c][p]) / 100;
  }
  return r;
}

// Saldo do fundo até hoje (créditos/receitas menos débitos/despesas), em reais.
function saldoFundoAteHoje(linhas, referencia = hoje()) {
  const limite = chaveData(referencia);
  let centavos = 0;
  for (const item of linhas) {
    if (item.destinacao !== "Fundo de Reserva") continue;
    if (!/^\s*\d{1,2}\/\d{1,2}\/\d{4}\s*$/.test(item.data || "")) continue;   // só DD/MM/AAAA, como no desktop
    const dt = paraData(item.data);
    if (!dt || chaveData(dt) > limite) continue;
    const tipo = item.tipo || "";   // como no desktop: sem tirar espaços
    if (["Receita", "Crédito", "receita", "crédito"].includes(tipo)) centavos += item.valores;
    else if (["Despesa", "Débito", "despesa", "débito"].includes(tipo)) centavos -= item.valores;
  }
  return centavos / 100;
}

// Quem paga quem para zerar os saldos (mesma ordem do app desktop).
function sugerirAcertos(saldos) {
  const devedores = Object.entries(saldos).filter(([, v]) => v < -0.05).map(([p, v]) => [p, -v]);
  const credores = Object.entries(saldos).filter(([, v]) => v > 0.05).map(([p, v]) => [p, v]);
  const sugestoes = [];
  while (devedores.length && credores.length) {
    const dev = devedores[0], cred = credores[0];
    const valor = Math.min(dev[1], cred[1]);
    if (valor > 0.05) sugestoes.push({ pagador: dev[0], recebedor: cred[0], valor });
    dev[1] -= valor; cred[1] -= valor;
    if (dev[1] <= 0.05) devedores.shift();
    if (cred[1] <= 0.05) credores.shift();
  }
  return sugestoes;
}

function iniciais(nome) {
  return nome.replace(/\//g, " ").split(/\s+/).filter(Boolean).slice(0, 2)
    .map((p) => p[0]).join("").toUpperCase();
}

// ---------------------------------------------------------------- fundo de reserva
// Só datas DD/MM/AAAA contam, como no desktop.
function dataDoBanco(texto) {
  return /^\s*\d{1,2}\/\d{1,2}\/\d{4}\s*$/.test(texto || "") ? paraData(texto) : null;
}

// Saldo do fundo antes do dia informado (linha "SALDO INICIAL"), em reais.
function saldoFundoAntesDe(linhas, dia) {
  const limite = chaveData(dia);
  let centavos = 0;
  for (const item of linhas) {
    if (item.destinacao !== "Fundo de Reserva") continue;
    const dt = dataDoBanco(item.data);
    if (!dt || chaveData(dt) >= limite) continue;
    const tipo = String(item.tipo || "").trim().toLowerCase();
    if (tipo === "receita" || tipo === "crédito") centavos += item.valores;
    else if (tipo === "despesa" || tipo === "débito") centavos -= item.valores;
  }
  return centavos / 100;
}

// ---------------------------------------------------------------- evolução dos gastos
const CATEGORIAS_GASTO = [
  { nome: "Condomínio", cor: "#3B82F6" },
  { nome: "Internet", cor: "#8B5CF6" },
  { nome: "Energia", cor: "#F59E0B" },
  { nome: "Outros", cor: "#EF4444" },
];
const MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

// Despesas dos 12 meses até o mês de referência, por categoria (em reais).
function gastosPorMes(linhas, refA, refM) {
  const agrupado = new Map();
  for (const item of linhas) {
    if (!String(item.tipo || "").toLowerCase().includes("despesa")) continue;
    const desc = String(item.descricao || "").toLowerCase();
    let cat = "Outros";
    if (desc.includes("condominio") || desc.includes("condomínio")) cat = "Condomínio";
    else if (desc.includes("internet")) cat = "Internet";
    else if (desc.includes("energia") || desc.includes("cemig")) cat = "Energia";
    const dt = dataDoBanco(item.data);
    if (!dt) continue;
    const chave = dt.a * 100 + dt.m;
    if (!agrupado.has(chave)) agrupado.set(chave, {});
    const g = agrupado.get(chave);
    g[cat] = (g[cat] || 0) + item.valores;
  }
  const meses = [];
  for (let i = 11; i >= 0; i--) {
    const x = somarMeses({ a: refA, m: refM, d: 1 }, -i);
    const g = agrupado.get(x.a * 100 + x.m) || {};
    const valores = {};
    let total = 0;
    for (const c of CATEGORIAS_GASTO) { valores[c.nome] = (g[c.nome] || 0) / 100; total += g[c.nome] || 0; }
    meses.push({ rotulo: `${MESES_CURTOS[x.m - 1]}/${String(x.a).slice(2)}`, valores, total: total / 100 });
  }
  return meses;
}

// ---------------------------------------------------------------- divisão (percentuais)
// 25000 milésimos -> "25"; 33333 -> "33,333"
function textoPercentual(milesimos) {
  return (milesimos / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",");
}
// "33,333" -> 33333; vazio/inválido -> null
function lerPercentual(texto) {
  const t = String(texto || "").replace("%", "").trim().replace(/\./g, "").replace(",", ".");
  if (!t || isNaN(Number(t))) return null;
  return Math.round(Number(t) * 1000);
}

Cadastro.prototype.divisaoEm = function (dt) {
  const r = {};
  for (const nome of this.ativosEm(dt)) r[nome] = this.percentualEm(nome, dt);
  return r;
};
Cadastro.prototype.divisaoOk = function (dt) {
  const divisao = this.divisaoEm(dt);
  const valores = Object.values(divisao);
  if (!valores.length || valores.some((v) => v === null)) return { ok: false, divisao };
  return { ok: Math.abs(valores.reduce((s, v) => s + v, 0) - 100000) <= 10, divisao };
};
Cadastro.prototype.situacao = function (s, dt = hoje()) {
  const k = chaveData(dt);
  if (chaveData(s.entrada) <= k && (!s.saida || k <= chaveData(s.saida))) return "Ativo";
  return chaveData(s.entrada) > k ? "A entrar" : "Saiu";
};
