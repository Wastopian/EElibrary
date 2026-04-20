// EE Library design system — tokens + primitives
// Matches globals.css "Precision Lab editorial" theme exactly

const EE_T = {
  bg: '#eef1f4',
  surface: '#fbfcfd',
  surfaceElevated: '#ffffff',
  surfaceMuted: '#f4f7fa',
  border: '#d4dce3',
  borderStrong: '#b8c4cf',
  text: '#141a1f',
  textMuted: '#5a6670',
  accent: '#2a5f9a',
  accentHover: '#1d4a7a',
  accentSoft: '#e4eef8',
  danger: '#b03a3a',
  dangerSoft: '#f7eaea',
  review: '#9a6f1e',
  reviewSoft: '#f7f0e4',
  verified: '#2d6a45',
  verifiedSoft: '#e8f4ec',
  generated: '#5c4b8a',
  generatedSoft: '#efeaf7',
  techBg: '#12161c',
  techSurface: '#1a2028',
  techBorder: '#2a323c',
  techText: '#e9eef3',
  techMuted: '#9aa7b2',
  mono: '"Cascadia Mono", "SFMono-Regular", Consolas, monospace',
  sans: '"Segoe UI", Inter, system-ui, sans-serif',
  rSm: '6px',
  rMd: '10px',
  rLg: '14px',
  shadow: '0 1px 2px rgba(20,26,31,0.04), 0 8px 24px rgba(20,26,31,0.06)',
};

function EEBadge({ label, tone = 'neutral' }) {
  const tones = {
    neutral:   { bg: EE_T.surfaceMuted,    border: EE_T.border,                       color: EE_T.textMuted  },
    info:      { bg: EE_T.accentSoft,      border: 'rgba(42,95,154,0.25)',             color: EE_T.accentHover },
    verified:  { bg: EE_T.verifiedSoft,    border: 'rgba(45,106,69,0.28)',             color: EE_T.verified   },
    review:    { bg: EE_T.reviewSoft,      border: 'rgba(154,111,30,0.35)',            color: EE_T.review     },
    danger:    { bg: EE_T.dangerSoft,      border: 'rgba(176,58,58,0.35)',             color: EE_T.danger     },
    generated: { bg: EE_T.generatedSoft,   border: 'rgba(92,75,138,0.35)',             color: EE_T.generated  },
  };
  const s = tones[tone] || tones.neutral;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      background: s.bg, border: `1px solid ${s.border}`, color: s.color,
      borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600,
      letterSpacing: '0.02em', minHeight: '26px', padding: '0 10px',
      whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

function EETrustMeter({ score, tone = 'info', label = 'Trust' }) {
  const bars = {
    verified: EE_T.verified, review: EE_T.review, danger: EE_T.danger,
    info: EE_T.accent, neutral: EE_T.accent, generated: EE_T.generated,
  };
  return (
    <div style={{ display: 'grid', gap: '6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: EE_T.textMuted, fontSize: '0.82rem' }}>
        <span>{label}</span><span>{Math.round(score * 100)}%</span>
      </div>
      <div style={{ background: EE_T.surfaceMuted, border: `1px solid ${EE_T.border}`, borderRadius: EE_T.rSm, height: '10px', overflow: 'hidden' }}>
        <span style={{ display: 'block', width: `${score * 100}%`, height: '100%', background: bars[tone] || EE_T.accent }} />
      </div>
    </div>
  );
}

function EEKicker({ children, style }) {
  return (
    <p style={{ color: EE_T.accent, fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.12em', margin: '0 0 6px', textTransform: 'uppercase', ...style }}>
      {children}
    </p>
  );
}

function EESpinner() {
  return (
    <span style={{
      display: 'inline-block', width: 14, height: 14, flexShrink: 0,
      border: `2px solid ${EE_T.border}`, borderTopColor: EE_T.accent,
      borderRadius: '50%', animation: 'ee-spin 0.8s linear infinite',
    }} />
  );
}

Object.assign(window, { EE_T, EEBadge, EETrustMeter, EEKicker, EESpinner });
