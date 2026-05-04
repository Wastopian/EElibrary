
// v3-home.jsx — Quick Part Readiness Check (compact, explanation-first)

const { useState } = React;

function V3HomeView({ onOpenDetail, onOpenAdmin }) {
  const [state, setState] = useState('idle');
  const [mpn, setMpn] = useState('');
  const [mfr, setMfr] = useState('');
  const [dsUrl, setDsUrl] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [inputErr, setInputErr] = useState('');
  const c = window.V2C;
  const part = window.V2_PART;

  const run = () => {
    const val = mpn.trim();
    if (!val) { setInputErr('Enter a manufacturer part number.'); return; }
    setInputErr('');
    setSubmitted(val);
    setState('loading');
    setTimeout(() => setState(val.toLowerCase() === 'error' || val.length < 4 ? 'error' : 'result'), 1400);
  };
  const reset = () => { setState('idle'); setMpn(''); setMfr(''); setDsUrl(''); setSubmitted(''); setInputErr(''); };

  const explanation = {
    headline: 'Review Needed',
    subhead: '2 CAD assets need verification before this part is ready for design use',
    detail: 'Identity confirmed (Molex catalog). Footprint is auto-generated and 3D model is third-party — both require visual check against datasheet. Mating parts mapped, sourcing healthy, awaiting library approval.',
  };

  const recActions = [
    { label: 'Verify PCB footprint against datasheet mechanical drawing',  priority: 'high',   eta: '~10 min' },
    { label: 'Review 3D model accuracy (SnapEDA source)',                   priority: 'high',   eta: '~5 min'  },
    { label: 'Submit for library approval (J. Kim assigned)',               priority: 'medium', eta: '1 click' },
  ];
  const priorityCol = { high: c.error, medium: c.warning, low: c.textMuted };

  return (
    <div style={{ padding: '20px 32px 32px', maxWidth: 1100, margin: '0 auto' }}>

      {/* Compact input strip */}
      <div style={{
        background: c.surfaceWhite, border: `1px solid ${c.border}`, borderRadius: 4,
        padding: '14px 18px', marginBottom: 16,
        display: 'grid',
        gridTemplateColumns: state === 'idle' ? '1.4fr 1fr 1.2fr auto' : '180px 140px 1fr auto auto',
        gap: 10, alignItems: 'end', transition: 'grid-template-columns 0.2s',
      }}>
        <div>
          <V2Label style={{ display: 'block', marginBottom: 5 }}>MPN <span style={{ color: c.error }}>*</span></V2Label>
          <input autoFocus value={mpn} onChange={e => setMpn(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && run()}
            placeholder="0430250200"
            style={{
              width: '100%', padding: '7px 11px',
              border: `1.5px solid ${inputErr ? c.error : c.border}`, borderRadius: 3,
              background: inputErr ? c.errorSoft : c.surfaceWhite,
              fontFamily: "'DM Mono', monospace", fontSize: 13.5, fontWeight: 600,
              color: c.text, outline: 'none', letterSpacing: '0.02em',
            }}/>
        </div>
        <div>
          <V2Label style={{ display: 'block', marginBottom: 5 }}>Manufacturer</V2Label>
          <input value={mfr} onChange={e => setMfr(e.target.value)} placeholder="optional"
            style={{ width: '100%', padding: '7px 11px', border: `1.5px solid ${c.border}`, borderRadius: 3, background: c.surfaceWhite, fontSize: 12.5, color: c.text, outline: 'none', fontFamily: 'inherit' }}/>
        </div>
        <div>
          <V2Label style={{ display: 'block', marginBottom: 5 }}>Datasheet URL</V2Label>
          <input value={dsUrl} onChange={e => setDsUrl(e.target.value)} placeholder="optional · improves CAD confidence"
            style={{ width: '100%', padding: '7px 11px', border: `1.5px solid ${c.border}`, borderRadius: 3, background: c.surfaceWhite, fontSize: 12.5, color: c.text, outline: 'none', fontFamily: 'inherit' }}/>
        </div>
        <V2Btn onClick={run} size="sm" style={{ height: 30 }}>Check Part</V2Btn>
        {state !== 'idle' && <V2Btn variant="ghost" size="sm" onClick={reset} style={{ height: 30 }}>Clear</V2Btn>}
      </div>
      {inputErr && <p style={{ marginTop: -10, marginBottom: 12, fontSize: 11.5, color: c.error, paddingLeft: 18 }}>{inputErr}</p>}
      {state === 'idle' && (
        <p style={{ fontSize: 11.5, color: c.textXMuted, marginBottom: 16, paddingLeft: 4 }}>
          Try: <span style={{ fontFamily: 'monospace', color: c.textMuted, cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }} onClick={() => { setMpn('0430250200'); setMfr('Molex'); }}>0430250200</span> · <span style={{ fontFamily: 'monospace', color: c.textMuted, cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }} onClick={() => setMpn('STM32F411CEU6')}>STM32F411CEU6</span> · type <span style={{ fontFamily: 'monospace', color: c.textMuted }}>error</span> for failure state
        </p>
      )}

      {/* Loading */}
      {state === 'loading' && (
        <div style={{ background: c.surfaceWhite, border: `1px solid ${c.border}`, borderRadius: 4, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 22, height: 22, borderRadius: '50%', border: `2.5px solid ${c.border}`, borderTopColor: c.plum, animation: 'v3spin 0.7s linear infinite', flexShrink: 0 }} />
          <p style={{ fontSize: 13, color: c.text }}>
            Querying catalog · matching CAD · mapping mates for <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{submitted}</span>…
          </p>
          <style>{`@keyframes v3spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Result — explanation-first */}
      {state === 'result' && (
        <div>
          {/* HERO: Status explanation, not the score */}
          <div style={{
            background: c.warningSoft, border: `1px solid ${c.warningBorder}`, borderRadius: 4,
            padding: '16px 20px', marginBottom: 12, display: 'flex', alignItems: 'flex-start', gap: 16,
          }}>
            <div style={{ width: 5, alignSelf: 'stretch', background: c.warning, borderRadius: 2, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
                <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 17, fontWeight: 800, color: c.warning, letterSpacing: '-0.01em' }}>{explanation.headline}</h2>
                <span style={{ fontSize: 13, color: c.text, fontWeight: 500 }}>{explanation.subhead}</span>
              </div>
              <p style={{ fontSize: 12.5, color: c.textMuted, lineHeight: 1.65, maxWidth: 820 }}>{explanation.detail}</p>
            </div>
            {/* Smaller, secondary score */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, paddingLeft: 12, borderLeft: `1px solid ${c.warningBorder}` }}>
              <ReadinessRing score={part.readiness.score} size={40} />
              <div>
                <p style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: c.textMuted, lineHeight: 1 }}>Score</p>
                <p style={{ fontSize: 11, color: c.textMuted, marginTop: 4 }}>6 of 8 checks pass</p>
              </div>
            </div>
          </div>

          {/* Part identity strip */}
          <div style={{ background: c.surfaceWhite, border: `1px solid ${c.border}`, borderRadius: 4, padding: '12px 18px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 16, fontWeight: 700 }}>{part.mpn}</span>
            <span style={{ width: 1, height: 16, background: c.border }} />
            <span style={{ fontSize: 13, color: c.text }}>{part.manufacturer} · {part.family}</span>
            <span style={{ fontSize: 13, color: c.textMuted, flex: 1 }}>{part.description}</span>
            <V2StatusPill status="warn" label="Connector" />
            <V2Btn onClick={onOpenDetail} size="sm">Open Full Record</V2Btn>
          </div>

          {/* 3-column dense layout: Checks | Actions | Mates Preview */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>

            {/* Checks */}
            <div style={{ background: c.surfaceWhite, border: `1px solid ${c.border}`, borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ padding: '9px 14px', background: c.surface, borderBottom: `1px solid ${c.border}`, display: 'flex', justifyContent: 'space-between' }}>
                <V2Label>Readiness Checks</V2Label>
                <span style={{ fontSize: 10.5, color: c.textXMuted, fontWeight: 600 }}>6 PASS · 2 ATTN</span>
              </div>
              <div style={{ padding: '0 14px' }}>
                {part.readiness.checks.map(ch => {
                  const map = { pass: { dot: c.plumLight, label: 'PASS' }, warn: { dot: c.warning, label: 'ATTN' }, error: { dot: c.error, label: 'FAIL' }, pending: { dot: c.green, label: 'PEND' } };
                  const s = map[ch.status] || map.warn;
                  return (
                    <div key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: `1px solid ${c.borderLight}` }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot, flexShrink: 0 }} />
                      <span style={{ fontSize: 12.5, fontWeight: 500, flex: 1 }}>{ch.label}</span>
                      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', color: ch.status === 'pass' ? c.success : ch.status === 'warn' ? c.warning : c.green }}>{s.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Recommended actions */}
            <div style={{ background: c.surfaceWhite, border: `1px solid ${c.border}`, borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ padding: '9px 14px', background: c.surface, borderBottom: `1px solid ${c.border}` }}>
                <V2Label>Next Actions</V2Label>
              </div>
              <div style={{ padding: '4px 14px' }}>
                {recActions.map((a, i) => (
                  <div key={i} style={{ padding: '9px 0', borderBottom: i < recActions.length - 1 ? `1px solid ${c.borderLight}` : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', color: priorityCol[a.priority], textTransform: 'uppercase' }}>{a.priority}</span>
                      <span style={{ width: 1, height: 9, background: c.border }} />
                      <span style={{ fontSize: 10, color: c.textXMuted }}>{a.eta}</span>
                    </div>
                    <p style={{ fontSize: 12, color: c.text, lineHeight: 1.5 }}>{a.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Mates preview — connector-specific elevation */}
            <div style={{ background: c.surfaceWhite, border: `1px solid ${c.border}`, borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ padding: '9px 14px', background: c.surface, borderBottom: `1px solid ${c.border}`, display: 'flex', justifyContent: 'space-between' }}>
                <V2Label>Mating Parts</V2Label>
                <span style={{ fontSize: 10.5, color: c.textXMuted, fontWeight: 600 }}>{part.mates.length} HEADERS · {part.contacts.length} CONTACTS</span>
              </div>
              <div style={{ padding: '0 14px' }}>
                {part.mates.map((m, i) => (
                  <div key={m.mpn} style={{ padding: '8px 0', borderBottom: `1px solid ${c.borderLight}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, flex: 1 }}>{m.mpn}</span>
                      <span style={{ fontSize: 10.5, color: m.readiness >= 85 ? c.success : c.warning, fontWeight: 700 }}>{m.readiness}%</span>
                      {m.inLibrary ? <V2StatusPill status="pass" label="LIB" /> : <span style={{ fontSize: 9.5, color: c.textXMuted, fontWeight: 600, letterSpacing: '0.08em' }}>NEW</span>}
                    </div>
                    <p style={{ fontSize: 11, color: c.textMuted, marginTop: 2 }}>{m.relationship}</p>
                  </div>
                ))}
                {part.contacts.map(ct => (
                  <div key={ct.mpn} style={{ padding: '8px 0', borderBottom: `1px solid ${c.borderLight}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, flex: 1 }}>{ct.mpn}</span>
                    {ct.required && <span style={{ fontSize: 9.5, fontWeight: 700, color: c.green, letterSpacing: '0.08em' }}>REQ</span>}
                    {ct.inLibrary ? <V2StatusPill status="pass" label="LIB" /> : <span style={{ fontSize: 9.5, color: c.textXMuted, fontWeight: 600, letterSpacing: '0.08em' }}>NEW</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Warnings strip */}
          {part.warnings.length > 0 && (
            <div style={{ background: c.surfaceWhite, border: `1px solid ${c.border}`, borderRadius: 4, marginBottom: 12 }}>
              {part.warnings.map((w, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 16px', borderBottom: i < part.warnings.length - 1 ? `1px solid ${c.borderLight}` : 'none' }}>
                  <span style={{ width: 14, height: 14, borderRadius: 2, background: w.level === 'warn' ? c.warningSoft : c.plumSoft, color: w.level === 'warn' ? c.warning : c.green, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, flexShrink: 0, marginTop: 1 }}>
                    {w.level === 'warn' ? '!' : 'i'}
                  </span>
                  <p style={{ fontSize: 12.5, color: c.text, lineHeight: 1.55 }}>{w.message}</p>
                </div>
              ))}
            </div>
          )}

          {/* Action strip */}
          <div style={{ display: 'flex', gap: 8 }}>
            <V2Btn onClick={onOpenDetail} size="sm">Open Full Record</V2Btn>
            <V2Btn variant="secondary" size="sm" onClick={onOpenAdmin}>View in Queue</V2Btn>
            <V2Btn variant="ghost" size="sm" onClick={reset}>Check Another Part</V2Btn>
          </div>
        </div>
      )}

      {/* Error */}
      {state === 'error' && (
        <div style={{ background: c.surfaceWhite, border: `1px solid ${c.errorBorder}`, borderRadius: 4, padding: '18px 22px' }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 14 }}>
            <div style={{ width: 28, height: 28, borderRadius: 4, background: c.errorSoft, border: `1.5px solid ${c.errorBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: c.error }}>✕</span>
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14.5, color: c.error, marginBottom: 3 }}>Part not found</p>
              <p style={{ fontSize: 12.5, color: c.textMuted }}>
                No records for <span style={{ fontFamily: 'monospace', fontWeight: 600, color: c.text }}>{submitted}</span> across configured providers.
              </p>
            </div>
          </div>
          <ul style={{ paddingLeft: 18, fontSize: 12, color: c.textMuted, lineHeight: 1.85, marginBottom: 14 }}>
            <li>Confirm exact MPN including suffixes (TR, CT, #PBF)</li>
            <li>Verify manufacturer spelling and product family</li>
            <li>Try the manufacturer's catalog or distributor search</li>
            <li>Contact the parts librarian if this part should already exist</li>
          </ul>
          <div style={{ display: 'flex', gap: 8 }}>
            <V2Btn size="sm" onClick={reset}>Try Again</V2Btn>
            <V2Btn variant="secondary" size="sm" onClick={onOpenAdmin}>View Import Log</V2Btn>
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { V3HomeView: V3HomeView });
