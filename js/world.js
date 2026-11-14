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
  SK.divYield = (def, t) => (SK.DIV_YIELD[def.sector] || 0) * Math.min(3, Math.max(1, interp(SK.RATES, t, false) / 0.04));
  SK.shortBanned = (t) => SK.SHORT_BANS.some(([a, b]) => t >= a && t < b);
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

  /* randomFrom: 이 주차까지는 실제 역사를 따르고, 그 뒤로는 지수·재료·부도·비트코인이 모두 난수로 흘러간다.
   * null이면 끝까지 역사를 따른다. */
  SK.createWorld = function (seed, randomFrom) {
    if (randomFrom === undefined) randomFrom = null;
    const randT = randomFrom === null ? Infinity : SK.tOf(randomFrom);
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
      }).filter((x) => x.from <= randT); // 랜덤 미래에서는 입사 뒤에 시작될 역사 속 재료를 버린다
    }
    waves['가상자산'] = [];
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const btcK = 0.6 + 0.5 * rnd(); // 판마다 다른 비트코인의 운
    let reg = { type: 'normal', left: Infinity }, baseLog = 0, btcReg = { type: 'calm', left: 0 }, btcLog = null, banUntil = -1, trendLog = null;
    const setReg = (type, week) => {
      const left = { bull: 40 + rnd() * 90, bear: 30 + rnd() * 70, crash: 5 + rnd() * 9, normal: Infinity }[type];
      reg = { type, left, rate: type === 'crash' ? (-(0.25 + 0.35 * rnd()) / left) * WPY : 0, newsAt: type === 'crash' ? week : week + 2 + Math.floor(rnd() * 6) };
    };
    // 랜덤 미래의 지수 한 주 변화: 평소·강세·약세·폭락 국면이 불규칙하게 바뀐다
    const macroStep = (t, week) => {
      if (reg.type === 'normal') {
        const r = rnd();
        if (r < 1 / 160) setReg('bull', week); else if (r < 1 / 160 + 1 / 350) setReg('bear', week); else if (r < 1 / 160 + 1 / 350 + 1 / 450) setReg('crash', week);
      } else if (--reg.left <= 0) {
        const r = rnd(), p = reg.type;
        setReg(p === 'bull' ? (r < 0.25 ? 'crash' : r < 0.5 ? 'bear' : 'normal') : p === 'crash' ? (r < 0.6 ? 'bull' : 'normal') : r < 0.4 ? 'bull' : 'normal', week);
      }
      const infl = Math.log(SK.cpi(t + 0.5) / SK.cpi(t - 0.5));
      // 장기 추세(물가 + 6%)에서 너무 멀어지면 천천히 끌려온다
      if (trendLog === null) trendLog = baseLog;
      trendLog += (0.06 + infl) / WPY;
      const mu = { normal: 0.05 + infl, bull: 0.35 + infl, bear: -0.28, crash: reg.rate }[reg.type] - 0.08 * (baseLog - trendLog);
      return mu / WPY + 0.012 * gauss();
    }
    const rumors = []; // { sector, good, text, from, to (주차), v }
    const sectorDrift = (sector, t, week) => {
      let d = 0;
      for (const x of waves[sector] || []) if (t >= x.from && t < x.to) d += x.v;
      for (const x of rumors) if (x.sector === sector && week < x.to) d += x.v;
      return d;
    };

    const W = { seed, randomFrom, week: -1, t: 0, unit: '환', index: 0, idxHist: [], assets: [], byId: {}, news: [] };
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

    W.shortBanned = () => (W.randomFrom !== null && W.week > W.randomFrom ? W.week < banUntil : SK.shortBanned(W.t));

    W.step = function () {
      W.week++;
      const t = (W.t = SK.tOf(W.week));
      const evts = [];
      const news = (title, body, major) => {
        const n = { week: W.week, title, body, major: !!major };
        W.news.push(n);
        evts.push({ type: 'news', news: n });
      };

      const rand = randomFrom !== null && W.week > randomFrom;
      for (const e of EVENT_WEEKS) if (e.week === W.week && (!rand || SK.STRUCTURAL.includes(e.title))) news(e.title, e.body, e.major);

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
          // 랜덤 미래: 업종 재료도 새로 생겨난다. 문구는 그 업종이 겪어 본 재료와 흔한 재료에서 고른다.
          if (rand && !waves[sector].some((x) => x.to > t) && rnd() < 1 / 90) {
            const good = rnd() < 0.5, r = rnd(), len = 0.4 + 1.6 * rnd(), mag = 0.15 + 0.4 * rnd();
            const m = r < 0.65 ? 0.6 + 0.7 * rnd() : r < 0.9 ? 0.3 * rnd() : -0.5;
            const pool = (SK.SECTOR_WAVES[sector] || []).filter((x) => x[2] > 0 === good && x[0] <= t).map((x) => x[3]).concat(RUMORS[good ? 'good' : 'bad'].slice(0, 3));
            const from = t + 0.02, lag = Math.min(0.5, len * 0.3) * rnd();
            waves[sector].push({ from, to: from + len, v: (good ? 1 : -1) * mag * m, good, text: pick(pool), showFrom: from + lag, showTo: from + len + Math.min(0.4, len * 0.25) * rnd() });
          }
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

      let dA;
      if (!rand) {
        const aLog = Math.log(SK.indexAnchor(t));
        dA = prevA === null ? 0 : aLog - prevA;
        prevA = baseLog = aLog;
      } else {
        dA = macroStep(t, W.week);
        baseLog += dA;
        if (reg.newsAt === W.week) {
          const [title, body] = pick(SK.MACRO[reg.type] || [[]]);
          if (title) news(title, body, reg.type === 'crash');
          if (reg.type === 'crash') {
            banUntil = W.week + Math.round(reg.left) + 20;
            news('공매도 한시 금지', '주가 급락에 당국이 공매도를 막았다.');
          }
        } else if (rnd() < 1 / 200) { // 시장 전체에도 헛소문이 돈다
          const [title, body] = pick(SK.MACRO[rnd() < 0.5 ? 'bull' : 'bear']);
          news(title, body);
        }
        if (banUntil === W.week) news('공매도 재개', '금지 조치가 풀렸다.');
      }
      const n1 = noise * 0.97 + 0.018 * gauss();
      const dN = n1 - noise;
      noise = n1;
      W.index = Math.exp(baseLog + noise);
      W.idxHist.push(W.index);
      btcNoise = btcNoise * 0.9 + 0.07 * gauss();

      // 배당은 1년에 한 번, 4월 첫 주에 지급된다
      const divWeek = W.week > 0 && SK.dateOf(W.week).getUTCMonth() === 3 && SK.dateOf(W.week - 1).getUTCMonth() === 2;
      for (const a of W.assets) {
        const def = a.def;
        let fresh = false, div = 0;
        const z = gauss(); // 상장 여부와 무관하게 뽑아 난수 순서를 고정한다
        if (a.dead) continue;
        if (!a.listed) {
          if (t < def.listT) continue;
          a.listed = true;
          fresh = true;
          a.listWeek = W.week;
          if (a.kind === 'stock') a.lp = Math.log(def.p0);
          if (W.week > 0) news('신규 상장: ' + def.name, def.desc, a.kind === 'crypto');
        } else if (a.kind === 'stock') {
          const dev1 = a.dev * 0.996 + def.sigma * z;
          a.lp += def.beta * (dA + dN) + (def.alpha + SK.divYield(def, t) + sectorDrift(def.sector, t, W.week)) / WPY + (dev1 - a.dev);
          a.dev = dev1;
        }
        if (a.kind === 'etf') a.lp = Math.log(W.index * 10);
        if (a.kind === 'crypto') {
          if (!rand) a.lp = (btcLog = Math.log(interp(SK.BTC_ANCHORS, t, true))) + btcNoise;
          else {
            // 랜덤 미래의 비트코인: 초기일수록 가파르게 오르는 추세에 급등·급락 국면이 얹힌다
            if (btcLog === null) btcLog = 0;
            if (--btcReg.left <= 0) {
              const p = btcReg.type, r = rnd();
              const type = p === 'boom' ? (r < 0.8 ? 'bust' : 'calm') : p === 'bust' ? 'calm' : r < 1 / 60 ? 'boom' : r < 1 / 60 + 1 / 300 ? 'bust' : 'calm';
              btcReg = { type, left: type === 'boom' ? 25 + rnd() * 30 : type === 'bust' ? 30 + rnd() * 35 : 1 };
              if (type !== 'calm') {
                const from = t + 0.05 + 0.15 * rnd(), good = type === 'boom';
                waves['가상자산'].push({ from, to: from + 0.5, v: 0, good, text: pick(SK.BTC_NEWS[good ? 'good' : 'bad']), showFrom: from, showTo: from + 0.4 + 0.4 * rnd() });
              }
            }
            btcLog += (btcK * 3.2 * Math.exp(-(t - 2009) / 5) + { boom: 2.0, bust: -1.6, calm: 0 }[btcReg.type]) / WPY + 0.06 * z;
            a.lp = btcLog + btcNoise;
          }
        }
        // 랜덤 미래의 부도: 자금난 소문이 먼저 돌고, 몇 달 뒤 쓰러지거나 살아난다
        let failed = false;
        if (rand && a.kind === 'stock' && !fresh) {
          if (!a.distress) {
            const hz = (1 / 20000) * (reg.type === 'crash' || reg.type === 'bear' ? 3 : 1) * (a.dev < -0.6 ? 3 : 1);
            if (rnd() < hz) {
              a.distress = { until: W.week + 8 + Math.floor(rnd() * 26), fail: rnd() < 0.65 };
              news(def.name + ' 자금난 소문', pick(['어음을 막기 어렵다는 말이 돈다.', '차입금이 감당하기 어려운 수준이라는 보도가 나왔다.', '주거래 은행이 대출 연장을 망설인다.']), true);
            }
          } else {
            a.lp -= 1.2 / WPY;
            if (W.week >= a.distress.until) {
              if (a.distress.fail) failed = true;
              else { a.lp += 0.25; a.distress = null; news(def.name + ' 위기 탈출', '채권단 지원으로 자금난을 넘겼다.'); }
            }
          }
        }
        if (divWeek && !fresh) {
          const y = SK.divYield(def, t);
          if (y > 0) {
            div = Math.exp(a.lp) * y;
            if (a.kind === 'stock') a.lp += Math.log(1 - y); // 배당락
          }
        }
        a.price = SK.roundPx(Math.exp(a.lp));
        if (div > 0) evts.push({ type: 'div', asset: a, amount: div });

        // 역사 속 퇴출은 입사 전의 것과 제도상 합병·폐지만 따른다
        const end = failed ? { type: 'bankrupt', mult: 0.03 } : def.end && t >= def.end.t && (def.end.t <= randT || def.end.mult === 1) ? def.end : null;
        if (end) {
          a.price = SK.roundPx(a.price * end.mult);
          a.dead = true;
          a.endType = end.type;
          const msg = {
            merge: ['합병: ' + def.name, '다른 회사와 합쳐지며 상장이 끝났다. 주주에게는 마지막 가격으로 대금이 지급된다.'],
            delist: ['상장폐지: ' + def.name, '거래가 끝났다. 보유 주식은 마지막 가격으로 정리된다.'],
            bankrupt: ['부도: ' + def.name, '회사가 무너졌다. 주식은 정리매매 가격으로 처분된다.']
          }[end.type];
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
