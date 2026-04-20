
// v2-shared.jsx — EE Library v2
// Shared colors, mock data, and base UI components

const { useState, useEffect, useRef } = React;

// ─── Color System ───────────────────────────────────────────────────────────
const V2C = {
  bg: '#EAE4DA',
  surface: '#F4F0E8',
  surfaceWhite: '#FDFCFA',
  surfaceHover: '#EDE8E2',

  border: '#D0C9BE',
  borderLight: '#DDD8CF',
  rule: '#C2BBB0',

  text: '#18140F',
  textMuted: '#6E6459',
  textXMuted: '#A49A90',

  // Plum — accent, used for status moments and special highlights
  green: '#4B1D3F',
  greenDark: '#6B2D5A',
  greenDeep: '#3A1631',
  greenSoft: '#F0E8ED',
  greenBorder: '#C4A0B8',

  // Frog Green — primary brand, action buttons, structural
  plum: '#6BA85E',
  plumMid: '#7FB872',
  plumLight: '#99C68E',
  plumSoft: '#EBF5E8',
  plumBorder: '#B5D9AD',

  // Semantic
  success: '#3A1631',
  successSoft: '#F0E8ED',
  warning: '#7A5F08',
  warningSoft: '#FBF6E2',
  warningBorder: '#D4B840',
  caution: '#A06828',
  cautionSoft: '#F6EBD8',
  error: '#832218',
  errorSoft: '#F8EDEB',
  errorBorder: '#E0A09A',

  // Sidebar
  sidebarBg: '#1E3A18',
  sidebarBorder: '#2C4F26',
  sidebarText: '#A8C9A0',
  sidebarActive: '#D9B5C8',
  sidebarActiveBg: '#2C4F26',
};

// ─── Mock Part Data ─────────────────────────────────────────────────────────
const V2_PART = {
  mpn: '0430250200',
  manufacturer: 'Molex',
  family: 'Micro-Fit 3.0',
  description: 'Micro-Fit 3.0 Receptacle Housing, 2-Circuit, Single Row, 3.00mm Pitch, Natural Nylon',
  category: 'Connector Housing',
  subcategory: 'Wire-to-Board',
  gender: 'Female (Receptacle)',
  pitch: '3.00 mm',
  circuits: 2,
  lifecycle: 'Active',
  rohs: 'Compliant',
  reach: 'Compliant',

  readiness: {
    score: 78,
    status: 'review',
    checks: [
      { id: 'identity',  label: 'Identity Verified',     status: 'pass',    note: 'Matched Molex catalog · 2 independent sources' },
      { id: 'specs',     label: 'Specs Normalized',       status: 'pass',    note: '14 parameters extracted and validated' },
      { id: 'symbol',    label: 'Schematic Symbol',       status: 'pass',    note: 'Official · Molex KiCad library · v2024.01' },
      { id: 'footprint', label: 'PCB Footprint',          status: 'warn',    note: 'Generated · IPC-7351B · needs visual verification' },
      { id: '3d',        label: '3D Model',               status: 'warn',    note: 'Third-party · SnapEDA STEP · medium confidence' },
      { id: 'mates',     label: 'Mates Mapped',           status: 'pass',    note: '2 mating headers · 2 crimp contact variants' },
      { id: 'sourcing',  label: 'Sourcing / Lifecycle',   status: 'pass',    note: 'Active · 3 distributors · in stock' },
      { id: 'approval',  label: 'Library Approval',       status: 'pending', note: 'Awaiting review · assigned to J. Kim' },
    ],
  },

  specs: [
    { label: 'Connector Family',  value: 'Micro-Fit 3.0' },
    { label: 'Pitch',             value: '3.00 mm' },
    { label: 'Circuits',          value: '2' },
    { label: 'Gender',            value: 'Female (Receptacle)' },
    { label: 'Orientation',       value: 'Vertical' },
    { label: 'Current Rating',    value: '5 A per circuit' },
    { label: 'Voltage Rating',    value: '600 V AC/DC' },
    { label: 'Temperature',       value: '−40°C to +105°C' },
    { label: 'Mating Cycles',     value: '30' },
    { label: 'Wire Gauge',        value: '18–24 AWG (with contacts)' },
    { label: 'Contact Finish',    value: 'Tin (standard) / Gold (premium)' },
    { label: 'Housing Material',  value: 'PA66 (Nylon), UL 94V-0' },
    { label: 'Packaging',         value: 'Tray' },
    { label: 'Mating Interface',  value: 'Header pins (separate order)' },
  ],

  mates: [
    { mpn: '0430450200', manufacturer: 'Molex', family: 'Micro-Fit 3.0',
      description: 'Micro-Fit 3.0 Header, 2-Circuit, Single Row, Vertical, 3.00mm Pitch, Through-Hole',
      relationship: 'Primary Mate', orientation: 'Vertical', readiness: 92, inLibrary: true },
    { mpn: '0430450201', manufacturer: 'Molex', family: 'Micro-Fit 3.0',
      description: 'Micro-Fit 3.0 Header, 2-Circuit, Single Row, Right Angle, 3.00mm Pitch, Through-Hole',
      relationship: 'Right Angle Variant', orientation: 'Right Angle', readiness: 85, inLibrary: false },
  ],

  contacts: [
    { mpn: '0430300001', description: 'Crimp Terminal, Tin, 20–24 AWG, Female',  required: true,  inLibrary: true },
    { mpn: '0430300002', description: 'Crimp Terminal, Gold, 20–24 AWG, Female', required: false, inLibrary: false },
  ],

  accessories: [
    { mpn: '0440440200', type: 'Backshell', description: 'Cable Clamp / Backshell Assembly, 2-Circuit', inLibrary: false },
    { mpn: '0440771000', type: 'Panel Clip', description: 'Panel Mount Retention Clip', inLibrary: false },
  ],

  warnings: [
    { level: 'warn', message: 'Family confusion risk: Micro-Fit 3.0 (3.00mm) vs. Mini-Fit Jr. (4.20mm) — verify pitch before selecting mating header.' },
    { level: 'info', message: '6 near-match MPNs in the Micro-Fit 3.0 family differ only by circuit count, orientation, or contact finish suffix.' },
  ],

  cadAssets: [
    { type: 'Datasheet',         status: 'official',     source: 'Molex.com',              confidence: 100, date: '2024-02', action: null },
    { type: 'Schematic Symbol',  status: 'official',     source: 'Molex KiCad library',    confidence: 97,  date: '2024-01', action: null },
    { type: 'PCB Footprint',     status: 'generated',    source: 'Generated (IPC-7351B)',   confidence: 72,  date: '2025-01', action: 'verify' },
    { type: '3D Model',          status: 'third-party',  source: 'SnapEDA (STEP)',          confidence: 64,  date: '2024-09', action: 'review' },
  ],

  suppliers: [
    { name: 'DigiKey', sku: 'WM1720-ND',        stock: 12480, price: '$0.31', moq: 1,   lead: 'In Stock' },
    { name: 'Mouser',  sku: '538-0430250200',   stock: 8200,  price: '$0.33', moq: 1,   lead: 'In Stock' },
    { name: 'Arrow',   sku: '0430250200',       stock: 3100,  price: '$0.29', moq: 100, lead: 'In Stock' },
  ],

  alternates: [
    { mpn: 'B2B-VH-A(LF)(SN)', manufacturer: 'JST',            description: 'VH Series 2-circuit, 3.96mm pitch', compatibility: 'Similar function — NOT pin-compatible (different pitch)', risk: 'high' },
    { mpn: '2-284507-0',        manufacturer: 'TE Connectivity', description: 'MATE-N-LOK 2-circuit housing',      compatibility: 'Compatible function, different contact system',          risk: 'medium' },
    { mpn: '0430250200TR',      manufacturer: 'Molex',           description: 'Micro-Fit 3.0, 2-circuit, T&R pkg', compatibility: 'Drop-in equivalent — packaging only difference',          risk: 'low' },
  ],

  approval: {
    status: 'pending',
    requestedBy: 'T. Nakamura', requestedAt: '2025-03-18',
    assignedTo: 'J. Kim', dueDate: '2025-03-25',
    notes: 'Verify 3D model accuracy against datasheet mechanical drawing before approving. Footprint looks correct but confirm pad dimensions.',
  },

  audit: [
    { when: '2025-03-18 14:22', by: 'T. Nakamura', action: 'Submitted for approval',  detail: 'Readiness 78% — 3D model and footprint flagged for manual review' },
    { when: '2025-03-18 09:15', by: 'System',       action: 'CAD assets populated',   detail: 'Symbol: official, Footprint: generated (IPC-7351B), 3D: SnapEDA third-party' },
    { when: '2025-03-18 09:14', by: 'T. Nakamura', action: 'Part imported',           detail: 'MPN 0430250200 matched via Molex catalog API · confidence 97%' },
    { when: '2025-03-17 16:05', by: 'System',       action: 'Import queued',          detail: 'Initiated by T. Nakamura via Quick Check' },
  ],
};

// ─── Admin Queue Data ────────────────────────────────────────────────────────
const V2_QUEUE = {
  missingCAD: [
    { mpn: 'GD25Q128CSIG',   mfr: 'GigaDevice',         issue: 'No 3D model',              severity: 'medium', age: '3 days' },
    { mpn: 'MMBT3904LT1G',   mfr: 'onsemi',              issue: 'Footprint unverified',      severity: 'medium', age: '5 days' },
    { mpn: 'BCM54210B0KFBG', mfr: 'Broadcom',            issue: 'No symbol or footprint',    severity: 'high',   age: '1 day'  },
    { mpn: 'TPS62130ARGTR',  mfr: 'Texas Instruments',   issue: 'Footprint confidence low',  severity: 'low',    age: '7 days' },
  ],
  missingMates: [
    { mpn: '2137755-1',     mfr: 'TE Connectivity', issue: 'Mating header not in library',   age: '2 days' },
    { mpn: 'DF12(3.0)-20DS', mfr: 'Hirose',         issue: 'Contact variants unmapped',       age: '4 days' },
    { mpn: '0430250400',    mfr: 'Molex',            issue: '4-circuit variant, mates partial', age: '6 days' },
  ],
  lowConfidence: [
    { mpn: 'PE4259-63',    mfr: 'pSemi',   issue: 'Conflicting specs across sources', confidence: 54, age: '2 days' },
    { mpn: 'XC9536XL-10VQ44I', mfr: 'Xilinx', issue: 'Specs extraction incomplete', confidence: 61, age: '8 days' },
  ],
  pendingApproval: [
    { mpn: '0430250200',   mfr: 'Molex',            assignee: 'J. Kim',    due: 'Mar 25', readiness: 78 },
    { mpn: 'STM32F411CEU6', mfr: 'STMicro',         assignee: 'J. Kim',    due: 'Mar 26', readiness: 91 },
    { mpn: 'LM358DR',      mfr: 'Texas Instruments', assignee: 'R. Patel', due: 'Mar 27', readiness: 88 },
    { mpn: 'INA219BIDR',   mfr: 'Texas Instruments', assignee: 'R. Patel', due: 'Mar 28', readiness: 95 },
  ],
  duplicates: [
    { mpn: 'MMBT3904', mfr: 'Fairchild', matchMpn: 'MMBT3904LT1G', matchMfr: 'onsemi', similarity: '94%' },
    { mpn: '0430250400', mfr: 'Molex', matchMpn: '0430250200', matchMfr: 'Molex', similarity: '81%' },
  ],
  obsolescence: [
    { mpn: 'LTC1799CS5#TRMPBF', mfr: 'Linear Tech', status: 'NRND', lastBuyDate: '2025-12', stock: 890 },
    { mpn: 'MAX3221ECAE+',      mfr: 'Maxim',        status: 'EOL',  lastBuyDate: '2024-06', stock: 0   },
  ],
};

// ─── Shared UI Components ────────────────────────────────────────────────────

function V2Label({ children, style: sx = {} }) {
  return (
    <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.13em', color: V2C.textMuted, ...sx }}>
      {children}
    </span>
  );
}

function V2Btn({ children, variant = 'primary', size = 'md', onClick, style: sx = {} }) {
  const [h, setH] = useState(false);
  const pad = size === 'sm' ? '6px 14px' : '10px 22px';
  const fs = size === 'sm' ? 11.5 : 13;
  const variants = {
    primary:   { bg: h ? V2C.plumMid  : V2C.plum,   color: '#F7F0F4', border: 'none' },
    secondary: { bg: h ? V2C.surfaceHover : V2C.surface, color: V2C.text, border: `1.5px solid ${V2C.border}` },
    green:     { bg: h ? V2C.greenDark : V2C.greenDeep, color: '#fff', border: 'none' },
    ghost:     { bg: h ? V2C.surfaceHover : 'transparent', color: V2C.textMuted, border: 'none' },
    warning:   { bg: h ? '#9A7510' : V2C.warning, color: '#fff', border: 'none' },
  };
  const v = variants[variant];
  return (
    <button onClick={onClick}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ padding: pad, background: v.bg, color: v.color, border: v.border, borderRadius: 3, cursor: 'pointer', fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: fs, letterSpacing: '0.06em', textTransform: 'uppercase', transition: 'all 0.12s', display: 'inline-flex', alignItems: 'center', gap: 6, ...sx }}>
      {children}
    </button>
  );
}

function V2StatusPill({ status, label, style: sx = {} }) {
  const map = {
    ready:    { bg: V2C.greenSoft,  color: V2C.greenDeep,  bar: V2C.green,    text: label || 'Ready' },
    review:   { bg: V2C.warningSoft, color: V2C.warning,   bar: '#D4B840',    text: label || 'Review Needed' },
    pending:  { bg: V2C.plumSoft,   color: V2C.plumMid,    bar: V2C.plumLight, text: label || 'Pending Approval' },
    incomplete:{ bg: V2C.errorSoft, color: V2C.error,      bar: '#C05048',    text: label || 'Incomplete' },
    pass:     { bg: V2C.greenSoft,  color: V2C.greenDeep,  bar: V2C.green,    text: label || 'Pass' },
    warn:     { bg: V2C.warningSoft, color: V2C.warning,   bar: '#D4B840',    text: label || 'Warning' },
    error:    { bg: V2C.errorSoft,  color: V2C.error,      bar: '#C05048',    text: label || 'Error' },
    official: { bg: V2C.greenSoft,  color: V2C.greenDeep,  bar: V2C.green,    text: label || 'Official' },
    generated:{ bg: V2C.warningSoft, color: V2C.warning,   bar: '#D4B840',    text: label || 'Generated' },
    'third-party':{ bg: V2C.cautionSoft, color: V2C.caution, bar: '#C08040', text: label || 'Third-party' },
    missing:  { bg: V2C.errorSoft,  color: V2C.error,      bar: '#C05048',    text: label || 'Missing' },
  };
  const s = map[status] || map.review;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px 3px 7px', background: s.bg, borderRadius: 2, ...sx }}>
      <span style={{ width: 3, height: 10, borderRadius: 1, background: s.bar, flexShrink: 0 }} />
      <span style={{ fontSize: 11.5, fontWeight: 600, color: s.color, whiteSpace: 'nowrap' }}>{s.text}</span>
    </span>
  );
}

function ReadinessRing({ score, size = 56 }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(Math.max(score, 0), 100);
  const fill = (pct / 100) * circ;
  const color = pct >= 85 ? V2C.greenDark : pct >= 60 ? '#C4A010' : V2C.error;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={V2C.borderLight} strokeWidth="5" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${fill} ${circ - fill}`} strokeLinecap="round" />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: size * 0.265, color, lineHeight: 1 }}>{pct}</span>
      </div>
    </div>
  );
}

function ConfidenceBar({ value, width = 120 }) {
  const color = value >= 85 ? V2C.greenDark : value >= 65 ? '#C4A010' : V2C.caution;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width, height: 5, background: V2C.borderLight, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${value}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 11.5, fontWeight: 600, color, minWidth: 28 }}>{value}%</span>
    </div>
  );
}

function CheckRow({ check }) {
  const map = {
    pass:    { icon: '✓', color: V2C.greenDeep, bg: V2C.greenSoft },
    warn:    { icon: '!', color: V2C.warning,   bg: V2C.warningSoft },
    error:   { icon: '✕', color: V2C.error,     bg: V2C.errorSoft },
    pending: { icon: '○', color: V2C.plumMid,   bg: V2C.plumSoft },
  };
  const s = map[check.status] || map.warn;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: `1px solid ${V2C.borderLight}` }}>
      <div style={{ width: 20, height: 20, borderRadius: '50%', background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: s.color }}>{s.icon}</span>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{check.label}</span>
        </div>
        <p style={{ fontSize: 11.5, color: V2C.textMuted, marginTop: 2, lineHeight: 1.5 }}>{check.note}</p>
      </div>
    </div>
  );
}

function V2Card({ children, style: sx = {}, pad = 20 }) {
  return (
    <div style={{ background: V2C.surfaceWhite, border: `1px solid ${V2C.border}`, borderRadius: 4, padding: pad, ...sx }}>
      {children}
    </div>
  );
}

function V2SectionHeader({ children, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
      <V2Label>{children}</V2Label>
      {action}
    </div>
  );
}

Object.assign(window, {
  V2C, V2_PART, V2_QUEUE,
  V2Label, V2Btn, V2StatusPill, ReadinessRing, ConfidenceBar, CheckRow, V2Card, V2SectionHeader,
});
