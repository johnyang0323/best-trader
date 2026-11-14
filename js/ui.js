/* 증권왕 — 화면 */
(function (SK) {
  const G = SK.Game;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- 표기 ---------- */
  const unit = () => (G.world ? G.world.unit : '원');
  const comma = (n) => Math.floor(n).toLocaleString('en-US');
  SK.fmtMoney = function (v, u) {
    u = u || unit();
    const neg = v < 0;
    v = Math.abs(v);
    let s;
    if (v >= 1e12) { const e = Math.floor((v % 1e12) / 1e8); s = comma(v / 1e12) + '조' + (e ? ' ' + comma(e) + '억' : ''); }
    else if (v >= 1e8) { const m = Math.floor((v % 1e8) / 1e4); s = comma(v / 1e8) + '억' + (m ? ' ' + comma(m) + '만' : ''); }
    else if (v >= 1e6) s = comma(v / 1e4) + '만';
    else s = comma(Math.round(v));
    return (neg ? '-' : '') + s + u;
  };
  SK.fmtPx = (p) => (p >= 100 ? comma(Math.round(p)) : p >= 10 ? p.toFixed(1) : p.toFixed(2));
  SK.fmtQty = (q, a) => (a.kind === 'crypto' ? (+q.toFixed(4)).toLocaleString('en-US', { maximumFractionDigits: 4 }) + ' BTC' : comma(q) + '주');
  const fmtPct = (r) => (r >= 0 ? '+' : '') + (Math.abs(r) >= 10 ? comma(r * 100) : (r * 100).toFixed(Math.abs(r) >= 1 ? 0 : 1)) + '%';
  const fmtDate = (w) => { const d = SK.dateOf(w); return d.getUTCFullYear() + '.' + String(d.getUTCMonth() + 1).padStart(2, '0') + '.' + String(d.getUTCDate()).padStart(2, '0'); };
  const pct1 = (r) => (r * 100).toFixed(1) + '%';
  const cls = (r) => (r > 0 ? 'up' : r < 0 ? 'down' : '');
  const eraOf = (y) => SK.ERAS.find((e) => y >= e.from && y <= e.to) || SK.ERAS[SK.ERAS.length - 1];
  const weekChg = (a) => { const h = a.hist, n = h.length; return n > 1 ? h[n - 1] / h[n - 2] - 1 : 0; };

  /* ---------- 상태 ---------- */
  let playing = false, speed = 1, timer = null, tab = 'market';
  let sheetId = null, sheetRange = 156, sheetMode = 'buy', sheetQty = '', sheetErr = '', resume = false;
  let sSide = 'short', futureMode = 'random';
  const C_SIDES = [['sell', '조건 매도'], ['buy', '조건 매수'], ['short', '조건 공매도'], ['cover', '조건 환매수']];
  const C_DIR = { sell: 'below', buy: 'above', short: 'below', cover: 'above' }; // 기본 방향: 손절·추격 매수·하락 추격·공매도 손절
  let cSide = 'sell', cDir = 'below', cBasis = 'price', cVal = '', cQty = '';
  let seenNews = 0;
  const DELAY = { 1: 900, 4: 225, 16: 56 };

  /* ---------- 시작 화면 ---------- */
  function renderEra() {
    const y = +$('#year').value;
    $('#year-num').textContent = y;
    const era = eraOf(y), t = Math.max(y, 1956.17);
    const cap = G.startCapitalFor(y), u = t < SK.REFORM_T ? '환' : '원';
    const listed = SK.ASSETS.filter((a) => a.listT <= t && !(a.end && a.end.t <= t) && a.kind !== 'crypto').length;
    const btc = y >= 2010 ? '거래 가능' : y === 2009 ? '1월 등장' : (2009 - y) + '년 뒤 등장';
    $('#era').innerHTML =
      '<h2>' + esc(era.name) + '</h2><p>' + esc(era.desc) + '</p>' +
      '<dl class="era-facts">' +
      '<div><dt>종잣돈</dt><dd>' + SK.fmtMoney(cap, u) + '</dd></div>' +
      '<div><dt>종합지수</dt><dd>' + SK.fmtPx(SK.indexAnchor(t)) + '</dd></div>' +
      '<div><dt>상장 종목</dt><dd>' + listed + '개</dd></div>' +
      '<div><dt>정년</dt><dd>' + Math.min(2026, y + SK.RETIRE_AGE - SK.START_AGE) + '년 · ' + (SK.START_AGE + Math.min(2026, y + SK.RETIRE_AGE - SK.START_AGE) - y) + '세</dd></div>' +
      '<div><dt>비트코인</dt><dd class="' + (y >= 2009 ? 'gold' : '') + '">' + btc + '</dd></div>' +
      '</dl>';
    document.querySelectorAll('#year-presets button').forEach((b) => b.classList.toggle('on', +b.dataset.y === y));
  }

  function showTitle() {
    setPlaying(false);
    $('#game-screen').hidden = true;
    $('#title-screen').hidden = false;
    const s = G.peekSave(), btn = $('#btn-continue');
    btn.hidden = !s || s.over;
    if (s && !s.over) btn.textContent = '이어하기 · ' + s.name + ' · ' + fmtDate(s.week);
    renderEra();
  }

  function showGame() {
    $('#title-screen').hidden = true;
    $('#game-screen').hidden = false;
    seenNews = tab === 'news' ? G.news().length : 0;
    $('#market-list').dataset.key = '';
    renderAll();
    if (G.state.over) showEnd();
  }

  /* ---------- 게임 화면 ---------- */
  function renderHud() {
    const W = G.world, S = G.state;
    const d = SK.dateOf(W.week);
    $('#hud-date').textContent = fmtDate(W.week);
    $('#hud-era').textContent = G.age() + '세 · ' + (G.state.random ? '입사 ' + (G.age() - SK.START_AGE + 1) + '년 차' : eraOf(d.getUTCFullYear()).name);
    $('#hud-index').textContent = SK.fmtPx(W.index);
    const h = W.idxHist, r = h.length > 1 ? h[h.length - 1] / h[h.length - 2] - 1 : 0;
    const chg = $('#hud-index-chg');
    chg.textContent = fmtPct(r);
    chg.className = cls(r);
    $('#hud-nw').textContent = SK.fmtMoney(G.netWorth());
    $('#hud-cash').textContent = SK.fmtMoney(S.cash);
    $('#hud-rank').textContent = SK.RANKS[S.rank].name;
    $('#news-dot').hidden = tab === 'news' || G.news().length <= seenNews;
  }

  function spark(a, n) {
    const h = a.hist.slice(-n);
    if (h.length < 2) return '';
    let lo = Infinity, hi = -Infinity;
    for (const v of h) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = hi - lo || 1;
    return h.map((v, i) => (i * 60 / (h.length - 1)).toFixed(1) + ',' + (23 - ((v - lo) / span) * 20).toFixed(1)).join(' ');
  }

  // 목록은 구성이 바뀔 때만 다시 만들고, 평소에는 숫자만 갱신한다 (진행 중에도 탭이 씹히지 않게)
  function syncList(box, assets, port) {
    const key = assets.map((a) => a.id).join(',');
    if (box.dataset.key !== key) {
      box.dataset.key = key;
      box.innerHTML = assets.map((a) =>
        '<button type="button" class="row" data-id="' + a.id + '"><span class="row-main"><span class="row-name">' + esc(a.def.name) +
        '</span><span class="row-sub"></span></span><svg class="spark" viewBox="0 0 60 26" preserveAspectRatio="none"><polyline points=""/></svg>' +
        '<span class="row-num"><span class="row-price"></span><span class="row-chg"></span></span></button>').join('');
    }
    assets.forEach((a, i) => {
      const el = box.children[i], h = port === 'short' ? G.state.shorts[a.id] : G.state.holdings[a.id];
      const sub = el.querySelector('.row-sub'), price = el.querySelector('.row-price'), chg = el.querySelector('.row-chg');
      const half = a.hist.length > 26 ? a.price / a.hist[a.hist.length - 27] - 1 : a.price / a.hist[0] - 1;
      const sp = el.querySelector('.spark');
      sp.setAttribute('class', 'spark ' + cls(half));
      sp.firstChild.setAttribute('points', spark(a, 27));
      if (port) {
        const pnl = port === 'short' ? 1 - a.price / h.avg : a.price / h.avg - 1;
        sub.textContent = SK.fmtQty(h.qty, a) + (port === 'short' ? ' · 매도가 ' : ' · 평단 ') + SK.fmtPx(h.avg);
        price.textContent = SK.fmtMoney(h.qty * a.price);
        chg.textContent = fmtPct(pnl);
        chg.className = 'row-chg ' + cls(pnl);
      } else {
        const r = weekChg(a);
        sub.innerHTML = h ? '<span class="own">보유 ' + SK.fmtQty(h.qty, a) + '</span>' : esc(a.def.desc);
        price.textContent = SK.fmtPx(a.price);
        chg.textContent = fmtPct(r);
        chg.className = 'row-chg ' + cls(r);
      }
    });
  }

  // 업종별 묶음. 머리줄에는 6개월 평균 등락과 지금 걸린 호재·악재를 보여 준다.
  let secOpen = {};
  function briefHtml(sector) {
    const b = G.world.brief(sector);
    return b.good.map((t) => '<span class="brief"><b class="up">호재</b>' + esc(t) + '</span>')
      .concat(b.bad.map((t) => '<span class="brief"><b class="down">악재</b>' + esc(t) + '</span>')).join('');
  }
  function renderMarket() {
    const live = G.world.assets.filter((a) => a.listed && !a.dead);
    const groups = SK.SECTORS.map((s) => ({ s, list: live.filter((a) => a.def.sector === s) })).filter((g) => g.list.length);
    const isOpen = (s) => (s in secOpen ? secOpen[s] : live.length <= 12 || s === '가상자산' || s === 'ETF');
    const box = $('#market-list');
    const key = groups.map((g) => g.s + (isOpen(g.s) ? '+' : '-')).join('|');
    if (box.dataset.key !== key) {
      box.dataset.key = key;
      box.innerHTML = groups.map((g) =>
        '<section class="sec"><button type="button" class="sec-head" data-sector="' + esc(g.s) + '" aria-expanded="' + isOpen(g.s) + '">' +
        '<span class="sec-name">' + esc(g.s) + '<small></small></span><span class="sec-chg"></span><span class="sec-caret">' + (isOpen(g.s) ? '−' : '+') + '</span></button>' +
        '<div class="sec-brief"></div><div class="list"' + (isOpen(g.s) ? '' : ' hidden') + '></div></section>').join('');
    }
    groups.forEach((g, i) => {
      const el = box.children[i];
      let sum = 0;
      for (const a of g.list) { const n = a.hist.length; sum += a.price / a.hist[Math.max(0, n - 27)] - 1; }
      const avg = sum / g.list.length, chg = el.querySelector('.sec-chg');
      const own = g.list.filter((a) => G.state.holdings[a.id]).length;
      el.querySelector('small').textContent = g.list.length + '종목' + (own ? ' · 보유 ' + own : '');
      chg.textContent = '6개월 ' + fmtPct(avg);
      chg.className = 'sec-chg ' + cls(avg);
      const brief = briefHtml(g.s), bel = el.querySelector('.sec-brief');
      if (bel.dataset.h !== brief) { bel.dataset.h = brief; bel.innerHTML = brief; bel.hidden = !brief; }
      if (isOpen(g.s)) syncList(el.querySelector('.list'), g.list, false);
    });
  }
  function toggleSector(s) {
    const live = G.world.assets.filter((a) => a.listed && !a.dead).length;
    secOpen[s] = !(s in secOpen ? secOpen[s] : live <= 12 || s === '가상자산' || s === 'ETF');
    renderMarket();
  }

  function renderPort(full) {
    const S = G.state, W = G.world, box = $('#tab-port');
    if (full || !box.firstChild) {
      box.innerHTML =
        '<div class="acct"><div><div class="label">순자산</div><div class="acct-big" id="pf-nw"></div></div>' +
        '<dl class="kv" id="pf-kv"></dl><div class="ladder" id="pf-ladder"></div>' +
        '<canvas class="chart" id="pf-chart"></canvas></div>' +
        '<h3 class="section-h">예금·신용</h3><div class="list">' +
        '<button type="button" class="row" data-bank="dep"><span class="row-main"><span class="row-name">예금</span><span class="row-sub" id="bk-dep-sub"></span></span><span></span><span class="row-num"><span class="row-price" id="bk-dep"></span><span class="row-chg">입금·출금</span></span></button>' +
        '<button type="button" class="row" data-bank="loan"><span class="row-main"><span class="row-name">신용 융자</span><span class="row-sub" id="bk-loan-sub"></span></span><span></span><span class="row-num"><span class="row-price" id="bk-loan"></span><span class="row-chg">빌리기·갚기</span></span></button></div>' +
        '<h3 class="section-h">보유 종목</h3><div class="list" id="pf-list"></div><p class="empty" id="pf-empty">아직 보유한 종목이 없습니다. 시장 탭에서 종목을 눌러 매수하세요.</p>' +
        '<h3 class="section-h" id="pf-short-h">공매도</h3><div class="list" id="pf-short"></div><h3 class="section-h" id="pf-orders-h">조건 주문</h3><div id="pf-orders"></div><h3 class="section-h">기록</h3><ul class="log" id="pf-log"></ul>';
      $('#pf-list').dataset.key = '';
    }
    const nw = G.netWorth(), ret = nw / S.startCap - 1, hv = G.holdingValue();
    let cost = 0;
    for (const id in S.holdings) cost += S.holdings[id].qty * S.holdings[id].avg;
    $('#pf-nw').textContent = SK.fmtMoney(nw);
    $('#pf-kv').innerHTML =
      '<div><dt>현금</dt><dd>' + SK.fmtMoney(S.cash) + '</dd></div>' +
      '<div><dt>평가 손익</dt><dd class="' + cls(hv - cost) + '">' + (hv - cost >= 0 ? '+' : '') + SK.fmtMoney(hv - cost) + '</dd></div>' +
      '<div><dt>입사 후 자산</dt><dd class="' + cls(ret) + '">' + fmtPct(ret) + '</dd></div>' +
      '<div><dt>같은 기간 지수</dt><dd class="' + cls(W.index / S.startIndex - 1) + '">' + fmtPct(W.index / S.startIndex - 1) + '</dd></div>' +
      '<div><dt>월 저축</dt><dd>' + SK.fmtMoney(G.salary()) + '</dd></div>' +
      (G.liab() > 0 ? '<div><dt>담보비율</dt><dd class="' + (G.marginRatio() < 1.6 ? 'up' : '') + '">' + Math.round(G.marginRatio() * 100) + '%</dd></div>' : '');
    $('#bk-dep').textContent = SK.fmtMoney(S.deposit);
    $('#bk-dep-sub').textContent = '연 ' + pct1(G.rate()) + ' · 언제든 입출금';
    $('#bk-loan').textContent = SK.fmtMoney(S.loan);
    $('#bk-loan-sub').textContent = '연 ' + pct1(G.loanRate()) + ' · 한도 ' + SK.fmtMoney(G.maxBorrow());
    const next = SK.RANKS[S.rank + 1];
    if (next) {
      const need = next.min * G.scale(), cur = SK.RANKS[S.rank].min * G.scale();
      const p = Math.max(0, Math.min(1, (nw - cur) / (need - cur)));
      $('#pf-ladder').innerHTML = '<div class="ladder-bar"><i style="width:' + (p * 100).toFixed(1) + '%"></i></div><p>' +
        esc(SK.RANKS[S.rank].name) + ' → ' + esc(next.name) + ' 승진까지 순자산 ' + SK.fmtMoney(need) + '</p>';
    } else $('#pf-ladder').innerHTML = '<p>최고 직급에 올랐습니다.</p>';
    drawChart($('#pf-chart'), S.nwHist, S.startWeek, null);
    const held = W.assets.filter((a) => S.holdings[a.id]);
    syncList($('#pf-list'), held, true);
    $('#pf-empty').hidden = held.length > 0;
    const sh = W.assets.filter((a) => S.shorts[a.id]);
    syncList($('#pf-short'), sh, 'short');
    $('#pf-short-h').hidden = !sh.length;
    const oh = ordersHtml(S.orders), ob = $('#pf-orders');
    if (ob.dataset.h !== oh) { ob.dataset.h = oh; ob.innerHTML = oh; }
    $('#pf-orders-h').hidden = !S.orders.length;
    $('#pf-log').innerHTML = S.log.map((l) => '<li><time>' + fmtDate(l.week) + '</time><span>' + esc(l.text) + '</span></li>').join('');
  }

  function renderNews() {
    const list = G.news().slice().reverse();
    seenNews = list.length;
    $('#tab-news').innerHTML = list.length
      ? '<ul class="news">' + list.map((n) => '<li class="' + (n.major ? 'major' : '') + '"><time>' + fmtDate(n.week) + '</time><h3>' + esc(n.title) + '</h3><p>' + esc(n.body) + '</p></li>').join('') + '</ul>'
      : '<p class="empty">아직 들어온 뉴스가 없습니다. 시간을 진행하면 그 시절의 사건이 전해집니다.</p>';
  }

  let lastNewsCount = -1;
  function renderAll(full) {
    renderHud();
    if (tab === 'market') renderMarket();
    else if (tab === 'port') renderPort(full);
    else if (tab === 'news' && (full || lastNewsCount !== G.news().length)) { lastNewsCount = G.news().length; renderNews(); }
  }

  function setTab(t) {
    tab = t;
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    ['market', 'port', 'news'].forEach((k) => ($('#tab-' + k).hidden = k !== t));
    $('#pane').scrollTop = 0;
    renderAll(true);
  }

  /* ---------- 차트 ---------- */
  function drawChart(cv, data, firstWeek, avg) {
    const css = getComputedStyle(document.documentElement);
    const c = (n) => css.getPropertyValue(n).trim();
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    cv.width = w * dpr; cv.height = h * dpr;
    const x = cv.getContext('2d');
    x.scale(dpr, dpr);
    x.clearRect(0, 0, w, h);
    if (data.length < 2) {
      x.fillStyle = c('--muted'); x.font = '12px ' + c('--body'); x.textAlign = 'center';
      x.fillText('시간이 지나면 차트가 그려집니다', w / 2, h / 2);
      return;
    }
    let lo = Infinity, hi = -Infinity;
    for (const v of data) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (avg) { lo = Math.min(lo, avg); hi = Math.max(hi, avg); }
    const useLog = lo > 0 && hi / lo > 20; // 수십 배 움직인 구간은 로그 눈금
    const f = useLog ? Math.log : (v) => v, inv = useLog ? Math.exp : (v) => v;
    let a = f(lo), b = f(hi);
    if (a === b) { a -= 1; b += 1; }
    const padR = 66, padT = 8, padB = 18, pw = w - padR, ph = h - padT - padB;
    const X = (i) => (i / (data.length - 1)) * pw, Y = (v) => padT + (1 - (f(v) - a) / (b - a)) * ph;
    x.font = '11px ' + c('--num'); x.textBaseline = 'middle'; x.textAlign = 'left';
    for (let i = 0; i <= 3; i++) {
      const v = inv(a + ((b - a) * i) / 3), y = Y(v);
      x.strokeStyle = c('--line'); x.lineWidth = 1; x.beginPath(); x.moveTo(0, y); x.lineTo(pw, y); x.stroke();
      x.fillStyle = c('--muted');
      x.fillText(v >= 1e12 ? (v / 1e12).toFixed(1) + '조' : v >= 1e8 ? (v / 1e8).toFixed(1) + '억' : v >= 1e6 ? comma(v / 1e4) + '만' : SK.fmtPx(v), pw + 6, y);
    }
    const col = data[data.length - 1] >= data[0] ? c('--up') : c('--down');
    x.beginPath();
    data.forEach((v, i) => (i ? x.lineTo(X(i), Y(v)) : x.moveTo(X(i), Y(v))));
    x.strokeStyle = col; x.lineWidth = 1.8; x.lineJoin = 'round'; x.stroke();
    x.lineTo(pw, padT + ph); x.lineTo(0, padT + ph); x.closePath();
    x.globalAlpha = 0.1; x.fillStyle = col; x.fill(); x.globalAlpha = 1;
    if (avg) {
      x.setLineDash([4, 4]); x.strokeStyle = c('--gold'); x.beginPath(); x.moveTo(0, Y(avg)); x.lineTo(pw, Y(avg)); x.stroke(); x.setLineDash([]);
    }
    x.fillStyle = col; x.beginPath(); x.arc(pw, Y(data[data.length - 1]), 3.5, 0, 7); x.fill();
    x.fillStyle = c('--muted'); x.textBaseline = 'alphabetic';
    x.fillText(fmtDate(firstWeek), 0, h - 3);
    x.textAlign = 'right';
    x.fillText(fmtDate(firstWeek + data.length - 1), pw, h - 3);
  }

  /* ---------- 종목 시트 ---------- */
  function openSheet(id) {
    resume = playing;
    setPlaying(false);
    sheetId = id; sheetQty = ''; sheetErr = '';
    sheetMode = 'buy';
    cSide = G.state.holdings[id] ? 'sell' : G.state.shorts[id] ? 'cover' : 'buy'; cDir = C_DIR[cSide]; cBasis = 'price'; cVal = ''; cQty = '';
    renderSheet();
    $('#sheet').hidden = false;
  }
  function closeSheet() {
    $('#sheet').hidden = true;
    sheetId = null;
    renderAll(true);
    if (resume && !G.state.over) setPlaying(true);
  }

  function sheetSummary() {
    const a = G.world.byId[sheetId], q = parseFloat(sheetQty) || 0, amt = q * a.price;
    if (sheetErr) return '<span class="err">' + esc(sheetErr) + '</span>';
    if (sheetMode === 'short') {
      const s = G.state.shorts[a.id], block = G.shortBlock(a.id);
      if (sSide === 'short') return block ? '<span class="err">' + block + '</span>' : q ? '<b>' + SK.fmtMoney(amt * (1 - G.FEE.sell)) + '</b> 입금. 주가가 오르면 손실이고, 빌린 값으로 연 3% 수수료를 냅니다' : '최대 ' + SK.fmtQty(G.maxShort(a.id), a) + ' 공매도 가능';
      return q ? '결제 <b>' + SK.fmtMoney(amt * (1 + G.FEE.buy)) + '</b>' + (s ? ' · 예상 손익 ' + SK.fmtMoney((s.avg - a.price) * Math.min(q, s.qty)) : '') : '공매도 잔량 ' + SK.fmtQty(s ? s.qty : 0, a);
    }
    if (sheetMode === 'cond') {
      const o = { asset: a.id, side: cSide, dir: cDir, basis: cBasis, value: parseFloat(cVal) || 0, qty: parseFloat(cQty) || 0 };
      const h = G.orderPos(o), sh = cSide === 'short' || cSide === 'cover', word = sh ? '매도가' : '평단';
      if (sh && a.kind === 'crypto') return '<span class="err">비트코인은 공매도할 수 없습니다</span>';
      if (!o.value || !o.qty) return cBasis === 'avg' ? (h ? word + ' ' + SK.fmtPx(h.avg) + unit() + ' 기준으로 몇 % 움직이면 주문할지 정합니다' : word + ' 기준은 ' + (sh ? '공매도' : '보유') + ' 중인 종목에만 걸 수 있습니다') : '현재가 ' + SK.fmtPx(a.price) + unit() + '. 기준 가격과 수량을 입력하세요';
      const T = G.orderTrigger(o);
      return (cBasis === 'avg' && T !== null ? word + ' ' + SK.fmtPx(h.avg) + '의 ' + (cDir === 'below' ? '-' : '+') + o.value + '%인 ' : '') + (T === null ? '' : '<b>' + SK.fmtPx(T) + unit() + '</b> ') +
        (cDir === 'below' ? '이하로 떨어지면 ' : '이상으로 오르면 ') + SK.fmtQty(o.qty, a) + ' ' + C_SIDES.find((x) => x[0] === cSide)[1].slice(3) + '. 닿은 주의 가격으로 체결됩니다';
    }
    if (sheetMode === 'buy') {
      const left = a.kind === 'crypto' ? G.btcLeft() : Infinity;
      const cap = left !== Infinity ? ' · 이번 주 매수 한도 ' + SK.fmtQty(left, a) : '';
      return q ? '결제 <b>' + SK.fmtMoney(amt * (1 + G.FEE.buy)) + '</b> (수수료 0.1% 포함)' + cap : '최대 ' + SK.fmtQty(G.maxBuy(a.id), a) + ' 매수 가능' + cap;
    }
    return q ? '입금 <b>' + SK.fmtMoney(amt * (1 - G.FEE.sell)) + '</b> (수수료·세금 0.3% 차감)' : '보유 ' + SK.fmtQty(G.maxSell(a.id), a);
  }

  const chipRow = (key, cur, opts) => '<div class="chips">' + opts.map(([v, l]) => '<button type="button" data-' + key + '="' + v + '" class="' + (v === cur ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';
  const ordersHtml = (list) => (list.length ? '<ul class="orders">' + list.map((o) => '<li><span>' + esc(SK.orderText(o)) + '</span><button type="button" data-cancel="' + o.id + '">취소</button></li>').join('') + '</ul>' : '');

  function renderSheet() {
    const a = G.world.byId[sheetId], h = G.state.holdings[a.id], st = G.state.shorts[a.id], box = $('#sheet');
    const dy = G.world.divYield(a.def);
    const n = sheetRange ? Math.min(sheetRange + 1, a.hist.length) : a.hist.length;
    const data = a.hist.slice(-n), r = data.length > 1 ? data[data.length - 1] / data[0] - 1 : 0;
    const ranges = [[26, '6개월'], [156, '3년'], [520, '10년'], [0, '전체']];
    const closed = a.dead;
    box.innerHTML =
      '<div class="card" role="dialog" aria-label="' + esc(a.def.name) + '">' +
      '<div class="card-head"><div><h2>' + esc(a.def.name) + '</h2><p class="sub">' + esc(a.def.sector) + ' · ' + esc(a.def.desc) + (dy > 0 ? ' 배당 연 ' + pct1(dy) + ' (4월 지급).' : a.kind === 'crypto' ? '' : ' 배당 없음.') + '</p></div>' +
      '<button type="button" class="icon-btn" data-act="close" aria-label="닫기">×</button></div>' +
      (briefHtml(a.def.sector) ? '<div class="sec-brief">' + briefHtml(a.def.sector) + '</div>' : '') +
      '<div class="px"><b>' + SK.fmtPx(a.price) + '</b><span>' + unit() + '</span><span class="' + cls(r) + '">' + fmtPct(r) + ' (' + ranges.find((x) => x[0] === sheetRange)[1] + ')</span></div>' +
      '<div class="chips">' + ranges.map(([v, l]) => '<button type="button" data-range="' + v + '" class="' + (v === sheetRange ? 'on' : '') + '">' + l + '</button>').join('') + '</div>' +
      '<canvas class="chart" id="sp-chart"></canvas>' +
      (h ? '<dl class="kv"><div><dt>보유</dt><dd>' + SK.fmtQty(h.qty, a) + '</dd></div><div><dt>평균 단가</dt><dd>' + SK.fmtPx(h.avg) + '</dd></div><div><dt>평가 손익</dt><dd class="' + cls(a.price - h.avg) + '">' +
        (a.price >= h.avg ? '+' : '') + SK.fmtMoney((a.price - h.avg) * h.qty) + ' (' + fmtPct(a.price / h.avg - 1) + ')</dd></div></dl>' : '') +
      (st ? '<dl class="kv"><div><dt>공매도</dt><dd>' + SK.fmtQty(st.qty, a) + '</dd></div><div><dt>평균 매도가</dt><dd>' + SK.fmtPx(st.avg) + '</dd></div><div><dt>평가 손익</dt><dd class="' + cls(st.avg - a.price) + '">' +
        (st.avg >= a.price ? '+' : '') + SK.fmtMoney((st.avg - a.price) * st.qty) + '</dd></div></dl>' : '') +
      (closed ? '<p class="sub">거래가 끝난 종목입니다.</p>' :
        '<div class="trade"><div class="seg">' + [['buy', '매수'], ['sell', '매도'], ['cond', '조건'], ['short', '공매도']].map(([m, l]) => '<button type="button" data-mode="' + m + '" class="' + (sheetMode === m ? 'on' : '') + '">' + l + '</button>').join('') + '</div>' +
        (sheetMode === 'cond'
          ? chipRow('cside', cSide, C_SIDES) +
            chipRow('cdir', cDir, [['below', '이하로 떨어지면'], ['above', '이상으로 오르면']]) +
            chipRow('cbasis', cBasis, [['price', '가격 기준'], ['avg', (cSide === 'short' || cSide === 'cover' ? '매도가' : '평단') + ' 기준 %']]) +
            '<label class="qty"><input id="sp-cval" type="text" inputmode="decimal" placeholder="' + (cBasis === 'price' ? '기준 가격' : (cSide === 'short' || cSide === 'cover' ? '매도가 대비' : '평단 대비')) + '" autocomplete="off" value="' + esc(cVal) + '"><span>' + (cBasis === 'price' ? unit() : (cDir === 'below' ? '% 하락' : '% 상승')) + '</span></label>' +
            '<label class="qty"><input id="sp-cqty" type="text" inputmode="decimal" placeholder="수량" autocomplete="off" value="' + esc(cQty) + '"><span>' + (a.kind === 'crypto' ? 'BTC' : '주') + '</span></label>'
          : (sheetMode === 'short' ? chipRow('sside', sSide, [['short', '공매도'], ['cover', '환매수']]) : '') + '<label class="qty"><input id="sp-qty" type="text" inputmode="decimal" placeholder="수량" autocomplete="off" value="' + esc(sheetQty) + '"><span>' + (a.kind === 'crypto' ? 'BTC' : '주') + '</span></label>') +
        '<div class="chips">' + [[0.1, '10%'], [0.25, '25%'], [0.5, '50%'], [1, '최대']].map(([v, l]) => '<button type="button" data-pct="' + v + '">' + l + '</button>').join('') + '</div>' +
        '<p class="sum" id="sp-sum">' + sheetSummary() + '</p>' +
        '<div class="card-foot"><button type="button" class="ghost" data-act="step">1주 진행 ▸</button><button type="button" class="primary ' + { buy: 'buy', sell: 'sell', cond: '', short: sSide === 'short' ? 'sell' : 'buy' }[sheetMode] + '" data-act="go">' + { buy: '매수', sell: '매도', cond: '조건 주문 등록', short: sSide === 'short' ? '공매도' : '환매수' }[sheetMode] + '</button></div>' +
        ordersHtml(G.state.orders.filter((o) => o.asset === a.id)) + '</div>') +
      '</div>';
    drawChart($('#sp-chart'), data, a.listWeek + a.hist.length - data.length, h ? h.avg : null);
  }

  $('#sheet').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) return closeSheet();
    const b = e.target.closest('button');
    if (!b) return;
    const a = G.world.byId[sheetId];
    sheetErr = '';
    if (b.dataset.act === 'close') return closeSheet();
    if (b.dataset.range !== undefined) sheetRange = +b.dataset.range;
    else if (b.dataset.mode) {
      sheetMode = b.dataset.mode; sheetQty = '';
      if (sheetMode === 'cond') { // 지금 포지션에 맞는 주문을 기본으로
        cSide = G.state.holdings[a.id] ? 'sell' : G.state.shorts[a.id] ? 'cover' : 'buy';
        cDir = C_DIR[cSide]; cBasis = 'price'; cVal = ''; cQty = '';
      }
    }
    else if (b.dataset.sside) { sSide = b.dataset.sside; sheetQty = ''; }
    else if (b.dataset.cside) { cSide = b.dataset.cside; cDir = C_DIR[cSide]; cQty = ''; }
    else if (b.dataset.cdir) cDir = b.dataset.cdir;
    else if (b.dataset.cbasis) { cBasis = b.dataset.cbasis; cVal = ''; }
    else if (b.dataset.cancel) G.cancelOrder(+b.dataset.cancel);
    else if (b.dataset.pct) {
      const side = sheetMode === 'cond' ? cSide : sheetMode === 'short' ? sSide : sheetMode;
      const q = G.orderMax({ asset: a.id, side }) * +b.dataset.pct;
      const s = String(a.kind === 'crypto' ? Math.floor(q * 1e4) / 1e4 : Math.floor(q));
      if (sheetMode === 'cond') cQty = s; else sheetQty = s;
    } else if (b.dataset.act === 'go' && sheetMode === 'cond') {
      sheetErr = G.addOrder({ asset: a.id, side: cSide, dir: cDir, basis: cBasis, value: parseFloat(cVal) || 0, qty: parseFloat(cQty) || 0 }) || '';
      if (!sheetErr) { toast('조건 주문을 등록했습니다'); cVal = ''; cQty = ''; }
    } else if (b.dataset.act === 'go' && sheetMode === 'short') {
      const q = Math.floor(parseFloat(sheetQty) || 0);
      sheetErr = (sSide === 'short' ? G.short(a.id, q) : G.cover(a.id, q)) || '';
      if (!sheetErr) { toast((sSide === 'short' ? '공매도 체결: ' : '환매수 체결: ') + a.def.name + ' ' + SK.fmtQty(q, a)); sheetQty = ''; renderHud(); }
    } else if (b.dataset.act === 'go') {
      const q = parseFloat(sheetQty) || 0;
      sheetErr = (sheetMode === 'buy' ? G.buy(a.id, q) : G.sell(a.id, q)) || '';
      if (!sheetErr) {
        toast((sheetMode === 'buy' ? '매수 체결: ' : '매도 체결: ') + a.def.name + ' ' + SK.fmtQty(a.kind === 'crypto' ? q : Math.floor(q), a));
        sheetQty = '';
        renderHud();
      }
    } else if (b.dataset.act === 'step') {
      advance();
      if (!sheetId) return;
    }
    renderSheet();
  });
  $('#sheet').addEventListener('input', (e) => {
    const id = e.target.id;
    if (id !== 'sp-qty' && id !== 'sp-cval' && id !== 'sp-cqty') return;
    const v = e.target.value.replace(/[^0-9.]/g, '');
    if (v !== e.target.value) e.target.value = v;
    if (id === 'sp-qty') sheetQty = v; else if (id === 'sp-cval') cVal = v; else cQty = v;
    sheetErr = '';
    $('#sp-sum').innerHTML = sheetSummary();
  });

  /* ---------- 모달 ---------- */
  function openModal(html) { $('#modal').innerHTML = '<div class="card" role="dialog">' + html + '</div>'; $('#modal').hidden = false; }
  function closeModal() { $('#modal').hidden = true; }

  function showMenu(confirming) {
    setPlaying(false);
    openModal(
      '<div class="card-head"><div><h2>메뉴</h2><p class="sub">' + esc(G.state.name) + ' · ' + SK.RANKS[G.state.rank].name + '</p></div><button type="button" class="icon-btn" data-m="close" aria-label="닫기">×</button></div>' +
      '<label class="check"><input type="checkbox" id="opt-pause" ' + (G.state.autoPause ? 'checked' : '') + '>속보가 뜨면 시간 멈추기</label>' +
      '<ul class="help"><li>한 번에 한 주씩 흐릅니다. 종목을 누르면 시간이 멈추고 매매 창이 열립니다.</li><li>매달 직급에 맞는 저축액이 현금으로 들어옵니다.</li><li>순자산이 늘면 승진합니다. 2026년 가치로 1000억 원이면 증권왕입니다.</li><li>내 계좌의 예금은 그 시절 금리로 이자가 붙습니다. 신용 융자는 총자산이 융자금의 2배 이상일 때 빌릴 수 있고, 140% 아래로 내려가면 반대매매됩니다.</li><li>시장 탭은 업종별로 묶여 있습니다. 업종 이름을 누르면 종목이 펼쳐지고, 그 아래에 지금의 호재와 악재가 요약됩니다.</li><li>호재와 악재가 모두 맞지는 않습니다. 헛소문도 있고, 이미 주가에 반영됐거나 거꾸로 가는 재료도 있습니다.</li><li>종목 창의 조건 주문으로 손절·익절·추격 매수를 미리 걸 수 있고, 공매도와 환매수에도 걸 수 있습니다. 가격 또는 평단 대비 %로 기준을 정합니다.</li><li>주식은 매년 4월 첫 주에 배당을 줍니다. 배당만큼 주가가 내려가고(배당락), 세금 15.4%를 뗍니다.</li><li>공매도는 내릴 것 같은 주식을 빌려서 먼저 파는 거래입니다. 주가가 오르면 손실이고 담보비율 규칙은 신용 융자와 같습니다. 금지된 시기에는 새로 걸 수 없습니다.</li><li>랜덤 미래로 시작했다면 입사 뒤의 일은 실제 역사와 다릅니다. 화폐개혁과 비트코인 등장 같은 제도 변화만 그대로 일어납니다.</li><li>부도난 회사의 주식은 거의 전부 잃습니다. 뉴스를 확인하세요.</li><li>24세에 입사해 65세 정년 또는 2026년 11월 중 먼저 오는 때에 끝납니다. 진행 상황은 이 기기에 자동 저장됩니다.</li></ul>' +
      (confirming
        ? '<p class="err">지금 판을 버리고 처음으로 돌아갑니다.</p><div class="card-foot"><button type="button" class="ghost" data-m="close">계속하기</button><button type="button" class="primary" data-m="quit">버리고 나가기</button></div>'
        : '<div class="card-foot"><button type="button" class="ghost" data-m="ask-quit">새 게임</button><button type="button" class="primary" data-m="close">계속하기</button></div>'));
  }

  function showEnd() {
    setPlaying(false);
    if (sheetId) { $('#sheet').hidden = true; sheetId = null; }
    const S = G.state, W = G.world, nw = G.netWorth();
    const years = Math.max((W.week - S.startWeek) / 52.18, 0.02);
    const mult = nw / S.startCap, idx = W.index / S.startIndex;
    const king = S.rank === SK.RANKS.length - 1;
    openModal(
      '<p class="label">' + fmtDate(S.startWeek) + ' – ' + fmtDate(W.week) + ' · ' + years.toFixed(1) + '년</p>' +
      '<p class="crown">' + (S.bust ? '깡통 계좌로 퇴사' : king ? '1000억 달성, 증권왕 등극' : G.age() + '세, ' + SK.RANKS[S.rank].name + '으로 은퇴') + '</p>' +
      '<div><div class="label">최종 순자산</div><div class="result">' + SK.fmtMoney(nw) + '</div></div>' +
      '<dl class="kv"><div><dt>자산 배수</dt><dd>' + (mult >= 100 ? comma(mult) : mult.toFixed(1)) + '배</dd></div><div><dt>같은 기간 지수</dt><dd>' + (idx >= 100 ? comma(idx) : idx.toFixed(1)) + '배</dd></div>' +
      '<div><dt>2026년 가치</dt><dd>' + SK.fmtMoney(G.realWorth(), '원') + '</dd></div></dl>' +
      '<p class="sub">' + (S.bust ? '빚으로 산 주식이 무너졌습니다. 신용은 양날의 칼입니다.' : mult > idx ? '지수를 이겼습니다.' : '지수를 이기지 못했습니다. 다른 해에 다시 도전해 보세요.') + '</p>' +
      '<div class="card-foot"><button type="button" class="ghost" data-m="close">계좌 보기</button><button type="button" class="primary" data-m="quit">새 게임</button></div>');
  }

  /* ---------- 예금·신용 창 ---------- */
  let bankKind = 'dep', bankMode = 'in', bankAmt = '', bankErr = '';
  function bankSum() {
    if (bankErr) return '<span class="err">' + esc(bankErr) + '</span>';
    const x = parseFloat(bankAmt) || 0;
    return x ? '<b>' + SK.fmtMoney(x) + '</b>' : '최대 ' + SK.fmtMoney(G.bankMax(bankMode));
  }
  function showBank(kind) {
    setPlaying(false);
    if (kind) { bankKind = kind; bankMode = kind === 'dep' ? 'in' : 'borrow'; bankAmt = ''; bankErr = ''; }
    const S = G.state, dep = bankKind === 'dep';
    const modes = dep ? [['in', '입금'], ['out', '출금']] : [['borrow', '빌리기'], ['repay', '갚기']];
    openModal(
      '<div class="card-head"><div><h2>' + (dep ? '예금' : '신용 융자') + '</h2><p class="sub">' +
      (dep ? '그 시절 금리로 매주 이자가 붙습니다. 언제든 넣고 뺄 수 있습니다.' : '증권사에서 돈을 빌려 투자합니다. 담보비율(총자산 ÷ (융자금 + 공매도 평가액))이 140% 아래로 내려가면 강제로 정리됩니다.') +
      '</p></div><button type="button" class="icon-btn" data-m="close" aria-label="닫기">×</button></div>' +
      '<dl class="kv">' + (dep
        ? '<div><dt>예금 잔액</dt><dd>' + SK.fmtMoney(S.deposit) + '</dd></div><div><dt>금리</dt><dd>연 ' + pct1(G.rate()) + '</dd></div><div><dt>현금</dt><dd>' + SK.fmtMoney(S.cash) + '</dd></div>'
        : '<div><dt>융자금</dt><dd>' + SK.fmtMoney(S.loan) + '</dd></div><div><dt>금리</dt><dd>연 ' + pct1(G.loanRate()) + '</dd></div><div><dt>담보비율</dt><dd>' + (G.liab() > 0 ? Math.round(G.marginRatio() * 100) + '%' : '-') + '</dd></div><div><dt>빌릴 수 있는 돈</dt><dd>' + SK.fmtMoney(G.maxBorrow()) + '</dd></div>') + '</dl>' +
      '<div class="trade"><div class="seg">' + modes.map(([m, l]) => '<button type="button" data-bmode="' + m + '" class="' + (m === bankMode ? 'on' : '') + '">' + l + '</button>').join('') + '</div>' +
      '<label class="qty"><input id="bank-amt" type="text" inputmode="numeric" placeholder="금액" autocomplete="off" value="' + esc(bankAmt) + '"><span>' + unit() + '</span></label>' +
      '<div class="chips">' + [[0.1, '10%'], [0.25, '25%'], [0.5, '50%'], [1, '최대']].map(([v, l]) => '<button type="button" data-bpct="' + v + '">' + l + '</button>').join('') + '</div>' +
      '<p class="sum" id="bank-sum">' + bankSum() + '</p>' +
      '<div class="card-foot"><button type="button" class="ghost" data-m="close">닫기</button><button type="button" class="primary" data-m="bank-go">' + modes.find((m) => m[0] === bankMode)[1] + '</button></div></div>');
  }
  $('#modal').addEventListener('input', (e) => {
    if (e.target.id !== 'bank-amt') return;
    bankAmt = e.target.value.replace(/[^0-9]/g, '');
    if (bankAmt !== e.target.value) e.target.value = bankAmt;
    bankErr = '';
    $('#bank-sum').innerHTML = bankSum();
  });

  $('#modal').addEventListener('click', (e) => {
    const bb = e.target.closest('[data-bmode],[data-bpct]');
    if (bb) {
      bankErr = '';
      if (bb.dataset.bmode) { bankMode = bb.dataset.bmode; bankAmt = ''; }
      else bankAmt = String(Math.floor(G.bankMax(bankMode) * +bb.dataset.bpct));
      return showBank();
    }
    const m = e.target.closest('[data-m]');
    if (!m) return;
    if (m.dataset.m === 'bank-go') {
      bankErr = G.bank(bankMode, parseFloat(bankAmt) || 0) || '';
      if (!bankErr) { toast({ in: '입금했습니다', out: '출금했습니다', borrow: '융자를 받았습니다', repay: '융자를 갚았습니다' }[bankMode]); bankAmt = ''; renderAll(); }
      return showBank();
    }
    if (m.dataset.m === 'close') { closeModal(); if (G.state && !$('#game-screen').hidden) renderAll(); }
    else if (m.dataset.m === 'ask-quit') showMenu(true);
    else if (m.dataset.m === 'quit') { closeModal(); G.clearSave(); showTitle(); }
  });
  $('#modal').addEventListener('change', (e) => {
    if (e.target.id === 'opt-pause') { G.state.autoPause = e.target.checked; G.save(); }
  });

  /* ---------- 알림 ---------- */
  function toast(text, major) {
    const box = $('#toasts'), el = document.createElement('div');
    el.className = 'toast' + (major ? ' major' : '');
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => el.remove(), major ? 5000 : 2800);
  }

  /* ---------- 시간 ---------- */
  function advance() {
    if (G.state.over) return showEnd();
    const out = G.tick();
    out.news.forEach((n) => toast(n.title, n.major));
    out.notes.forEach((t) => toast(t, true));
    if (sheetId && G.world.byId[sheetId].dead) { $('#sheet').hidden = true; sheetId = null; }
    renderAll();
    if (out.major && G.state.autoPause) setPlaying(false);
    if (G.state.over) showEnd();
  }
  function loop() {
    if (!playing) return;
    advance();
    if (playing) timer = setTimeout(loop, DELAY[speed]);
  }
  function setPlaying(on) {
    playing = on && G.state && !G.state.over;
    clearTimeout(timer);
    const b = $('#btn-play');
    b.textContent = playing ? '❚❚ 멈춤' : '▶ 시작';
    if (playing) timer = setTimeout(loop, DELAY[speed]);
  }

  /* ---------- 이벤트 연결 ---------- */
  $('#future').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    futureMode = b.dataset.future;
    document.querySelectorAll('#future button').forEach((x) => x.classList.toggle('on', x === b));
    $('#future-note').textContent = futureMode === 'random'
      ? '입사 전까지는 실제 역사 그대로입니다. 입사한 뒤의 지수, 금리와 물가, 호재·악재, 부도, 비트코인은 판마다 전혀 다르게 흘러갑니다.'
      : '입사한 뒤에도 실제 역사의 큰 흐름과 사건을 따라갑니다. 역사를 알면 유리합니다.';
  });
  $('#year').addEventListener('input', renderEra);
  $('#year-presets').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) { $('#year').value = b.dataset.y; renderEra(); }
  });
  $('#btn-start').addEventListener('click', () => {
    G.newGame(+$('#year').value, $('#player-name').value.trim(), futureMode === 'random');
    secOpen = {};
    tab = 'market';
    setTab('market');
    showGame();
    G.news().forEach((n) => toast(n.title, n.major));
  });
  $('#btn-continue').addEventListener('click', () => { if (G.load()) { setTab('market'); showGame(); } });
  $('#btn-play').addEventListener('click', () => setPlaying(!playing));
  $('#btn-step').addEventListener('click', () => { setPlaying(false); advance(); });
  $('#btn-menu').addEventListener('click', () => showMenu(false));
  $('#speeds').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    speed = +b.dataset.speed;
    document.querySelectorAll('#speeds button').forEach((x) => x.classList.toggle('on', x === b));
    if (playing) setPlaying(true);
  });
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setTab(b.dataset.tab);
  });
  $('#pane').addEventListener('click', (e) => {
    const cx = e.target.closest('[data-cancel]');
    if (cx) { G.cancelOrder(+cx.dataset.cancel); return renderAll(); }
    const sh = e.target.closest('.sec-head');
    if (sh) return toggleSector(sh.dataset.sector);
    const bk = e.target.closest('[data-bank]');
    if (bk) return showBank(bk.dataset.bank);
    const r = e.target.closest('.row');
    if (r) openSheet(r.dataset.id);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { setPlaying(false); if (G.state) G.save(); } });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#modal').hidden) closeModal();
    else if (sheetId) closeSheet();
  });
  window.addEventListener('resize', () => { if (G.state && !$('#game-screen').hidden) { renderAll(true); if (sheetId) renderSheet(); } });

  showTitle();
})(window.SK);
