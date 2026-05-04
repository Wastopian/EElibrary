
// Direction 1: Clean Professional Utility
// IBM Plex Sans + IBM Plex Mono | Cool light | Blue accent | Left sidebar

const { useState, useEffect, useRef } = React;

const C1 = {
  bg: '#F5F7FA', surface: '#FFFFFF', surfaceAlt: '#F0F4F8',
  border: '#E2E8F0', borderLight: '#EDF2F7',
  text: '#0F172A', textMuted: '#64748B', textXMuted: '#94A3B8',
  accent: '#2563EB', accentHover: '#1D4ED8', accentSoft: '#EFF6FF', accentText: '#1D4ED8',
  success: '#16A34A', successSoft: '#F0FDF4', successText: '#15803D',
  error: '#DC2626', errorSoft: '#FEF2F2', errorText: '#B91C1C',
  warning: '#D97706', warningSoft: '#FFFBEB',
  pending: '#7C3AED', pendingSoft: '#F5F3FF',
};

const MOCK_PART = {
  mpn: 'STM32F411CEU6', manufacturer: 'STMicroelectronics',
  description: 'Arm® Cortex®-M4 32-bit MCU, 512KB Flash, 128KB SRAM, 100MHz',
  category: 'Microcontrollers (MCU)', subcategory: 'ARM Cortex-M4',
  package: 'UFQFPN48', lifecycle: 'Active', rohs: 'Compliant', reach: 'Compliant',
  suppliers: [
    { name: 'DigiKey', sku: '497-15743-ND', stock: 4218, price: '$3.42', moq: 1, lead: 'In Stock' },
    { name: 'Mouser', sku: '511-STM32F411CEU6', stock: 2100, price: '$3.51', moq: 1, lead: 'In Stock' },
    { name: 'Arrow', sku: 'STM32F411CEU6TR', stock: 892, price: '$3.38', moq: 10, lead: 'In Stock' },
  ],
  specs: [
    { label: 'Core', value: 'ARM Cortex-M4 + FPU' },
    { label: 'Speed', value: '100 MHz' },
    { label: 'Flash', value: '512 KB' },
    { label: 'SRAM', value: '128 KB' },
    { label: 'I/O Pins', value: '36' },
    { label: 'Supply Voltage', value: '1.7V – 3.6V' },
    { label: 'Temperature', value: '-40°C to 85°C' },
    { label: 'Interface', value: 'I²C, SPI, UART, USB' },
    { label: 'ADC', value: '12× 12-bit' },
    { label: 'Package', value: 'UFQFPN48' },
  ],
};

const RECENT_IMPORTS = [
  { id: 1, mpn: 'STM32F411CEU6', mfr: 'STMicroelectronics', cat: 'MCU', status: 'success', when: '2 min ago', by: 'You' },
  { id: 2, mpn: 'LM358DR', mfr: 'Texas Instruments', cat: 'Op Amp', status: 'success', when: '1 hr ago', by: 'jsmith' },
  { id: 3, mpn: 'MCP2551-I/SN', mfr: 'Microchip', cat: 'CAN Bus', status: 'error', when: '3 hr ago', by: 'alee' },
  { id: 4, mpn: 'TPS62130ARGTR', mfr: 'Texas Instruments', cat: 'DC/DC Converter', status: 'success', when: 'Yesterday', by: 'jsmith' },
  { id: 5, mpn: 'MMBT3904', mfr: 'onsemi', cat: 'BJT', status: 'pending', when: 'Yesterday', by: 'You' },
  { id: 6, mpn: 'GD25Q128CSIG', mfr: 'GigaDevice', cat: 'Flash Memory', status: 'success', when: '2 days ago', by: 'alee' },
];

function D1Btn({ children, variant = 'primary', onClick, style: sx = {} }) {
  const [hover, setHover] = useState(false);
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none',
    borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500,
    fontSize: 13.5, padding: '8px 16px', transition: 'all 0.12s', ...sx,
  };
  const variants = {
    primary: { background: hover ? C1.accentHover : C1.accent, color: '#fff' },
    secondary: { background: hover ? C1.surfaceAlt : C1.surface, color: C1.text, border: `1px solid ${C1.border}` },
    ghost: { background: hover ? C1.surfaceAlt : 'transparent', color: C1.textMuted, border: 'none', padding: '8px 12px' },
    danger: { background: hover ? '#B91C1C' : C1.error, color: '#fff' },
  };
  return (
    <button style={{ ...base, ...variants[variant] }} onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {children}
    </button>
  );
}

function D1Badge({ status }) {
  const map = {
    success: { bg: C1.successSoft, color: C1.successText, dot: C1.success, label: 'Imported' },
    error: { bg: C1.errorSoft, color: C1.errorText, dot: C1.error, label: 'Failed' },
    pending: { bg: C1.pendingSoft, color: C1.pending, dot: C1.pending, label: 'Pending' },
    active: { bg: C1.accentSoft, color: C1.accentText, dot: C1.accent, label: 'Active' },
  };
  const s = map[status] || map.pending;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 99, background: s.bg, color: s.color, fontSize: 12, fontWeight: 500 }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: s.dot, display: 'inline-block' }} />
      {s.label}
    </span>
  );
}

function D1Input({ value, onChange, onKeyDown, placeholder, error, autoFocus }) {
  return (
    <div>
      <input
        autoFocus={autoFocus}
        value={value} onChange={e => onChange(e.target.value)} onKeyDown={onKeyDown}
        placeholder={placeholder}
        style={{
          width: '100%', padding: '10px 14px', borderRadius: 7, fontSize: 14,
          fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500, letterSpacing: '0.02em',
          border: `1.5px solid ${error ? C1.error : C1.border}`,
          background: error ? C1.errorSoft : C1.surface,
          color: C1.text, outline: 'none',
          transition: 'border-color 0.12s',
        }}
      />
      {error && <p style={{ margin: '5px 0 0', fontSize: 12, color: C1.errorText }}>{error}</p>}
    </div>
  );
}

function D1HomeView({ importState, mpn, setMpn, submittedMpn, inputError, onImport, onReset, onDetail, onAdmin }) {
  const handleKey = e => e.key === 'Enter' && onImport();

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '48px 32px' }}>
      <div style={{ marginBottom: 40 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 6 }}>Import by MPN</h1>
        <p style={{ color: C1.textMuted, fontSize: 14 }}>Enter a manufacturer part number to search suppliers and add the part to your library.</p>
      </div>

      {/* Import Panel */}
      <div style={{ background: C1.surface, border: `1px solid ${C1.border}`, borderRadius: 10, padding: 28, marginBottom: 24 }}>
        {importState === 'idle' && (
          <>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C1.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Manufacturer Part Number</label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <D1Input value={mpn} onChange={setMpn} onKeyDown={handleKey} placeholder="e.g. STM32F411CEU6" error={inputError} autoFocus />
              </div>
              <D1Btn onClick={onImport}>Import</D1Btn>
            </div>
            <p style={{ marginTop: 10, fontSize: 12, color: C1.textXMuted }}>
              Try: <span style={{ fontFamily: 'IBM Plex Mono', color: C1.textMuted }}>STM32F411CEU6</span>, <span style={{ fontFamily: 'IBM Plex Mono', color: C1.textMuted }}>LM358DR</span>, <span style={{ fontFamily: 'IBM Plex Mono', color: C1.textMuted }}>TPS62130ARGTR</span>
            </p>
          </>
        )}

        {importState === 'loading' && (
          <div style={{ padding: '16px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <D1Spinner />
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontWeight: 500, marginBottom: 4 }}>Searching suppliers…</p>
              <p style={{ fontSize: 13, color: C1.textMuted }}>Looking up <span style={{ fontFamily: 'IBM Plex Mono', fontWeight: 500 }}>{submittedMpn}</span> across DigiKey, Mouser, Arrow</p>
            </div>
          </div>
        )}

        {importState === 'success' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, paddingBottom: 20, borderBottom: `1px solid ${C1.borderLight}` }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: C1.successSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" stroke={C1.success} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div>
                <p style={{ fontWeight: 600, fontSize: 14, color: C1.successText }}>Part imported successfully</p>
                <p style={{ fontSize: 12, color: C1.textMuted }}>Added to your component library</p>
              </div>
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                <span style={{ fontFamily: 'IBM Plex Mono', fontWeight: 600, fontSize: 17, letterSpacing: '0.01em' }}>{MOCK_PART.mpn}</span>
                <D1Badge status="active" />
              </div>
              <p style={{ color: C1.textMuted, fontSize: 13, marginBottom: 2 }}>{MOCK_PART.manufacturer}</p>
              <p style={{ color: C1.text, fontSize: 13, lineHeight: 1.5 }}>{MOCK_PART.description}</p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
              {[['Package', MOCK_PART.package], ['Category', MOCK_PART.category], ['Lifecycle', MOCK_PART.lifecycle]].map(([k, v]) => (
                <div key={k} style={{ background: C1.bg, borderRadius: 6, padding: '8px 12px' }}>
                  <p style={{ fontSize: 11, color: C1.textXMuted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>{k}</p>
                  <p style={{ fontSize: 13, fontWeight: 500 }}>{v}</p>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <D1Btn onClick={onDetail}>Open Part Detail</D1Btn>
              <D1Btn variant="secondary" onClick={onAdmin}>View in Admin</D1Btn>
              <D1Btn variant="ghost" onClick={onReset}>Import Another</D1Btn>
            </div>
          </div>
        )}

        {importState === 'error' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, paddingBottom: 20, borderBottom: `1px solid ${C1.borderLight}` }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: C1.errorSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke={C1.error} strokeWidth="2" strokeLinecap="round"/></svg>
              </div>
              <div>
                <p style={{ fontWeight: 600, fontSize: 14, color: C1.errorText }}>Import failed</p>
                <p style={{ fontSize: 12, color: C1.textMuted }}>No matching part found for <span style={{ fontFamily: 'IBM Plex Mono' }}>{submittedMpn}</span></p>
              </div>
            </div>
            <div style={{ background: C1.errorSoft, border: `1px solid #FECACA`, borderRadius: 7, padding: 14, marginBottom: 20, fontSize: 13 }}>
              <p style={{ fontWeight: 500, marginBottom: 6 }}>Suggestions:</p>
              <ul style={{ paddingLeft: 16, color: C1.textMuted, lineHeight: 1.8 }}>
                <li>Verify the MPN is exact — check for trailing suffixes (TR, CT, etc.)</li>
                <li>Check manufacturer spelling or try searching by description</li>
                <li>Contact your parts librarian if the part should exist in the catalog</li>
              </ul>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <D1Btn onClick={onReset}>Try Again</D1Btn>
              <D1Btn variant="secondary" onClick={onAdmin}>View Import Log</D1Btn>
            </div>
          </div>
        )}
      </div>

      {/* Recent imports summary */}
      {importState === 'idle' && (
        <div>
          <p style={{ fontSize: 12, fontWeight: 600, color: C1.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>Recent Imports</p>
          <div style={{ background: C1.surface, border: `1px solid ${C1.border}`, borderRadius: 10, overflow: 'hidden' }}>
            {RECENT_IMPORTS.slice(0, 4).map((r, i) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderBottom: i < 3 ? `1px solid ${C1.borderLight}` : 'none' }}>
                <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 13, fontWeight: 500, flex: '0 0 160px' }}>{r.mpn}</span>
                <span style={{ fontSize: 12, color: C1.textMuted, flex: 1 }}>{r.mfr}</span>
                <D1Badge status={r.status} />
                <span style={{ fontSize: 12, color: C1.textXMuted, flex: '0 0 80px', textAlign: 'right' }}>{r.when}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function D1Spinner() {
  return (
    <div style={{ width: 36, height: 36, borderRadius: '50%', border: `3px solid ${C1.border}`, borderTopColor: C1.accent, animation: 'spin1 0.7s linear infinite' }}>
      <style>{`@keyframes spin1 { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function D1DetailView({ mpn, onBack }) {
  return (
    <div style={{ padding: '32px 40px', maxWidth: 880, margin: '0 auto' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C1.textMuted, fontSize: 13, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
        ← Back to Import
      </button>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, paddingBottom: 28, borderBottom: `1px solid ${C1.border}` }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <h1 style={{ fontFamily: 'IBM Plex Mono', fontSize: 24, fontWeight: 600, letterSpacing: '0.01em' }}>{MOCK_PART.mpn}</h1>
            <D1Badge status="active" />
          </div>
          <p style={{ fontSize: 15, color: C1.textMuted, marginBottom: 4 }}>{MOCK_PART.manufacturer}</p>
          <p style={{ fontSize: 13, color: C1.text, maxWidth: 520, lineHeight: 1.6 }}>{MOCK_PART.description}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <D1Btn variant="secondary">Datasheet</D1Btn>
          <D1Btn>Add to BOM</D1Btn>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Specs */}
        <div style={{ background: C1.surface, border: `1px solid ${C1.border}`, borderRadius: 10, padding: 20 }}>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C1.textMuted, marginBottom: 16 }}>Specifications</p>
          {MOCK_PART.specs.map(s => (
            <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${C1.borderLight}`, fontSize: 13 }}>
              <span style={{ color: C1.textMuted }}>{s.label}</span>
              <span style={{ fontWeight: 500 }}>{s.value}</span>
            </div>
          ))}
        </div>

        {/* Suppliers + Compliance */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: C1.surface, border: `1px solid ${C1.border}`, borderRadius: 10, padding: 20 }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C1.textMuted, marginBottom: 16 }}>Supplier Pricing</p>
            {MOCK_PART.suppliers.map(s => (
              <div key={s.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: `1px solid ${C1.borderLight}`, fontSize: 13 }}>
                <div>
                  <p style={{ fontWeight: 600, marginBottom: 2 }}>{s.name}</p>
                  <p style={{ fontSize: 11, fontFamily: 'IBM Plex Mono', color: C1.textMuted }}>{s.sku}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontWeight: 600, color: C1.accent }}>{s.price}</p>
                  <p style={{ fontSize: 11, color: C1.successText }}>{s.lead}</p>
                </div>
              </div>
            ))}
          </div>
          <div style={{ background: C1.surface, border: `1px solid ${C1.border}`, borderRadius: 10, padding: 20 }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C1.textMuted, marginBottom: 14 }}>Compliance</p>
            <div style={{ display: 'flex', gap: 8 }}>
              {[['RoHS', 'success'], ['REACH', 'success'], ['Active', 'active']].map(([l, s]) => <D1Badge key={l} status={s} />)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function D1AdminView({ onDetail }) {
  const [filter, setFilter] = useState('all');
  const filtered = filter === 'all' ? RECENT_IMPORTS : RECENT_IMPORTS.filter(r => r.status === filter);

  return (
    <div style={{ padding: '32px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 4 }}>Import Log</h1>
          <p style={{ color: C1.textMuted, fontSize: 13 }}>6 imports in the last 7 days</p>
        </div>
        <D1Btn>New Import</D1Btn>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {['all', 'success', 'error', 'pending'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '5px 14px', borderRadius: 6, border: `1px solid ${filter === f ? C1.accent : C1.border}`,
            background: filter === f ? C1.accentSoft : C1.surface, color: filter === f ? C1.accentText : C1.textMuted,
            fontSize: 13, fontWeight: filter === f ? 500 : 400, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={{ background: C1.surface, border: `1px solid ${C1.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: C1.bg, borderBottom: `1px solid ${C1.border}` }}>
              {['MPN', 'Manufacturer', 'Category', 'Status', 'Imported', 'By', ''].map(h => (
                <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: C1.textMuted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={r.id} style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${C1.borderLight}` : 'none' }}>
                <td style={{ padding: '12px 16px', fontFamily: 'IBM Plex Mono', fontSize: 13, fontWeight: 500 }}>{r.mpn}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: C1.textMuted }}>{r.mfr}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: C1.textMuted }}>{r.cat}</td>
                <td style={{ padding: '12px 16px' }}><D1Badge status={r.status} /></td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: C1.textXMuted }}>{r.when}</td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: C1.textMuted }}>{r.by}</td>
                <td style={{ padding: '12px 16px' }}>
                  <button onClick={onDetail} style={{ fontSize: 12, color: C1.accent, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>View →</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Dir1() {
  const [view, setView] = useState('home');
  const [importState, setImportState] = useState('idle');
  const [mpn, setMpn] = useState('');
  const [submittedMpn, setSubmittedMpn] = useState('');
  const [inputError, setInputError] = useState('');

  useEffect(() => {
    const el = document.createElement('style');
    el.id = 'd1-fonts';
    el.textContent = `@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');`;
    document.head.appendChild(el);
    return () => el.remove();
  }, []);

  const handleImport = () => {
    const val = mpn.trim();
    if (!val) { setInputError('Please enter a manufacturer part number.'); return; }
    setInputError('');
    setSubmittedMpn(val);
    setImportState('loading');
    setTimeout(() => setImportState(val.toLowerCase() === 'error' || val.length < 4 ? 'error' : 'success'), 1800);
  };

  const handleReset = () => { setImportState('idle'); setMpn(''); setSubmittedMpn(''); setInputError(''); };

  const navItems = [
    { id: 'home', label: 'Import', icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M3.5 6l3.5 3.5L10.5 6M1 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> },
    { id: 'detail', label: 'Part Detail', icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="1" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><path d="M4.5 5h5M4.5 7.5h5M4.5 10h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
    { id: 'admin', label: 'Import Log', icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="3" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><path d="M1 6h12" stroke="currentColor" strokeWidth="1.5"/></svg> },
  ];

  return (
    <div style={{ fontFamily: "'IBM Plex Sans', -apple-system, sans-serif", background: C1.bg, minHeight: '100vh', display: 'flex', color: C1.text, fontSize: 14 }}>
      {/* Sidebar */}
      <nav style={{ width: 220, background: C1.surface, borderRight: `1px solid ${C1.border}`, display: 'flex', flexDirection: 'column', flexShrink: 0, userSelect: 'none' }}>
        <div style={{ padding: '18px 20px 16px', borderBottom: `1px solid ${C1.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{ width: 28, height: 28, background: C1.accent, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="1.5" width="4" height="4" rx="0.5" fill="white"/><rect x="8.5" y="1.5" width="4" height="4" rx="0.5" fill="white" opacity="0.5"/><rect x="1.5" y="8.5" width="4" height="4" rx="0.5" fill="white" opacity="0.5"/><rect x="8.5" y="8.5" width="4" height="4" rx="0.5" fill="white"/></svg>
            </div>
            <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.01em' }}>EE Library</span>
          </div>
        </div>
        <div style={{ padding: '10px 8px', flex: 1 }}>
          <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C1.textXMuted, padding: '8px 12px 6px' }}>Workspace</p>
          {navItems.map(item => (
            <button key={item.id} onClick={() => setView(item.id)} style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              padding: '8px 12px', borderRadius: 7, border: 'none', cursor: 'pointer',
              background: view === item.id ? C1.accentSoft : 'transparent',
              color: view === item.id ? C1.accent : C1.text,
              fontWeight: view === item.id ? 500 : 400,
              fontFamily: 'inherit', fontSize: 13.5, textAlign: 'left', marginBottom: 2,
            }}>
              <span style={{ color: view === item.id ? C1.accent : C1.textMuted }}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
        <div style={{ padding: '14px 20px', borderTop: `1px solid ${C1.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#E0E7FF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: C1.accent }}>JD</div>
            <div>
              <p style={{ fontSize: 12.5, fontWeight: 500 }}>Jane D.</p>
              <p style={{ fontSize: 11, color: C1.textXMuted }}>Engineer</p>
            </div>
          </div>
        </div>
      </nav>
      <main style={{ flex: 1, overflow: 'auto' }}>
        {view === 'home' && <D1HomeView importState={importState} mpn={mpn} setMpn={setMpn} submittedMpn={submittedMpn} inputError={inputError} onImport={handleImport} onReset={handleReset} onDetail={() => setView('detail')} onAdmin={() => setView('admin')} />}
        {view === 'detail' && <D1DetailView mpn={submittedMpn || MOCK_PART.mpn} onBack={() => setView('home')} />}
        {view === 'admin' && <D1AdminView onDetail={() => setView('detail')} />}
      </main>
    </div>
  );
}

Object.assign(window, { Dir1 });
