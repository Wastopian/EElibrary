
// v3-admin.jsx — Admin Review Queue with grouped + table modes

const { useState } = React;

function SeverityDot({ level }) {
  const c = window.V2C;
  const col = { high: c.error, medium: c.warning, low: c.textXMuted }[level] || c.textXMuted;
  return <span style={{ width: 7, height: 7, borderRadius: '50%', background: col, display: 'inline-block', flexShrink: 0 }} />;
}

function QueueSection({ title, count, color, colorSoft, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  const c = window.V2C;
  return (
    <div style={{ border: `1px solid ${c.border}`, borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 14px', background: c.surface, border: 'none', cursor: 'pointer',
        fontFamily: 'inherit', textAlign: 'left',
      }}>
        <span style={{ width: 4, height: 16, borderRadius: 2, background: color, flexShrink: 0 }} />
        <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 12.5, flex: 1, color: c.text }}>{title}</span>
        <span style={{ background: colorSoft, color: color, fontWeight: 700, fontSize: 11, padding: '1px 8px', borderRadius: 8, border: `1px solid ${color}40` }}>{count}</span>
        <span style={{ fontSize: 10, color: c.textXMuted, marginLeft: 4 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ background: c.surfaceWhite }}>{children}</div>}
    </div>
  );
}

// Build flat list for table mode
function buildFlat(q) {
  const items = [];
  q.missingCAD.forEach(i => items.push({ ...i, type: 'Missing CAD',     typeKey: 'cad',        severity: i.severity, action: 'Generate' }));
  q.missingMates.forEach(i => items.push({ ...i, type: 'Missing Mates', typeKey: 'mates',      severity: 'medium',   action: 'Map Mates' }));
  q.lowConfidence.forEach(i => items.push({ ...i, type: 'Low Confidence', typeKey: 'confidence', severity: 'medium', action: 'Review' }));
  q.pendingApproval.forEach(i => items.push({ mpn: i.mpn, mfr: i.mfr, type: 'Pending Approval', typeKey: 'approval', severity: 'low', age: `Due ${i.due}`, issue: `Assigned to ${i.assignee}`, readiness: i.readiness, action: 'Approve' }));
  q.duplicates.forEach(i => items.push({ mpn: i.mpn, mfr: i.mfr, type: 'Duplicate', typeKey: 'duplicates', severity: 'high', age: '—', issue: `Matches ${i.matchMpn} (${i.similarity})`, action: 'Compare' }));
  q.obsolescence.forEach(i => items.push({ mpn: i.mpn, mfr: i.mfr, type: 'Obsolescence', typeKey: 'obsolete', severity: i.status === 'EOL' ? 'high' : 'medium', age: `Last buy ${i.lastBuyDate}`, issue: `${i.status} · stock ${i.stock}`, action: 'Find Alt' }));
  return items;
}

function V3AdminView({ onOpenDetail }) {
  const c = window.V2C;
  const q = window.V2_QUEUE;
  const [mode, setMode] = useState('grouped'); // 'grouped' | 'table'
  const [activeSection, setActiveSection] = useState('all');
  const [sort, setSort] = useState({ key: 'severity', dir: 'desc' });

  const flat = buildFlat(q);
  const filtered = activeSection === 'all' ? flat : flat.filter(i => i.typeKey === activeSection);
  const sevRank = { high: 3, medium: 2, low: 1 };
  const sorted = [...filtered].sort((a, b) => {
    let av = a[sort.key], bv = b[sort.key];
    if (sort.key === 'severity') { av = sevRank[av] || 0; bv = sevRank[bv] || 0; }
    if (av < bv) return sort.dir === 'asc' ? -1 : 1;
    if (av > bv) return sort.dir === 'asc' ?  1 : -1;
    return 0;
  });
  const setSortKey = k => setSort(s => s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'desc' });

  const sectionNav = [
    { id: 'all',        label: 'All Items',       count: flat.length },
    { id: 'cad',        label: 'Missing CAD',     count: q.missingCAD.length },
    { id: 'mates',      label: 'Missing Mates',   count: q.missingMates.length },
    { id: 'confidence', label: 'Low Confidence',  count: q.lowConfidence.length },
    { id: 'approval',   label: 'Pending Approval',count: q.pendingApproval.length },
    { id: 'duplicates', label: 'Duplicates',      count: q.duplicates.length },
    { id: 'obsolete',   label: 'Obsolescence',    count: q.obsolescence.length },
  ];
  const show = id => activeSection === 'all' || activeSection === id;

  const sevPill = lvl => {
    const m = { high: { bg: c.errorSoft, fg: c.error, label: 'HIGH' }, medium: { bg: c.warningSoft, fg: c.warning, label: 'MED' }, low: { bg: c.surface, fg: c.textMuted, label: 'LOW' } };
    const s = m[lvl] || m.low;
    return <span style={{ fontSize: 10, fontWeight: 700, color: s.fg, background: s.bg, padding: '1px 7px', borderRadius: 2, letterSpacing: '0.05em' }}>{s.label}</span>;
  };

  return (
    <div style={{ padding: '20px 32px 32px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: c.textMuted, marginBottom: 3 }}>Admin</p>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em' }}>Review Queue</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Mode toggle */}
          <div style={{ display: 'inline-flex', border: `1px solid ${c.border}`, borderRadius: 3, overflow: 'hidden' }}>
            {[{ id: 'grouped', label: 'Grouped' }, { id: 'table', label: 'Table' }].map(m => (
              <button key={m.id} onClick={() => setMode(m.id)} style={{
                padding: '6px 14px', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 11.5, fontWeight: 600, letterSpacing: '0.05em',
                background: mode === m.id ? c.plum : c.surfaceWhite,
                color: mode === m.id ? '#fff' : c.textMuted,
              }}>{m.label}</button>
            ))}
          </div>
          <V2Btn variant="secondary" size="sm">Export CSV</V2Btn>
          <V2Btn size="sm">Bulk Import</V2Btn>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, marginBottom: 18 }}>
        {[
          { label: 'Missing CAD',      n: q.missingCAD.length,     color: c.warning },
          { label: 'Missing Mates',    n: q.missingMates.length,   color: c.caution },
          { label: 'Low Confidence',   n: q.lowConfidence.length,  color: c.warning },
          { label: 'Pending Approval', n: q.pendingApproval.length, color: c.green },
          { label: 'Duplicates',       n: q.duplicates.length,     color: c.error },
          { label: 'Obsolescence',     n: q.obsolescence.length,   color: c.error },
        ].map(s => (
          <div key={s.label} style={{ background: c.surfaceWhite, border: `1px solid ${c.border}`, borderRadius: 3, padding: '10px 12px', borderTop: `3px solid ${s.color}` }}>
            <p style={{ fontSize: 19, fontFamily: "'Syne', sans-serif", fontWeight: 800, color: s.color, lineHeight: 1, marginBottom: 4 }}>{s.n}</p>
            <p style={{ fontSize: 10.5, color: c.textMuted, lineHeight: 1.4, fontWeight: 500 }}>{s.label}</p>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 18 }}>
        {/* Sidebar filter */}
        <div style={{ width: 160, flexShrink: 0 }}>
          <V2Label style={{ display: 'block', marginBottom: 8 }}>Filter by type</V2Label>
          {sectionNav.map(s => (
            <button key={s.id} onClick={() => setActiveSection(s.id)} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              width: '100%', padding: '5px 9px', border: 'none', borderRadius: 3, cursor: 'pointer',
              background: activeSection === s.id ? c.plumSoft : 'transparent',
              color: activeSection === s.id ? c.plum : c.textMuted,
              fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: activeSection === s.id ? 600 : 400,
              marginBottom: 1, textAlign: 'left',
            }}>
              <span>{s.label}</span>
              <span style={{ fontSize: 10.5, background: c.surface, border: `1px solid ${c.border}`, padding: '0 5px', borderRadius: 8, color: c.textMuted }}>{s.count}</span>
            </button>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>

          {/* TABLE MODE */}
          {mode === 'table' && (
            <div style={{ background: c.surfaceWhite, border: `1px solid ${c.border}`, borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ padding: '8px 14px', background: c.surface, borderBottom: `1px solid ${c.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: c.textMuted, fontWeight: 600 }}>{sorted.length} items · sorted by {sort.key} {sort.dir === 'desc' ? '↓' : '↑'}</span>
                <span style={{ fontSize: 10.5, color: c.textXMuted, fontFamily: 'monospace' }}>↑↓ to sort · Enter to open</span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: c.bg }}>
                    {[
                      { k: 'severity', l: 'SEV', w: 60 },
                      { k: 'mpn',      l: 'MPN' },
                      { k: 'mfr',      l: 'MANUFACTURER' },
                      { k: 'type',     l: 'ISSUE TYPE' },
                      { k: 'issue',    l: 'DETAIL' },
                      { k: 'age',      l: 'AGE' },
                      { k: '_',        l: '' },
                    ].map(h => (
                      <th key={h.l} onClick={() => h.k !== '_' && setSortKey(h.k)} style={{
                        padding: '7px 12px', textAlign: 'left', borderBottom: `1px solid ${c.border}`,
                        cursor: h.k !== '_' ? 'pointer' : 'default', width: h.w, userSelect: 'none',
                        fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', color: sort.key === h.k ? c.plum : c.textMuted,
                      }}>
                        {h.l}{sort.key === h.k && (sort.dir === 'desc' ? ' ↓' : ' ↑')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row, i) => (
                    <tr key={`${row.mpn}-${row.type}-${i}`} style={{ borderBottom: `1px solid ${c.borderLight}`, transition: 'background 0.08s' }}
                      onMouseEnter={e => e.currentTarget.style.background = c.surface}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ padding: '7px 12px' }}>{sevPill(row.severity)}</td>
                      <td style={{ padding: '7px 12px', fontFamily: 'monospace', fontWeight: 700, fontSize: 12 }}>{row.mpn}</td>
                      <td style={{ padding: '7px 12px', color: c.textMuted }}>{row.mfr}</td>
                      <td style={{ padding: '7px 12px' }}>
                        <span style={{ fontSize: 11, padding: '1px 7px', background: c.surface, border: `1px solid ${c.border}`, borderRadius: 2, color: c.textMuted, fontWeight: 600 }}>{row.type}</span>
                      </td>
                      <td style={{ padding: '7px 12px', color: c.text, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.issue}</td>
                      <td style={{ padding: '7px 12px', color: c.textXMuted, fontSize: 11.5, whiteSpace: 'nowrap' }}>{row.age}</td>
                      <td style={{ padding: '7px 12px', textAlign: 'right' }}>
                        <button onClick={onOpenDetail} style={{ background: 'transparent', border: `1px solid ${c.border}`, borderRadius: 3, padding: '3px 10px', fontSize: 11, color: c.plum, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{row.action}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* GROUPED MODE */}
          {mode === 'grouped' && (
            <div>
              {show('cad') && (
                <QueueSection title="Missing CAD Assets" count={q.missingCAD.length} color={c.warning} colorSoft={c.warningSoft}>
                  {q.missingCAD.map((item, i) => (
                    <div key={item.mpn} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', borderBottom: i < q.missingCAD.length - 1 ? `1px solid ${c.borderLight}` : 'none' }}>
                      <SeverityDot level={item.severity} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12.5 }}>{item.mpn}</span>
                          <span style={{ fontSize: 11.5, color: c.textMuted }}>{item.mfr}</span>
                        </div>
                        <p style={{ fontSize: 11.5, color: c.warning, marginTop: 1 }}>{item.issue}</p>
                      </div>
                      <span style={{ fontSize: 11, color: c.textXMuted }}>{item.age}</span>
                      <V2Btn variant="secondary" size="sm" onClick={onOpenDetail}>Review</V2Btn>
                    </div>
                  ))}
                </QueueSection>
              )}
              {show('mates') && (
                <QueueSection title="Unresolved Mating Parts" count={q.missingMates.length} color={c.caution} colorSoft={c.cautionSoft}>
                  {q.missingMates.map((item, i) => (
                    <div key={item.mpn} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', borderBottom: i < q.missingMates.length - 1 ? `1px solid ${c.borderLight}` : 'none' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: c.caution, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12.5 }}>{item.mpn}</span>
                          <span style={{ fontSize: 11.5, color: c.textMuted }}>{item.mfr}</span>
                        </div>
                        <p style={{ fontSize: 11.5, color: c.caution, marginTop: 1 }}>{item.issue}</p>
                      </div>
                      <span style={{ fontSize: 11, color: c.textXMuted }}>{item.age}</span>
                      <V2Btn variant="secondary" size="sm" onClick={onOpenDetail}>Map Mates</V2Btn>
                    </div>
                  ))}
                </QueueSection>
              )}
              {show('confidence') && (
                <QueueSection title="Low Confidence Data" count={q.lowConfidence.length} color={c.warning} colorSoft={c.warningSoft}>
                  {q.lowConfidence.map((item, i) => (
                    <div key={item.mpn} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', borderBottom: i < q.lowConfidence.length - 1 ? `1px solid ${c.borderLight}` : 'none' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12.5 }}>{item.mpn}</span>
                          <span style={{ fontSize: 11.5, color: c.textMuted }}>{item.mfr}</span>
                        </div>
                        <p style={{ fontSize: 11.5, color: c.textMuted, marginTop: 1 }}>{item.issue}</p>
                      </div>
                      <ConfidenceBar value={item.confidence} width={90} />
                      <span style={{ fontSize: 11, color: c.textXMuted, marginLeft: 4 }}>{item.age}</span>
                      <V2Btn variant="secondary" size="sm" onClick={onOpenDetail}>Review</V2Btn>
                    </div>
                  ))}
                </QueueSection>
              )}
              {show('approval') && (
                <QueueSection title="Pending Approval" count={q.pendingApproval.length} color={c.green} colorSoft={c.greenSoft}>
                  {q.pendingApproval.map((item, i) => (
                    <div key={item.mpn} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', borderBottom: i < q.pendingApproval.length - 1 ? `1px solid ${c.borderLight}` : 'none' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12.5 }}>{item.mpn}</span>
                          <span style={{ fontSize: 11.5, color: c.textMuted }}>{item.mfr}</span>
                        </div>
                        <span style={{ fontSize: 11, color: c.textXMuted }}>Assigned: {item.assignee} · Due {item.due}</span>
                      </div>
                      <ReadinessRing score={item.readiness} size={28} />
                      <V2Btn size="sm" onClick={onOpenDetail}>Approve</V2Btn>
                    </div>
                  ))}
                </QueueSection>
              )}
              {show('duplicates') && (
                <QueueSection title="Duplicate Candidates" count={q.duplicates.length} color={c.error} colorSoft={c.errorSoft} defaultOpen={false}>
                  {q.duplicates.map((item, i) => (
                    <div key={item.mpn} style={{ padding: '9px 14px', borderBottom: i < q.duplicates.length - 1 ? `1px solid ${c.borderLight}` : 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12.5 }}>{item.mpn}</span>
                      <span style={{ fontSize: 11.5, color: c.textXMuted }}>↔</span>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12.5, color: c.error }}>{item.matchMpn}</span>
                      <span style={{ fontSize: 11, padding: '1px 7px', background: c.errorSoft, color: c.error, borderRadius: 2, fontWeight: 700 }}>{item.similarity}</span>
                      <span style={{ flex: 1 }} />
                      <V2Btn variant="secondary" size="sm" onClick={onOpenDetail}>Compare</V2Btn>
                    </div>
                  ))}
                </QueueSection>
              )}
              {show('obsolete') && (
                <QueueSection title="Obsolescence Risk" count={q.obsolescence.length} color={c.error} colorSoft={c.errorSoft} defaultOpen={false}>
                  {q.obsolescence.map((item, i) => (
                    <div key={item.mpn} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', borderBottom: i < q.obsolescence.length - 1 ? `1px solid ${c.borderLight}` : 'none' }}>
                      <V2StatusPill status={item.status === 'EOL' ? 'error' : 'warn'} label={item.status} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12.5 }}>{item.mpn}</span>
                          <span style={{ fontSize: 11.5, color: c.textMuted }}>{item.mfr}</span>
                        </div>
                        <p style={{ fontSize: 11, color: c.textMuted, marginTop: 1 }}>Last buy: {item.lastBuyDate} · Stock: {item.stock}</p>
                      </div>
                      <V2Btn variant="secondary" size="sm" onClick={onOpenDetail}>Find Alternate</V2Btn>
                    </div>
                  ))}
                </QueueSection>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

Object.assign(window, { V3AdminView });
