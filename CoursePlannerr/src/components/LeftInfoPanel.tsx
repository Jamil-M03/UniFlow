import { useState } from "react";
import type { Course } from '../types';

type Tab = 'welcome' | 'info' | 'crn';

type Props = {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  selectedCourse: Course | null;
  selectedCrns: string[];
  scheduled: Course[];
  onToggleSchedule: (course: Course) => void;
};

function TabButton({ label, title, isActive, onClick }: { label: string; title: string; isActive: boolean; onClick: () => void }) {
  return (
    <button type="button" title={title} className={`sideTabs__tab ${isActive ? 'isActive' : ''}`} onClick={onClick}>
      {label}
    </button>
  );
}

function Row({ label, value, alwaysShow }: { label: string; value: React.ReactNode; alwaysShow?: boolean }) {
  if (!alwaysShow && (!value || (typeof value === 'string' && value.trim() === '') || value === '—')) return null;
  return (
    <tr>
      <td className="infoK" style={{ verticalAlign: 'top', paddingTop: '5px' }}>{label}:</td>
      <td className="infoV" colSpan={3} style={{ paddingTop: '5px' }}>{value}</td>
    </tr>
  );
}

export function LeftInfoPanel({ activeTab, onTabChange, selectedCourse, selectedCrns, scheduled, onToggleSchedule }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopyCrns = async () => {
    const crns = scheduled.map((c) => c.crn).join('\n');
    try {
      await navigator.clipboard.writeText(crns);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback for older browsers
      const el = document.createElement('textarea');
      el.value = crns;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <aside className="leftPanel">
      <div className="sideTabs" role="tablist" aria-label="Info tabs">
        <TabButton label="🏠" title="Welcome" isActive={activeTab === 'welcome'} onClick={() => onTabChange('welcome')} />
        <TabButton label="ℹ️" title="Course Information" isActive={activeTab === 'info'} onClick={() => onTabChange('info')} />
        <TabButton
          label={scheduled.length > 0 ? `☑ ${scheduled.length}` : '☑'}
          title="Selected Courses"
          isActive={activeTab === 'crn'}
          onClick={() => onTabChange('crn')}
        />
      </div>

      <div className="leftPanel__body">
        {activeTab === 'welcome' && (
          <div className="welcomeBox">
            <p><b>Welcome!</b> This is your AUB course discovery + scheduling workspace.</p>
            <p>Use the search box on the right to find courses. Hover over a result to preview it on the grid. Click to see details here, then press ☑ to add it to your schedule.</p>
            <div className="welcomeBox__hints">
              <div><b>Right-click</b> a course block to change its color</div>
              <div><b>Hover</b> a search result to preview on grid</div>
              <div><b>PDF ↗</b> to export your schedule</div>
            </div>
          </div>
        )}

        {activeTab === 'info' && (
          <div className="infoBox">
            {!selectedCourse ? (
              <div className="emptyState">Select or hover a course to see details.</div>
            ) : (
              <table className="infoTable">
                <tbody>
                  <tr>
                    <td colSpan={4} className="infoTitle">
                      <span>{selectedCourse.code}</span>
                      <span className="infoCrn">CRN {selectedCourse.crn}</span>
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={4} className="infoSubtitle">{selectedCourse.title}</td>
                  </tr>

                  <Row label="Instructor" value={selectedCourse.instructor} />
                  <Row label="Campus" value={selectedCourse.campus} />
                  <Row label="Section" value={selectedCourse.section} />
                  <Row label="Credits" value={selectedCourse.credits != null && selectedCourse.credits > 0 ? String(selectedCourse.credits) : 'N/A'} />
                  <Row label="Capacity" value={`${selectedCourse.capacity.enrolled} / ${selectedCourse.capacity.limit}`} />

                  {selectedCourse.attributes && (Array.isArray(selectedCourse.attributes) ? selectedCourse.attributes.length > 0 : selectedCourse.attributes) && (
                    <tr>
                      <td className="infoK" style={{ verticalAlign: 'top', paddingTop: '5px' }}>Attributes:</td>
                      <td className="infoV" colSpan={3} style={{ paddingTop: '5px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {selectedCourse.attributes.map((a, i) => (
                            <span key={i} style={{
                              backgroundColor: 'rgba(163,38,56,0.15)',
                              color: '#e07080',
                              borderRadius: '4px',
                              padding: '2px 6px',
                              fontSize: '11px',
                              border: '1px solid rgba(163,38,56,0.3)',
                            }}>{a}</span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}

                  {selectedCourse.prerequisites && selectedCourse.prerequisites !== 'None' && (
                    <tr>
                      <td className="infoK" style={{ verticalAlign: 'top', paddingTop: '5px' }}>Prereqs:</td>
                      <td className="infoV" colSpan={3} style={{ paddingTop: '5px', color: '#f0c040', fontSize: '12px' }}>
                        {selectedCourse.prerequisites}
                      </td>
                    </tr>
                  )}

                  {selectedCourse.restrictions && selectedCourse.restrictions !== 'None' && (
                    <tr>
                      <td className="infoK" style={{ verticalAlign: 'top', paddingTop: '5px' }}>Restrictions:</td>
                      <td className="infoV" colSpan={3} style={{ paddingTop: '5px', color: '#f08040', fontSize: '12px' }}>
                        {selectedCourse.restrictions}
                      </td>
                    </tr>
                  )}

                  <tr>
                    <td colSpan={4} className="infoSectionHeader">Sessions</td>
                  </tr>
                  <tr>
                    <td colSpan={4}>
                      <div className="sessions">
                        {selectedCourse.meetings.map((m, idx) => (
                          <div key={idx} className="sessionCard">
                            <div><span className="muted">Timing:</span> {m.days.join('')}&nbsp;{m.start}–{m.end}</div>
                            <div><span className="muted">Instructor:</span> {selectedCourse.instructor}</div>
                            <div><span className="muted">Type:</span> {m.type ?? '—'}</div>
                            <div><span className="muted">Location:</span> {m.location ?? '—'}</div>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'crn' && (
          <div className="crnBox">
            <div className="crnBox__title">
              Selected Courses
              {scheduled.length > 0 && (
                <span style={{
                  marginLeft: 8,
                  fontSize: 11,
                  fontWeight: 400,
                  color: 'var(--muted)',
                }}>
                  {scheduled.length} course{scheduled.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {scheduled.length === 0 ? (
              <div className="emptyState">No courses added yet. Click ☐ on any course to add it.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                {scheduled.map((course) => (
                  <button
                    key={course.id}
                    type="button"
                    onClick={() => onToggleSchedule(course)}
                    title="Click to remove from schedule"
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      width: '100%',
                      padding: '10px 12px',
                      background: 'var(--panel2)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'background 0.15s, border-color 0.15s',
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLButtonElement).style.background = 'rgba(163,38,56,0.08)';
                      (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(163,38,56,0.4)';
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLButtonElement).style.background = 'var(--panel2)';
                      (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
                    }}
                  >
                    {/* Remove icon */}
                    <span style={{
                      flexShrink: 0,
                      marginTop: 1,
                      fontSize: 14,
                      color: '#A32638',
                      opacity: 0.7,
                      lineHeight: 1,
                    }}>✕</span>

                    {/* Course info */}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: 'var(--text)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {course.code}
                        <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 6, fontSize: 11 }}>
                          §{course.section}
                        </span>
                      </div>
                      <div style={{
                        fontSize: 11,
                        color: 'var(--muted)',
                        marginTop: 2,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {course.title}
                      </div>
                      <div style={{
                        fontSize: 11,
                        color: 'var(--muted)',
                        marginTop: 2,
                        display: 'flex',
                        gap: 8,
                      }}>
                        <span>CRN {course.crn}</span>
                        {course.credits != null && course.credits > 0 && (
                          <span>{course.credits} cr</span>
                        )}
                        {course.meetings?.[0] && (
                          <span>{course.meetings[0].days.join('')} {course.meetings[0].start}–{course.meetings[0].end}</span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}

                {/* Summary + Copy CRNs row */}
                <div style={{
                  marginTop: 4,
                  padding: '8px 12px',
                  background: 'var(--bg)',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 12,
                  color: 'var(--muted)',
                }}>
                  <span>Total credits</span>
                  <span style={{ fontWeight: 700, color: 'var(--text)' }}>
                    {scheduled.reduce((sum, c) => sum + (c.credits ?? 0), 0)}
                  </span>
                </div>

                {/* Copy CRNs button */}
                <button
                  type="button"
                  onClick={handleCopyCrns}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 7,
                    width: '100%',
                    padding: '9px 12px',
                    background: copied ? 'rgba(34,197,94,0.12)' : 'var(--panel2)',
                    border: `1px solid ${copied ? 'rgba(34,197,94,0.4)' : 'var(--border)'}`,
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 600,
                    color: copied ? '#22c55e' : 'var(--muted)',
                    transition: 'all 0.2s',
                    fontFamily: 'inherit',
                  }}
                  onMouseEnter={e => {
                    if (!copied) {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(163,38,56,0.4)';
                      (e.currentTarget as HTMLButtonElement).style.color = '#A32638';
                      (e.currentTarget as HTMLButtonElement).style.background = 'rgba(163,38,56,0.06)';
                    }
                  }}
                  onMouseLeave={e => {
                    if (!copied) {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
                      (e.currentTarget as HTMLButtonElement).style.color = 'var(--muted)';
                      (e.currentTarget as HTMLButtonElement).style.background = 'var(--panel2)';
                    }
                  }}
                >
                  {copied ? (
                    <>
                      <span style={{ fontSize: 13 }}>✓</span>
                      CRNs copied!
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 13 }}>⧉</span>
                      Copy all CRNs
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
