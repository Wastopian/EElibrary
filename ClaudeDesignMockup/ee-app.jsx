// EE Library — App root with screen nav + Tweaks
// Depends on all prior ee-*.jsx files

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "panelVariant": "inline",
  "fontFamily": "segoe"
}/*EDITMODE-END*/;

function App() {
  const [screen, setScreen] = React.useState(() =>
    localStorage.getItem('ee_screen') || 'home'
  );
  const [tweaks, setTweaks] = React.useState(() => {
    try { return { ...TWEAK_DEFAULTS, ...JSON.parse(localStorage.getItem('ee_tweaks') || '{}') }; }
    catch { return { ...TWEAK_DEFAULTS }; }
  });
  const [tweaksOpen, setTweaksOpen] = React.useState(false);
  const T = EE_T;

  React.useEffect(() => { localStorage.setItem('ee_screen', screen); }, [screen]);
  React.useEffect(() => {
    localStorage.setItem('ee_tweaks', JSON.stringify(tweaks));
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits: tweaks }, '*');
  }, [tweaks]);

  React.useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === '__activate_edit_mode')   setTweaksOpen(true);
      if (e.data?.type === '__deactivate_edit_mode') setTweaksOpen(false);
    };
    window.addEventListener('message', handler);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', handler);
  }, []);

  const navItems = [
    { id: 'home',   label: 'Homepage' },
    { id: 'states', label: 'Import states' },
    { id: 'admin',  label: 'Admin' },
    { id: 'detail', label: 'Part detail' },
  ];

  const fontMap = {
    segoe: '"Segoe UI", Inter, system-ui, sans-serif',
    ibm:   '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
    space: '"Space Grotesk", "Segoe UI", system-ui, sans-serif',
  };

  const variantMeta = {
    inline:  { label: 'A — Inline section',  sub: 'Faithful to codebase' },
    card:    { label: 'B — Focused card',     sub: 'Elevated, provider cards' },
    command: { label: 'C — Command bar',      sub: 'Compact, keyboard-first' },
  };

  return (
    <div style={{ minHeight: '100vh', background: T.bg, backgroundImage: 'linear-gradient(180deg, #fbfcfd 0%, #eef1f4 42%, #eef1f4 100%)', fontFamily: fontMap[tweaks.fontFamily] || fontMap.segoe, color: T.text }}>

      {/* ── Top nav ── */}
      <div style={{ background: T.surfaceElevated, borderBottom: `1px solid ${T.border}`, padding: '0 28px', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <span style={{ fontWeight: 700, fontSize: '0.95rem', letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
              <span style={{ color: T.accent }}>EE</span> Library
            </span>
            <nav style={{ display: 'flex', gap: 2 }}>
              {navItems.map(item => (
                <button key={item.id} onClick={() => setScreen(item.id)}
                  style={{ background: screen === item.id ? T.accentSoft : 'transparent', border: screen === item.id ? `1px solid rgba(42,95,154,0.2)` : '1px solid transparent', borderRadius: T.rMd, color: screen === item.id ? T.accentHover : T.textMuted, cursor: 'pointer', font: 'inherit', fontWeight: screen === item.id ? 600 : 500, fontSize: '0.88rem', minHeight: 34, padding: '0 14px', transition: 'all 120ms ease' }}>
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {screen === 'home' && (
              <span style={{ color: T.textMuted, fontSize: '0.8rem', fontFamily: T.mono }}>
                variant: {variantMeta[tweaks.panelVariant]?.label || tweaks.panelVariant}
              </span>
            )}
            <EEBadge label="Design exploration" tone="info" />
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '28px 28px 64px' }}>
        {screen === 'home'   && <HomeScreen   panelVariant={tweaks.panelVariant} onPartOpen={() => setScreen('detail')} />}
        {screen === 'states' && <StatesScreen />}
        {screen === 'admin'  && <AdminScreen  />}
        {screen === 'detail' && <DetailScreen onBack={() => setScreen('home')} />}
      </div>

      {/* ── Tweaks panel ── */}
      {tweaksOpen && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: T.surfaceElevated, border: `1px solid ${T.border}`, borderRadius: T.rLg, boxShadow: T.shadow, padding: '18px 20px', width: 292, zIndex: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
            <span style={{ fontWeight: 650, fontSize: '0.92rem' }}>Tweaks</span>
            <button onClick={() => setTweaksOpen(false)} style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', font: 'inherit', fontSize: '1.1rem', lineHeight: 1, minHeight: 'auto', padding: '0 2px' }}>×</button>
          </div>

          {/* Panel variant */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ color: T.textMuted, fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>Import panel — Homepage</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {Object.entries(variantMeta).map(([id, meta]) => (
                <label key={id} style={{ cursor: 'pointer' }}>
                  <input type="radio" name="panelVariant" value={id} checked={tweaks.panelVariant === id} onChange={() => setTweaks(t => ({ ...t, panelVariant: id }))} style={{ display: 'none' }} />
                  <div style={{ background: tweaks.panelVariant === id ? T.accentSoft : T.surfaceMuted, border: `1px solid ${tweaks.panelVariant === id ? 'rgba(42,95,154,0.25)' : T.border}`, borderRadius: T.rMd, padding: '9px 12px', transition: 'all 100ms ease', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${tweaks.panelVariant === id ? T.accent : T.border}`, background: tweaks.panelVariant === id ? T.accent : 'transparent', flexShrink: 0, transition: 'all 100ms ease' }} />
                    <div>
                      <div style={{ fontSize: '0.84rem', fontWeight: 600, color: tweaks.panelVariant === id ? T.accentHover : T.text }}>{meta.label}</div>
                      <div style={{ fontSize: '0.76rem', color: T.textMuted, marginTop: 1 }}>{meta.sub}</div>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Font */}
          <div>
            <div style={{ color: T.textMuted, fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>Typography</div>
            <select value={tweaks.fontFamily} onChange={e => setTweaks(t => ({ ...t, fontFamily: e.target.value }))}
              style={{ background: T.surfaceElevated, border: `1px solid ${T.border}`, borderRadius: T.rMd, color: T.text, font: 'inherit', fontSize: '0.88rem', minHeight: 38, padding: '0 10px', width: '100%' }}>
              <option value="segoe">Segoe UI / Inter</option>
              <option value="ibm">IBM Plex Sans</option>
              <option value="space">Space Grotesk</option>
            </select>
          </div>
        </div>
      )}

      <style>{`
        @keyframes ee-spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        input, select, button, textarea { font-family: inherit; }
        input:focus, select:focus { outline: 2px solid ${T.accent}; outline-offset: 2px; }
      `}</style>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
