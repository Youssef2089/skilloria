'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'

type Props = {
  id: string
  title: React.ReactNode
  subtitle?: React.ReactNode
  isExpanded: boolean
  onToggleExpand: () => void
  confirmingDelete: boolean
  onRequestDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
  accentColor: string
  children: React.ReactNode
}

const AUTO_CANCEL_DELETE_MS = 5000

export default function CompactListItem({
  id,
  title,
  subtitle,
  isExpanded,
  onToggleExpand,
  confirmingDelete,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  accentColor,
  children,
}: Props) {
  const t = useTranslations('profile_validation.compact_actions')
  const cancelTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (confirmingDelete) {
      cancelTimerRef.current = window.setTimeout(onCancelDelete, AUTO_CANCEL_DELETE_MS)
      return () => {
        if (cancelTimerRef.current) window.clearTimeout(cancelTimerRef.current)
      }
    }
    return
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmingDelete])

  return (
    <div
      data-compact-item-id={id}
      className="compact-card"
      style={{
        position: 'relative',
        background: 'var(--sk-surface)',
        border: `1px solid ${isExpanded ? `color-mix(in srgb, var(--sk-accent) 33%, transparent)` : 'var(--sk-border)'}`,
        borderRadius: 12,
        padding: '12px 14px',
        marginBottom: 8,
        transition: 'border-color 200ms ease, box-shadow 200ms ease',
        boxShadow: isExpanded ? `0 4px 16px color-mix(in srgb, var(--sk-accent) 8%, transparent)` : 'none',
      }}
    >
      <style>{`
        @keyframes compact-expand {
          from { opacity: 0; max-height: 0; }
          to { opacity: 1; max-height: 1000px; }
        }
        .compact-edit-fields {
          animation: compact-expand 200ms ease-out both;
          overflow: hidden;
          padding-top: 14px;
          margin-top: 12px;
          border-top: 1px solid var(--sk-surface-2);
        }
        .compact-icon-btn {
          width: 30px; height: 30px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: none;
          background: transparent;
          color: var(--sk-muted);
          cursor: pointer;
          border-radius: 8px;
          font-size: 14px;
          transition: background 0.15s, color 0.15s;
          padding: 0;
        }
        .compact-icon-btn:hover:not(:disabled) {
          background: var(--sk-surface-2);
          color: var(--sk-text);
        }
        .compact-icon-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .compact-icon-btn-active { color: var(--compact-accent) !important; background: var(--compact-accent-soft); }
        .compact-icon-btn-danger:hover:not(:disabled) { color: var(--sk-red) !important; background: var(--sk-red-soft); }
      `}</style>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          ['--compact-accent' as string]: accentColor,
          ['--compact-accent-soft' as string]: `color-mix(in srgb, var(--sk-accent) 11%, transparent)`,
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: accentColor,
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sk-text)', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title || <span style={{ color: 'var(--sk-muted)', fontWeight: 400, fontStyle: 'italic' }}>—</span>}
          </div>
          {subtitle && (
            <div style={{ fontSize: 12, color: 'var(--sk-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {subtitle}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <button
            type="button"
            className={`compact-icon-btn ${isExpanded ? 'compact-icon-btn-active' : ''}`}
            aria-label={isExpanded ? t('collapse') : t('expand')}
            aria-expanded={isExpanded}
            title={isExpanded ? t('collapse') : t('expand')}
            onClick={onToggleExpand}
            disabled={confirmingDelete}
          >
            {isExpanded ? '▾' : '✏️'}
          </button>
          <button
            type="button"
            className="compact-icon-btn compact-icon-btn-danger"
            aria-label={t('delete')}
            title={t('delete')}
            onClick={onRequestDelete}
            disabled={confirmingDelete}
          >
            🗑
          </button>
        </div>
      </div>

      {confirmingDelete && (
        <div
          role="alertdialog"
          aria-label={t('confirm_delete_question')}
          style={{
            marginTop: 12,
            padding: '12px 14px',
            background: 'var(--sk-red-soft)',
            border: '1px solid var(--sk-red-soft)',
            borderRadius: 10,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 10,
            justifyContent: 'space-between',
            animation: 'compact-expand 200ms ease-out both',
          }}
        >
          <div style={{ fontSize: 13, color: 'var(--sk-red)', fontWeight: 600, flex: '1 1 auto' }}>
            ⚠️ {t('confirm_delete_question')}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={onCancelDelete}
              autoFocus
              style={{
                height: 34,
                padding: '0 14px',
                background: 'var(--sk-surface)',
                border: '1px solid var(--sk-border)',
                color: 'var(--sk-muted)',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={onConfirmDelete}
              style={{
                height: 34,
                padding: '0 14px',
                background: 'var(--sk-red)',
                border: '1px solid var(--sk-red)',
                color: 'var(--sk-sur-accent)',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {t('confirm_delete_button')}
            </button>
          </div>
        </div>
      )}

      {isExpanded && !confirmingDelete && <div className="compact-edit-fields">{children}</div>}
    </div>
  )
}
