/**
 * 可播种随机数发生器 (mulberry32)。
 * 引擎所有随机决策都经由它,保证联机模式下房主端结算可复现、可调试。
 */
export function createRng(seed) {
  let a = seed >>> 0;
  const rng = {
    draws: 0,
    next() {
      rng.draws++;
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
  };
  const next = () => rng.next();
  return Object.assign(rng, {
    /** [0, n) 整数 */
    int(n) {
      return Math.floor(next() * n);
    },
    pick(arr) {
      return arr[this.int(arr.length)];
    },
    /** 以概率 p 返回 true */
    chance(p) {
      return next() < p;
    },
    shuffle(arr) {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = this.int(i + 1);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    }
  });
}

export function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff);
}
