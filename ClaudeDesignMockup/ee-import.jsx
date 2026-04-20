// Import panel — 3 layout variants + import states showcase
// Depends on: EE_T, EEBadge, EEKicker, EESpinner from ee-ds.jsx

const { useState, useCallback, useEffect } = React;

function useImportMachine() {
  const [status, setStatus]               = useState('idle');
  const [mpn, setMpn]                     = useState('');
  const [providerPartId, setProviderPartId] = useState('');
  const [manufacturerName, setManufacturerName] = useState('');
  const [providerId, setProviderId]       = useState('jlcparts');
  const [errorMessage, setErrorMessage]   = useState('');
  const [resultPartId, setResultPartId]   = useState(null);

  const submit = useCallback(async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const trimMpn = mpn.trim();
    const trimPid = providerPartId.trim();
    if (!trimMpn && !trimPid) {
      setStatus('validation');
      setErrorMessage('Enter an MPN or a provider part ID to continue.');
      return;
    }
    setStatus('submitting');
    await new Promise(r => setTimeout(r, 2000));
    // Simulate: succeed unless user typed "fail" or "xxx"
    const fails = /fail|xxx|invalid/i.test(trimMpn + trimPid);
    if (fails) {
      setStatus('failure');
      setErrorMessage('Provider lookup returned no matching record for this MPN. Verify the part number and try again.');
    } else {
      setResultPartId((trimMpn || trimPid).replace(/[^a-z0-9]/gi, '_').toLowerCase());
      setStatus('success');
    }
  }, [mpn, providerPartId, manufacturerName, providerId]);

  const reset = () => {
    setStatus('idle'); setMpn(''); setProviderPartId('');
    setManufacturerName(''); setErrorMessage(''); setResultPartId(null);
  };

  return { status, mpn, setMpn, providerPartId, setProviderPartId,
           manufacturerName, setManufacturerName, providerId, setProviderId,
           errorMessage, resultPartId, submit, reset };
}

/* ─────────────────────────────────────────────────────────────────────────
   STATUS FEEDBACK BLOCKS (shared across variants)
───────────────────────────────────────────────────────────────────────── */
function ImportFeedback({ status, errorMessage, resultPartId, onPartOpen, onReset }) {
  const T = EE_T;
  if (status === 'submitting') return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: T.textMuted, fontSize: '0.92rem', marginTop: 14 }}>
      <EESpinner /> Import in progress. This may take a short while.
    </div>
  );
  if (status === 'success') return (
    <div style={{ marginTop: 14 }}>
      <div style={{ background: T.verifiedSoft, border: '1px solid rgba(45,106,69,0.25)', borderRadius: T.rMd, padding: '12px 16px', color: T.verified, fontSize: '0.9rem', lineHeight: 1.55 }}>
        <strong>Import finished.</strong> The catalog record is ready to inspect. CAD and export readiness are unchanged until evidence exists.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <button onClick={() => onPartOpen && onPartOpen(resultPartId)}
          style={{ background: T.accent, border: 'none', borderRadius: T.rMd, color: '#fff', cursor: 'pointer', font: 'inherit', fontWeight: 600, fontSize: '0.9rem', minHeight: 40, padding: '0 16px' }}>
          Open part detail →
        </button>
        <button style={{ background: T.surfaceElevated, border: `1px solid ${T.border}`, borderRadius: T.rMd, color: T.text, cursor: 'pointer', font: 'inherit', fontWeight: 600, fontSize: '0.9rem', minHeight: 40, padding: '0 16px' }}>
          View in admin
        </button>
        <button onClick={onReset} style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', font: 'inherit', fontSize: '0.86rem', minHeight: 'auto', padding: '0 4px' }}>
          Import another
        </button>
      </div>
    </div>
  );
  if (status === 'failure' || status === 'validation') return (
    <div style={{ marginTop: 14, background: T.dangerSoft, border: '1px solid rgba(176,58,58,0.25)', borderRadius: T.rMd, padding: '12px 16px' }}>
      <div style={{ color: T.danger, fontWeight: 600, fontSize: '0.88rem', marginBottom: 3 }}>Import did not complete</div>
      <div style={{ color: T.danger, fontSize: '0.86rem', lineHeight: 1.5 }}>{errorMessage}</div>
    </div>
  );
  return null;
}

/* ─────────────────────────────────────────────────────────────────────────
   VARIANT A — INLINE SECTION  (faithful to codebase style)
───────────────────────────────────────────────────────────────────────── */
function ImportPanelInline({ onPartOpen }) {
  const m = useImportMachine();
  const T = EE_T;
  const [showAdv, setShowAdv] = useState(false);
  const disabled = m.status === 'submitting';

  const fieldStyle = {
    background: T.surfaceElevated, border: `1px solid ${T.border}`, borderRadius: T.rMd,
    color: T.text, font: 'inherit', fontSize: '1rem', minHeight: 44, padding: '0 12px', width: '100%',
  };

  return (
    <div style={{ borderTop: `1px solid ${T.border}`, marginTop: 28, paddingTop: 22, maxWidth: 720 }}>
      <EEKicker>Import by MPN</EEKicker>
      <p style={{ color: T.textMuted, fontSize: '0.9rem', margin: '0 0 20px', maxWidth: '44rem', lineHeight: 1.55 }}>
        Bring a part into the catalog using the same import path as the worker CLI. Fetches provider metadata; does not verify CAD files or export bundles.
      </p>
      <form onSubmit={m.submit} style={{ display: 'grid', gap: 14, maxWidth: 520 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ color: T.textMuted, fontSize: '0.88rem', fontWeight: 600 }}>Provider</span>
          <select value={m.providerId} onChange={e => m.setProviderId(e.target.value)} disabled={disabled} style={fieldStyle}>
            <option value="jlcparts">JLCPCB / LCSC (jlcparts)</option>
            <option value="local-catalog">Local catalog (development)</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ color: T.textMuted, fontSize: '0.88rem', fontWeight: 600 }}>MPN</span>
          <input value={m.mpn} onChange={e => m.setMpn(e.target.value)} placeholder="e.g. RC-02W300JT"
            disabled={disabled} autoComplete="off"
            style={{ ...fieldStyle, fontFamily: T.mono, border: `1px solid ${m.status === 'validation' ? T.danger : T.border}` }} />
        </label>
        <button type="button" onClick={() => setShowAdv(v => !v)}
          style={{ background: 'none', border: 'none', color: T.accent, cursor: 'pointer', font: 'inherit', fontSize: '0.84rem', fontWeight: 600, minHeight: 'auto', padding: 0, textAlign: 'left', width: 'max-content' }}>
          {showAdv ? '− Hide' : '+ Show'} optional fields
        </button>
        {showAdv && <>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ color: T.textMuted, fontSize: '0.88rem', fontWeight: 600 }}>Provider part ID <span style={{ fontWeight: 400 }}>(optional)</span></span>
            <input value={m.providerPartId} onChange={e => m.setProviderPartId(e.target.value)} placeholder="e.g. LCSC C code when known"
              disabled={disabled} autoComplete="off" style={{ ...fieldStyle, fontFamily: T.mono }} />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ color: T.textMuted, fontSize: '0.88rem', fontWeight: 600 }}>Manufacturer hint <span style={{ fontWeight: 400 }}>(optional)</span></span>
            <input value={m.manufacturerName} onChange={e => m.setManufacturerName(e.target.value)} placeholder="Only when provider needs disambiguation"
              disabled={disabled} autoComplete="off" style={fieldStyle} />
          </label>
        </>}
        <button type="submit" disabled={disabled}
          style={{ background: disabled ? '#e2e6ea' : T.accent, border: `1px solid ${disabled ? T.border : T.accent}`, borderRadius: T.rMd, color: disabled ? T.textMuted : '#fff', cursor: disabled ? 'not-allowed' : 'pointer', font: 'inherit', fontWeight: 600, minHeight: 44, padding: '0 20px', width: 'max-content' }}>
          {disabled ? 'Importing…' : 'Import into catalog'}
        </button>
      </form>
      <ImportFeedback status={m.status} errorMessage={m.errorMessage} resultPartId={m.resultPartId} onPartOpen={onPartOpen} onReset={m.reset} />
      <details style={{ marginTop: 20, borderTop: `1px solid ${T.border}`, paddingTop: 16 }}>
        <summary style={{ color: T.textMuted, cursor: 'pointer', fontSize: '0.84rem', fontWeight: 600, listStyle: 'none' }}>Advanced: worker CLI</summary>
        <pre style={{ background: T.techBg, borderRadius: T.rMd, color: T.techText, fontFamily: T.mono, fontSize: '0.8rem', margin: '10px 0 0', overflowX: 'auto', padding: '12px 14px' }}>{`npm run ingest -w @ee-library/worker -- jlcparts <MPN>
npm run imports:providers`}</pre>
      </details>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   VARIANT B — FOCUSED CARD  (elevated, provider as radio cards)
───────────────────────────────────────────────────────────────────────── */
function ImportPanelCard({ onPartOpen }) {
  const m = useImportMachine();
  const T = EE_T;
  const [showAdv, setShowAdv] = useState(false);
  const disabled = m.status === 'submitting';

  const providers = [
    { id: 'jlcparts', name: 'JLCPCB / LCSC', tag: 'jlcparts' },
    { id: 'local-catalog', name: 'Local catalog', tag: 'development' },
  ];

  return (
    <div style={{ marginTop: 28, maxWidth: 600 }}>
      <EEKicker>Import by MPN</EEKicker>
      <div style={{ background: T.surfaceElevated, border: `1px solid ${T.border}`, borderRadius: T.rLg, boxShadow: T.shadow, padding: '24px 28px' }}>
        <h3 style={{ margin: '0 0 20px', fontSize: '1rem', fontWeight: 650, letterSpacing: '-0.01em' }}>Add a part to the catalog</h3>
        <form onSubmit={m.submit} style={{ display: 'grid', gap: 18 }}>

          {/* Provider radio cards */}
          <div>
            <div style={{ color: T.textMuted, fontSize: '0.84rem', fontWeight: 600, marginBottom: 8 }}>Provider</div>
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
              {providers.map(p => (
                <label key={p.id} style={{ cursor: 'pointer' }}>
                  <input type="radio" name="provider_b" value={p.id} checked={m.providerId === p.id} onChange={() => m.setProviderId(p.id)} style={{ display: 'none' }} />
                  <div style={{ background: m.providerId === p.id ? T.accentSoft : T.surfaceMuted, border: `1.5px solid ${m.providerId === p.id ? T.accent : T.border}`, borderRadius: T.rMd, padding: '10px 14px', transition: 'all 120ms ease' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{p.name}</div>
                    <div style={{ color: T.textMuted, fontSize: '0.76rem', marginTop: 2, fontFamily: T.mono }}>{p.tag}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* MPN — large + prominent */}
          <label style={{ display: 'grid', gap: 7 }}>
            <span style={{ color: T.textMuted, fontSize: '0.84rem', fontWeight: 600 }}>Manufacturer Part Number (MPN)</span>
            <input value={m.mpn} onChange={e => m.setMpn(e.target.value)}
              placeholder="e.g. SN74ABT245B, RC-02W300JT…"
              disabled={disabled} autoFocus autoComplete="off"
              style={{ background: T.surfaceElevated, border: `1.5px solid ${m.status === 'validation' ? T.danger : m.mpn ? T.accent : T.border}`, borderRadius: T.rMd, color: T.text, font: 'inherit', fontSize: '1.1rem', fontFamily: T.mono, minHeight: 52, padding: '0 16px', outline: 'none', transition: 'border-color 120ms ease', width: '100%' }} />
          </label>

          {/* Optional fields gated */}
          {!showAdv
            ? <button type="button" onClick={() => setShowAdv(true)} style={{ background: 'none', border: `1px dashed ${T.border}`, borderRadius: T.rMd, color: T.textMuted, cursor: 'pointer', font: 'inherit', fontSize: '0.86rem', minHeight: 40, padding: '0 16px', textAlign: 'left' }}>
                + Provider part ID or manufacturer hint…
              </button>
            : <div style={{ display: 'grid', gap: 10, borderTop: `1px solid ${T.border}`, paddingTop: 16 }}>
                <label style={{ display: 'grid', gap: 5 }}>
                  <span style={{ color: T.textMuted, fontSize: '0.84rem', fontWeight: 600 }}>Provider part ID <span style={{ fontWeight: 400, fontSize: '0.78rem' }}>(optional)</span></span>
                  <input value={m.providerPartId} onChange={e => m.setProviderPartId(e.target.value)} placeholder="LCSC C code" disabled={disabled} autoComplete="off"
                    style={{ background: T.surfaceElevated, border: `1px solid ${T.border}`, borderRadius: T.rMd, color: T.text, font: 'inherit', fontFamily: T.mono, minHeight: 42, padding: '0 12px', width: '100%' }} />
                </label>
                <label style={{ display: 'grid', gap: 5 }}>
                  <span style={{ color: T.textMuted, fontSize: '0.84rem', fontWeight: 600 }}>Manufacturer hint <span style={{ fontWeight: 400, fontSize: '0.78rem' }}>(optional)</span></span>
                  <input value={m.manufacturerName} onChange={e => m.setManufacturerName(e.target.value)} placeholder="When provider needs disambiguation" disabled={disabled} autoComplete="off"
                    style={{ background: T.surfaceElevated, border: `1px solid ${T.border}`, borderRadius: T.rMd, color: T.text, font: 'inherit', minHeight: 42, padding: '0 12px', width: '100%' }} />
                </label>
              </div>
          }

          <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
            <button type="submit" disabled={disabled}
              style={{ background: disabled ? '#e2e6ea' : T.accent, border: 'none', borderRadius: T.rMd, color: disabled ? T.textMuted : '#fff', cursor: disabled ? 'not-allowed' : 'pointer', font: 'inherit', fontWeight: 600, fontSize: '0.95rem', minHeight: 46, padding: '0 24px', display: 'flex', alignItems: 'center', gap: 8 }}>
              {disabled && <EESpinner />}
              {disabled ? 'Importing…' : 'Import into catalog'}
            </button>
            {(m.status === 'failure' || m.status === 'validation') && (
              <button type="button" onClick={m.reset} style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', font: 'inherit', fontSize: '0.86rem', minHeight: 'auto', padding: 0 }}>Reset</button>
            )}
          </div>
        </form>
        <ImportFeedback status={m.status} errorMessage={m.errorMessage} resultPartId={m.resultPartId} onPartOpen={onPartOpen} onReset={m.reset} />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   VARIANT C — COMMAND BAR  (compact, keyboard-first)
───────────────────────────────────────────────────────────────────────── */
function ImportPanelCommand({ onPartOpen }) {
  const m = useImportMachine();
  const T = EE_T;
  const [focused, setFocused] = useState(false);
  const disabled = m.status === 'submitting';
  const active = focused || m.mpn.length > 0 || m.status !== 'idle';

  const handleKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); m.submit(e); }
  };

  return (
    <div style={{ marginTop: 28, maxWidth: 700 }}>
      <EEKicker>Import by MPN</EEKicker>
      <form onSubmit={m.submit}>
        {/* Command row */}
        <div style={{ display: 'flex', alignItems: 'stretch', border: `1.5px solid ${m.status === 'validation' ? T.danger : active ? T.accent : T.border}`, borderRadius: T.rMd, background: T.surfaceElevated, overflow: 'hidden', boxShadow: active ? `0 0 0 3px rgba(42,95,154,0.1)` : 'none', transition: 'box-shadow 150ms, border-color 150ms' }}>
          <select value={m.providerId} onChange={e => m.setProviderId(e.target.value)} disabled={disabled}
            style={{ background: T.surfaceMuted, border: 'none', borderRight: `1px solid ${T.border}`, color: T.textMuted, font: 'inherit', fontSize: '0.84rem', fontWeight: 600, minHeight: 52, padding: '0 14px', cursor: 'pointer', outline: 'none', minWidth: 110 }}>
            <option value="jlcparts">JLCPCB</option>
            <option value="local-catalog">Local</option>
          </select>
          <input value={m.mpn} onChange={e => m.setMpn(e.target.value)}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            onKeyDown={handleKey}
            placeholder="Enter MPN to import…" disabled={disabled} autoComplete="off"
            style={{ background: 'transparent', border: 'none', color: T.text, flex: 1, font: 'inherit', fontSize: '1rem', fontFamily: T.mono, minHeight: 52, outline: 'none', padding: '0 16px' }} />
          <button type="submit" disabled={disabled}
            style={{ background: disabled ? '#e2e6ea' : T.accent, border: 'none', borderLeft: `1px solid ${disabled ? T.border : T.accentHover}`, color: disabled ? T.textMuted : '#fff', cursor: disabled ? 'not-allowed' : 'pointer', font: 'inherit', fontWeight: 600, fontSize: '0.9rem', minHeight: 52, padding: '0 20px', minWidth: 88, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
            {disabled ? <EESpinner /> : null}
            {disabled ? '' : 'Import →'}
          </button>
        </div>

        {/* Optional fields expand when focused or filled */}
        {(active && m.status === 'idle') && (
          <div style={{ background: T.surfaceElevated, border: `1px solid ${T.border}`, borderTop: 'none', borderRadius: `0 0 ${T.rMd} ${T.rMd}`, padding: '12px 14px', display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ color: T.textMuted, fontSize: '0.78rem', fontWeight: 600 }}>Provider part ID <span style={{ fontWeight: 400 }}>(optional)</span></span>
              <input value={m.providerPartId} onChange={e => m.setProviderPartId(e.target.value)} placeholder="LCSC C code"
                style={{ background: T.surfaceMuted, border: `1px solid ${T.border}`, borderRadius: T.rSm, color: T.text, font: 'inherit', fontFamily: T.mono, fontSize: '0.86rem', minHeight: 36, padding: '0 10px' }} />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ color: T.textMuted, fontSize: '0.78rem', fontWeight: 600 }}>Manufacturer hint <span style={{ fontWeight: 400 }}>(optional)</span></span>
              <input value={m.manufacturerName} onChange={e => m.setManufacturerName(e.target.value)} placeholder="For disambiguation"
                style={{ background: T.surfaceMuted, border: `1px solid ${T.border}`, borderRadius: T.rSm, color: T.text, font: 'inherit', fontSize: '0.86rem', minHeight: 36, padding: '0 10px' }} />
            </label>
          </div>
        )}
      </form>
      <ImportFeedback status={m.status} errorMessage={m.errorMessage} resultPartId={m.resultPartId} onPartOpen={onPartOpen} onReset={m.reset} />
      {m.status === 'idle' && !active && (
        <p style={{ color: T.textMuted, fontSize: '0.82rem', margin: '8px 0 0' }}>Type MPN and press Enter, or click Import →</p>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   IMPORT STATES GRID  (static showcase of all 4 states)
───────────────────────────────────────────────────────────────────────── */
function StaticImportCard({ label, tone, status, mpnValue, children }) {
  const T = EE_T;
  const disabled = status === 'submitting';
  return (
    <div style={{ background: T.surfaceElevated, border: `1px solid ${T.border}`, borderRadius: T.rLg, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', borderBottom: `1px solid ${T.border}`, background: T.surfaceMuted, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 650, fontSize: '0.88rem' }}>{label}</span>
        <EEBadge label={label} tone={tone} />
      </div>
      <div style={{ padding: '18px 20px' }}>
        {/* Mini form mockup */}
        <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
          <div style={{ display: 'grid', gap: 4 }}>
            <span style={{ color: T.textMuted, fontSize: '0.78rem', fontWeight: 600 }}>Provider</span>
            <div style={{ background: disabled ? T.surfaceMuted : T.surfaceElevated, border: `1px solid ${T.border}`, borderRadius: T.rMd, color: disabled ? T.textMuted : T.text, fontSize: '0.86rem', minHeight: 38, padding: '0 12px', display: 'flex', alignItems: 'center' }}>
              JLCPCB / LCSC (jlcparts)
            </div>
          </div>
          <div style={{ display: 'grid', gap: 4 }}>
            <span style={{ color: T.textMuted, fontSize: '0.78rem', fontWeight: 600 }}>MPN</span>
            <div style={{ background: disabled ? T.surfaceMuted : T.surfaceElevated, border: `1px solid ${status === 'failure' ? T.danger : T.border}`, borderRadius: T.rMd, color: disabled ? T.textMuted : T.text, fontSize: '0.88rem', fontFamily: T.mono, minHeight: 38, padding: '0 12px', display: 'flex', alignItems: 'center' }}>
              {mpnValue || <span style={{ color: T.textMuted }}>e.g. RC-02W300JT</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: disabled ? '#e2e6ea' : T.accent, borderRadius: T.rMd, color: disabled ? T.textMuted : '#fff', fontSize: '0.86rem', fontWeight: 600, minHeight: 38, padding: '0 14px' }}>
              {disabled && <EESpinner />}
              {disabled ? 'Importing…' : 'Import into catalog'}
            </div>
            {status === 'success' && <>
              <div style={{ display: 'inline-flex', alignItems: 'center', background: T.surfaceElevated, border: `1px solid ${T.border}`, borderRadius: T.rMd, color: T.text, fontSize: '0.82rem', fontWeight: 600, minHeight: 36, padding: '0 12px' }}>Open part detail</div>
              <div style={{ display: 'inline-flex', alignItems: 'center', background: T.surfaceElevated, border: `1px solid ${T.border}`, borderRadius: T.rMd, color: T.text, fontSize: '0.82rem', fontWeight: 600, minHeight: 36, padding: '0 12px' }}>View in admin</div>
            </>}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function ImportStatesGrid() {
  const T = EE_T;
  return (
    <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(2, 1fr)' }}>
      <StaticImportCard label="Idle" tone="neutral" status="idle" mpnValue={null}>
        <p style={{ color: T.textMuted, fontSize: '0.8rem', margin: 0, lineHeight: 1.5 }}>Form ready to fill. All fields enabled. Provider defaults to jlcparts. MPN is required; optional fields gated.</p>
      </StaticImportCard>

      <StaticImportCard label="Submitting" tone="info" status="submitting" mpnValue="SN74ABT245B">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: T.textMuted, fontSize: '0.86rem', marginBottom: 10 }}>
          <EESpinner /> Import in progress. This may take a short while.
        </div>
        <p style={{ color: T.textMuted, fontSize: '0.8rem', margin: 0, lineHeight: 1.5 }}>Fields disabled. Spinner communicates async work. Button text changes to "Importing…"</p>
      </StaticImportCard>

      <StaticImportCard label="Success" tone="verified" status="success" mpnValue="SN74ABT245B">
        <div style={{ background: T.verifiedSoft, border: '1px solid rgba(45,106,69,0.25)', borderRadius: T.rMd, padding: '10px 14px', marginBottom: 10 }}>
          <span style={{ color: T.verified, fontSize: '0.86rem', lineHeight: 1.5 }}><strong>Import finished.</strong> Record ready to inspect. CAD readiness unchanged until evidence exists.</span>
        </div>
        <p style={{ color: T.textMuted, fontSize: '0.8rem', margin: 0, lineHeight: 1.5 }}>Two follow-up actions appear. Calm, non-celebratory confirmation—no CAD promises.</p>
      </StaticImportCard>

      <StaticImportCard label="Failure" tone="danger" status="failure" mpnValue="TPS7A0201PDBVR">
        <div style={{ background: T.dangerSoft, border: '1px solid rgba(176,58,58,0.25)', borderRadius: T.rMd, padding: '10px 14px', marginBottom: 10 }}>
          <div style={{ color: T.danger, fontWeight: 600, fontSize: '0.84rem', marginBottom: 3 }}>Import did not complete</div>
          <div style={{ color: T.danger, fontSize: '0.82rem', lineHeight: 1.5 }}>Provider lookup returned no matching record for this MPN. Verify the part number and try again.</div>
        </div>
        <p style={{ color: T.textMuted, fontSize: '0.8rem', margin: 0, lineHeight: 1.5 }}>Clear, actionable error. No jargon. Reset path available.</p>
      </StaticImportCard>
    </div>
  );
}

Object.assign(window, { ImportPanelInline, ImportPanelCard, ImportPanelCommand, ImportStatesGrid });
