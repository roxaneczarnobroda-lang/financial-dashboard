import { useState, useEffect, useRef, useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, LineChart, Line, ComposedChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { storage } from "./storage.js";

const INK = "#1B2430";
const INK_SOFT = "#4A5568";
const PAPER = "#FAF8F3";
const CARD = "#FFFFFF";
const GOLD = "#B08D57";
const TEAL = "#3E6E64";
const CLAY = "#B5533C";
const SAND = "#E4DCC8";
const BORDER = "#E5E0D4";
const MAUVE = "#8B6F9E";

const fmt = (n) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);
const pct = (n) => `${((n || 0) * 100).toFixed(2)}%`;

// GBP balances below are converted at ~1 GBP = 1.1757 EUR (20 Jul 2026) and not
// live-updated — revisit if the rate moves a lot.
const DEFAULT_INPUTS = {
  trackingStart: new Date().toISOString().slice(0, 10),
  savings: {
    livretA: { balance: 25000, rate: 0.015 },
    // Placeholder rate — PEL rates are locked in at account opening and vary by
    // vintage, so this can't be looked up. Replace with your actual contract rate.
    pel: { balance: 61000, rate: 0.015 },
    isaPlum: { balance: 24419, rate: 0.027 }, // £20,770 AER 2.7%
  },
  etf: { current: 500, planned: 50000, plannedDate: "2026-09", expectedReturn: 0.07, volatility: 0.15 },
  moneyfarm: { balance: 17636, expectedReturn: 0.0378, volatility: 0.12 }, // £15,000
  pension: { balance: 77172, rate: 0.05, volatility: 0.1 }, // £65,639, rate is a rough estimate, see note below
  scpi: { invested: 0, expectedReturn: 0.045, volatility: 0.05 },
  reCurrent: { value: 0, loanPrincipal: 0, loanRate: 0.035, loanTermYears: 20 },
  reFuture: { enabled: false, price: 0, downPayment: 0, loanRate: 0.035, loanTermYears: 20, startYear: new Date().getFullYear() + 1 },
};

function useStoredInputs() {
  const [inputs, setInputs] = useState(DEFAULT_INPUTS);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        // Bumped key: the input shape changed (savings/moneyfarm/pension added),
        // so any older "fd-inputs" data is incompatible and deliberately ignored.
        const r = await storage.get("fd-inputs-v2");
        if (r?.value) setInputs(JSON.parse(r.value));
      } catch (e) {}
      setLoaded(true);
    })();
  }, []);
  const save = async (next) => {
    setInputs(next);
    try { await storage.set("fd-inputs-v2", JSON.stringify(next)); } catch (e) {}
  };
  return [inputs, save, loaded];
}

function Field({ label, value, onChange, suffix, type = "number", step = "any" }) {
  const [draft, setDraft] = useState(String(value));
  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) setDraft(String(value));
  }, [value]);

  const handleChange = (e) => {
    const raw = e.target.value;
    setDraft(raw);
    if (type !== "number") { onChange(raw); return; }
    // Let the user finish typing partial/intermediate values like "-", "0." or "1,"
    // before committing a parsed number back up — otherwise the controlled value
    // snaps back mid-keystroke and the decimal point can never be typed.
    if (raw === "" || raw === "-" || /[.,]$/.test(raw)) return;
    const parsed = parseFloat(raw.replace(",", "."));
    if (!Number.isNaN(parsed)) onChange(parsed);
  };

  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: INK_SOFT }}>
      {label}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type={type === "number" ? "text" : type}
          inputMode={type === "number" ? "decimal" : undefined}
          value={draft}
          onFocus={() => { editingRef.current = true; }}
          onBlur={() => { editingRef.current = false; setDraft(String(value)); }}
          onChange={handleChange}
          style={{
            width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${BORDER}`,
            fontSize: 14, color: INK, background: "#fff", fontFamily: "IBM Plex Mono, monospace"
          }}
        />
        {suffix && <span style={{ fontSize: 12, color: INK_SOFT, minWidth: 16 }}>{suffix}</span>}
      </div>
    </label>
  );
}

function Card({ children, style }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20, ...style }}>
      {children}
    </div>
  );
}

function computeTotals(inputs, includeFuture) {
  let invested = 0, borrowed = 0, value = 0;
  const savingsTotal = inputs.savings.livretA.balance + inputs.savings.pel.balance + inputs.savings.isaPlum.balance;
  invested += savingsTotal; value += savingsTotal;
  invested += inputs.etf.current; value += inputs.etf.current;
  invested += inputs.moneyfarm.balance; value += inputs.moneyfarm.balance;
  invested += inputs.pension.balance; value += inputs.pension.balance;
  invested += inputs.scpi.invested; value += inputs.scpi.invested;
  invested += inputs.reCurrent.value; value += inputs.reCurrent.value;
  borrowed += inputs.reCurrent.loanPrincipal;
  if (includeFuture) {
    invested += inputs.etf.planned;
    value += inputs.etf.planned;
    if (inputs.reFuture.enabled) {
      invested += inputs.reFuture.price;
      value += inputs.reFuture.price;
      borrowed += inputs.reFuture.price - inputs.reFuture.downPayment;
    }
  }
  const net = value - borrowed;
  return { invested, borrowed, value, net };
}

function allocationData(inputs, includeFuture) {
  const savingsTotal = inputs.savings.livretA.balance + inputs.savings.pel.balance + inputs.savings.isaPlum.balance;
  const etfAmt = inputs.etf.current + (includeFuture ? inputs.etf.planned : 0);
  const avLinxeaAmt = etfAmt + inputs.moneyfarm.balance;
  const reAmt = inputs.reCurrent.value + (includeFuture && inputs.reFuture.enabled ? inputs.reFuture.price : 0);
  const pensionAmt = inputs.pension.balance;

  const byClass = [
    { name: "Épargne", value: savingsTotal, color: SAND },
    { name: "AV (Linxea)", value: avLinxeaAmt, color: GOLD },
    { name: "SCPI", value: inputs.scpi.invested, color: TEAL },
    { name: "Immobilier", value: reAmt, color: CLAY },
    { name: "Pension", value: pensionAmt, color: MAUVE },
  ].filter((d) => d.value > 0);

  const liquid = savingsTotal + avLinxeaAmt;
  const illiquid = inputs.scpi.invested + reAmt + pensionAmt;
  const byLiquidity = [
    { name: "Liquide", value: liquid, color: GOLD },
    { name: "Illiquide", value: illiquid, color: TEAL },
  ].filter((d) => d.value > 0);

  const low = savingsTotal;
  const mid = inputs.scpi.invested + pensionAmt;
  const high = avLinxeaAmt + reAmt;
  const byRisk = [
    { name: "Faible", value: low, color: TEAL },
    { name: "Moyen", value: mid, color: GOLD },
    { name: "Elevé", value: high, color: CLAY },
  ].filter((d) => d.value > 0);

  return { byClass, byLiquidity, byRisk };
}

function MiniPie({ title, data }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div style={{ flex: 1, minWidth: 200 }}>
      <div style={{ fontSize: 13, color: INK_SOFT, marginBottom: 8, textAlign: "center" }}>{title}</div>
      {total === 0 ? (
        <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", color: INK_SOFT, fontSize: 12 }}>
          Pas encore de données
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2}>
              {data.map((d, i) => <Cell key={i} fill={d.color} stroke="#fff" strokeWidth={1} />)}
            </Pie>
            <Tooltip formatter={(v) => fmt(v)} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function remainingLoanBalance(principal, rate, termYears, k) {
  if (termYears <= 0) return 0;
  if (k <= 0) return principal;
  if (k >= termYears) return 0;
  if (rate === 0) return principal * (1 - k / termYears);
  const growth = Math.pow(1 + rate, termYears);
  const growthK = Math.pow(1 + rate, k);
  return (principal * (growth - growthK)) / (growth - 1);
}

function buildLiabilitySchedule(loans, years) {
  const schedule = new Array(years + 1).fill(0);
  for (let y = 0; y <= years; y++) {
    schedule[y] = loans.reduce((sum, loan) => {
      if (y < loan.startOffset) return sum;
      return sum + remainingLoanBalance(loan.principal, loan.rate, loan.termYears, y - loan.startOffset);
    }, 0);
  }
  return schedule;
}

function runMonteCarlo(inputs, years, includeFuture, sims = 500) {
  const currentYear = new Date().getFullYear();
  const reFutureOffset = Math.max(0, inputs.reFuture.startYear - currentYear);

  const assets = [];
  if (inputs.savings.livretA.balance > 0) assets.push({ v: inputs.savings.livretA.balance, r: inputs.savings.livretA.rate, vol: 0.001, startOffset: 0 });
  if (inputs.savings.pel.balance > 0) assets.push({ v: inputs.savings.pel.balance, r: inputs.savings.pel.rate, vol: 0.001, startOffset: 0 });
  if (inputs.savings.isaPlum.balance > 0) assets.push({ v: inputs.savings.isaPlum.balance, r: inputs.savings.isaPlum.rate, vol: 0.001, startOffset: 0 });
  if (inputs.etf.current > 0) assets.push({ v: inputs.etf.current, r: inputs.etf.expectedReturn, vol: inputs.etf.volatility, startOffset: 0 });
  if (includeFuture && inputs.etf.planned > 0) assets.push({ v: inputs.etf.planned, r: inputs.etf.expectedReturn, vol: inputs.etf.volatility, startOffset: 0 });
  if (inputs.moneyfarm.balance > 0) assets.push({ v: inputs.moneyfarm.balance, r: inputs.moneyfarm.expectedReturn, vol: inputs.moneyfarm.volatility, startOffset: 0 });
  if (inputs.pension.balance > 0) assets.push({ v: inputs.pension.balance, r: inputs.pension.rate, vol: inputs.pension.volatility, startOffset: 0 });
  if (inputs.scpi.invested > 0) assets.push({ v: inputs.scpi.invested, r: inputs.scpi.expectedReturn, vol: inputs.scpi.volatility, startOffset: 0 });
  if (inputs.reCurrent.value > 0) assets.push({ v: inputs.reCurrent.value, r: 0.02, vol: 0.06, startOffset: 0 });
  if (includeFuture && inputs.reFuture.enabled && inputs.reFuture.price > 0) {
    assets.push({ v: inputs.reFuture.price, r: 0.02, vol: 0.06, startOffset: reFutureOffset });
  }

  if (assets.length === 0) return [];

  // Debt is deterministic (fixed-rate amortization), unlike asset returns, so it's
  // computed once as a schedule and subtracted from each simulated path rather than
  // simulated itself. reCurrent's balance is treated as the current outstanding
  // amount amortizing over the stated remaining term; reFuture's loan starts, at
  // full principal, in the year the property is bought (startYear).
  const loans = [];
  if (inputs.reCurrent.loanPrincipal > 0) {
    loans.push({ principal: inputs.reCurrent.loanPrincipal, rate: inputs.reCurrent.loanRate, termYears: inputs.reCurrent.loanTermYears, startOffset: 0 });
  }
  if (includeFuture && inputs.reFuture.enabled && inputs.reFuture.price - inputs.reFuture.downPayment > 0) {
    loans.push({ principal: inputs.reFuture.price - inputs.reFuture.downPayment, rate: inputs.reFuture.loanRate, termYears: inputs.reFuture.loanTermYears, startOffset: reFutureOffset });
  }
  const liabilitySchedule = buildLiabilitySchedule(loans, years);

  function gauss() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // Lognormal shock keeps values positive and compounds correctly, unlike a plain
  // arithmetic shock which can drive an asset negative in one bad draw and then
  // oscillate nonsensically from there.
  function shock(a) {
    return Math.exp(a.r - (a.vol * a.vol) / 2 + a.vol * gauss());
  }

  const paths = [];
  for (let s = 0; s < sims; s++) {
    // null = not yet acquired (a future asset before its startOffset)
    let vals = assets.map((a) => (a.startOffset > 0 ? null : a.v));
    const yearly = [vals.reduce((sum, v) => sum + (v || 0), 0)];
    for (let y = 1; y <= years; y++) {
      vals = vals.map((v, i) => {
        const a = assets[i];
        if (v === null) return y === a.startOffset ? a.v : null;
        return v * shock(a);
      });
      yearly.push(vals.reduce((sum, v) => sum + (v || 0), 0));
    }
    paths.push(yearly);
  }

  const result = [];
  for (let y = 0; y <= years; y++) {
    const col = paths.map((p) => p[y] - liabilitySchedule[y]).sort((a, b) => a - b);
    result.push({
      year: currentYear + y,
      p10: col[Math.floor(sims * 0.1)],
      p50: col[Math.floor(sims * 0.5)],
      p90: col[Math.floor(sims * 0.9)],
    });
  }
  return result;
}

function Toggle({ checked, onChange, label }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: INK }}>
      <span style={{
        position: "relative", width: 36, height: 20, borderRadius: 10,
        background: checked ? GOLD : BORDER, transition: "background 0.15s"
      }}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
          style={{ position: "absolute", opacity: 0, width: "100%", height: "100%", cursor: "pointer", margin: 0 }} />
        <span style={{
          position: "absolute", top: 2, left: checked ? 18 : 2, width: 16, height: 16,
          borderRadius: "50%", background: "#fff", transition: "left 0.15s", boxShadow: "0 1px 2px rgba(0,0,0,0.2)"
        }} />
      </span>
      {label}
    </label>
  );
}

export default function FinancialDashboard() {
  const [inputs, saveInputs, loaded] = useStoredInputs();
  const [tab, setTab] = useState("overview");
  const [includeFuture, setIncludeFuture] = useState(false);
  const [history, setHistory] = useState([]);
  const [horizon, setHorizon] = useState(25);
  const [messages, setMessages] = useState([{ role: "assistant", content: "Bonjour Roxane. Je peux répondre à des questions sur ton patrimoine actuel — allocation, rentabilité, ce que change le scénario futur. Que veux-tu savoir ?" }]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [reflectionStage, setReflectionStage] = useState(null);
  const chatEndRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await storage.get("fd-history");
        if (r?.value) setHistory(JSON.parse(r.value));
      } catch (e) {}
    })();
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const totals = useMemo(() => computeTotals(inputs, includeFuture), [inputs, includeFuture]);
  const alloc = useMemo(() => allocationData(inputs, includeFuture), [inputs, includeFuture]);
  const mc = useMemo(() => runMonteCarlo(inputs, horizon, includeFuture), [inputs, horizon, includeFuture]);

  const saveSnapshot = async () => {
    const snap = { date: new Date().toISOString().slice(0, 10), invested: totals.invested, value: totals.value, borrowed: totals.borrowed };
    const next = [...history.filter((h) => h.date !== snap.date), snap];
    setHistory(next);
    try { await storage.set("fd-history", JSON.stringify(next)); } catch (e) {}
  };

  const set = (path, val) => {
    const next = JSON.parse(JSON.stringify(inputs));
    const keys = path.split(".");
    let obj = next;
    for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
    obj[keys[keys.length - 1]] = val;
    saveInputs(next);
  };

  const refresh = () => { saveSnapshot(); };

  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = { role: "user", content: chatInput };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setChatInput("");
    setChatLoading(true);
    setReflectionStage("draft");
    const context = `Contexte patrimoine de Roxane (chiffres actuels):
- Épargne — Livret A: ${fmt(inputs.savings.livretA.balance)} (taux ${pct(inputs.savings.livretA.rate)}), PEL: ${fmt(inputs.savings.pel.balance)} (taux ${pct(inputs.savings.pel.rate)}), ISA (Plum): ${fmt(inputs.savings.isaPlum.balance)} (AER ${pct(inputs.savings.isaPlum.rate)})
- AV (Linxea) — ETF: ${fmt(inputs.etf.current)} actuel (rendement attendu ${pct(inputs.etf.expectedReturn)}), ${fmt(inputs.etf.planned)} prévu (${inputs.etf.plannedDate}), Moneyfarm: ${fmt(inputs.moneyfarm.balance)} (rendement attendu ${pct(inputs.moneyfarm.expectedReturn)})
- Pension (Standard Life, Trust Based): ${fmt(inputs.pension.balance)} (rendement estimé ${pct(inputs.pension.rate)})
- SCPI: ${fmt(inputs.scpi.invested)} (rendement attendu ${pct(inputs.scpi.expectedReturn)})
- Immobilier actuel: ${fmt(inputs.reCurrent.value)}, emprunt ${fmt(inputs.reCurrent.loanPrincipal)} (taux ${pct(inputs.reCurrent.loanRate)}, durée ${inputs.reCurrent.loanTermYears} ans)
- Scénario futur immobilier: ${inputs.reFuture.enabled ? `${fmt(inputs.reFuture.price)} (apport ${fmt(inputs.reFuture.downPayment)}, taux ${pct(inputs.reFuture.loanRate)}, achat prévu ${inputs.reFuture.startYear})` : "désactivé"}
- Total investi (${includeFuture ? "avec" : "sans"} futur): ${fmt(totals.invested)}
- Valeur totale: ${fmt(totals.value)}
- Emprunté: ${fmt(totals.borrowed)}
- Net: ${fmt(totals.net)}
Réponds en français, de façon concise et factuelle, basé uniquement sur ces chiffres. Précise quand une question dépasse ce contexte.`;
    try {
      // Proxied through our own /api/chat serverless function, which holds the
      // Anthropic API key server-side — the browser never sees it.
      const callClaude = async (msgs, sys) => {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ system: sys, messages: msgs }),
        });
        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const data = await response.json();
        return data.text || "";
      };

      // Step 1: draft
      const draft = await callClaude(nextMessages.map((m) => ({ role: m.role, content: m.content })), context);
      setReflectionStage("critique");

      // Step 2: self-critique + revise in one call, checked against the same numeric context
      const critiquePrompt = `Voici ta réponse provisoire à la dernière question:\n\n"${draft}"\n\nRelis-la par rapport aux chiffres du contexte ci-dessus. Vérifie: (1) chaque chiffre cité correspond exactement au contexte, (2) tu ne présentes pas les projections Monte Carlo comme des certitudes, (3) la réponse reste concise et factuelle. Si elle est déjà correcte, renvoie-la telle quelle. Sinon, renvoie une version corrigée. Réponds uniquement avec la réponse finale, sans commentaire sur la révision elle-même.`;
      const revised = await callClaude(
        [...nextMessages.map((m) => ({ role: m.role, content: m.content })), { role: "assistant", content: draft }, { role: "user", content: critiquePrompt }],
        context
      );

      const finalText = revised || draft || "Désolé, je n'ai pas pu générer de réponse.";
      setMessages((m) => [...m, { role: "assistant", content: finalText, draft: draft !== finalText ? draft : undefined }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: "Erreur de connexion à l'API." }]);
    }
    setReflectionStage(null);
    setChatLoading(false);
  };

  const tabs = [
    { id: "overview", label: "Vue d'ensemble" },
    { id: "dashboard", label: "Répartition" },
    { id: "history", label: "Historique" },
    { id: "predictions", label: "Projections" },
    { id: "counselor", label: "Conseiller IA" },
  ];

  if (!loaded) return null;

  return (
    <div style={{ fontFamily: "Inter, sans-serif", background: PAPER, minHeight: "100%", padding: "24px 16px", color: INK }}>
      <div style={{ maxWidth: 920, margin: "0 auto" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontFamily: "Fraunces, serif", fontSize: 26, fontWeight: 500, letterSpacing: "-0.01em" }}>Patrimoine</div>
            <div style={{ fontSize: 12, color: INK_SOFT }}>Suivi depuis {inputs.trackingStart}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Toggle checked={includeFuture} onChange={setIncludeFuture} label="Inclure le futur" />
            <button onClick={refresh} style={{
              padding: "8px 14px", borderRadius: 8, border: `1px solid ${INK}`, background: INK, color: "#fff",
              fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6
            }}>
              <i className="ti ti-refresh" style={{ fontSize: 14 }} /> Actualiser
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: `1px solid ${BORDER}`, flexWrap: "wrap" }}>
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "10px 14px", background: "none", border: "none", cursor: "pointer",
              fontSize: 13, color: tab === t.id ? INK : INK_SOFT,
              borderBottom: tab === t.id ? `2px solid ${GOLD}` : "2px solid transparent",
              fontWeight: tab === t.id ? 500 : 400
            }}>{t.label}</button>
          ))}
        </div>

        {tab === "overview" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
              {[
                { label: "Investi", value: totals.invested, color: INK },
                { label: "Emprunté", value: totals.borrowed, color: CLAY },
                { label: "Valeur totale", value: totals.value, color: TEAL },
                { label: "Net", value: totals.net, color: GOLD },
              ].map((m) => (
                <Card key={m.label}>
                  <div style={{ fontSize: 12, color: INK_SOFT, marginBottom: 6 }}>{m.label}</div>
                  <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 22, color: m.color }}>{fmt(m.value)}</div>
                </Card>
              ))}
            </div>

            <Card style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>Épargne</div>

              <div style={{ fontSize: 12, fontWeight: 500, color: INK_SOFT, marginBottom: 8 }}>Livret A</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <Field label="Solde" value={inputs.savings.livretA.balance} onChange={(v) => set("savings.livretA.balance", v)} suffix="€" />
                <Field label="Taux annuel" value={inputs.savings.livretA.rate} onChange={(v) => set("savings.livretA.rate", v)} step="0.001" />
              </div>

              <div style={{ fontSize: 12, fontWeight: 500, color: INK_SOFT, marginBottom: 8 }}>PEL</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <Field label="Solde" value={inputs.savings.pel.balance} onChange={(v) => set("savings.pel.balance", v)} suffix="€" />
                <Field label="Taux annuel" value={inputs.savings.pel.rate} onChange={(v) => set("savings.pel.rate", v)} step="0.001" />
              </div>

              <div style={{ fontSize: 12, fontWeight: 500, color: INK_SOFT, marginBottom: 8 }}>ISA (Plum)</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Solde" value={inputs.savings.isaPlum.balance} onChange={(v) => set("savings.isaPlum.balance", v)} suffix="€" />
                <Field label="Taux annuel (AER)" value={inputs.savings.isaPlum.rate} onChange={(v) => set("savings.isaPlum.rate", v)} step="0.001" />
              </div>
            </Card>

            <Card style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>AV (Linxea)</div>

              <div style={{ fontSize: 12, fontWeight: 500, color: INK_SOFT, marginBottom: 8 }}>ETF</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <Field label="Montant actuel" value={inputs.etf.current} onChange={(v) => set("etf.current", v)} suffix="€" />
                <Field label="Montant prévu" value={inputs.etf.planned} onChange={(v) => set("etf.planned", v)} suffix="€" />
                <Field label="Date prévue" type="text" value={inputs.etf.plannedDate} onChange={(v) => set("etf.plannedDate", v)} />
                <Field label="Rendement attendu" value={inputs.etf.expectedReturn} onChange={(v) => set("etf.expectedReturn", v)} step="0.001" />
              </div>

              <div style={{ fontSize: 12, fontWeight: 500, color: INK_SOFT, marginBottom: 8 }}>Moneyfarm</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Montant" value={inputs.moneyfarm.balance} onChange={(v) => set("moneyfarm.balance", v)} suffix="€" />
                <Field label="Rendement attendu" value={inputs.moneyfarm.expectedReturn} onChange={(v) => set("moneyfarm.expectedReturn", v)} step="0.001" />
              </div>
            </Card>

            <Card style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Pension</div>
              <div style={{ fontSize: 12, color: INK_SOFT, marginBottom: 12 }}>Standard Life — Trust Based Pension</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Solde" value={inputs.pension.balance} onChange={(v) => set("pension.balance", v)} suffix="€" />
                <Field label="Rendement attendu (estimation)" value={inputs.pension.rate} onChange={(v) => set("pension.rate", v)} step="0.001" />
              </div>
            </Card>

            <Card style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>SCPI</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Montant investi" value={inputs.scpi.invested} onChange={(v) => set("scpi.invested", v)} suffix="€" />
                <Field label="Rendement attendu" value={inputs.scpi.expectedReturn} onChange={(v) => set("scpi.expectedReturn", v)} step="0.001" />
              </div>
            </Card>

            <Card style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>Immobilier actuel</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Valeur estimée" value={inputs.reCurrent.value} onChange={(v) => set("reCurrent.value", v)} suffix="€" />
                <Field label="Capital emprunté" value={inputs.reCurrent.loanPrincipal} onChange={(v) => set("reCurrent.loanPrincipal", v)} suffix="€" />
                <Field label="Taux du prêt" value={inputs.reCurrent.loanRate} onChange={(v) => set("reCurrent.loanRate", v)} step="0.001" />
                <Field label="Durée (années)" value={inputs.reCurrent.loanTermYears} onChange={(v) => set("reCurrent.loanTermYears", v)} />
              </div>
            </Card>

            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>Immobilier — scénario futur</div>
                <Toggle checked={inputs.reFuture.enabled} onChange={(v) => set("reFuture.enabled", v)} label="Activer" />
              </div>
              {inputs.reFuture.enabled && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Prix du bien" value={inputs.reFuture.price} onChange={(v) => set("reFuture.price", v)} suffix="€" />
                  <Field label="Apport" value={inputs.reFuture.downPayment} onChange={(v) => set("reFuture.downPayment", v)} suffix="€" />
                  <Field label="Taux du prêt" value={inputs.reFuture.loanRate} onChange={(v) => set("reFuture.loanRate", v)} step="0.001" />
                  <Field label="Année de début" value={inputs.reFuture.startYear} onChange={(v) => set("reFuture.startYear", v)} />
                </div>
              )}
            </Card>
          </div>
        )}

        {tab === "dashboard" && (
          <Card>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              <MiniPie title="Par classe d'actif" data={alloc.byClass} />
              <MiniPie title="Par liquidité" data={alloc.byLiquidity} />
              <MiniPie title="Par niveau de risque" data={alloc.byRisk} />
            </div>
          </Card>
        )}

        {tab === "history" && (
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>Évolution annuelle</div>
              <button onClick={saveSnapshot} style={{
                padding: "6px 12px", borderRadius: 6, border: `1px solid ${BORDER}`, background: "#fff",
                fontSize: 12, cursor: "pointer"
              }}>Enregistrer un point</button>
            </div>
            {history.length === 0 ? (
              <div style={{ fontSize: 13, color: INK_SOFT, padding: "24px 0", textAlign: "center" }}>
                Pas encore d'historique. Clique sur "Enregistrer un point" à chaque actualisation pour commencer à construire ta courbe.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={history}>
                  <CartesianGrid stroke={BORDER} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v) => fmt(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="value" name="Valeur totale" stroke={GOLD} strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="invested" name="Investi" stroke={TEAL} strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="borrowed" name="Emprunté" stroke={CLAY} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Card>
        )}

        {tab === "predictions" && (
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>Simulation Monte Carlo — {horizon} ans</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: INK_SOFT }}>Horizon</span>
                <input type="range" min="20" max="30" value={horizon} onChange={(e) => setHorizon(parseInt(e.target.value))} />
                <span style={{ fontSize: 12, fontFamily: "IBM Plex Mono, monospace" }}>{horizon} ans</span>
              </div>
            </div>
            <div style={{ fontSize: 12, color: INK_SOFT, marginBottom: 12 }}>
              Patrimoine net projeté (actifs moins emprunts en cours ou à venir), basé sur des hypothèses de rendement/volatilité par actif — pas sur un historique réel, à affiner au fil du temps.
            </div>
            {mc.length === 0 ? (
              <div style={{ fontSize: 13, color: INK_SOFT, padding: "24px 0", textAlign: "center" }}>Ajoute des montants dans "Vue d'ensemble" pour voir une projection.</div>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={mc}>
                  <CartesianGrid stroke={BORDER} strokeDasharray="3 3" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v) => fmt(v)} />
                  <Area type="monotone" dataKey="p90" stroke="none" fill={GOLD} fillOpacity={0.15} />
                  <Area type="monotone" dataKey="p10" stroke="none" fill={CARD} fillOpacity={1} />
                  <Line type="monotone" dataKey="p50" stroke={INK} strokeWidth={2} dot={false} name="Médiane" />
                  <Line type="monotone" dataKey="p90" stroke={GOLD} strokeWidth={1} dot={false} name="90e percentile" strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="p10" stroke={CLAY} strokeWidth={1} dot={false} name="10e percentile" strokeDasharray="4 4" />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </Card>
        )}

        {tab === "counselor" && (
          <Card style={{ display: "flex", flexDirection: "column", height: 480 }}>
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, paddingRight: 4 }}>
              {messages.map((m, i) => (
                <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "80%" }}>
                  <div style={{
                    background: m.role === "user" ? INK : SAND,
                    color: m.role === "user" ? "#fff" : INK,
                    padding: "8px 12px", borderRadius: 10, fontSize: 13, lineHeight: 1.5
                  }}>{m.content}</div>
                  {m.draft && <div style={{ fontSize: 10, color: INK_SOFT, marginTop: 3 }}>révisé après relecture</div>}
                </div>
              ))}
              {chatLoading && (
                <div style={{ fontSize: 12, color: INK_SOFT }}>
                  {reflectionStage === "draft" ? "rédaction..." : "relecture et correction..."}
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12, borderTop: `1px solid ${BORDER}`, paddingTop: 12 }}>
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendChat()}
                placeholder="Pose une question sur ton patrimoine..."
                style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 13 }}
              />
              <button onClick={sendChat} disabled={chatLoading} style={{
                padding: "10px 16px", borderRadius: 8, border: "none", background: INK, color: "#fff",
                fontSize: 13, cursor: "pointer"
              }}>Envoyer</button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
