import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CloudOff, LogIn, LogOut, RefreshCw, UserRound } from 'lucide-react'
import { sync, useSyncState } from '../sync/engine'
import IconButton from './IconButton'

/** Bottom of the sidebar: who is signed in and how sync is doing, or a Log in button. */
export default function AccountPanel() {
  const s = useSyncState()
  const [open, setOpen] = useState(false)

  if (!s.ready) return <div className="account" />

  if (!s.user) {
    return (
      <div className="account">
        <button className="account-login" onClick={() => setOpen(true)}>
          <LogIn size={16} strokeWidth={1.75} aria-hidden="true" />
          Log in
        </button>
        <span className="account-note">Notes stay on this device until you do.</span>
        {s.error && <span className="account-error">{s.error}</span>}
        {open && <LoginDialog onClose={() => setOpen(false)} />}
      </div>
    )
  }

  const status = !s.online
    ? 'Offline'
    : s.error
      ? s.error
      : s.syncing
        ? 'Syncing…'
        : s.pending > 0
          ? `${s.pending} pending`
          : s.connected
            ? 'Synced · live'
            : 'Synced'
  const tone = !s.online || s.error ? 'warn' : s.pending > 0 || s.syncing ? 'busy' : 'ok'

  return (
    <div className="account">
      <span className="account-user">
        <UserRound size={16} strokeWidth={1.75} aria-hidden="true" />
        <span className="account-name">{s.user.name}</span>
      </span>
      <span className={`account-status ${tone}`} title={s.lastSyncAt ? `Last sync ${new Date(s.lastSyncAt).toLocaleTimeString()}` : undefined}>
        {!s.online ? (
          <CloudOff size={13} strokeWidth={2} aria-hidden="true" />
        ) : (
          <span className="status-dot" aria-hidden="true" />
        )}
        {status}
      </span>
      <span className="account-actions">
        <IconButton icon={RefreshCw} label="Sync now" size={16} onClick={() => sync.kick()} />
        <IconButton icon={LogOut} label="Log out" size={16} align="end" onClick={() => void sync.logout()} />
      </span>
    </div>
  )
}

function LoginDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (el && !el.open) el.showModal()
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await sync.login(name.trim(), password)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={ref}
      className="login-dialog"
      aria-label="Log in"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <form className="login-form" onSubmit={submit}>
        <h2>
          <img className="brand-icon" src="/pilefile-icon.svg" alt="" width={22} height={22} />
          Log in to PileFile
        </h2>
        <p className="muted small">Anything already on this device is merged into your account.</p>
        <label>
          Username
          <input autoFocus autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="account-error" role="alert">{error}</p>}
        <div className="login-actions">
          <button type="button" className="text-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-btn" disabled={busy || !name.trim() || !password}>
            {busy ? 'Logging in…' : 'Log in'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
