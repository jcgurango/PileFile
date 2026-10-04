import type { ComponentProps, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

interface Props extends Omit<ComponentProps<'button'>, 'children'> {
  icon: LucideIcon
  /** Accessible name. Also the tooltip unless `hint` is given. */
  label: string
  /** Tooltip text when it should say more than the label, e.g. a shortcut. */
  hint?: string
  active?: boolean
  danger?: boolean
  size?: number
  /** Where the tooltip appears relative to the button. */
  tip?: 'top' | 'bottom'
  /** Anchor the tooltip to the button's end edge, for buttons near the right side of the viewport. */
  align?: 'center' | 'end'
  /** Small text shown after the icon, such as a count. */
  badge?: ReactNode
}

export default function IconButton({
  icon: Icon,
  label,
  hint,
  active,
  danger,
  size = 16,
  tip = 'top',
  align = 'center',
  badge,
  className,
  ...rest
}: Props) {
  const classes = ['ibtn', active && 'active', danger && 'danger', badge !== undefined && 'with-badge', className]
    .filter(Boolean)
    .join(' ')
  return (
    <button
      type="button"
      className={classes}
      aria-label={label}
      aria-pressed={active}
      data-tip={hint ?? label}
      data-tip-pos={tip}
      data-tip-align={align}
      {...rest}
    >
      <Icon size={size} strokeWidth={1.75} aria-hidden="true" />
      {badge !== undefined && <span className="ibtn-badge">{badge}</span>}
    </button>
  )
}
