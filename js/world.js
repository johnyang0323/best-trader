/* 증권왕 — 시장 시뮬레이션
 * 세계는 (seed, 주차)의 순수 함수다. 저장 파일에는 seed만 두고 불러올 때 다시 계산한다.
 */
(function (SK) {
  const EPOCH = Date.UTC(1956, 2, 3); // 대한증권거래소 개장일
  const WEEK = 7 * 864e5;
  const WPY = 52.18;

  SK.dateOf = (w) => new Date(EPOCH + w * WEEK);
  SK.tOf = (w) => {
    const d = SK.dateOf(w), y = d.getUTCFullYear();
    const s = Date.UTC(y, 0, 1), e = Date.UTC(y + 1, 0, 1);
    return y + (d - s) / (e - s);
  };
  SK.weekOfDate = (y, m, d) => Math.max(0, Math.ceil((Date.UTC(y, m - 1, d) - EPOCH) / WEEK));
  SK.END_WEEK = SK.weekOfDate(2026, 11, 12);

  function interp(anchors, t, log) {
    if (t <= anchors[0][0]) return anchors[0][1];
    const n = anchors.length;
    if (t >= anchors[n - 1][0]) return anchors[n - 1][1];
    let i = 1;
    while (anchors[i][0] < t) i++;
    const [t0, v0] = anchors[i - 1], [t1, v1] = anchors[i];
    const f = (t - t0) / (t1 - t0);
    return log ? Math.exp(Math.log(v0) + (Math.log(v1) - Math.log(v0)) * f) : v0 + (v1 - v0) * f;
  }
  SK.interp = interp;
  SK.cpi = (t) => interp(SK.CPI, t, true);
  SK.indexAnchor = (t) => interp(SK.INDEX_ANCHORS, t, true);

  // 초기 비트코인은 개인 간 거래뿐이라 주당 살 수 있는 양에 한도가 있다
  SK.btcCap = (t) => (t < 2010.5 ? 100 : t < 2011.5 ? 1000 : t < 2013.28 ? 10000 : Infinity);

  SK.roundPx = (p) => (p >= 100 ? Math.round(p) : p >= 10 ? Math.round(p * 10) / 10 : Math.max(0.01, Math.round(p * 100) / 100));

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 근거 없이 도는 재료. 진짜 재료와 같은 모양으로 보인다.
  const RUMORS = {
    good: ['정부가 업종 육성책을 내놓았다', '대형 수출 계약 소식', '기관이 꾸준히 사들인다', '증권사들이 목표가를 올린다', '업황이 바닥을 지났다',
      '신사업 진출 발표', '분기 실적이 예상을 웃돌았다', '규제 완화 방침', '수출 주문이 늘고 있다', '제품 가격 인상'],
    bad: ['세무조사 착수', '대주주 지분 매각', '증권사들이 투자의견을 낮춘다', '업황이 정점을 지났다', '규제 강화 방침',
      '분기 실적이 예상에 못 미쳤다', '자금 사정 악화', '업체 간 가격 경쟁', '기관이 물량을 내놓는다', '원가 부담 증가']
  };

  const EVENT_WEEKS = SK.EVENTS.map(([d, title, body, major]) => {
    const [y, m, dd] = d.split('-').map(Number);
    return { week: SK.weekOfDate(y, m, dd), title, body, major: !!major };
  });

  SK.createWorld = function (seed) {
    const rnd = mulberry32(seed);
    const gauss = () => {
      let u = 0;
      while (u === 0) u = rnd();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
    };

    // 진짜 재료도 판마다 세기가 다르고(이미 반영됐거나 거꾸로 가기도 한다), 뉴스가 도는 시점이 실제 효과보다 늦다
    const waves = {};
    for (const s in SK.SECTOR_WAVES) {
      waves[s] = SK.SECTOR_WAVES[s].map(([from, to, v, text]) => {
        const r = rnd(), len = to - from;
        const m = Math.abs(v) >= 1.5 ? 0.7 + 0.5 * rnd() : r < 0.65 ? 0.6 + 0.7 * rnd() : r < 0.9 ? 0.3 * rnd() : -0.5;
        return { from, to, v: v * m, good: v > 0, text, showFrom: from + Math.min(0.5, len * 0.3) * rnd(), showTo: to + Math.min(0.4, len * 0.25) * rnd() };
      });
    }
    const rumors = []; // { sector, good, text, from, to (주차), v }
    const sectorDrift = (sector, t, week) => {
      let d = 0;
      for (const x of waves[sector] || []) if (t >= x.from && t < x.to) d += x.v;
      for (const x of rumors) if (x.sector === sector && week < x.to) d += x.v;
      return d;
    };

    const W = { seed, week: -1, t: 0, unit: '환', index: 0, idxHist: [], assets: [], byId: {}, news: [] };
    let noise = 0, prevA = null, btcNoise = 0;

    for (const def of SK.ASSETS) {
      const a = { def, id: def.id, kind: def.kind || 'stock', listed: false, dead: false, lp: 0, dev: 0, price: 0, hist: [], listWeek: -1 };
      W.assets.push(a);
      W.byId[a.id] = a;
    }

    // 지금 이 업종에 돌고 있는 호재·악재 (진짜와 가짜가 섞여 있다)
    W.brief = function (sector) {
      const out = { good: [], bad: [] };
      for (const x of waves[sector] || []) if (W.t >= x.showFrom && W.t < x.showTo) (x.good ? out.good : out.bad).push(x.text);
      for (const x of rumors) if (x.sector === sector && W.week < x.to) (x.good ? out.good : out.bad).push(x.text);
      return out;
    };

    W.step = function () {
      W.week++;
      const t = (W.t = SK.tOf(W.week));
      const evts = [];
      const news = (title, body, major) => {
        const n = { week: W.week, title, body, major: !!major };
        W.news.push(n);
        evts.push({ type: 'news', news: n });
      };

      for (const e of EVENT_WEEKS) if (e.week === W.week) news(e.title, e.body, e.major);

      // 화폐개혁: 모든 가격을 10분의 1로
      if (W.unit === '환' && t >= SK.REFORM_T) {
        W.unit = '원';
        for (const a of W.assets) {
          if (!a.listed) continue;
          a.lp -= Math.LN10;
          a.price = SK.roundPx(a.price / 10);
          a.hist = a.hist.map((p) => p / 10);
        }
        evts.push({ type: 'reform' });
      }

      // 업종 재료: 진짜는 뉴스가 도는 시점에, 가짜는 가끔 생겨난다
      if (W.week > 0) {
        const prevT = SK.tOf(W.week - 1);
        for (let i = rumors.length - 1; i >= 0; i--) if (rumors[i].to <= W.week) rumors.splice(i, 1);
        for (const sector in waves) {
          if (!W.assets.some((a) => a.def.sector === sector && a.listed && !a.dead)) continue;
          for (const x of waves[sector]) if (x.showFrom > prevT && x.showFrom <= t) news((x.good ? '호재 · ' : '악재 · ') + sector, x.text + '.');
          if (rumors.some((x) => x.sector === sector) || rnd() > 1 / 130) continue;
          const good = rnd() < 0.5, r = rnd(), sign = good ? 1 : -1;
          const x = {
            sector, good, text: RUMORS[good ? 'good' : 'bad'][Math.floor(rnd() * 10)],
            from: W.week, to: W.week + 16 + Math.floor(rnd() * 45),
            v: r < 0.45 ? 0 : r < 0.75 ? -sign * 0.35 : sign * 0.4 // 절반 가까이는 헛소문, 일부는 거꾸로 간다
          };
          rumors.push(x);
          news((good ? '호재 · ' : '악재 · ') + sector, x.text + '.');
        }
      }

      const aLog = Math.log(SK.indexAnchor(t));
      const dA = prevA === null ? 0 : aLog - prevA;
      prevA = aLog;
      const n1 = noise * 0.97 + 0.018 * gauss();
      const dN = n1 - noise;
      noise = n1;
      W.index = Math.exp(aLog + noise);
      W.idxHist.push(W.index);
      btcNoise = btcNoise * 0.9 + 0.07 * gauss();

      for (const a of W.assets) {
        const def = a.def;
        const z = gauss(); // 상장 여부와 무관하게 뽑아 난수 순서를 고정한다
        if (a.dead) continue;
        if (!a.listed) {
          if (t < def.listT) continue;
          a.listed = true;
          a.listWeek = W.week;
          if (a.kind === 'stock') a.lp = Math.log(def.p0);
          if (W.week > 0) news('신규 상장: ' + def.name, def.desc, a.kind === 'crypto');
        } else if (a.kind === 'stock') {
          const dev1 = a.dev * 0.996 + def.sigma * z;
          a.lp += def.beta * (dA + dN) + (def.alpha + sectorDrift(def.sector, t, W.week)) / WPY + (dev1 - a.dev);
          a.dev = dev1;
        }
        if (a.kind === 'etf') a.lp = Math.log(W.index * 10);
        if (a.kind === 'crypto') a.lp = Math.log(interp(SK.BTC_ANCHORS, t, true)) + btcNoise;
        a.price = SK.roundPx(Math.exp(a.lp));

        if (def.end && t >= def.end.t) {
          a.price = SK.roundPx(a.price * def.end.mult);
          a.dead = true;
          a.endType = def.end.type;
          const msg = {
            merge: ['합병: ' + def.name, '다른 회사와 합쳐지며 상장이 끝났다. 주주에게는 마지막 가격으로 대금이 지급된다.'],
            delist: ['상장폐지: ' + def.name, '거래가 끝났다. 보유 주식은 마지막 가격으로 정리된다.'],
            bankrupt: ['부도: ' + def.name, '회사가 무너졌다. 주식은 정리매매 가격으로 처분된다.']
          }[def.end.type];
          news(msg[0], msg[1], true);
          evts.push({ type: 'end', asset: a });
        }
        a.hist.push(a.price);
      }
      return evts;
    };

    return W;
  };
})(window.SK);
