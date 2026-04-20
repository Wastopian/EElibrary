
// v2-detail.jsx — Part Detail / Readiness Record (tabbed)

const { useState } = React;

const TABS = [
  { id: 'overview',   label: 'Overview' },
  { id: 'mates',      label: 'Mates & Accessories', badge: 4 },
  { id: 'cad',        label: 'CAD Assets',          badge: '2!' },
  { id: 'sourcing',   label: 'Sourcing' },
  { id: 'alternates', label: 'Alternates' },
  { id: 'approval',   label: 'Approval & Audit' },
];

function D2TabBar({ active, onChange }) {
  const c = window.V2C;
  return (
    <div style={{ display: 'flex', borderBottom: `1px solid ${c.border}`, background: c.surface, paddingLeft: 32 }}>
      {TABS.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)} style={{
          padding: '11px 16px', border: 'none', background: 'transparent', cursor: 'pointer',
          fontFamily: "'DM Sans', sans-serif", fontSize: 12.5, fontWeight: active === t.id ? 600 : 400,
          color: active === t.id ? c.plum : c.textMuted,
          borderBottom: `2px solid ${active === t.id ? c.plum : 'transparent'}`,
          marginBottom: -1, letterSpacing: '0.01em', transition: 'color 0.1s',
          display: 'inline-flex', alignItems: 'center', gap: 7,
        }}>
          {t.label}
          {t.badge && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 8, background: typeof t.badge === 'string' && t.badge.includes('!') ? c.warningSoft : c.surface, color: typeof t.badge === 'string' && t.badge.includes('!') ? c.warning : c.textMuted, border: `1px solid ${c.border}` }}>{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

// ── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab({ part, c }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16 }}>
      {/* Left */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Description + flags */}
        <V2Card pad={16}>
          <p style={{ fontSize: 13.5, lineHeight: 1.65, marginBottom: 12 }}>{part.description}</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[['Category', part.category], ['Family', part.family], ['Pitch', part.pitch], ['Circuits', part.circuits]].map(([k, v]) => (
              <div key={k} style={{ background: c.surface, border: `1px solid ${c.border}`, borderRadius: 3, padding: '4px 10px' }}>
                <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: c.textMuted }}>{k} </span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{v}</span>
              </div>
            ))}
          </div>
        </V2Card>

        {/* MATES PREVIEW — elevated for connector parts */}
        <V2Card pad={0} style={{ overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', background: c.plumSoft, borderBottom: `1px solid ${c.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <V2Label style={{ color: c.green }}>Mates &amp; Required Accessories — Connector Part</V2Label>
            <span style={{ fontSize: 10.5, color: c.textMuted, fontWeight: 600 }}>{part.mates.length} HEADERS · {part.contacts.length} CONTACTS · {part.accessories.length} OPTIONAL</span>
          </div>
          <div style={{ padding: '0 16px' }}>
            {part.mates.map((m, i) => (
              <div key={m.mpn} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: `1px solid ${c.borderLight}` }}>
                <span style={{ width: 5, height: 24, background: c.plumLight, borderRadius: 1, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12.5 }}>{m.mpn}</span>
                    <span style={{ fontSize: 10.5, color: c.textXMuted, background: c.surface, border: `1px solid ${c.border}`, padding: '0 6px', borderRadius: 2 }}>{m.relationship}</span>
                    {m.inLibrary && <V2StatusPill status="pass" label="In Library" />}
                  </div>
                  <p style={{ fontSize: 11.5, color: c.textMuted, marginTop: 1 }}>{m.description}</p>
                </div>
                <span style={{ fontSize: 11.5, color: m.readiness >= 85 ? c.success : c.warning, fontWeight: 700 }}>{m.readiness}%</span>
              </div>
            ))}
            {part.contacts.map(ct => (
              <div key={ct.mpn} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${c.borderLight}` }}>
                <span style={{ width: 5, height: 18, background: ct.required ? c.green : c.borderLight, borderRadius: 1, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12.5 }}>{ct.mpn}</span>
                    {ct.required && <span style={{ fontSize: 10, padding: '0 6px', background: c.greenSoft, color: c.green, borderRadius: 2, fontWeight: 700, letterSpacing: '0.05em' }}>REQUIRED</span>}
                    {ct.inLibrary ? <V2StatusPill status="pass" label="In Library" /> : <span style={{ fontSize: 10, color: c.textXMuted, fontWeight: 600 }}>NOT IN LIB</span>}
                  </div>
                  <p style={{ fontSize: 11.5, color: c.textMuted, marginTop: 1 }}>{ct.description}</p>
                </div>
              </div>
            ))}
          </div>
          <div style={{ padding: '8px 16px', background: c.surface, borderTop: `1px solid ${c.border}`, fontSize: 11.5, color: c.textMuted }}>
            <strong style={{ color: c.warning }}>⚠</strong> &nbsp;Pitch confusion risk: Micro-Fit 3.0 (3.00mm) vs. Mini-Fit Jr. (4.20mm) — verify before layout.
          </div>
        </V2Card>

        {/* Specs grid */}
        <V2Card pad={0} style={{ overflow: 'hidden' }}>
          <div style={{ padding: '12px 18px', background: c.surface, borderBottom: `1px solid ${c.border}` }}>
            <V2Label>Specifications</V2Label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
            {part.specs.map((s, i) => (
              <div key={s.label} style={{
                padding: '9px 18px', borderBottom: `1px solid ${c.borderLight}`,
                borderRight: i % 2 === 0 ? `1px solid ${c.borderLight}` : 'none',
              }}>
                <p style={{ fontSize: 11, color: c.textMuted, marginBottom: 3 }}>{s.label}</p>
                <p style={{ fontSize: 13, fontWeight: 500 }}>{s.value}</p>
              </div>
            ))}
          </div>
        </V2Card>
      </div>

      {/* Right */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Readiness summary */}
        <V2Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16, paddingBottom: 16, borderBottom: `1px solid ${c.borderLight}` }}>
            <ReadinessRing score={part.readiness.score} size={52} />
            <div>
              <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13.5, marginBottom: 3 }}>Readiness Score</p>
              <V2StatusPill status={part.readiness.status} />
            </div>
          </div>
          {part.readiness.checks.map(ch => <CheckRow key={ch.id} check={ch} />)}
        </V2Card>

        {/* Compliance */}
        <V2Card>
          <V2SectionHeader>Compliance</V2SectionHeader>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <V2StatusPill status="pass" label="RoHS" />
            <V2StatusPill status="pass" label="REACH" />
            <V2StatusPill status="pass" label="Active" />
            <V2StatusPill status="pass" label="UL 94V-0" />
          </div>
        </V2Card>

        {/* Warnings */}
        {part.warnings.length > 0 && (
          <V2Card pad={0} style={{ overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', background: c.warningSoft, borderBottom: `1px solid ${c.warningBorder}` }}>
              <V2Label style={{ color: c.warning }}>⚠ Warnings ({part.warnings.length})</V2Label>
            </div>
            <div style={{ padding: '0 16px' }}>
              {part.warnings.map((w, i) => (
                <p key={i} style={{ fontSize: 12, color: c.text, lineHeight: 1.65, padding: '9px 0', borderBottom: i < part.warnings.length - 1 ? `1px solid ${c.borderLight}` : 'none' }}>{w.message}</p>
              ))}
            </div>
          </V2Card>
        )}
      </div>
    </div>
  );
}

// ── Mates & Accessories Tab ──────────────────────────────────────────────────
function MatesTab({ part, c }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Variant confusion warning */}
      <div style={{ background: c.warningSoft, border: `1px solid ${c.warningBorder}`, borderRadius: 4, padding: '12px 18px', display: 'flex', gap: 10 }}>
        <span style={{ fontSize: 18, lineHeight: 1 }}>⚠</span>
        <div>
          <p style={{ fontWeight: 600, fontSize: 13, color: c.warning, marginBottom: 3 }}>Micro-Fit 3.0 vs. Mini-Fit Jr. — Pitch Confusion Risk</p>
          <p style={{ fontSize: 12.5, color: c.textMuted, lineHeight: 1.6 }}>
            Micro-Fit 3.0 uses a <strong>3.00mm pitch</strong>. Mini-Fit Jr. uses <strong>4.20mm pitch</strong> — they look similar but are <strong>not interchangeable</strong>. Verify mating header pitch before PCB layout.
          </p>
        </div>
      </div>

      {/* Mating headers */}
      <V2Card pad={0} style={{ overflow: 'hidden' }}>
        <div style={{ padding: '12px 20px', background: c.surface, borderBottom: `1px solid ${c.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <V2Label>Mating Headers</V2Label>
          <span style={{ fontSize: 11.5, color: c.textMuted }}>2 variants</span>
        </div>
        {part.mates.map((m, i) => (
          <div key={m.mpn} style={{ padding: '16px 20px', borderBottom: i < part.mates.length - 1 ? `1px solid ${c.borderLight}` : 'none', display: 'flex', alignItems: 'flex-start', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: 14 }}>{m.mpn}</span>
                <span style={{ fontSize: 11.5, color: c.textXMuted, background: c.surface, border: `1px solid ${c.border}`, padding: '1px 7px', borderRadius: 2 }}>{m.relationship}</span>
                {m.inLibrary && <V2StatusPill status="pass" label="In Library" />}
              </div>
              <p style={{ fontSize: 13, color: c.textMuted, marginBottom: 4 }}>{m.manufacturer} · {m.family}</p>
              <p style={{ fontSize: 12.5, lineHeight: 1.5 }}>{m.description}</p>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', marginBottom: 6 }}>
                <ReadinessRing score={m.readiness} size={36} />
              </div>
              {!m.inLibrary && <V2Btn variant="secondary" size="sm">Import</V2Btn>}
            </div>
          </div>
        ))}
      </V2Card>

      {/* Required contacts */}
      <V2Card pad={0} style={{ overflow: 'hidden' }}>
        <div style={{ padding: '12px 20px', background: c.surface, borderBottom: `1px solid ${c.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <V2Label>Crimp Contacts</V2Label>
          <span style={{ fontSize: 11.5, color: c.textMuted }}>Required for field termination</span>
        </div>
        {part.contacts.map((ct, i) => (
          <div key={ct.mpn} style={{ padding: '13px 20px', borderBottom: i < part.contacts.length - 1 ? `1px solid ${c.borderLight}` : 'none', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: 13.5 }}>{ct.mpn}</span>
                {ct.required && <span style={{ fontSize: 11, padding: '1px 7px', background: c.plumSoft, color: c.plumMid, borderRadius: 2, fontWeight: 600 }}>Required</span>}
                {ct.inLibrary && <V2StatusPill status="pass" label="In Library" />}
              </div>
              <p style={{ fontSize: 12.5, color: c.textMuted }}>{ct.description}</p>
            </div>
            {!ct.inLibrary && <V2Btn variant="secondary" size="sm">Import</V2Btn>}
          </div>
        ))}
      </V2Card>

      {/* Optional accessories */}
      <V2Card pad={0} style={{ overflow: 'hidden' }}>
        <div style={{ padding: '12px 20px', background: c.surface, borderBottom: `1px solid ${c.border}` }}>
          <V2Label>Optional Accessories</V2Label>
        </div>
        {part.accessories.map((ac, i) => (
          <div key={ac.mpn} style={{ padding: '12px 20px', borderBottom: i < part.accessories.length - 1 ? `1px solid ${c.borderLight}` : 'none', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: 13.5 }}>{ac.mpn}</span>
                <span style={{ fontSize: 11, padding: '1px 7px', background: c.surface, border: `1px solid ${c.border}`, color: c.textMuted, borderRadius: 2 }}>{ac.type}</span>
              </div>
              <p style={{ fontSize: 12.5, color: c.textMuted }}>{ac.description}</p>
            </div>
            <V2Btn variant="secondary" size="sm">Import</V2Btn>
          </div>
        ))}
      </V2Card>
    </div>
  );
}

// ── CAD Assets Tab ───────────────────────────────────────────────────────────
function CADTab({ part, c }) {
  const assetIcon = { 'Datasheet': 'PDF', 'Schematic Symbol': 'SYM', 'PCB Footprint': 'FP', '3D Model': '3D' };
  const statusMeta = {
    official:      { label: 'Official',     note: 'From manufacturer or verified open-source library', action: null },
    generated:     { label: 'Generated',    note: 'Auto-generated from datasheet data — verify visually before use', action: 'verify' },
    'third-party': { label: 'Third-Party',  note: 'From SnapEDA or similar — review accuracy against datasheet', action: 'review' },
    missing:       { label: 'Missing',      note: 'No asset found — manual creation or generation required', action: 'create' },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Asset cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {part.cadAssets.map(asset => {
          const sm = statusMeta[asset.status] || statusMeta.missing;
          return (
            <V2Card key={asset.type} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 36, height: 36, background: c.surface, border: `1.5px solid ${c.border}`, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: 9.5, fontWeight: 800, fontFamily: 'monospace', color: c.textMuted, letterSpacing: '0.05em' }}>{assetIcon[asset.type]}</span>
                  </div>
                  <div>
                    <p style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 2 }}>{asset.type}</p>
                    <p style={{ fontSize: 11.5, color: c.textMuted }}>{asset.source}</p>
                  </div>
                </div>
                <V2StatusPill status={asset.status} />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <V2Label>Confidence</V2Label>
                  <span style={{ fontSize: 11, color: c.textXMuted }}>Updated {asset.date}</span>
                </div>
                <ConfidenceBar value={asset.confidence} width={160} />
              </div>

              <p style={{ fontSize: 11.5, color: c.textMuted, lineHeight: 1.55 }}>{sm.note}</p>

              {sm.action && (
                <div style={{ display: 'flex', gap: 8 }}>
                  {sm.action === 'verify' && <V2Btn variant="secondary" size="sm">Mark Verified</V2Btn>}
                  {sm.action === 'review' && <>
                    <V2Btn variant="secondary" size="sm">Accept</V2Btn>
                    <V2Btn variant="warning" size="sm">Flag for Review</V2Btn>
                  </>}
                  {sm.action === 'create' && <V2Btn variant="primary" size="sm">Generate Asset</V2Btn>}
                </div>
              )}
            </V2Card>
          );
        })}
      </div>

      {/* Workflow guidance */}
      <V2Card style={{ background: c.plumSoft, border: `1px solid ${c.plumBorder}` }}>
        <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13, color: c.plum, marginBottom: 8 }}>CAD Asset Review Workflow</p>
        <p style={{ fontSize: 12.5, color: c.textMuted, lineHeight: 1.65 }}>
          Parts with generated or third-party CAD assets should be reviewed by a CAD librarian before approval. 
          Open the PCB footprint in your EDA tool and compare pad layout against the datasheet mechanical drawing. 
          For 3D models, verify against the datasheet dimensions and connector mating height.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <V2Btn variant="primary" size="sm">Request CAD Review</V2Btn>
          <V2Btn variant="secondary" size="sm">Download All Assets</V2Btn>
        </div>
      </V2Card>
    </div>
  );
}

// ── Sourcing Tab ─────────────────────────────────────────────────────────────
function SourcingTab({ part, c }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <V2Card pad={0} style={{ overflow: 'hidden' }}>
          <div style={{ padding: '12px 20px', background: c.surface, borderBottom: `1px solid ${c.border}` }}>
            <V2Label>Distributor Pricing & Stock</V2Label>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: c.bg }}>
                {['Distributor', 'SKU', 'Stock', 'Price (1u)', 'MOQ', 'Lead Time'].map(h => (
                  <th key={h} style={{ padding: '8px 16px', textAlign: 'left', borderBottom: `1px solid ${c.border}` }}>
                    <V2Label>{h}</V2Label>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {part.suppliers.map((s, i) => (
                <tr key={s.name} style={{ borderBottom: i < part.suppliers.length - 1 ? `1px solid ${c.borderLight}` : 'none' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600, fontSize: 13.5 }}>{s.name}</td>
                  <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: 12.5, color: c.textMuted }}>{s.sku}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13 }}>{s.stock.toLocaleString()}</td>
                  <td style={{ padding: '12px 16px', fontWeight: 700, fontSize: 14, color: c.plum }}>{s.price}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: c.textMuted }}>{s.moq}</td>
                  <td style={{ padding: '12px 16px' }}><V2StatusPill status="pass" label={s.lead} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </V2Card>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <V2Card>
          <V2SectionHeader>Lifecycle Status</V2SectionHeader>
          <V2StatusPill status="pass" label="Active" style={{ marginBottom: 12 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[['Lifecycle', 'Active'], ['EOL Risk', 'Low'], ['NRND', 'No'], ['Last Confirmed', 'Feb 2025']].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '5px 0', borderBottom: `1px solid ${c.borderLight}` }}>
                <span style={{ color: c.textMuted }}>{k}</span>
                <span style={{ fontWeight: 500 }}>{v}</span>
              </div>
            ))}
          </div>
        </V2Card>

        <V2Card>
          <V2SectionHeader>Packaging Options</V2SectionHeader>
          {[['Tray (standard)', 'As-drawn'], ['Tape & Reel', '0430250200TR']].map(([pkg, mpn]) => (
            <div key={pkg} style={{ padding: '8px 0', borderBottom: `1px solid ${c.borderLight}`, display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
              <span style={{ color: c.textMuted }}>{pkg}</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{mpn}</span>
            </div>
          ))}
        </V2Card>
      </div>
    </div>
  );
}

// ── Alternates Tab ───────────────────────────────────────────────────────────
function AlternatesTab({ part, c }) {
  const riskColor = { high: c.error, medium: c.warning, low: c.success };
  const riskSoft  = { high: c.errorSoft, medium: c.warningSoft, low: c.successSoft };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 13, color: c.textMuted, marginBottom: 4, lineHeight: 1.6 }}>
        Alternate parts are assessed for functional compatibility. Always verify pinout, pitch, and mechanical fit before substitution.
      </p>
      {part.alternates.map(alt => (
        <V2Card key={alt.mpn} style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: 14.5 }}>{alt.mpn}</span>
              <span style={{ fontSize: 12.5, color: c.textMuted }}>{alt.manufacturer}</span>
            </div>
            <p style={{ fontSize: 13, marginBottom: 8 }}>{alt.description}</p>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: riskSoft[alt.risk], border: `1px solid ${riskColor[alt.risk]}30`, borderRadius: 3, padding: '5px 12px' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: riskColor[alt.risk], flexShrink: 0 }} />
              <span style={{ fontSize: 12.5, color: riskColor[alt.risk], fontWeight: 500 }}>{alt.compatibility}</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
            <V2Btn variant="secondary" size="sm">View Part</V2Btn>
            {alt.risk === 'low' && <V2Btn variant="ghost" size="sm" style={{ fontSize: 11 }}>Mark as Alternate</V2Btn>}
          </div>
        </V2Card>
      ))}
    </div>
  );
}

// ── Approval & Audit Tab ─────────────────────────────────────────────────────
function ApprovalTab({ part, c }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Approval status */}
        <V2Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 16, borderBottom: `1px solid ${c.borderLight}` }}>
            <div>
              <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Library Approval</p>
              <V2StatusPill status="pending" />
            </div>
            <V2Btn variant="primary">Approve Part</V2Btn>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              ['Requested By', part.approval.requestedBy],
              ['Requested', part.approval.requestedAt],
              ['Assigned To', part.approval.assignedTo],
              ['Due Date', part.approval.dueDate],
            ].map(([k, v]) => (
              <div key={k} style={{ background: c.surface, borderRadius: 3, padding: '8px 12px' }}>
                <p style={{ fontSize: 10.5, color: c.textMuted, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{k}</p>
                <p style={{ fontSize: 13, fontWeight: 500 }}>{v}</p>
              </div>
            ))}
          </div>
          {part.approval.notes && (
            <div style={{ marginTop: 14, padding: '10px 14px', background: c.plumSoft, borderRadius: 3, borderLeft: `3px solid ${c.plumLight}` }}>
              <p style={{ fontSize: 12.5, color: c.text, lineHeight: 1.6 }}><strong>Reviewer note:</strong> {part.approval.notes}</p>
            </div>
          )}
        </V2Card>

        {/* Audit trail */}
        <V2Card pad={0} style={{ overflow: 'hidden' }}>
          <div style={{ padding: '12px 20px', background: c.surface, borderBottom: `1px solid ${c.border}` }}>
            <V2Label>Audit Trail</V2Label>
          </div>
          <div style={{ padding: '0 20px' }}>
            {part.audit.map((entry, i) => (
              <div key={i} style={{ display: 'flex', gap: 14, padding: '12px 0', borderBottom: i < part.audit.length - 1 ? `1px solid ${c.borderLight}` : 'none' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: c.plumLight, marginTop: 5, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{entry.action}</span>
                    <span style={{ fontSize: 11.5, color: c.textXMuted }}>{entry.by}</span>
                  </div>
                  <p style={{ fontSize: 12, color: c.textMuted, lineHeight: 1.5, marginBottom: 3 }}>{entry.detail}</p>
                  <p style={{ fontSize: 11, fontFamily: 'monospace', color: c.textXMuted }}>{entry.when}</p>
                </div>
              </div>
            ))}
          </div>
        </V2Card>
      </div>

      {/* Provenance + confidence */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <V2Card>
          <V2SectionHeader>Data Provenance</V2SectionHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { label: 'Identity match',    value: 97, source: 'Molex catalog API' },
              { label: 'Specs extraction',  value: 91, source: 'Datasheet (official)' },
              { label: 'CAD assets',        value: 72, source: 'Mixed sources' },
              { label: 'Mate mapping',      value: 88, source: 'Molex series data' },
            ].map(row => (
              <div key={row.label} style={{ paddingBottom: 10, borderBottom: `1px solid ${c.borderLight}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 12.5 }}>{row.label}</span>
                  <span style={{ fontSize: 11.5, color: c.textMuted }}>{row.source}</span>
                </div>
                <ConfidenceBar value={row.value} width={200} />
              </div>
            ))}
          </div>
        </V2Card>

        <V2Card>
          <V2SectionHeader>Overall Readiness</V2SectionHeader>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <ReadinessRing score={part.readiness.score} size={56} />
            <div>
              <V2StatusPill status={part.readiness.status} />
              <p style={{ fontSize: 12, color: c.textMuted, marginTop: 6, lineHeight: 1.5 }}>
                2 checks require attention before this part is ready for design use.
              </p>
            </div>
          </div>
        </V2Card>
      </div>
    </div>
  );
}

// ── Main Detail View ──────────────────────────────────────────────────────────
function V2DetailView({ onBack }) {
  const [tab, setTab] = useState('overview');
  const c = window.V2C;
  const part = window.V2_PART;

  const content = {
    overview:   <OverviewTab   part={part} c={c} />,
    mates:      <MatesTab      part={part} c={c} />,
    cad:        <CADTab        part={part} c={c} />,
    sourcing:   <SourcingTab   part={part} c={c} />,
    alternates: <AlternatesTab part={part} c={c} />,
    approval:   <ApprovalTab   part={part} c={c} />,
  };

  return (
    <div>
      {/* Sticky part header */}
      <div style={{ background: c.surface, borderBottom: `1px solid ${c.border}`, padding: '14px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.textMuted, fontSize: 12.5, fontFamily: "'DM Sans', sans-serif", padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                ← Library
              </button>
              <span style={{ color: c.rule }}>›</span>
              <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>{part.mpn}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>{part.mpn}</h1>
              <V2StatusPill status="review" />
              <V2StatusPill status="pending" label="Pending Approval" />
            </div>
            <p style={{ fontSize: 13, color: c.textMuted, marginTop: 2 }}>{part.manufacturer} · {part.family} · {part.category}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <ReadinessRing score={part.readiness.score} size={44} />
            <V2Btn>Approve Part</V2Btn>
          </div>
        </div>
      </div>

      <D2TabBar active={tab} onChange={setTab} />

      <div style={{ padding: '20px 32px' }}>
        {content[tab]}
      </div>
    </div>
  );
}

Object.assign(window, { V3DetailView: V2DetailView });
