/* 증권왕 — 플레이어 상태, 매매, 저장 */
(function (SK) {
  const KEY = 'jeunggwonwang.save.v3';
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
  G.assets = () => G.state.cash + G.state.deposit + G.holdingValue();
  G.netWorth = () => G.assets() - G.state.loan;
  G.rate = () => SK.interp(SK.RATES, G.world.t, false);
  G.loanRate = () => G.rate() + 0.04;
  G.marginRatio = () => (G.state.loan > 0 ? G.assets() / G.state.loan : Infinity);
  // 융자 직후 담보비율이 200% 이상이어야 한다
  G.maxBorrow = () => Math.max(0, Math.floor(G.assets() - 2 * G.state.loan));
  G.MARGIN_CALL = 1.4;
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
      v: 3, seed, name: name || '신입', startWeek, week: W.week, cash: cap, startCap: cap,
      startIndex: W.index, holdings: {}, rank: 0, nwHist: [cap], log: [], autoPause: true,
      orders: [], orderSeq: 0, deposit: 0, loan: 0, warned: false, bust: false, over: false, btcWeek: -1, btcBought: 0, month: SK.dateOf(W.week).getUTCMonth()
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
      return s && s.v === 3 ? s : null;
    } catch (e) { return null; }
  };
  G.load = function () {
    const s = G.peekSave();
    if (!s) return false;
    const W = (G.world = SK.createWorld(s.seed));
    while (W.week < s.week) W.step();
    s.deposit = s.deposit || 0; s.loan = s.loan || 0;
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
        S.deposit /= 10;
        S.loan /= 10;
        for (const id in S.holdings) S.holdings[id].avg /= 10;
        for (const o of S.orders) if (o.basis === 'price') o.value /= 10;
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
    S.deposit *= 1 + G.rate() / 52.18;
    if (S.loan > 0) S.loan *= 1 + G.loanRate() / 52.18;
    runOrders(out);
    marginCheck(out);
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

  /* 예금과 신용 융자 */
  function money(x, max, what) {
    x = Math.floor(x);
    if (!(x > 0)) return '금액을 입력하세요';
    if (x > max + 1e-6) return what;
    return null;
  }
  G.bankMax = (mode) => Math.floor({ in: G.state.cash, out: G.state.deposit, borrow: G.maxBorrow(), repay: Math.min(G.state.cash, Math.ceil(G.state.loan)) }[mode]);
  G.bank = function (mode, x) {
    const S = G.state;
    const err = money(x, G.bankMax(mode), { in: '현금이 부족합니다', out: '예금 잔액이 부족합니다', borrow: '융자 한도를 넘었습니다', repay: '갚을 수 있는 금액을 넘었습니다' }[mode]);
    if (err) return err;
    x = Math.floor(x);
    if (mode === 'in') { S.cash -= x; S.deposit += x; }
    else if (mode === 'out') { S.deposit -= x; S.cash += x; }
    else if (mode === 'borrow') { S.loan += x; S.cash += x; }
    else { S.cash -= x; S.loan = Math.max(0, S.loan - x); if (S.loan < 1) S.loan = 0; }
    log({ in: '예금 입금 ', out: '예금 출금 ', borrow: '신용 융자 ', repay: '융자 상환 ' }[mode] + SK.fmtMoney(x));
    G.save();
    return null;
  };

  // 담보비율(총자산 ÷ 융자금)이 140% 아래로 내려가면 반대매매
  function marginCheck(out) {
    const S = G.state;
    if (!(S.loan > 0)) { S.warned = false; return; }
    const ratio = G.marginRatio();
    if (ratio >= G.MARGIN_CALL) {
      if (ratio >= 1.6) S.warned = false;
      else if (!S.warned) {
        S.warned = true;
        out.notes.push('담보비율 ' + Math.round(ratio * 100) + '%. 140% 아래로 내려가면 반대매매됩니다');
        out.major = true;
      }
      return;
    }
    const pay = (from) => { const x = Math.min(S[from], S.loan); S[from] -= x; S.loan -= x; };
    pay('cash');
    pay('deposit');
    const ids = Object.keys(S.holdings).sort((a, b) => S.holdings[b].qty * G.world.byId[b].price - S.holdings[a].qty * G.world.byId[a].price);
    for (const id of ids) {
      if (S.loan < 1) break;
      const a = G.world.byId[id], need = S.loan / (a.price * (1 - FEE.sell));
      G.sell(id, Math.min(S.holdings[id].qty, a.kind === 'crypto' ? Math.ceil(need * 1e4) / 1e4 : Math.ceil(need)));
      pay('cash');
    }
    let note;
    if (S.loan >= 1) {
      S.bust = true;
      S.over = true;
      note = '깡통 계좌: 가진 것을 모두 팔고도 융자금을 갚지 못했습니다';
    } else {
      S.loan = 0;
      note = '반대매매: 담보비율이 140% 아래로 내려가 자산이 강제로 정리됐습니다';
    }
    S.warned = false;
    log(note);
    out.notes.push(note);
    out.major = true;
  }

  /* 조건 주문: 가격이 기준에 닿은 주에 그 주 가격으로 체결된다.
   * { id, asset, side: buy|sell, dir: below|above, basis: price|avg, value: 가격 또는 평단 대비 %, qty } */
  G.orderTrigger = function (o) {
    if (o.basis === 'price') return o.value;
    const h = G.state.holdings[o.asset];
    return h ? h.avg * (1 + ((o.dir === 'below' ? -1 : 1) * o.value) / 100) : null;
  };
  SK.orderText = function (o) {
    const a = G.world.byId[o.asset], T = G.orderTrigger(o);
    const base = o.basis === 'price' ? SK.fmtPx(o.value) : '평단 ' + (o.dir === 'below' ? '-' : '+') + o.value + '%' + (T === null ? '' : '(' + SK.fmtPx(T) + ')');
    return a.def.name + ' ' + base + (o.dir === 'below' ? ' 이하' : ' 이상') + '이면 ' + SK.fmtQty(o.qty, a) + (o.side === 'buy' ? ' 매수' : ' 매도');
  };
  G.addOrder = function (o) {
    const S = G.state, a = G.world.byId[o.asset], h = S.holdings[o.asset];
    o.qty = a.kind === 'crypto' ? r4(o.qty) : Math.floor(o.qty);
    if (!a.listed || a.dead) return '거래할 수 없는 종목입니다';
    if (!(o.value > 0)) return o.basis === 'price' ? '기준 가격을 입력하세요' : '평단 대비 몇 %인지 입력하세요';
    if (!(o.qty > 0)) return '수량을 입력하세요';
    if (o.basis === 'avg' && !h) return '평단 기준은 보유 중인 종목에만 걸 수 있습니다';
    if (o.basis === 'avg' && o.dir === 'below' && o.value >= 100) return '100%보다 작게 입력하세요';
    if (o.side === 'sell' && !h) return '보유 중인 종목에만 조건 매도를 걸 수 있습니다';
    if (S.orders.filter((x) => x.asset === o.asset).length >= 5) return '한 종목에 조건 주문은 5개까지입니다';
    o.id = ++S.orderSeq;
    S.orders.push(o);
    log('조건 주문 등록: ' + SK.orderText(o));
    G.save();
    return null;
  };
  G.cancelOrder = function (id) {
    const S = G.state, i = S.orders.findIndex((o) => o.id === id);
    if (i < 0) return;
    log('조건 주문 취소: ' + SK.orderText(S.orders[i]));
    S.orders.splice(i, 1);
    G.save();
  };
  function runOrders(out) {
    const S = G.state;
    for (const o of S.orders.slice()) {
      const a = G.world.byId[o.asset];
      const drop = () => S.orders.splice(S.orders.indexOf(o), 1);
      if (a.dead) { drop(); continue; }
      const T = G.orderTrigger(o);
      if (T === null) { drop(); log('조건 주문 취소: ' + a.def.name + ' (보유 수량 없음)'); continue; }
      if (o.dir === 'below' ? a.price > T : a.price < T) continue;
      const q = Math.min(o.qty, o.side === 'buy' ? G.maxBuy(a.id) : G.maxSell(a.id));
      drop();
      if (!(q > 0)) {
        const note = '조건 주문 취소: ' + a.def.name + (o.side === 'buy' ? ' (현금 부족)' : ' (보유 수량 없음)');
        log(note); out.notes.push(note);
        continue;
      }
      if (!(o.side === 'buy' ? G.buy(a.id, q) : G.sell(a.id, q))) {
        out.notes.push('조건 ' + (o.side === 'buy' ? '매수' : '매도') + ' 체결: ' + a.def.name + ' ' + SK.fmtQty(q, a) + ' @ ' + SK.fmtPx(a.price));
      }
    }
  }

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
