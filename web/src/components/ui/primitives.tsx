import { AppIcon } from '@/components/ui/AppIcon';
import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import {
  Button,
  Card as AntCard,
  Empty,
  Input,
  Modal as AntModal,
  Segmented,
  Select as AntSelect,
  Spin,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { classNames } from '@/lib/format';

/* --------------------------------------------------------------- spinner */

export function Spinner({ className = '' }: { className?: string }) {
  return <Spin size="small" className={className} />;
}

export function LoadingRow({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-12 justify-center text-slate-400 dark:text-slate-500 text-sm">
      <Spin size="small" />
      {label ? <span>{label}</span> : null}
    </div>
  );
}

/* --------------------------------------------------------------- layout */

export function PageHeader({
  title,
  desc,
  children,
}: {
  title: ReactNode;
  desc?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-6 gap-4">
      <div>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {title}
        </Typography.Title>
        {desc ? <Typography.Text type="secondary">{desc}</Typography.Text> : null}
      </div>
      {children ? <div className="flex items-center gap-2">{children}</div> : null}
    </div>
  );
}

export function Card({
  children,
  className = '',
  ...rest
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <AntCard
      className={classNames('overflow-hidden', className)}
      styles={{ body: { padding: 0 } }}
      {...rest}
    >
      {children}
    </AntCard>
  );
}

export function IconChip({
  icon,
  className = 'bg-primary-50 dark:bg-primary-900/30',
  glyph = 'text-primary-500',
  size = 'w-9 h-9',
}: {
  icon: string;
  className?: string;
  glyph?: string;
  size?: string;
}) {
  return (
    <div className={classNames('rounded-lg flex items-center justify-center flex-shrink-0', size, className)}>
      <AppIcon className={classNames('fas text-sm', icon, glyph)} />
    </div>
  );
}

export function EmptyState({
  icon,
  iconClass = 'bg-slate-100 dark:bg-white/5 text-slate-400',
  title,
  desc,
  children,
}: {
  icon: string;
  iconClass?: string;
  title: ReactNode;
  desc?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="py-16">
      <Empty
        styles={{
          image: { height: 'auto', marginBottom: 0 },
          footer: { display: 'flex', justifyContent: 'center' },
        }}
        image={
          <div className={classNames('inline-flex w-16 h-16 rounded-2xl items-center justify-center', iconClass)}>
            <AppIcon className={classNames('fas text-xl', icon)} />
          </div>
        }
        description={
          <div className="mt-4">
            <p className="text-slate-500 dark:text-slate-400 font-medium">{title}</p>
            {desc ? (
              <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">{desc}</p>
            ) : null}
          </div>
        }
      >
        {children}
      </Empty>
    </div>
  );
}

/* ---------------------------------------------------------------- toggles */

export function Toggle({
  checked,
  onChange,
  size = 'sm',
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  size?: 'sm' | 'md';
}) {
  return <Switch size={size === 'md' ? 'default' : 'small'} checked={checked} onChange={onChange} />;
}

/* ------------------------------------------------------------- segmented */

export interface TabItem {
  id: string;
  label: ReactNode;
  icon?: string;
}

export function SegmentedTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <Segmented
      value={active}
      onChange={(value) => onChange(String(value))}
      options={tabs.map((tab) => ({
        value: tab.id,
        label: (
          <span className="inline-flex items-center gap-1.5">
            {tab.icon ? <AppIcon className={classNames('fas', tab.icon)} /> : null}
            <span>{tab.label}</span>
          </span>
        ),
      }))}
    />
  );
}

/* --------------------------------------------------------------- buttons */

/** Button props with antd-conflicting keys (type/color/size) removed. */
type ButtonBaseProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'type' | 'color' | 'size'
> & {
  type?: ButtonHTMLAttributes<HTMLButtonElement>['type'];
};

export function PrimaryButton({ children, className = '', type, ...rest }: ButtonBaseProps) {
  return (
    <Button type="primary" htmlType={type ?? 'button'} className={className} {...rest}>
      {children}
    </Button>
  );
}

export function SecondaryButton({ children, className = '', type, ...rest }: ButtonBaseProps) {
  return (
    <Button htmlType={type ?? 'button'} className={className} {...rest}>
      {children}
    </Button>
  );
}

export function DangerButton({ children, className = '', type, ...rest }: ButtonBaseProps) {
  return (
    <Button danger type="primary" htmlType={type ?? 'button'} className={className} {...rest}>
      {children}
    </Button>
  );
}

/* ----------------------------------------------------------------- inputs */

export const inputClass =
  'w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-white/5 ' +
  'text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:border-primary-500 transition-colors';

export const monoInputClass = inputClass + ' font-mono';

export function TextField({ className = '', size: _size, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <Input className={className} {...rest} />;
}

export function TextArea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <Input.TextArea className={className} {...rest} />;
}

export function Field({
  label,
  tip,
  children,
  hint,
}: {
  label: ReactNode;
  tip?: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">
        <span>{label}</span>
        {tip ? (
          <span className="cfg-tip" data-tip-key={tip}>
            <AppIcon className="fas fa-circle-question" />
          </span>
        ) : null}
      </label>
      {children}
      {hint ? <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">{hint}</p> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- badges */

export function Badge({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Tag bordered={false} className={className}>
      {children}
    </Tag>
  );
}

/* -------------------------------------------------------------- dropdown */

export interface DropdownOption {
  value: string;
  label: string;
}

export function Dropdown({
  options,
  value,
  onChange,
  placeholder = '--',
  className = '',
  disabled = false,
}: {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <AntSelect
      className={className}
      value={value}
      onChange={(next) => onChange(next)}
      placeholder={placeholder}
      disabled={disabled}
      options={options.map((opt) => ({ value: opt.value, label: opt.label }))}
      style={{ width: '100%' }}
    />
  );
}

/* ----------------------------------------------------------------- modal */

const MODAL_WIDTHS: Record<string, number> = {
  'max-w-sm': 384,
  'max-w-md': 480,
  'max-w-lg': 560,
  'max-w-xl': 640,
  'max-w-2xl': 720,
  'max-w-3xl': 840,
  'max-w-4xl': 960,
};

export function Modal({
  open,
  onClose,
  children,
  maxWidth = 'max-w-md',
  z: _z = 'z-[200]',
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
  z?: string;
}) {
  return (
    <AntModal
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      centered
      destroyOnHidden
      width={MODAL_WIDTHS[maxWidth] ?? 480}
      styles={{ body: { padding: 0 } }}
    >
      {children}
    </AntModal>
  );
}

export function ModalHeader({
  icon,
  iconChip = 'bg-primary-50 dark:bg-primary-900/20',
  iconGlyph = 'text-primary-500',
  title,
  subtitle,
}: {
  icon: string;
  iconChip?: string;
  iconGlyph?: string;
  title: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <IconChip icon={icon} className={iconChip} glyph={iconGlyph} size="w-10 h-10" />
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-base">{title}</h3>
        {subtitle ? (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono truncate">{subtitle}</p>
        ) : null}
      </div>
    </div>
  );
}

export function ModalFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 dark:border-white/5">
      {children}
    </div>
  );
}
