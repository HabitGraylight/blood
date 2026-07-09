import React from "react";

// 星星坐标:避开右上月亮与钟楼区域(x 1060-1310, y < 250)
const STARS = [
  [70, 110, 1.8], [140, 300, 1.3], [215, 80, 2.2], [300, 190, 1.5],
  [360, 420, 1.2], [430, 120, 2.0], [520, 260, 1.4], [600, 60, 1.7],
  [665, 350, 1.1], [760, 150, 2.1], [830, 290, 1.4], [905, 90, 1.8],
  [955, 390, 1.2], [1010, 210, 1.5], [1050, 440, 1.3], [980, 300, 1.4],
  [1290, 330, 1.6], [1340, 150, 2.0], [1400, 60, 1.5], [1375, 340, 1.2],
  [500, 470, 1.1], [900, 480, 1.4], [1300, 470, 1.2], [160, 500, 1.2],
  [60, 380, 1.5], [250, 330, 1.1], [680, 240, 1.2], [390, 300, 1.7],
  [1420, 240, 1.6], [120, 60, 1.4], [560, 180, 1.2], [40, 220, 1.1],
  [770, 60, 1.6], [1240, 420, 1.1],
];

// 地面萤火:x, 起始 y, 时长 s, 延迟 s
const EMBERS = [
  [180, 850, 11, 0], [420, 830, 13, 3], [640, 860, 9, 6],
  [860, 840, 12, 1.5], [1040, 855, 10, 4.5], [1330, 835, 14, 7.5],
];

const CX = 1180; // 钟面圆心:位于月亮正下方
const CY = 524;

export function HomeBackdrop() {
  return (
    <svg
      className="home-backdrop"
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="hb-mist-warm">
          <stop offset="0%" stopColor="rgba(233, 217, 172, 0.16)" />
          <stop offset="60%" stopColor="rgba(233, 217, 172, 0.075)" />
          <stop offset="100%" stopColor="rgba(233, 217, 172, 0)" />
        </radialGradient>
        <radialGradient id="hb-mist-cool">
          <stop offset="0%" stopColor="rgba(169, 158, 201, 0.13)" />
          <stop offset="60%" stopColor="rgba(169, 158, 201, 0.06)" />
          <stop offset="100%" stopColor="rgba(169, 158, 201, 0)" />
        </radialGradient>
        <radialGradient id="hb-clock-glow-grad">
          <stop offset="0%" stopColor="rgba(231, 208, 155, 0.5)" />
          <stop offset="100%" stopColor="rgba(231, 208, 155, 0)" />
        </radialGradient>
        <linearGradient id="hb-ground-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(7, 6, 10, 0)" />
          <stop offset="100%" stopColor="rgba(7, 6, 10, 0.9)" />
        </linearGradient>
        <linearGradient
          id="hb-shoot-grad"
          gradientUnits="userSpaceOnUse"
          x1="0" y1="0" x2="90" y2="42"
        >
          <stop offset="0%" stopColor="rgba(233, 224, 205, 0)" />
          <stop offset="100%" stopColor="rgba(233, 224, 205, 0.9)" />
        </linearGradient>

        {/* 天际薄雾与地面雾,各定义一份,平移复用做无缝循环 */}
        <g id="hb-sky-mist">
          <ellipse cx="200" cy="150" rx="240" ry="30" fill="url(#hb-mist-warm)" />
          <ellipse cx="560" cy="95" rx="190" ry="24" fill="url(#hb-mist-warm)" />
          <ellipse cx="920" cy="185" rx="270" ry="34" fill="url(#hb-mist-warm)" />
          <ellipse cx="1250" cy="115" rx="210" ry="28" fill="url(#hb-mist-warm)" />
        </g>
        <g id="hb-fog">
          <ellipse cx="160" cy="875" rx="320" ry="42" fill="url(#hb-mist-cool)" />
          <ellipse cx="620" cy="852" rx="360" ry="48" fill="url(#hb-mist-cool)" />
          <ellipse cx="1020" cy="882" rx="330" ry="44" fill="url(#hb-mist-warm)" />
          <ellipse cx="1360" cy="848" rx="280" ry="38" fill="url(#hb-mist-cool)" />
        </g>
      </defs>

      {/* 星空 */}
      <g>
        {STARS.map(([x, y, r], i) => (
          <circle
            key={i}
            className="hb-star"
            cx={x}
            cy={y}
            r={r}
            fill="#e2d8bd"
            style={{
              animationDuration: `${2.8 + (i % 5) * 0.6}s`,
              animationDelay: `${(i * 0.53) % 4}s`,
            }}
          />
        ))}
      </g>

      {/* 流星 */}
      <g className="hb-shoot">
        <line x1="0" y1="0" x2="90" y2="42" stroke="url(#hb-shoot-grad)" strokeWidth="2.2" strokeLinecap="round" />
      </g>

      {/* 高空薄雾(会飘过月亮) */}
      <g className="hb-mist-sky">
        <use href="#hb-sky-mist" />
        <use href="#hb-sky-mist" x="1440" />
      </g>

      {/* 乌鸦:路线掠过月亮 */}
      <g className="hb-crow hb-crow-1">
        <path d="M-10 0 Q -5 -7 0 -1.5 Q 5 -7 10 0 Q 5 -3.5 0 0.5 Q -5 -3.5 -10 0 Z" />
      </g>
      <g className="hb-crow hb-crow-2">
        <path d="M-10 0 Q -5 -7 0 -1.5 Q 5 -7 10 0 Q 5 -3.5 0 0.5 Q -5 -3.5 -10 0 Z" />
      </g>

      {/* 远景屋脊 */}
      <path
        fill="#1a1626"
        opacity="0.65"
        d="M0 900 L0 796 L64 796 L96 748 L128 796 L128 820 L208 820 L208 772 L232 754 L256 772 L256 820 L336 820 L336 796 L376 758 L416 796 L416 838 L520 838 L520 856 L640 856 L640 872 L800 872 L800 852 L888 852 L888 820 L920 796 L952 820 L952 844 L1032 844 L1032 806 L1076 770 L1120 806 L1120 838 L1208 838 L1208 812 L1264 812 L1284 776 L1304 812 L1376 812 L1376 792 L1440 792 L1440 900 Z"
      />

      {/* 近景屋脊与烟囱 */}
      <g fill="#0a0812">
        <path d="M0 900 L0 852 L88 852 L120 818 L152 852 L152 872 L296 872 L296 840 L344 840 L344 868 L488 868 L488 884 L952 884 L952 864 L1048 864 L1080 830 L1112 864 L1112 880 L1256 880 L1256 856 L1320 856 L1320 878 L1440 878 L1440 900 Z" />
        <rect x="200" y="844" width="9" height="28" />
        <rect x="380" y="852" width="9" height="24" />
      </g>

      {/* 炊烟 */}
      <g>
        {[0, 3, 6].map((d) => (
          <circle
            key={`s1-${d}`}
            className="hb-smoke"
            cx="204"
            cy="840"
            r={4 + d * 0.5}
            fill="url(#hb-mist-cool)"
            style={{ animationDelay: `${d}s` }}
          />
        ))}
        {[1.5, 4.5, 7.5].map((d) => (
          <circle
            key={`s2-${d}`}
            className="hb-smoke"
            cx="384"
            cy="848"
            r={3.5 + d * 0.4}
            fill="url(#hb-mist-cool)"
            style={{ animationDelay: `${d}s` }}
          />
        ))}
      </g>

      {/* 小镇零星灯火 */}
      {[
        [318, 856, 0], [500, 874, 1], [1076, 846, 2], [700, 888, 3], [250, 880, 4],
      ].map(([x, y, i]) => (
        <rect
          key={i}
          className="hb-window"
          x={x}
          y={y}
          width="4"
          height="6"
          style={{ animationDuration: `${6 + i * 1.3}s`, animationDelay: `${i * 1.7}s` }}
        />
      ))}

      {/* 钟楼:立于月亮之下 */}
      <g>
        <g fill="#060509">
          <path d="M1112 452 L1180 330 L1248 452 Z" stroke="rgba(231, 208, 155, 0.2)" strokeWidth="1" />
          <rect x="1178" y="306" width="4" height="26" />
          <rect x="1108" y="450" width="144" height="16" />
          <rect x="1122" y="466" width="116" height="118" />
          <rect x="1108" y="584" width="144" height="16" />
          <rect x="1126" y="600" width="108" height="300" />
          <rect x="1112" y="858" width="136" height="42" />
        </g>
        <circle cx="1180" cy="302" r="3.5" fill="#060509" stroke="rgba(231, 208, 155, 0.45)" strokeWidth="0.8" />

        {/* 钟面 */}
        <circle className="hb-clock-glow" cx={CX} cy={CY} r="80" fill="url(#hb-clock-glow-grad)" />
        <circle cx={CX} cy={CY} r="37" fill="#0b0911" stroke="rgba(231, 208, 155, 0.5)" strokeWidth="1.5" />
        <circle cx={CX} cy={CY} r="31" fill="none" stroke="rgba(231, 208, 155, 0.16)" strokeWidth="1" />
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i * Math.PI) / 6;
          const c = Math.cos(a);
          const s = Math.sin(a);
          const r1 = i % 3 === 0 ? 27 : 30;
          return (
            <line
              key={i}
              x1={CX + r1 * c}
              y1={CY + r1 * s}
              x2={CX + 33 * c}
              y2={CY + 33 * s}
              stroke="rgba(231, 208, 155, 0.45)"
              strokeWidth={i % 3 === 0 ? 1.6 : 1}
            />
          );
        })}
        <line className="hb-hand hb-hand-hour" x1={CX} y1={CY} x2={CX - 14.7} y2={CY - 8.5} strokeWidth="3" />
        <line className="hb-hand hb-hand-min" x1={CX} y1={CY} x2={CX + 19.9} y2={CY - 11.5} strokeWidth="1.8" />
        <circle cx={CX} cy={CY} r="2.5" fill="#c2a061" />

        {/* 塔身窗火 */}
        <rect className="hb-window" x="1162" y="640" width="9" height="22" rx="4.5" style={{ animationDuration: "8s" }} />
        <rect className="hb-window" x="1189" y="640" width="9" height="22" rx="4.5" style={{ animationDuration: "9.5s", animationDelay: "2.4s" }} />
      </g>

      {/* 地面萤火 */}
      <g>
        {EMBERS.map(([x, y, dur, delay], i) => (
          <circle
            key={i}
            className="hb-ember"
            cx={x}
            cy={y}
            r="1.7"
            fill="#e7d09b"
            style={{ animationDuration: `${dur}s`, animationDelay: `${delay}s` }}
          />
        ))}
      </g>

      {/* 地面压暗 */}
      <rect x="0" y="760" width="1440" height="140" fill="url(#hb-ground-grad)" />

      {/* 近地雾,反向漂移 */}
      <g className="hb-mist-fog">
        <use href="#hb-fog" />
        <use href="#hb-fog" x="1440" />
      </g>
    </svg>
  );
}
