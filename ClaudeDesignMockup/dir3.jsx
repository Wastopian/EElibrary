
// Direction 3: Industrial Refined
// Syne + DM Sans | Warm parchment | Amber accent | Editorial grid

const { useState, useEffect } = React;

const C3 = {
  bg: '#EDE8E0', surface: '#F7F4EF', surfaceWhite: '#FDFCFA',
  border: '#D6CFC4', borderLight: '#E5E0D8',
  text: '#1A1612', textMuted: '#7A6E64', textXMuted: '#ADA29A',
  accent: '#B87333', accentDark: '#96582A', accentSoft: '#F5EDE2', accentText: '#8C4A1E',
  success: '#3D6B45', successSoft: '#EAF3EC', successText: '#2E5235',
  error: '#9B3528', errorSoft: '#F8EDEB', errorText: '#7A2920',
  pending: '#7C6C1E', pendingSoft: '#F7F2E0',
  rule: '#C8BFB4',
};

const MOCK_PART3 = {
  mpn: 'STM32F411CEU6', manufacturer: 'STMicroelectronics',
  description: 'Arm® Cortex®-M4 32-bit MCU — 512KB Flash, 128KB SRAM, 100MHz',
  category: 'Microcontrollers (MCU)', package: 'UFQFPN48', lifecycle: 'Active',
  suppliers: [
    { name: 'DigiKey', sku: '497-15743-ND', stock: 4218, price: '$3.42', moq: 1, lead: 'In Stock' },
    { name: 'Mouser', sku: '511-STM32F411CEU6', stock: 2100, price: '$3.51', moq: 1, lead: 'In Stock' },
    { name: 'Arrow', sku: 'STM32F411CEU6TR', stock: 892, price: '$3.38', moq: 10, lead: 'In Stock' },
  ],
  specs: [
    { label: 'Core', value: 'ARM Cortex-M4 + FPU' }, { label: 'Clock', value: '100 MHz' },
    { label: 'Flash', value: '512 KB' }, { label: 'SRAM', value: '128 KB' },
    { label: 'I/O', value: '36 pins' }, { label: 'Supply', value: '1.7 – 3.6V' },
    { label: 'Temp Range', value: '−40 to 85°C' }, { label: 'Interfaces', value: 'I²C / SPI / USART / USB' },
    { label: 'ADC', value: '12× 12-bit' }, { label: 'Package', value: 'UFQFPN48' },
  ],
};

const IMPORTS3 = [
  { id: 1, mpn: 'STM32F411CEU6', mfr: 'STMicroelectronics', cat: 'MCU', status: 'success', when: '2 min ago', by: 'You' },
  { id: 2, mpn: 'LM358DR', mfr: 'Texas Instruments', cat: 'Op Amp', status: 'success', when: '1 hr ago', by: 'J. Smith' },
  { id: 3, mpn: 'MCP2551-I/SN', mfr: 'Microchip', cat: 'CAN Bus', status: 'error', when: '3 hr ago', by: 'A. Lee' },
  { id: 4, mpn: 'TPS62130ARGTR', mfr: 'Texas Instruments', cat: 'DC/DC', status: 'success', when: 'Yesterday', by: 'J. Smith' },
  { id: 5, mpn: 'MMBT3904', mfr: 'onsemi', cat: 'BJT', status: 'pending', when: 'Yesterday', by: 'You' },
  { id: 6, mpn: 'GD25Q128CSIG', mfr: 'GigaDevice', cat: 'Flash', status: 'success', when: '2 days ago', by: 'A. Lee' },
];

function D3Label({ children }) {
  return <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', color: C3.textMuted }}>{children}</span>;
}

function D3Status({ status }) {
  const map = {
    success: { label: 'Imported', color: C3.successText, bg: C3.successSoft, bar: C3.success },
    error: { label: 'Failed', color: C3.errorText, bg: C3.errorSoft, bar: C3.error },
    pending: { label: 'Pending', color: C3.pending, bg: C3.pendingSoft, bar: C3.pending },
    active: { label: 'Active', color: C3.accentText, bg: C3.accentSoft, bar: C3.accent },
  };
  const s = map[status] || map.pending;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px 3px 7px', background: s.bg, borderRadius: 2 }}>
      <span style={{ width: 3, height: 12, borderRadius: 1, background: s.bar, display: 'inline-block' }} />
      <span style={{ fontSize: 11.5, fontWeight: 500, color: s.color }}>{s.label}</span>
    </span>
  );
}

function D3Divider({ style: sx = {} }) {
  return <div style={{ height: 1, background: C3.rule, ...sx }} />;
}

function D3Spinner3() {
  return (
    <div style={{ width: 28, height: 28, borderRadius: '50%', border: `2.5px solid ${C3.border}`, borderTopColor: C3.accent, animation: 'spin3 0.8s linear infinite' }}>
      <style>{`@keyframes spin3 { to { transform:rotate(360deg); } }`}</style>
    </div>
  );
}

function D3HomeView({ importState, mpn, setMpn, submittedMpn, inputError, onImport, onReset, onDetail, onAdmin }) {

  return (
    <div>
      {/* Hero import strip */}
      <div style={{ background: C3.text, padding: '52px 64px' }}>
        <div style={{ maxWidth: 640 }}>
          <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: C3.accent, marginBottom: 14 }}>Parts Library</p>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 36, fontWeight: 800, color: '#F7F4EF', lineHeight: 1.15, letterSpacing: '-0.02em', marginBottom: 10 }}>Import by Part Number</h1>
          <p style={{ fontSize: 15, color: '#7A7068', lineHeight: 1.6, maxWidth: 460 }}>Enter a manufacturer part number to search supplier catalogs and add the component to your library.</p>
        </div>
      </div>

      {/* Import form area */}
      <div style={{ background: C3.surface, borderBottom: `1px solid ${C3.border}`, padding: '36px 64px' }}>
        {importState === 'idle' && (
          <div style={{ maxWidth: 560 }}>
            <D3Label>Manufacturer Part Number</D3Label>
            <div style={{ marginTop: 10, display: 'flex', gap: 10 }}>
              <input
                autoFocus
                value={mpn} onChange={e => setMpn(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && onImport()}
                placeholder="e.g. STM32F411CEU6"
                style={{
                  flex: 1, padding: '12px 16px', border: `1.5px solid ${inputError ? C3.error : C3.border}`,
                  borderRadius: 3, background: inputError ? C3.errorSoft : C3.surfaceWhite,
                  fontFamily: "'DM Mono', 'Courier New', monospace", fontSize: 14.5, fontWeight: 500,
                  color: C3.text, outline: 'none', letterSpacing: '0.02em',
                }}
              />
              <button onClick={onImport} style={{
                padding: '12px 28px', background: C3.text, color: C3.surface,
                border: 'none', borderRadius: 3, cursor: 'pointer',
                fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700, letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}>Import</button>
            </div>
            {inputError && <p style={{ marginTop: 6, fontSize: 12.5, color: C3.errorText }}>{inputError}</p>}
            <p style={{ marginTop: 10, fontSize: 12, color: C3.textXMuted }}>
              Try: <span style={{ fontFamily: 'monospace', color: C3.textMuted }}>STM32F411CEU6</span> · <span style={{ fontFamily: 'monospace', color: C3.textMuted }}>LM358DR</span> · <span style={{ fontFamily: 'monospace', color: C3.textMuted }}>TPS62130ARGTR</span>
            </p>
          </div>
        )}

        {importState === 'loading' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <D3Spinner3 />
            <div>
              <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 3 }}>Searching providers…</p>
              <p style={{ fontSize: 13, color: C3.textMuted }}>Looking up <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{submittedMpn}</span> across DigiKey, Mouser, Arrow</p>
            </div>
          </div>
        )}

        {importState === 'success' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: C3.successSoft, border: `1.5px solid ${C3.success}40`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.5 3.5 6.5-7" stroke={C3.success} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div>
                <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15 }}>Part imported successfully</p>
                <p style={{ fontSize: 12.5, color: C3.textMuted }}>Added to component library · Ready to use in BOMs</p>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 32, marginBottom: 24, paddingBottom: 24, borderBottom: `1px solid ${C3.border}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
                  <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em' }}>{MOCK_PART3.mpn}</span>
                  <D3Status status="active" />
                </div>
                <p style={{ color: C3.textMuted, fontSize: 13.5, marginBottom: 6 }}>{MOCK_PART3.manufacturer}</p>
                <p style={{ fontSize: 13.5, lineHeight: 1.6 }}>{MOCK_PART3.description}</p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
                {[['Package', MOCK_PART3.package], ['Category', 'MCU'], ['Lifecycle', MOCK_PART3.lifecycle]].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
                    <D3Label>{k}</D3Label>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={onDetail} style={{ padding: '10px 22px', background: C3.text, color: C3.surfaceWhite, border: 'none', borderRadius: 3, cursor: 'pointer', fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Open Part Detail</button>
              <button onClick={onAdmin} style={{ padding: '10px 22px', background: 'transparent', color: C3.text, border: `1.5px solid ${C3.border}`, borderRadius: 3, cursor: 'pointer', fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.07em' }}>View in Admin</button>
              <button onClick={onReset} style={{ padding: '10px 16px', background: 'transparent', color: C3.textMuted, border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontSize: 13 }}>Import another →</button>
            </div>
          </div>
        )}

        {importState === 'error' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: C3.errorSoft, border: `1.5px solid ${C3.error}40`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke={C3.error} strokeWidth="2" strokeLinecap="round"/></svg>
              </div>
              <div>
                <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15, color: C3.errorText }}>Import failed</p>
                <p style={{ fontSize: 12.5, color: C3.textMuted }}>No part found for <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{submittedMpn}</span></p>
              </div>
            </div>
            <div style={{ background: C3.errorSoft, borderLeft: `3px solid ${C3.error}`, padding: '14px 18px', marginBottom: 20, borderRadius: '0 3px 3px 0' }}>
              <p style={{ fontSize: 13, color: C3.errorText, fontWeight: 500, marginBottom: 6 }}>What to check:</p>
              <ul style={{ paddingLeft: 16, color: C3.textMuted, fontSize: 13, lineHeight: 1.9 }}>
                <li>Confirm the exact MPN — including suffixes like TR, CT, or packaging codes</li>
                <li>Verify manufacturer name and part number format</li>
                <li>Contact your parts librarian if the part should already be in the catalog</li>
              </ul>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={onReset} style={{ padding: '10px 22px', background: C3.text, color: C3.surfaceWhite, border: 'none', borderRadius: 3, cursor: 'pointer', fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Try Again</button>
              <button onClick={onAdmin} style={{ padding: '10px 22px', background: 'transparent', color: C3.text, border: `1.5px solid ${C3.border}`, borderRadius: 3, cursor: 'pointer', fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.07em' }}>View Import Log</button>
            </div>
          </div>
        )}
      </div>

      {/* Recent imports */}
      {importState === 'idle' && (
        <div style={{ padding: '36px 64px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 20 }}>
            <D3Label>Recent Imports</D3Label>
            <button style={{ fontSize: 12, color: C3.accent, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>View all →</button>
          </div>
          <div style={{ background: C3.surfaceWhite, border: `1px solid ${C3.border}`, borderRadius: 4, overflow: 'hidden' }}>
            {IMPORTS3.slice(0, 4).map((r, i) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '13px 20px', borderBottom: i < 3 ? `1px solid ${C3.borderLight}` : 'none' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 13.5, fontWeight: 600, flex: '0 0 180px' }}>{r.mpn}</span>
                <span style={{ fontSize: 12.5, color: C3.textMuted, flex: 1 }}>{r.mfr}</span>
                <D3Status status={r.status} />
                <span style={{ fontSize: 12, color: C3.textXMuted, flex: '0 0 90px', textAlign: 'right' }}>{r.when}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function D3DetailView({ onBack }) {
  return (
    <div>
      {/* Breadcrumb bar */}
      <div style={{ background: C3.surface, borderBottom: `1px solid ${C3.border}`, padding: '14px 64px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C3.textMuted, fontSize: 13, fontFamily: 'inherit', padding: 0 }}>Library</button>
        <span style={{ color: C3.rule }}>›</span>
        <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>{MOCK_PART3.mpn}</span>
      </div>

      <div style={{ padding: '40px 64px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 36, paddingBottom: 28 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
              <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em' }}>{MOCK_PART3.mpn}</h1>
              <D3Status status="active" />
            </div>
            <p style={{ fontSize: 15, color: C3.textMuted, marginBottom: 6 }}>{MOCK_PART3.manufacturer}</p>
            <p style={{ fontSize: 14, lineHeight: 1.6, maxWidth: 520 }}>{MOCK_PART3.description}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button style={{ padding: '10px 18px', background: 'transparent', color: C3.text, border: `1.5px solid ${C3.border}`, borderRadius: 3, cursor: 'pointer', fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Datasheet</button>
            <button style={{ padding: '10px 18px', background: C3.text, color: C3.surfaceWhite, border: 'none', borderRadius: 3, cursor: 'pointer', fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Add to BOM</button>
          </div>
        </div>

        <D3Divider style={{ marginBottom: 32 }} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40 }}>
          {/* Specs */}
          <div>
            <D3Label>Specifications</D3Label>
            <div style={{ marginTop: 16 }}>
              {MOCK_PART3.specs.map((s, i) => (
                <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '10px 0', borderBottom: `1px solid ${C3.borderLight}` }}>
                  <span style={{ fontSize: 13, color: C3.textMuted }}>{s.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 500, textAlign: 'right', maxWidth: 220 }}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            <div>
              <D3Label>Supplier Pricing</D3Label>
              <div style={{ marginTop: 16 }}>
                {MOCK_PART3.suppliers.map((s, i) => (
                  <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0', borderBottom: `1px solid ${C3.borderLight}` }}>
                    <div>
                      <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{s.name}</p>
                      <p style={{ fontSize: 11, fontFamily: 'monospace', color: C3.textMuted }}>{s.sku}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontWeight: 700, fontSize: 16, color: C3.accent, marginBottom: 2 }}>{s.price}</p>
                      <p style={{ fontSize: 11, color: C3.successText }}>{s.lead} · {s.stock.toLocaleString()} units</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <D3Label>Compliance</D3Label>
              <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                {['RoHS', 'REACH', 'Active'].map(tag => (
                  <span key={tag} style={{ padding: '5px 12px', background: C3.successSoft, color: C3.successText, fontSize: 12, fontWeight: 500, borderRadius: 2 }}>{tag}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function D3AdminView({ onDetail }) {
  const [filter, setFilter] = useState('all');
  const filtered = filter === 'all' ? IMPORTS3 : IMPORTS3.filter(r => r.status === filter);

  return (
    <div style={{ padding: '40px 64px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <D3Label>Import Management</D3Label>
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', marginTop: 6 }}>Import Log</h2>
        </div>
        <button style={{ padding: '10px 22px', background: C3.text, color: C3.surfaceWhite, border: 'none', borderRadius: 3, cursor: 'pointer', fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em' }}>New Import</button>
      </div>

      <D3Divider style={{ marginBottom: 24 }} />

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: `1px solid ${C3.border}` }}>
        {['all', 'success', 'error', 'pending'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '8px 20px', border: 'none', borderBottom: `2px solid ${filter === f ? C3.accent : 'transparent'}`,
            background: 'transparent', color: filter === f ? C3.accent : C3.textMuted,
            fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 11, cursor: 'pointer',
            letterSpacing: '0.08em', textTransform: 'uppercase',
          }}>{f}</button>
        ))}
      </div>

      {/* Table */}
      <div style={{ background: C3.surfaceWhite, border: `1px solid ${C3.border}`, borderRadius: 4, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: C3.bg, borderBottom: `1px solid ${C3.border}` }}>
              {['MPN', 'Manufacturer', 'Category', 'Status', 'Imported', 'By', ''].map(h => (
                <th key={h} style={{ padding: '11px 18px', textAlign: 'left' }}><D3Label>{h}</D3Label></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={r.id} style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${C3.borderLight}` : 'none' }}>
                <td style={{ padding: '13px 18px', fontFamily: 'monospace', fontSize: 13.5, fontWeight: 600 }}>{r.mpn}</td>
                <td style={{ padding: '13px 18px', fontSize: 13, color: C3.textMuted }}>{r.mfr}</td>
                <td style={{ padding: '13px 18px', fontSize: 13, color: C3.textMuted }}>{r.cat}</td>
                <td style={{ padding: '13px 18px' }}><D3Status status={r.status} /></td>
                <td style={{ padding: '13px 18px', fontSize: 12.5, color: C3.textXMuted }}>{r.when}</td>
                <td style={{ padding: '13px 18px', fontSize: 12.5, color: C3.textMuted }}>{r.by}</td>
                <td style={{ padding: '13px 18px' }}>
                  <button onClick={onDetail} style={{ fontSize: 12, color: C3.accent, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>View →</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Dir3() {
  const [view, setView] = useState('home');
  const [importState, setImportState] = useState('idle');
  const [mpn, setMpn] = useState('');
  const [submittedMpn, setSubmittedMpn] = useState('');
  const [inputError, setInputError] = useState('');

  useEffect(() => {
    const el = document.createElement('style');
    el.id = 'd3-fonts';
    el.textContent = `@import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&display=swap');`;
    document.head.appendChild(el);
    return () => el.remove();
  }, []);

  const handleImport = () => {
    const val = mpn.trim();
    if (!val) { setInputError('Please enter a manufacturer part number.'); return; }
    setInputError('');
    setSubmittedMpn(val);
    setImportState('loading');
    setTimeout(() => setImportState(val.toLowerCase() === 'error' || val.length < 4 ? 'error' : 'success'), 2000);
  };

  const handleReset = () => { setImportState('idle'); setMpn(''); setSubmittedMpn(''); setInputError(''); };

  const navItems = [
    { id: 'home', label: 'Import' },
    { id: 'detail', label: 'Part Detail' },
    { id: 'admin', label: 'Admin' },
  ];

  return (
    <div style={{ fontFamily: "'DM Sans', -apple-system, sans-serif", background: C3.bg, minHeight: '100vh', color: C3.text, fontSize: 14 }}>
      {/* Top bar */}
      <header style={{ background: C3.text, borderBottom: `1px solid #2A2520`, padding: '0 64px', display: 'flex', alignItems: 'center', height: 56, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginRight: 48 }}>
          <div style={{ width: 26, height: 26, border: `2px solid ${C3.accent}`, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><rect x="1" y="1" width="3.5" height="3.5" fill={C3.accent}/><rect x="6.5" y="1" width="3.5" height="3.5" fill={C3.accent} opacity="0.4"/><rect x="1" y="6.5" width="3.5" height="3.5" fill={C3.accent} opacity="0.4"/><rect x="6.5" y="6.5" width="3.5" height="3.5" fill={C3.accent}/></svg>
          </div>
          <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 14, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#F7F4EF' }}>EE Library</span>
        </div>
        {navItems.map(item => (
          <button key={item.id} onClick={() => setView(item.id)} style={{
            padding: '0 18px', height: '100%', border: 'none', cursor: 'pointer',
            background: 'transparent', fontFamily: "'Syne', sans-serif",
            fontSize: 11, letterSpacing: '0.1em', fontWeight: 700, textTransform: 'uppercase',
            color: view === item.id ? C3.accent : '#6A6058',
            borderBottom: view === item.id ? `2px solid ${C3.accent}` : '2px solid transparent',
          }}>
            {item.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#2E2820', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: C3.accent, fontFamily: 'Syne' }}>JD</div>
          <span style={{ fontSize: 12, color: '#6A6058' }}>Jane D.</span>
        </div>
      </header>

      <main style={{ overflow: 'auto' }}>
        {view === 'home' && <D3HomeView importState={importState} mpn={mpn} setMpn={setMpn} submittedMpn={submittedMpn} inputError={inputError} onImport={handleImport} onReset={handleReset} onDetail={() => setView('detail')} onAdmin={() => setView('admin')} />}
        {view === 'detail' && <D3DetailView onBack={() => setView('home')} />}
        {view === 'admin' && <D3AdminView onDetail={() => setView('detail')} />}
      </main>
    </div>
  );
}

Object.assign(window, { Dir3 });
