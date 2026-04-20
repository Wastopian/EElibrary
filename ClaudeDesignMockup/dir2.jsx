
// Direction 2: Technical Admin Dark
// JetBrains Mono + Inter | Near-black | Terminal green accent | Dense layout

const { useState, useEffect } = React;

const C2 = {
  bg: '#0C1017', surface: '#111720', surfaceHover: '#161E2B', surfaceRaised: '#1A2233',
  border: '#1E2A3A', borderLight: '#172030',
  text: '#C8D4E0', textMuted: '#5A7090', textBright: '#E8F0F8', textXMuted: '#364860',
  accent: '#3DD68C', accentDim: '#1A3B2E', accentText: '#2CC27C',
  blue: '#4DA6FF', blueDim: '#0D2A4A',
  error: '#F07070', errorDim: '#3A1515',
  warning: '#F0B429', warningDim: '#2E2100',
  purple: '#A78BFA', purpleDim: '#1E1535',
};

const MOCK_PART2 = {
  mpn: 'STM32F411CEU6', manufacturer: 'STMicroelectronics',
  description: 'Arm® Cortex®-M4 32-bit MCU, 512KB Flash, 128KB SRAM, 100MHz',
  category: 'Microcontrollers (MCU)', package: 'UFQFPN48', lifecycle: 'Active',
  suppliers: [
    { name: 'DigiKey', sku: '497-15743-ND', stock: 4218, price: '$3.42', moq: 1, lead: 'In Stock' },
    { name: 'Mouser', sku: '511-STM32F411CEU6', stock: 2100, price: '$3.51', moq: 1, lead: 'In Stock' },
    { name: 'Arrow', sku: 'STM32F411CEU6TR', stock: 892, price: '$3.38', moq: 10, lead: 'In Stock' },
  ],
  specs: [
    { label: 'CORE', value: 'ARM Cortex-M4 + FPU' }, { label: 'SPEED', value: '100 MHz' },
    { label: 'FLASH', value: '512 KB' }, { label: 'SRAM', value: '128 KB' },
    { label: 'I/O', value: '36 pins' }, { label: 'VCC', value: '1.7 – 3.6V' },
    { label: 'TEMP', value: '-40 to 85°C' }, { label: 'ADC', value: '12× 12-bit' },
    { label: 'INTERFACES', value: 'I²C / SPI / USART / USB' }, { label: 'PKG', value: 'UFQFPN48' },
  ],
};

const IMPORTS2 = [
  { id: 1, mpn: 'STM32F411CEU6', mfr: 'STMicroelectronics', cat: 'MCU', status: 'success', providers: 3, t: '00:01:42', when: '2m ago', by: 'You', hash: 'a3f9c' },
  { id: 2, mpn: 'LM358DR', mfr: 'Texas Instruments', cat: 'Op Amp', status: 'success', providers: 3, t: '00:00:58', when: '1h ago', by: 'jsmith', hash: 'b2e1d' },
  { id: 3, mpn: 'MCP2551-I/SN', mfr: 'Microchip', cat: 'CAN Bus', status: 'error', providers: 0, t: '—', when: '3h ago', by: 'alee', hash: 'c9a7f' },
  { id: 4, mpn: 'TPS62130ARGTR', mfr: 'Texas Instruments', cat: 'DC/DC', status: 'success', providers: 2, t: '00:02:11', when: '1d ago', by: 'jsmith', hash: 'd4b3e' },
  { id: 5, mpn: 'MMBT3904', mfr: 'onsemi', cat: 'BJT', status: 'pending', providers: 1, t: '—', when: '1d ago', by: 'You', hash: 'e7c2a' },
  { id: 6, mpn: 'GD25Q128CSIG', mfr: 'GigaDevice', cat: 'Flash', status: 'success', providers: 2, t: '00:01:18', when: '2d ago', by: 'alee', hash: 'f1d9b' },
];

function D2Mono({ children, color, size = 12 }) {
  return <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: size, color: color || C2.text }}>{children}</span>;
}

function D2StatusDot({ status, showLabel = true }) {
  const map = {
    success: { color: C2.accent, label: 'OK' },
    error: { color: C2.error, label: 'ERR' },
    pending: { color: C2.warning, label: 'WAIT' },
    loading: { color: C2.blue, label: 'RUN' },
  };
  const s = map[status] || map.pending;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, boxShadow: `0 0 6px ${s.color}`, display: 'inline-block' }} />
      {showLabel && <D2Mono color={s.color} size={11}>{s.label}</D2Mono>}
    </span>
  );
}

function D2Tag({ children, color }) {
  return (
    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, padding: '2px 6px', borderRadius: 3, border: `1px solid ${color || C2.border}`, color: color || C2.textMuted, letterSpacing: '0.05em' }}>{children}</span>
  );
}

function D2Spinner2() {
  return (
    <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', border: `1.5px solid ${C2.border}`, borderTopColor: C2.accent, animation: 'spin2 0.6s linear infinite' }}>
      <style>{`@keyframes spin2 { to { transform:rotate(360deg); } }`}</style>
    </span>
  );
}

function D2HomeView({ importState, mpn, setMpn, submittedMpn, inputError, onImport, onReset, onDetail, onAdmin }) {
  const [logLines, setLogLines] = useState([]);

  useEffect(() => {
    if (importState === 'loading') {
      setLogLines([]);
      const lines = [
        { t: 0,    text: `> INIT import sequence for ${mpn || submittedMpn}`, color: C2.textMuted },
        { t: 300,  text: '> Querying DigiKey API... ', color: C2.textMuted },
        { t: 600,  text: '  ↳ DigiKey: found 1 match (4218 stock)', color: C2.accent },
        { t: 800,  text: '> Querying Mouser API... ', color: C2.textMuted },
        { t: 1000, text: '  ↳ Mouser: found 1 match (2100 stock)', color: C2.accent },
        { t: 1200, text: '> Querying Arrow API... ', color: C2.textMuted },
        { t: 1400, text: '  ↳ Arrow: found 1 match (892 stock)', color: C2.accent },
        { t: 1600, text: '> Normalizing supplier data... ', color: C2.textMuted },
        { t: 1750, text: '> Validating against library schema... ', color: C2.textMuted },
      ];
      lines.forEach(({ t, text, color }) => setTimeout(() => setLogLines(prev => [...prev, { text, color }]), t));
    } else if (importState === 'success') {
      setLogLines(prev => [...prev, { text: '> Import complete. Part saved to library.', color: C2.accent }]);
    } else if (importState === 'error') {
      setLogLines(prev => [...prev, { text: '> ERROR: No matching records found across providers.', color: C2.error }]);
    }
  }, [importState]);

  return (
    <div style={{ padding: '28px 32px', maxWidth: 820, margin: '0 auto' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <D2Mono color={C2.textMuted} size={11}>IMPORT</D2Mono>
        <span style={{ color: C2.border }}>›</span>
        <D2Mono color={C2.textMuted} size={11}>MPN_LOOKUP</D2Mono>
        <div style={{ flex: 1 }} />
        <D2Tag color={C2.accent}>v2.4.1</D2Tag>
        <D2Tag>PRODUCTION</D2Tag>
      </div>

      {/* Main import card */}
      <div style={{ background: C2.surface, border: `1px solid ${C2.border}`, borderRadius: 6, overflow: 'hidden', marginBottom: 20 }}>
        {/* Card header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: `1px solid ${C2.border}`, background: C2.bg }}>
          <D2StatusDot status={importState === 'idle' ? 'pending' : importState} showLabel={false} />
          <D2Mono color={C2.textBright} size={11}>MPN IMPORT</D2Mono>
          <div style={{ flex: 1 }} />
          <D2Mono color={C2.textMuted} size={10}>providers: DigiKey · Mouser · Arrow</D2Mono>
        </div>

        <div style={{ padding: 20 }}>
          {/* Input row */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 0, border: `1px solid ${inputError ? C2.error : C2.border}`, borderRadius: 4, background: C2.bg, overflow: 'hidden' }}>
                <span style={{ padding: '0 10px', color: C2.textMuted, fontFamily: 'JetBrains Mono', fontSize: 13 }}>$</span>
                <input
                  value={mpn} onChange={e => setMpn(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && onImport()}
                  placeholder="mpn --import"
                  autoFocus
                  style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', padding: '10px 4px', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: C2.textBright, letterSpacing: '0.03em' }}
                />
                {importState === 'loading' && <span style={{ padding: '0 12px' }}><D2Spinner2 /></span>}
              </div>
              {inputError && <p style={{ margin: '4px 0 0', fontSize: 11, fontFamily: 'JetBrains Mono', color: C2.error }}>{inputError}</p>}
            </div>
            <button onClick={importState !== 'idle' ? onReset : onImport} style={{
              padding: '10px 20px', borderRadius: 4, border: `1px solid ${importState !== 'idle' ? C2.border : C2.accent}`,
              background: importState !== 'idle' ? 'transparent' : C2.accentDim, color: importState !== 'idle' ? C2.textMuted : C2.accent,
              fontFamily: "'JetBrains Mono', monospace", fontSize: 12, cursor: 'pointer', letterSpacing: '0.05em', fontWeight: 500,
            }}>
              {importState === 'idle' ? 'RUN' : importState === 'loading' ? 'CANCEL' : 'RESET'}
            </button>
          </div>

          {/* Log terminal */}
          <div style={{ background: C2.bg, border: `1px solid ${C2.borderLight}`, borderRadius: 4, padding: '12px 14px', minHeight: 100, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, lineHeight: 1.9 }}>
            {logLines.length === 0 && importState === 'idle' && (
              <p style={{ color: C2.textXMuted }}>{'# Ready. Enter MPN and press RUN.'}</p>
            )}
            {logLines.map((l, i) => (
              <div key={i} style={{ color: l.color }}>{l.text}</div>
            ))}
            {importState === 'loading' && <span style={{ color: C2.blue }}>▊</span>}
          </div>
        </div>

        {/* Success result */}
        {importState === 'success' && (
          <div style={{ borderTop: `1px solid ${C2.border}`, padding: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div>
                <p style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: C2.textMuted, marginBottom: 6, letterSpacing: '0.08em' }}>RESOLVED PART</p>
                <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, fontWeight: 700, color: C2.accent, marginBottom: 4 }}>{MOCK_PART2.mpn}</p>
                <p style={{ fontSize: 12, color: C2.textMuted }}>{MOCK_PART2.manufacturer}</p>
                <p style={{ fontSize: 12, color: C2.text, marginTop: 4, lineHeight: 1.5 }}>{MOCK_PART2.description}</p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[['PKG', MOCK_PART2.package], ['CAT', 'MCU'], ['PROVIDERS', '3/3'], ['LIFECYCLE', MOCK_PART2.lifecycle]].map(([k, v]) => (
                  <div key={k} style={{ background: C2.bg, border: `1px solid ${C2.border}`, borderRadius: 4, padding: '8px 10px' }}>
                    <p style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: C2.textMuted, letterSpacing: '0.1em', marginBottom: 3 }}>{k}</p>
                    <p style={{ fontFamily: 'JetBrains Mono', fontSize: 12, color: C2.textBright }}>{v}</p>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[['OPEN DETAIL', onDetail, C2.accent, C2.accentDim], ['VIEW IN ADMIN', onAdmin, C2.blue, C2.blueDim], ['IMPORT ANOTHER', onReset, C2.textMuted, 'transparent']].map(([label, fn, color, bg]) => (
                <button key={label} onClick={fn} style={{ padding: '8px 14px', border: `1px solid ${color}`, borderRadius: 4, background: bg, color: color, fontFamily: 'JetBrains Mono', fontSize: 11, cursor: 'pointer', letterSpacing: '0.05em' }}>{label}</button>
              ))}
            </div>
          </div>
        )}

        {importState === 'error' && (
          <div style={{ borderTop: `1px solid ${C2.border}`, padding: 20 }}>
            <div style={{ background: C2.errorDim, border: `1px solid ${C2.error}30`, borderRadius: 4, padding: '12px 14px', marginBottom: 16, fontFamily: 'JetBrains Mono', fontSize: 12 }}>
              <p style={{ color: C2.error, marginBottom: 6 }}>ERR_PART_NOT_FOUND</p>
              <p style={{ color: C2.textMuted, lineHeight: 1.7 }}>
                No records found for <span style={{ color: C2.text }}>{submittedMpn}</span> across all configured providers.<br />
                Check MPN format, suffixes (TR/CT), or consult the catalog admin.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onReset} style={{ padding: '8px 14px', border: `1px solid ${C2.error}`, borderRadius: 4, background: C2.errorDim, color: C2.error, fontFamily: 'JetBrains Mono', fontSize: 11, cursor: 'pointer' }}>RETRY</button>
              <button onClick={onAdmin} style={{ padding: '8px 14px', border: `1px solid ${C2.border}`, borderRadius: 4, background: 'transparent', color: C2.textMuted, fontFamily: 'JetBrains Mono', fontSize: 11, cursor: 'pointer' }}>VIEW LOG</button>
            </div>
          </div>
        )}
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[['TOTAL IMPORTS', '247', C2.accent], ['SUCCESS RATE', '94.3%', C2.accent], ['PENDING', '3', C2.warning], ['FAILED (7d)', '14', C2.error]].map(([k, v, color]) => (
          <div key={k} style={{ background: C2.surface, border: `1px solid ${C2.border}`, borderRadius: 5, padding: '12px 14px' }}>
            <p style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: C2.textMuted, letterSpacing: '0.1em', marginBottom: 6 }}>{k}</p>
            <p style={{ fontFamily: 'JetBrains Mono', fontSize: 20, fontWeight: 700, color }}>{v}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function D2DetailView({ onBack }) {
  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
        <button onClick={onBack} style={{ background: 'none', border: `1px solid ${C2.border}`, borderRadius: 4, padding: '5px 10px', cursor: 'pointer', color: C2.textMuted, fontFamily: 'JetBrains Mono', fontSize: 11 }}>← BACK</button>
        <D2Mono color={C2.textMuted} size={11}>LIBRARY</D2Mono>
        <span style={{ color: C2.border }}>›</span>
        <D2Mono color={C2.accent} size={11}>{MOCK_PART2.mpn}</D2Mono>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20 }}>
        {/* Left */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: C2.surface, border: `1px solid ${C2.border}`, borderRadius: 6, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 16, borderBottom: `1px solid ${C2.border}` }}>
              <div>
                <p style={{ fontFamily: 'JetBrains Mono', fontSize: 22, fontWeight: 700, color: C2.accent, marginBottom: 4 }}>{MOCK_PART2.mpn}</p>
                <p style={{ fontSize: 13, color: C2.textMuted }}>{MOCK_PART2.manufacturer}</p>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <D2StatusDot status="success" />
                <D2Tag color={C2.accent}>ACTIVE</D2Tag>
                <D2Tag color={C2.accent}>ROHS</D2Tag>
              </div>
            </div>
            <p style={{ fontSize: 13, color: C2.text, lineHeight: 1.6 }}>{MOCK_PART2.description}</p>
          </div>

          <div style={{ background: C2.surface, border: `1px solid ${C2.border}`, borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C2.border}`, background: C2.bg }}>
              <D2Mono color={C2.textMuted} size={10}>SPECIFICATIONS</D2Mono>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              {MOCK_PART2.specs.map((s, i) => (
                <div key={s.label} style={{ padding: '10px 16px', borderBottom: `1px solid ${C2.borderLight}`, borderRight: i % 2 === 0 ? `1px solid ${C2.borderLight}` : 'none' }}>
                  <p style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: C2.textMuted, letterSpacing: '0.08em', marginBottom: 4 }}>{s.label}</p>
                  <p style={{ fontFamily: 'JetBrains Mono', fontSize: 12, color: C2.textBright }}>{s.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: C2.surface, border: `1px solid ${C2.border}`, borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C2.border}`, background: C2.bg }}>
              <D2Mono color={C2.textMuted} size={10}>SUPPLIER PRICING</D2Mono>
            </div>
            {MOCK_PART2.suppliers.map((s, i) => (
              <div key={s.name} style={{ padding: '12px 16px', borderBottom: i < 2 ? `1px solid ${C2.borderLight}` : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ fontFamily: 'JetBrains Mono', fontSize: 12, color: C2.textBright, marginBottom: 3 }}>{s.name}</p>
                  <p style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: C2.textMuted }}>{s.sku}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontFamily: 'JetBrains Mono', fontSize: 14, fontWeight: 700, color: C2.accent }}>{s.price}</p>
                  <p style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: C2.accentText }}>{s.lead} · {s.stock.toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>

          <div style={{ background: C2.surface, border: `1px solid ${C2.border}`, borderRadius: 6, padding: 16 }}>
            <D2Mono color={C2.textMuted} size={10}>ACTIONS</D2Mono>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              {['Add to BOM', 'Download Datasheet', 'Flag for Review', 'Edit Library Entry'].map(a => (
                <button key={a} style={{ padding: '8px 14px', border: `1px solid ${C2.border}`, borderRadius: 4, background: 'transparent', color: C2.text, fontFamily: 'JetBrains Mono', fontSize: 11, cursor: 'pointer', textAlign: 'left' }}>{a}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function D2AdminView({ onDetail }) {
  const [filter, setFilter] = useState('ALL');
  const filtered = filter === 'ALL' ? IMPORTS2 : IMPORTS2.filter(r => r.status.toUpperCase() === filter);

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <D2Mono color={C2.textBright} size={13}>IMPORT LOG</D2Mono>
          <D2Tag>{IMPORTS2.length} records</D2Tag>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['ALL', 'SUCCESS', 'ERROR', 'PENDING'].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '5px 12px', borderRadius: 3, border: `1px solid ${filter === f ? C2.accent : C2.border}`,
              background: filter === f ? C2.accentDim : 'transparent', color: filter === f ? C2.accent : C2.textMuted,
              fontFamily: 'JetBrains Mono', fontSize: 10, cursor: 'pointer', letterSpacing: '0.05em',
            }}>{f}</button>
          ))}
        </div>
      </div>

      <div style={{ background: C2.surface, border: `1px solid ${C2.border}`, borderRadius: 6, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: C2.bg, borderBottom: `1px solid ${C2.border}` }}>
              {['STATUS', 'MPN', 'MANUFACTURER', 'CATEGORY', 'PROVIDERS', 'DURATION', 'WHEN', 'BY', ''].map(h => (
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontFamily: 'JetBrains Mono', fontSize: 9, color: C2.textMuted, letterSpacing: '0.1em', fontWeight: 400 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={r.id} style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${C2.borderLight}` : 'none' }}
                onMouseEnter={e => e.currentTarget.style.background = C2.surfaceHover}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td style={{ padding: '10px 12px' }}><D2StatusDot status={r.status} /></td>
                <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono', fontSize: 12, color: C2.textBright }}>{r.mpn}</td>
                <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono', fontSize: 11, color: C2.textMuted }}>{r.mfr}</td>
                <td style={{ padding: '10px 12px' }}><D2Tag>{r.cat}</D2Tag></td>
                <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono', fontSize: 11, color: r.providers > 0 ? C2.accent : C2.error }}>{r.providers}/3</td>
                <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono', fontSize: 11, color: C2.textMuted }}>{r.t}</td>
                <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono', fontSize: 11, color: C2.textMuted }}>{r.when}</td>
                <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono', fontSize: 11, color: C2.textXMuted }}>{r.by}</td>
                <td style={{ padding: '10px 12px' }}>
                  <button onClick={onDetail} style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: C2.blue, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>OPEN →</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Dir2() {
  const [view, setView] = useState('home');
  const [importState, setImportState] = useState('idle');
  const [mpn, setMpn] = useState('');
  const [submittedMpn, setSubmittedMpn] = useState('');
  const [inputError, setInputError] = useState('');

  useEffect(() => {
    const el = document.createElement('style');
    el.id = 'd2-fonts';
    el.textContent = `@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600&display=swap');`;
    document.head.appendChild(el);
    return () => el.remove();
  }, []);

  const handleImport = () => {
    const val = mpn.trim();
    if (!val) { setInputError('ERR: MPN required'); return; }
    setInputError('');
    setSubmittedMpn(val);
    setImportState('loading');
    setTimeout(() => setImportState(val.toLowerCase() === 'error' || val.length < 4 ? 'error' : 'success'), 2200);
  };

  const handleReset = () => { setImportState('idle'); setMpn(''); setSubmittedMpn(''); setInputError(''); };

  const navItems = [
    { id: 'home', label: 'IMPORT', desc: 'MPN lookup' },
    { id: 'detail', label: 'PART', desc: 'Detail view' },
    { id: 'admin', label: 'LOG', desc: 'Import history' },
  ];

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", background: C2.bg, minHeight: '100vh', display: 'flex', flexDirection: 'column', color: C2.text, fontSize: 13 }}>
      {/* Top nav */}
      <header style={{ borderBottom: `1px solid ${C2.border}`, background: C2.surface, display: 'flex', alignItems: 'center', padding: '0 24px', height: 48, flexShrink: 0, gap: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 32 }}>
          <div style={{ width: 22, height: 22, border: `1.5px solid ${C2.accent}`, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="1" y="1" width="3" height="3" fill={C2.accent}/><rect x="6" y="1" width="3" height="3" fill={C2.accent} opacity="0.4"/><rect x="1" y="6" width="3" height="3" fill={C2.accent} opacity="0.4"/><rect x="6" y="6" width="3" height="3" fill={C2.accent}/></svg>
          </div>
          <span style={{ fontFamily: 'JetBrains Mono', fontSize: 12, color: C2.textBright, fontWeight: 700, letterSpacing: '0.05em' }}>EE_LIB</span>
        </div>
        {navItems.map(item => (
          <button key={item.id} onClick={() => setView(item.id)} style={{
            padding: '0 16px', height: '100%', border: 'none', cursor: 'pointer',
            background: 'transparent', fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10, letterSpacing: '0.08em', fontWeight: 500,
            color: view === item.id ? C2.accent : C2.textMuted,
            borderBottom: view === item.id ? `2px solid ${C2.accent}` : '2px solid transparent',
          }}>
            {item.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <D2StatusDot status="success" showLabel={false} />
          <D2Mono color={C2.textMuted} size={10}>ALL SYSTEMS NOMINAL</D2Mono>
        </div>
      </header>

      <main style={{ flex: 1, overflow: 'auto' }}>
        {view === 'home' && <D2HomeView importState={importState} mpn={mpn} setMpn={setMpn} submittedMpn={submittedMpn} inputError={inputError} onImport={handleImport} onReset={handleReset} onDetail={() => setView('detail')} onAdmin={() => setView('admin')} />}
        {view === 'detail' && <D2DetailView onBack={() => setView('home')} />}
        {view === 'admin' && <D2AdminView onDetail={() => setView('detail')} />}
      </main>
    </div>
  );
}

Object.assign(window, { Dir2 });
