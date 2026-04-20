// EE Library — page-level screen components
// Depends on: EE_T, EEBadge, EETrustMeter, EEKicker from ee-ds.jsx
// Depends on: ImportPanelInline, ImportPanelCard, ImportPanelCommand, ImportStatesGrid from ee-import.jsx

/* ─────────────────────────────────────────────────────────────────────────
   HOME SCREEN
───────────────────────────────────────────────────────────────────────── */
function HomeScreen({ panelVariant, onPartOpen }) {
  const T = EE_T;
  const Panel = panelVariant === 'card' ? ImportPanelCard
              : panelVariant === 'command' ? ImportPanelCommand
              : ImportPanelInline;

  return (
    <div style={{ background: T.surfaceElevated, border: `1px solid ${T.border}`, borderRadius: T.rLg, boxShadow: T.shadow, padding: '36px 36px 32px', position: 'relative', overflow: 'hidden' }}>
      {/* Grid ornament */}
      <div style={{ position: 'absolute', right: '-20%', top: 0, width: '55%', height: '100%', opacity: 0.3, pointerEvents: 'none', transform: 'skewX(-8deg)', backgroundImage: `repeating-linear-gradient(90deg, ${T.border} 0 1px, transparent 1px 48px), repeating-linear-gradient(0deg, ${T.border} 0 1px, transparent 1px 48px)` }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <EEKicker>EE Library</EEKicker>
        <h1 style={{ fontSize: 'clamp(1.65rem, 2.6vw, 2.35rem)', fontWeight: 650, letterSpacing: '-0.02em', lineHeight: 1.2, margin: '0 0 12px', maxWidth: '36rem' }}>
          Find parts with honest CAD and export readiness.
        </h1>
        <p style={{ color: T.textMuted, fontSize: '1.05rem', lineHeight: 1.55, margin: '0 0 28px', maxWidth: '40rem' }}>
          Normalized specs, connector build sets, and file-backed engineering assets—without treating references, drafts, or approvals as production-ready exports.
        </p>

        {/* Search */}
        <div style={{ maxWidth: 640 }}>
          <label style={{ color: T.textMuted, display: 'block', fontSize: '0.88rem', fontWeight: 600, marginBottom: 10 }}>Search by MPN or keyword</label>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0,1fr) auto' }}>
            <input placeholder="TPS7A02, QFN-16, connector series…" style={{ background: T.surfaceElevated, border: `1px solid ${T.border}`, borderRadius: T.rMd, color: T.text, font: 'inherit', fontSize: '1.05rem', minHeight: 52, padding: '0 16px', width: '100%' }} />
            <button style={{ background: T.accent, border: 'none', borderRadius: T.rMd, color: '#fff', cursor: 'pointer', font: 'inherit', fontWeight: 600, minHeight: 52, minWidth: 140, padding: '0 22px' }}>Search catalog</button>
          </div>
        </div>

        {/* Catalog status strip */}
        <div style={{ alignItems: 'center', background: T.surfaceMuted, border: `1px solid ${T.border}`, borderRadius: T.rMd, display: 'flex', flexWrap: 'wrap', gap: '10px 14px', marginTop: 22, padding: '12px 16px' }}>
          <span style={{ color: T.textMuted, fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Catalog</span>
          <EEBadge label="DB-backed catalog" tone="verified" />
          <EEBadge label="API healthy" tone="info" />
          <EEBadge label="Database connected" tone="verified" />
        </div>

        {/* Quick actions */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 22 }}>
          {['Browse connectors', 'Review missing CAD', 'Recently updated'].map(a => (
            <button key={a} style={{ background: T.surfaceElevated, border: `1px solid ${T.border}`, borderRadius: T.rMd, color: T.text, cursor: 'pointer', font: 'inherit', fontWeight: 600, fontSize: '0.88rem', minHeight: 38, padding: '0 16px' }}>{a}</button>
          ))}
        </div>

        {/* The panel variant */}
        <Panel onPartOpen={onPartOpen} />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   STATES SCREEN
───────────────────────────────────────────────────────────────────────── */
function StatesScreen() {
  const T = EE_T;
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <EEKicker>Design reference</EEKicker>
        <h2 style={{ margin: '0 0 6px', fontSize: '1.2rem', fontWeight: 650, letterSpacing: '-0.01em' }}>Import flow — all four states</h2>
        <p style={{ color: T.textMuted, margin: 0, fontSize: '0.92rem', maxWidth: '44rem', lineHeight: 1.5 }}>
          Static renders for design review. Each state maps to a step in the import machine: idle → submitting → success or failure.
          Use the Homepage screen to interact with each variant live.
        </p>
      </div>
      <ImportStatesGrid />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   ADMIN SCREEN
───────────────────────────────────────────────────────────────────────── */
function AdminScreen() {
  const T = EE_T;
  const [dark, setDark] = React.useState(true);
  const bg     = dark ? T.techBg      : T.bg;
  const surf   = dark ? T.techSurface : T.surfaceElevated;
  const bdr    = dark ? T.techBorder  : T.border;
  const txt    = dark ? T.techText    : T.text;
  const muted  = dark ? T.techMuted   : T.textMuted;
  const link   = dark ? '#9ecfff'     : T.accent;

  const imports = [
    { mpn: 'SN74ABT245B',    provider: 'jlcparts', status: 'imported', partId: 'part_001', ts: '2025-04-19 14:32' },
    { mpn: 'RC-02W300JT',    provider: 'jlcparts', status: 'imported', partId: 'part_002', ts: '2025-04-19 13:18' },
    { mpn: 'TPS7A0201PDBVR', provider: 'jlcparts', status: 'failed',   partId: null,       ts: '2025-04-19 12:55' },
    { mpn: 'LM358DR',        provider: 'jlcparts', status: 'imported', partId: 'part_004', ts: '2025-04-18 17:40' },
    { mpn: 'STM32F103C8T6',  provider: 'jlcparts', status: 'imported', partId: 'part_005', ts: '2025-04-18 16:22' },
    { mpn: 'SMBJ33A',        provider: 'jlcparts', status: 'imported', partId: 'part_006', ts: '2025-04-18 11:07' },
  ];

  const cell = { padding: '10px 14px', borderBottom: `1px solid ${bdr}` };
  const th   = { ...cell, color: muted, fontSize: '0.74rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' };

  return (
    <div style={{ background: bg, borderRadius: T.rLg, padding: '28px 32px', color: txt }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <EEKicker style={{ color: dark ? '#9ecfff' : T.accent }}>Admin</EEKicker>
          <h2 style={{ margin: '0 0 6px', fontSize: '1.45rem', fontWeight: 650, color: txt }}>Provider Import Management</h2>
          <p style={{ color: muted, margin: 0, fontSize: '0.9rem', maxWidth: '46rem' }}>Technical access to import records. Review, re-import, or delete provider entries.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <EEBadge label="Admin" tone={dark ? 'generated' : 'info'} />
          <button onClick={() => setDark(v => !v)}
            style={{ background: surf, border: `1px solid ${bdr}`, borderRadius: T.rMd, color: muted, cursor: 'pointer', font: 'inherit', fontSize: '0.82rem', fontWeight: 600, minHeight: 34, padding: '0 14px' }}>
            {dark ? '☀ Light' : '☾ Dark'}
          </button>
        </div>
      </div>

      {/* Dense import form */}
      <div style={{ background: surf, border: `1px solid ${bdr}`, borderRadius: T.rMd, padding: '16px 18px', marginBottom: 18 }}>
        <div style={{ color: muted, fontSize: '0.74rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>Quick import</div>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '140px 1fr 1fr 1fr auto', alignItems: 'center' }}>
          <select style={{ background: dark ? T.techBg : T.surfaceMuted, border: `1px solid ${bdr}`, borderRadius: T.rMd, color: muted, font: 'inherit', fontSize: '0.84rem', fontWeight: 600, minHeight: 38, padding: '0 10px', cursor: 'pointer', outline: 'none' }}>
            <option>jlcparts</option><option>local-catalog</option>
          </select>
          {['MPN', 'Provider part ID (optional)', 'Manufacturer hint (optional)'].map((ph, i) => (
            <input key={i} placeholder={ph}
              style={{ background: dark ? T.techBg : T.surfaceElevated, border: `1px solid ${bdr}`, borderRadius: T.rMd, color: txt, font: 'inherit', fontSize: '0.86rem', fontFamily: i === 0 ? T.mono : 'inherit', minHeight: 38, padding: '0 10px', width: '100%' }} />
          ))}
          <button style={{ background: dark ? '#1a3a66' : T.accent, border: 'none', borderRadius: T.rMd, color: dark ? '#9ecfff' : '#fff', cursor: 'pointer', font: 'inherit', fontWeight: 600, fontSize: '0.88rem', minHeight: 38, padding: '0 18px', whiteSpace: 'nowrap' }}>
            Import →
          </button>
        </div>
      </div>

      {/* Summary row */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <EEBadge label={`${imports.filter(r => r.status === 'imported').length} imported`} tone="verified" />
        <EEBadge label={`${imports.filter(r => r.status === 'failed').length} failed`} tone="danger" />
        <EEBadge label="jlcparts provider" tone={dark ? 'generated' : 'neutral'} />
      </div>

      {/* Imports table */}
      <div style={{ background: surf, border: `1px solid ${bdr}`, borderRadius: T.rMd, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${bdr}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 650, fontSize: '0.9rem', color: txt }}>Recent imports</span>
          <span style={{ color: muted, fontSize: '0.82rem' }}>{imports.length} records · page 1 of 1</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}>
            <thead>
              <tr>{['MPN', 'Provider', 'Status', 'Part ID', 'Timestamp', 'Actions'].map(h =>
                <th key={h} style={th}>{h}</th>
              )}</tr>
            </thead>
            <tbody>
              {imports.map((imp, i) => (
                <tr key={i}>
                  <td style={{ ...cell, fontFamily: T.mono, fontSize: '0.9rem', fontWeight: 600, color: txt, borderBottom: i < imports.length - 1 ? `1px solid ${bdr}` : 'none' }}>{imp.mpn}</td>
                  <td style={{ ...cell, color: muted, fontSize: '0.86rem', borderBottom: i < imports.length - 1 ? `1px solid ${bdr}` : 'none' }}>{imp.provider}</td>
                  <td style={{ ...cell, borderBottom: i < imports.length - 1 ? `1px solid ${bdr}` : 'none' }}>
                    <EEBadge label={imp.status} tone={imp.status === 'imported' ? 'verified' : 'danger'} />
                  </td>
                  <td style={{ ...cell, fontFamily: T.mono, fontSize: '0.82rem', color: imp.partId ? link : muted, borderBottom: i < imports.length - 1 ? `1px solid ${bdr}` : 'none' }}>{imp.partId || '—'}</td>
                  <td style={{ ...cell, color: muted, fontSize: '0.82rem', whiteSpace: 'nowrap', borderBottom: i < imports.length - 1 ? `1px solid ${bdr}` : 'none' }}>{imp.ts}</td>
                  <td style={{ ...cell, borderBottom: i < imports.length - 1 ? `1px solid ${bdr}` : 'none' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {imp.partId && <button style={{ background: dark ? T.techBg : T.accentSoft, border: `1px solid ${dark ? bdr : 'rgba(42,95,154,0.2)'}`, borderRadius: T.rSm, color: link, cursor: 'pointer', font: 'inherit', fontSize: '0.78rem', minHeight: 28, padding: '0 8px' }}>View</button>}
                      <button style={{ background: dark ? T.techBg : T.surfaceMuted, border: `1px solid ${bdr}`, borderRadius: T.rSm, color: muted, cursor: 'pointer', font: 'inherit', fontSize: '0.78rem', minHeight: 28, padding: '0 8px' }}>Re-import</button>
                      <button style={{ background: dark ? '#281010' : T.dangerSoft, border: `1px solid ${dark ? '#5a1515' : 'rgba(176,58,58,0.3)'}`, borderRadius: T.rSm, color: T.danger, cursor: 'pointer', font: 'inherit', fontSize: '0.78rem', minHeight: 28, padding: '0 8px' }}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   PART DETAIL SCREEN
───────────────────────────────────────────────────────────────────────── */
function DetailScreen({ onBack }) {
  const T = EE_T;
  const part = {
    mpn: 'SN74ABT245B', manufacturer: 'Texas Instruments',
    description: 'Octal bus transceiver, 3-state, 5 V, 20-pin package',
    category: 'Logic ICs', package: 'TSSOP-20', lifecycle: 'active', trustScore: 0.93,
    metrics: [
      { key: 'supply_voltage_min', value: '4.5',  unit: 'V',  source: 'datasheet rev G', status: 'verified' },
      { key: 'supply_voltage_max', value: '5.5',  unit: 'V',  source: 'datasheet rev G', status: 'verified' },
      { key: 'ioh_max',           value: '-32',  unit: 'mA', source: 'datasheet rev G', status: 'verified' },
      { key: 'iol_max',           value: '64',   unit: 'mA', source: 'datasheet rev G', status: 'verified' },
    ],
    assets: [
      { type: 'Footprint', file: '.PcbLib', note: 'origin centered'           },
      { type: 'Symbol',    file: '.SchLib', note: 'pin map matches record'    },
      { type: '3D Model',  file: '.STEP',   note: 'units: mm, bbox extracted' },
      { type: 'Datasheet', file: '.PDF',    note: 'revision G, 28 pages'      },
    ],
    source: { provider: 'jlcparts', partId: 'C5174', status: 'imported', lastImported: '2025-04-19' },
  };

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {/* Back */}
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', font: 'inherit', fontSize: '0.9rem', fontWeight: 600, minHeight: 'auto', padding: 0, textAlign: 'left', width: 'max-content' }}>
        ← Back to search
      </button>

      {/* Hero */}
      <div style={{ background: T.surfaceElevated, border: `1px solid ${T.border}`, borderRadius: T.rLg, boxShadow: T.shadow, padding: '28px 32px', position: 'relative' }}>
        <div style={{ position: 'absolute', height: 1, left: 32, right: 32, top: 18, background: `repeating-linear-gradient(90deg, transparent 0 11px, ${T.border} 11px 12px)`, opacity: 0.6, pointerEvents: 'none' }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 24 }}>
          <div>
            <EEKicker>{part.category}</EEKicker>
            <h1 style={{ fontFamily: T.mono, fontSize: 'clamp(1.75rem, 3vw, 2.5rem)', fontWeight: 600, letterSpacing: '-0.03em', margin: '8px 0 0' }}>{part.mpn}</h1>
            <p style={{ color: T.textMuted, fontSize: '0.95rem', margin: '10px 0 16px' }}>{part.manufacturer} · {part.description}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <EEBadge label={part.manufacturer} tone="neutral" />
              <EEBadge label={`Lifecycle: ${part.lifecycle}`} tone="verified" />
              <EEBadge label={part.package} tone="info" />
              <EEBadge label="Verified" tone="verified" />
            </div>
          </div>
          <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
            <EETrustMeter score={part.trustScore} tone="verified" label="Source confidence" />
            <div style={{ background: T.accentSoft, border: '1px solid rgba(42,95,154,0.2)', borderRadius: T.rMd, padding: '12px 14px', fontSize: '0.86rem', lineHeight: 1.5, color: T.text }}>
              <strong style={{ color: T.accentHover }}>2 providers + manual review</strong> — trust score reflects normalized cross-source agreement.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button style={{ background: T.accent, border: 'none', borderRadius: T.rMd, color: '#fff', cursor: 'pointer', font: 'inherit', fontWeight: 600, fontSize: '0.86rem', minHeight: 38, padding: '0 14px' }}>Altium Export</button>
              <button style={{ background: T.surfaceElevated, border: `1px solid ${T.border}`, borderRadius: T.rMd, color: T.text, cursor: 'pointer', font: 'inherit', fontWeight: 600, fontSize: '0.86rem', minHeight: 38, padding: '0 14px' }}>STEP Download</button>
            </div>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {[
          { label: 'Package',    value: part.package,      sub: '0.65 mm pitch' },
          { label: 'VCC',        value: '4.5 – 5.5 V',    sub: 'recommended operating' },
          { label: 'Temp Range', value: '-40 to 85 °C',   sub: 'commercial/industrial' },
        ].map(({ label, value, sub }) => (
          <div key={label} style={{ background: T.surfaceElevated, border: `1px solid ${T.border}`, borderRadius: T.rMd, padding: '14px 16px' }}>
            <div style={{ color: T.textMuted, fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
            <div style={{ fontFamily: T.mono, fontSize: '1.2rem', fontWeight: 600, letterSpacing: '-0.01em' }}>{value}</div>
            <div style={{ color: T.textMuted, fontSize: '0.78rem', marginTop: 4 }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Technical dark panel — normalized metrics + CAD */}
      <div style={{ background: T.techBg, border: `1px solid ${T.techBorder}`, borderRadius: T.rMd, padding: '20px 22px', color: T.techText }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, borderBottom: `1px solid ${T.techBorder}`, marginBottom: 18, paddingBottom: 12 }}>
          <span style={{ fontFamily: T.mono, fontSize: '0.78rem', color: T.techMuted, fontWeight: 600 }}>02</span>
          <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 650 }}>Normalized metrics</h2>
          <span style={{ color: T.techMuted, fontSize: '0.84rem', marginLeft: 'auto' }}>4 parameters · datasheet rev G</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          {/* Metrics table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>{['Metric', 'Value', 'Unit', 'Status'].map(h =>
                  <th key={h} style={{ borderBottom: `1px solid ${T.techBorder}`, color: T.techMuted, fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em', padding: '8px 10px', textAlign: 'left', textTransform: 'uppercase' }}>{h}</th>
                )}</tr>
              </thead>
              <tbody>
                {part.metrics.map((m, i) => (
                  <tr key={i}>
                    <td style={{ borderBottom: `1px solid ${T.techBorder}`, fontFamily: T.mono, fontSize: '0.82rem', padding: '9px 10px', color: T.techMuted }}>{m.key}</td>
                    <td style={{ borderBottom: `1px solid ${T.techBorder}`, fontFamily: T.mono, fontSize: '0.9rem', fontWeight: 600, padding: '9px 10px', color: T.techText }}>{m.value}</td>
                    <td style={{ borderBottom: `1px solid ${T.techBorder}`, fontSize: '0.84rem', color: T.techMuted, padding: '9px 10px' }}>{m.unit}</td>
                    <td style={{ borderBottom: `1px solid ${T.techBorder}`, padding: '9px 10px' }}><EEBadge label={m.status} tone="verified" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* CAD assets */}
          <div>
            <div style={{ color: T.techMuted, fontSize: '0.74rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>CAD assets</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {part.assets.map(asset => (
                <div key={asset.type} style={{ background: T.techSurface, border: `1px solid ${T.techBorder}`, borderRadius: T.rMd, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontWeight: 650, fontSize: '0.88rem', flex: 1 }}>{asset.type}</span>
                  <span style={{ fontFamily: T.mono, fontSize: '0.78rem', color: T.techMuted }}>{asset.file}</span>
                  <span style={{ color: T.techMuted, fontSize: '0.78rem' }}>{asset.note}</span>
                  <EEBadge label="Verified" tone="verified" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Provider source */}
      <div style={{ background: T.surfaceElevated, border: `1px solid ${T.border}`, borderRadius: T.rMd, padding: '18px 20px' }}>
        <div style={{ color: T.textMuted, fontSize: '0.74rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>Provider source</div>
        <div style={{ background: T.surfaceMuted, border: `1px solid ${T.border}`, borderRadius: T.rMd, padding: '14px 16px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          {[['Provider', part.source.provider, true], ['Part ID', part.source.partId, true], ['Status', null, false], ['Last imported', part.source.lastImported, false]].map(([label, val, mono]) => (
            <div key={label}>
              <div style={{ color: T.textMuted, fontSize: '0.78rem', marginBottom: 4 }}>{label}</div>
              {label === 'Status'
                ? <EEBadge label={part.source.status} tone="verified" />
                : <div style={{ fontFamily: mono ? T.mono : 'inherit', fontWeight: 600, fontSize: '0.9rem' }}>{val}</div>
              }
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { HomeScreen, StatesScreen, AdminScreen, DetailScreen });
