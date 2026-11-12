/* 증권왕 — 플레이어 상태, 매매, 저장 */
(function (SK) {
  const KEY = 'jeunggwonwang.save.v2';
  const FEE = { buy: 0.001, sell: 0.003 }; // 매도에는 거래세 포함
  const G = { state: null, world: null, FEE };

  const roundSig = (v, n) => {
    if (v <= 0) return 0;
    const m = Math.pow(10, Math.floor(Math.log10(v)) - n + 1);
    return Math.round(v / m) * m;
  };
  const r4 = (q) => Math.round(q * 1e4) / 1e4;

  G.unitMult = () => (G.world.unit === '환' ? 10 : 1);
  G.scale = () => SK.cpi(G.world.t) * G.unitMult();
  G.startCapitalFor = (year) => {
    const t = Math.max(year, 1956.17);
    return roundSig(1e7 * SK.cpi(t) * (t < SK.REFORM_T ? 10 : 1), 2);
  };

  G.holdingValue = () => {
    let v = 0;
    for (const id in G.state.holdings) v += G.state.holdings[id].qty * G.world.byId[id].price;
    return v;
  };
  G.netWorth = () => G.state.cash + G.holdingValue();
  G.realWorth = () => G.netWorth() / G.scale(); // 2026년 원화 가치
  G.salary = () => roundSig(SK.RANKS[G.state.rank].pay * G.scale(), 2);
  G.news = () => G.world.news.filter((n) => n.week >= G.state.startWeek);

  function log(text) {
    G.state.log.unshift({ week: G.world.week, text });
    if (G.state.log.length > 60) G.state.log.length = 60;
  }

  G.newGame = function (year, name) {
    const seed = (Math.random() * 4294967296) >>> 0;
    const W = (G.world = SK.createWorld(seed));
    const startWeek = SK.weekOfDate(year, 1, 2);
    while (W.week < startWeek) W.step();
    const cap = G.startCapitalFor(year);
    G.state = {
      v: 2, seed, name: name || '신입', startWeek, week: W.week, cash: cap, startCap: cap,
      startIndex: W.index, holdings: {}, rank: 0, nwHist: [cap], log: [], autoPause: true,
      over: false, btcWeek: -1, btcBought: 0, month: SK.dateOf(W.week).getUTCMonth()
    };
    log(year + '년, 증권사 입사. 종잣돈 ' + SK.fmtMoney(cap));
    G.save();
  };

  G.save = function () {
    try {
      G.state.week = G.world.week;
      localStorage.setItem(KEY, JSON.stringify(G.state));
    } catch (e) { /* 저장소를 못 쓰는 환경에서는 저장 없이 진행 */ }
  };
  G.peekSave = function () {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      return s && s.v === 2 ? s : null;
    } catch (e) { return null; }
  };
  G.load = function () {
    const s = G.peekSave();
    if (!s) return false;
    const W = (G.world = SK.createWorld(s.seed));
    while (W.week < s.week) W.step();
    G.state = s;
    return true;
  };
  G.clearSave = function () {
    try { localStorage.removeItem(KEY); } catch (e) { /* 무시 */ }
  };

  // 한 주 진행. 화면에 알릴 내용을 돌려준다.
  G.tick = function () {
    const S = G.state, W = G.world;
    const out = { news: [], notes: [], major: false };
    if (S.over) return out;
    const evts = W.step();
    for (const e of evts) {
      if (e.type === 'news') {
        out.news.push(e.news);
        if (e.news.major) out.major = true;
      } else if (e.type === 'reform') {
        S.cash /= 10;
        S.startCap /= 10;
        S.nwHist = S.nwHist.map((v) => v / 10);
        for (const id in S.holdings) S.holdings[id].avg /= 10;
        log('화폐개혁: 보유 현금과 단가가 10분의 1 숫자로 바뀌었다');
      } else if (e.type === 'end') {
        const h = S.holdings[e.asset.id];
        if (h) {
          const got = h.qty * e.asset.price;
          S.cash += got;
          delete S.holdings[e.asset.id];
          const note = e.asset.def.name + ' ' + SK.fmtQty(h.qty, e.asset) + ' 정리, ' + SK.fmtMoney(got) + ' 입금';
          log(note);
          out.notes.push(note);
        }
      }
    }
    const month = SK.dateOf(W.week).getUTCMonth();
    if (month !== S.month) {
      S.month = month;
      S.cash += G.salary();
    }
    const real = G.realWorth();
    let rank = S.rank;
    while (rank < SK.RANKS.length - 1 && real >= SK.RANKS[rank + 1].min) rank++;
    if (rank > S.rank) {
      S.rank = rank;
      const note = SK.RANKS[rank].name + ' 승진';
      log(note + ' (순자산 ' + SK.fmtMoney(G.netWorth()) + ')');
      out.notes.push(note);
      out.major = true;
    }
    S.nwHist.push(G.netWorth());
    if (W.week >= SK.END_WEEK) S.over = true;
    if (S.over || W.week % 4 === 0) G.save();
    return out;
  };

  G.btcLeft = function () {
    const cap = SK.btcCap(G.world.t);
    if (cap === Infinity) return Infinity;
    const used = G.state.btcWeek === G.world.week ? G.state.btcBought : 0;
    return Math.max(0, cap - used);
  };

  G.maxBuy = function (id) {
    const a = G.world.byId[id];
    let q = G.state.cash / (a.price * (1 + FEE.buy));
    if (a.kind === 'crypto') return Math.max(0, Math.floor(Math.min(q, G.btcLeft()) * 1e4) / 1e4);
    return Math.max(0, Math.floor(q));
  };
  G.maxSell = (id) => (G.state.holdings[id] ? G.state.holdings[id].qty : 0);

  G.buy = function (id, qty) {
    const S = G.state, a = G.world.byId[id];
    qty = a.kind === 'crypto' ? r4(qty) : Math.floor(qty);
    if (!(qty > 0)) return '수량을 입력하세요';
    if (!a.listed || a.dead) return '거래할 수 없는 종목입니다';
    if (qty > G.maxBuy(id) + 1e-9) return a.kind === 'crypto' && qty > G.btcLeft() ? '이번 주에 살 수 있는 물량을 넘었습니다' : '현금이 부족합니다';
    const cost = qty * a.price;
    S.cash -= cost * (1 + FEE.buy);
    const h = S.holdings[id] || (S.holdings[id] = { qty: 0, avg: 0 });
    h.avg = (h.avg * h.qty + cost) / (h.qty + qty);
    h.qty = r4(h.qty + qty);
    if (a.kind === 'crypto') {
      if (S.btcWeek !== G.world.week) { S.btcWeek = G.world.week; S.btcBought = 0; }
      S.btcBought += qty;
    }
    log('매수 ' + a.def.name + ' ' + SK.fmtQty(qty, a) + ' @ ' + SK.fmtPx(a.price));
    G.save();
    return null;
  };

  G.sell = function (id, qty) {
    const S = G.state, a = G.world.byId[id], h = S.holdings[id];
    qty = a.kind === 'crypto' ? r4(qty) : Math.floor(qty);
    if (!(qty > 0)) return '수량을 입력하세요';
    if (!h || qty > h.qty + 1e-9) return '보유 수량이 부족합니다';
    const got = qty * a.price * (1 - FEE.sell);
    S.cash += got;
    const pnl = (a.price - h.avg) * qty;
    h.qty = r4(h.qty - qty);
    if (h.qty < 1e-6) delete S.holdings[id];
    log('매도 ' + a.def.name + ' ' + SK.fmtQty(qty, a) + ' @ ' + SK.fmtPx(a.price) + ' (손익 ' + (pnl >= 0 ? '+' : '') + SK.fmtMoney(pnl) + ')');
    G.save();
    return null;
  };

  SK.Game = G;
})(window.SK);
